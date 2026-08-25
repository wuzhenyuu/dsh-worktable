/* Update-scenario gate.
 *
 * The self-contained part proves that the current branch bundle can load in a
 * disposable headless Chrome.  The interactive update matrix needs a
 * disposable DSH host fixture; an active user service is never a substitute.
 */
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
    '<!doctype html><html><body><div data-phase="active"><div></div><div></div></div>',
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

async function waitForJson(url) {
  let lastError = null
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { return await getJson(url) } catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 200)) }
  }
  throw lastError || new Error('timed out waiting for ' + url)
}

function createCdp(socket) {
  let id = 0
  const pending = new Map()
  const events = new Map()
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
    const waiters = events.get(message.method)
    if (!waiters) return
    events.delete(message.method)
    waiters.forEach((resolve) => resolve(message.params))
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
        const waiters = events.get(method) || []
        waiters.push(resolve)
        events.set(method, waiters)
      })
    },
  }
}

async function runBundlePreflight(chromePath, fixture, profile) {
  const port = await freePort()
  const child = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile, 'about:blank',
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
    const loaded = cdp.event('Page.loadEventFired')
    await cdp.send('Page.navigate', { url: fixture.url })
    await loaded
    const result = await cdp.send('Runtime.evaluate', {
      expression: '({ id: window.__dshLoadedSpec && window.__dshLoadedSpec.id, factory: window.__dshLoadedSpec && typeof window.__dshLoadedSpec.factory, origin: location.origin })',
      returnByValue: true,
    })
    const value = result.result.value
    if (!value || value.id !== 'dsh-worktable' || value.factory !== 'function') throw new Error('current branch bundle identity or factory handshake is invalid')
    return value
  } finally {
    if (socket && socket.readyState === WebSocket.OPEN) {
      await new Promise((resolve) => { socket.once('close', resolve); socket.close() })
    }
    await stopChild(child)
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
    if (!process.env.DSH_UPDATE_SCENARIOS_URL) {
      console.log('probe-update-scenarios: SKIPPED (exact prerequisite unavailable: no disposable DSH/host fixture URL was supplied; active user services are never used)')
      return
    }
    const hostUrl = new URL(process.env.DSH_UPDATE_SCENARIOS_URL)
    if (!['http:', 'https:'].includes(hostUrl.protocol) || !['localhost', '127.0.0.1', '::1'].includes(hostUrl.hostname)) {
      console.log('probe-update-scenarios: SKIPPED (exact prerequisite unavailable: DSH_UPDATE_SCENARIOS_URL is not a loopback disposable fixture)')
      return
    }
    if (process.env.DSH_UPDATE_SCENARIOS_BUNDLE_ID !== 'dsh-worktable' || process.env.DSH_UPDATE_SCENARIOS_RUN !== '1') {
      console.log('probe-update-scenarios: SKIPPED (exact prerequisite unavailable: explicit current-branch host runner and bundle identity gate were not supplied)')
      return
    }
    console.log('probe-update-scenarios: SKIPPED (exact prerequisite unavailable: host fixture supplied no declared current-branch update scenario runner)')
  } finally {
    if (fixture) await new Promise((resolve, reject) => fixture.server.close((error) => error ? reject(error) : resolve()))
    await removeDisposableProfile(profile)
  }
}

main().catch((error) => {
  console.error('probe-update-scenarios: FAIL', error && error.stack || error)
  process.exitCode = 1
})
