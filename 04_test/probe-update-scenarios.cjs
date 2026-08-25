/* Update-check scenarios. A supplied loopback DSH fixture is required for the
 * interactive matrix; the active 3080 service is never a valid prerequisite. */
'use strict'

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const {
  requireLocalDependency,
  resolveRepositoryRoot,
  resolveChromePath,
  createDisposableProfile,
  assertDisposablePath,
  removeDisposableProfile,
  stopChild,
} = require('./test-harness.cjs')

const WebSocket = requireLocalDependency('ws')
const repo = resolveRepositoryRoot()
const finalBundle = path.join(repo, '01_content', 'lib', 'client.js')

function fixtureHtml() {
  return [
    '<!doctype html><html><body><div data-phase="active"></div>',
    '<script>window.__ModuleLoader__={load:function(spec){window.__dshLoadedSpec=spec;}};</script>',
    '<script src="/bundle.js"></script>',
    '</body></html>',
  ].join('\n')
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function startFixture() {
  const bundle = fs.readFileSync(finalBundle)
  const server = http.createServer((request, response) => {
    if (request.url === '/bundle.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
      response.end(bundle)
      return
    }
    if (request.url === '/' || request.url === '/index.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(fixtureHtml())
      return
    }
    response.writeHead(404)
    response.end('not found')
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }))
  })
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    })
    request.once('error', reject)
  })
}

async function waitForJson(url, attempts = 100) {
  let lastError = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await getJson(url) } catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 200)) }
  }
  throw lastError || new Error('timed out waiting for ' + url)
}

function createCdp(socket) {
  let id = 0
  const pending = new Map()
  const eventWaiters = new Map()
  const eventHandlers = new Map()
  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw))
    if (message.id) {
      const waiter = pending.get(message.id)
      if (!waiter) return
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message || 'CDP error'))
      else waiter.resolve(message.result)
      return
    }
    const waiters = eventWaiters.get(message.method)
    if (waiters) {
      eventWaiters.delete(message.method)
      waiters.forEach((resolve) => resolve(message.params))
    }
    for (const handler of eventHandlers.get(message.method) || []) handler(message.params)
  })
  return {
    send(method, params = {}) {
      const messageId = ++id
      return new Promise((resolve, reject) => {
        pending.set(messageId, { resolve, reject })
        socket.send(JSON.stringify({ id: messageId, method, params }))
      })
    },
    event(method) {
      return new Promise((resolve) => {
        const waiters = eventWaiters.get(method) || []
        waiters.push(resolve)
        eventWaiters.set(method, waiters)
      })
    },
    on(method, handler) {
      const handlers = eventHandlers.get(method) || []
      handlers.push(handler)
      eventHandlers.set(method, handlers)
      return () => eventHandlers.set(method, handlers.filter((item) => item !== handler))
    },
  }
}

async function closeSocket(socket) {
  if (!socket || socket.readyState === WebSocket.CLOSED) return
  await new Promise((resolve) => { socket.once('close', resolve); socket.close() })
}

async function chromePage(chromePath, profilePath, url) {
  const port = await freePort()
  const child = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port,
    '--user-data-dir=' + profilePath, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  let socket = null
  try {
    const targets = await waitForJson('http://127.0.0.1:' + port + '/json/list')
    const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
    if (!target) throw new Error('Chrome did not expose a disposable page target')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await once(socket, 'open')
    const cdp = createCdp(socket)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    async function navigate(nextUrl) {
      const load = cdp.event('Page.loadEventFired')
      await cdp.send('Page.navigate', { url: nextUrl })
      await load
    }
    async function evaluate(expression) {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'browser evaluation failed')
      return result.result.value
    }
    await navigate(url)
    return { child, socket, cdp, navigate, evaluate }
  } catch (error) {
    if (socket) await closeSocket(socket)
    await stopChild(child)
    throw error
  }
}

async function runBundlePreflight(chromePath, fixture, profile) {
  const browser = await chromePage(chromePath, profile, fixture.url)
  try {
    const value = await browser.evaluate('({ id: window.__dshLoadedSpec && window.__dshLoadedSpec.id, factory: window.__dshLoadedSpec && typeof window.__dshLoadedSpec.factory, origin: location.origin })')
    if (!value || value.id !== 'dsh-worktable' || value.factory !== 'function') throw new Error('current branch bundle identity or factory handshake is invalid')
    return value
  } finally {
    await closeSocket(browser.socket)
    await stopChild(browser.child)
  }
}

function loopback(url) {
  return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const OK_BODY = Buffer.from(JSON.stringify({ tag_name: 'v0.1.0', body: 'scenario test', html_url: 'https://example.com/x' })).toString('base64')
const FAIL_BODY = Buffer.from('{"message":"boom"}').toString('base64')
const HI_BODY = Buffer.from(JSON.stringify({ tag_name: 'v0.2.3', body: 'v0.2.3 release notes', html_url: 'https://example.com/hi' })).toString('base64')
const HDRS = [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }]

async function runScenarioMatrix(chromePath, hostUrl, profile) {
  const browser = await chromePage(chromePath, profile, hostUrl.href)
  const mounted = await browser.evaluate('typeof window.__dshUpdateFixtureMount === "function" && !document.querySelector(".dsh-wt_versionRow") ? window.__dshUpdateFixtureMount() : { host: true }')
  if (mounted && mounted.host !== true && (mounted.ok !== true || mounted.id !== 'dsh-worktable' || mounted.updateUi !== true)) {
    throw new Error('disposable update fixture could not execute the production WorktableSection DOM harness: ' + JSON.stringify(mounted))
  }
  let mode = 'success'
  let reqCount = 0
  let fulfillCount = 0
  const removeFetchHandler = browser.cdp.on('Fetch.requestPaused', (params) => {
    reqCount += 1
    const requestId = params.requestId
    const send = (body, responseCode = 200) => browser.cdp.send('Fetch.fulfillRequest', { requestId, responseCode, responseHeaders: HDRS, body }).catch(() => {})
    if (mode === 'pending') setTimeout(() => browser.cdp.send('Fetch.continueRequest', { requestId }).catch(() => {}), 9000)
    else if (mode === 'fail500') send(FAIL_BODY, 500)
    else if (mode === 'twothenok') {
      if (fulfillCount < 2) { fulfillCount += 1; send(FAIL_BODY, 500) } else send(OK_BODY)
    } else if (mode === 'slowok') setTimeout(() => send(OK_BODY), 2500)
    else if (mode === 'hiok') send(HI_BODY)
    else send(OK_BODY)
  })
  await browser.cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*api.github.com*' }] })
  const evaluate = browser.evaluate
  const rowSnap = () => evaluate("(function(){ var r=document.querySelector('.dsh-wt_versionRow'); if(!r) return null; var btn=Array.from(r.querySelectorAll('button')).find(function(b){ return b.textContent.indexOf('检查')>=0 || b.textContent.indexOf('Check')>=0; }); return { text: r.innerText.replace(/\\s+/g,' '), disabled: btn ? btn.disabled : null, label: btn ? btn.textContent.trim() : null }; })()")
  const openSettings = async () => { await evaluate("(function(){ var b=document.querySelector('button[title=\\\"设置\\\"]')||document.querySelector('button[title=\\\"Settings\\\"]'); if(b) b.click(); })()"); await sleep(500) }
  const clickCheck = () => evaluate("(function(){ var r=document.querySelector('.dsh-wt_versionRow'); if(!r) return; var btn=Array.from(r.querySelectorAll('button')).find(function(b){ return b.textContent.indexOf('检查')>=0 || b.textContent.indexOf('Check')>=0; }); if(btn) btn.click(); })()")
  async function scenario(name, options) {
    mode = options.mode
    fulfillCount = 0
    await browser.navigate(hostUrl.href)
    await sleep(6000)
    const rail = await evaluate('!!document.querySelector(\'.dsh-wt_rail\')')
    if (rail) { await evaluate("(function(){ var b=document.querySelector('button.hHd-Xa_toggle'); if(b) b.click(); })()"); await sleep(1500) }
    await evaluate("localStorage.setItem('dsh.worktable.lastUpdateCheck.v1', String(Date.now())); localStorage.removeItem('dsh.worktable.skipVersion.v1');")
    reqCount = 0
    await browser.navigate(hostUrl.href)
    await sleep(6000)
    const rail2 = await evaluate('!!document.querySelector(\'.dsh-wt_rail\')')
    if (rail2) { await evaluate("(function(){ var b=document.querySelector('button.hHd-Xa_toggle'); if(b) b.click(); })()"); await sleep(1500) }
    await openSettings()
    const before = await rowSnap()
    await clickCheck()
    if (options.reentry) for (let index = 0; index < 4; index += 1) await clickCheck()
    await sleep(Math.min(900, options.waitMs))
    const mid = await rowSnap()
    await sleep(options.waitMs)
    const end = await rowSnap()
    console.log('SCENARIO[' + name + '] requests=' + reqCount)
    console.log('  mid:', JSON.stringify(mid))
    console.log('  end:', JSON.stringify(end))
    return { before, mid, end, requests: reqCount }
  }
  try {
    const results = []
    results.push(['1-success', await scenario('1-success', { mode: 'success', waitMs: 4000 })])
    results.push(['2-pending-timeout', await scenario('2-pending-timeout', { mode: 'pending', waitMs: 26000 })])
    results.push(['3-twothenok', await scenario('3-twothenok', { mode: 'twothenok', waitMs: 5000 })])
    results.push(['4-fail-all', await scenario('4-fail-all', { mode: 'fail500', waitMs: 4000 })])
    results.push(['5-reentry', await scenario('5-reentry', { mode: 'slowok', waitMs: 4000, reentry: true })])
    results.push(['6-higher-version', await scenario('6-higher-version', { mode: 'hiok', waitMs: 4000 })])
    const hiState = await evaluate("(function(){ var b=document.querySelector('.dsh-wt_updateBadge'); if(!b) return {badge:false}; b.click(); return {badge:true}; })()")
    await sleep(700)
    const hiCard = await evaluate("(function(){ var c=document.querySelector('.dsh-wt_updateCard'); if(!c) return {card:false}; return {card:true, text:c.innerText.replace(/\\s+/g,' ')}; })()")
    console.log('HI_BADGE:', JSON.stringify(hiState), 'HI_CARD:', JSON.stringify(hiCard))
    let pass = true
    const ok = (condition, label) => { if (!condition) { pass = false; console.log('  FAIL ' + label) } else console.log('  PASS ' + label) }
    const [, s1] = results[0]; ok(s1.requests >= 1 && /已是最新版本|Up to date/.test(s1.end?.text || ''), 'success -> up-to-date')
    const [, s2] = results[1]; ok(s2.requests === 3 && /上次检查未成功|Last check failed/.test(s2.end?.text || ''), 'pending x3 timeout -> failure'); ok(s2.mid?.disabled === true && /检查中|Checking/.test(s2.mid?.label || ''), 'checking button disabled with checking label')
    const [, s3] = results[2]; ok(s3.requests === 3 && /已是最新版本|Up to date/.test(s3.end?.text || ''), 'two failures then success -> up-to-date')
    const [, s4] = results[3]; ok(s4.requests === 3 && /上次检查未成功|Last check failed/.test(s4.end?.text || ''), 'three failures -> failure')
    const [, s5] = results[4]; ok(s5.requests === 1, 'slow response and five clicks keep one in-flight request'); ok(s5.mid?.disabled === true, 'in-flight check button remains disabled')
    const [, s6] = results[5]; ok(s6.requests >= 1 && hiState?.badge === true && hiCard?.card === true && /v0\.2\.3/.test(hiCard?.text || ''), 'higher version -> badge and v0.2.3 card')
    console.log(pass ? 'ALL SCENARIOS PASS' : 'SCENARIO FAILURES PRESENT')
    if (!pass) throw new Error('update scenario behavior assertions failed')
  } finally {
    removeFetchHandler()
    await closeSocket(browser.socket)
    await stopChild(browser.child)
  }
}

async function main() {
  const chromePath = resolveChromePath()
  if (!chromePath) {
    console.log('probe-update-scenarios: SKIPPED (exact prerequisite unavailable: headless Chrome executable not found)')
    return
  }
  if (!fs.existsSync(finalBundle)) {
    console.log('probe-update-scenarios: SKIPPED (exact prerequisite unavailable: current branch final bundle is missing)')
    return
  }
  const profile = createDisposableProfile('dsh-update-scenarios-')
  assertDisposablePath(profile)
  let fixture = null
  try {
    fixture = await startFixture()
    const identity = await runBundlePreflight(chromePath, fixture, profile)
    console.log('bundle-preflight: PASS (current branch final bundle loaded in disposable headless Chrome at ' + identity.origin + ')')
    if (process.env.DSH_UPDATE_TEST_RUN !== '1') {
      console.log('probe-update-scenarios: SKIPPED (exact prerequisite unavailable: set DSH_UPDATE_TEST_RUN=1 to enable the six-scenario interactive matrix)')
      return
    }
    if (!process.env.DSH_UPDATE_SCENARIOS_URL) {
      console.log('probe-update-scenarios: SKIPPED (exact prerequisite unavailable: no disposable DSH/host fixture URL was supplied; active user services are never used)')
      return
    }
    const hostUrl = new URL(process.env.DSH_UPDATE_SCENARIOS_URL)
    if (!loopback(hostUrl)) {
      console.log('probe-update-scenarios: SKIPPED (exact prerequisite unavailable: DSH_UPDATE_SCENARIOS_URL is not a loopback disposable fixture)')
      return
    }
    if (process.env.DSH_UPDATE_SCENARIOS_BUNDLE_ID !== 'dsh-worktable') {
      console.log('probe-update-scenarios: SKIPPED (exact prerequisite unavailable: DSH_UPDATE_SCENARIOS_BUNDLE_ID must be dsh-worktable)')
      return
    }
    const hostBrowser = await chromePage(chromePath, profile, hostUrl.href)
    const hostIdentity = await hostBrowser.evaluate('({ id: window.__dshLoadedSpec && window.__dshLoadedSpec.id, factory: window.__dshLoadedSpec && typeof window.__dshLoadedSpec.factory })')
    await closeSocket(hostBrowser.socket)
    await stopChild(hostBrowser.child)
    if (!hostIdentity || hostIdentity.id !== 'dsh-worktable' || hostIdentity.factory !== 'function') {
      console.log('probe-update-scenarios: SKIPPED (exact prerequisite unavailable: supplied disposable fixture did not prove current-branch dsh-worktable factory identity)')
      return
    }
    console.log('update-fixture-identity: PASS (supplied disposable fixture proved dsh-worktable factory)')
    await runScenarioMatrix(chromePath, hostUrl, profile)
    console.log('probe-update-scenarios: PASS (six disposable-host update scenarios and all behavior assertions)')
  } finally {
    const cleanupErrors = []
    if (fixture) {
      try { await new Promise((resolve, reject) => fixture.server.close((error) => error ? reject(error) : resolve())) } catch (error) { cleanupErrors.push(error) }
    }
    try { await removeDisposableProfile(profile) } catch (error) { cleanupErrors.push(error) }
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'update probe cleanup failed')
  }
}

main().catch((error) => {
  console.error('probe-update-scenarios: FAIL', error && error.stack || error)
  process.exitCode = 1
})
