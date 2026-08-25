'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..')
const contentRoot = path.join(repoRoot, '01_content')

function resolveRepositoryRoot() {
  const override = process.env.DSH_WORKTABLE_REPO
  return override ? path.resolve(override) : repoRoot
}

function requireLocalDependency(name) {
  const root = resolveRepositoryRoot()
  const dependencyPath = require.resolve(name, { paths: [path.join(root, '01_content')] })
  return require(dependencyPath)
}

function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)
  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function createDisposableProfile(prefix = 'dsh-worktable-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function assertDisposablePath(targetPath) {
  const root = fs.realpathSync.native(path.resolve(os.tmpdir()))
  const resolvedTarget = path.resolve(targetPath)
  let target = resolvedTarget
  try {
    target = fs.realpathSync.native(resolvedTarget)
  } catch {
    try {
      target = path.join(fs.realpathSync.native(path.dirname(resolvedTarget)), path.basename(resolvedTarget))
    } catch {
      target = resolvedTarget
    }
  }
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error(`refusing cleanup outside disposable temp root: ${target}`)
  }
}

async function removeDisposableProfile(profilePath) {
  if (!profilePath) return
  assertDisposablePath(profilePath)
  const target = path.resolve(profilePath)
  let lastError = null
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 0 })
      if (!fs.existsSync(target)) return
    } catch (error) {
      lastError = error
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code)) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000, 50 * (attempt + 1))))
  }
  if (fs.existsSync(target)) {
    const error = lastError ?? new Error(`cleanup did not remove ${target}`)
    throw new Error(`disposable profile cleanup failed after retries: ${target} (${error.code ?? error.message})`)
  }
}

function waitForChildExit(child) {
  if (!child || child.exitCode !== null || child.signalCode) return Promise.resolve()
  return new Promise((resolve) => child.once('close', resolve))
}

async function stopChild(child) {
  if (!child) return
  if (child.exitCode === null && !child.signalCode) child.kill()
  await waitForChildExit(child)
}

/** Stop only the exact disposable runtime PID and its descendants. */
async function stopChildTree(child) {
  if (!child) return
  if (child.exitCode === null && !child.signalCode && child.pid) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } else {
      try { process.kill(-child.pid, 'SIGTERM') } catch (error) { if (error?.code !== 'ESRCH') throw error }
      try { child.kill('SIGTERM') } catch (error) { if (error?.code !== 'ESRCH') throw error }
    }
  }
  await waitForChildExit(child)
}

function jsonForBrowser(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

module.exports = {
  repoRoot,
  contentRoot,
  resolveRepositoryRoot,
  requireLocalDependency,
  resolveChromePath,
  createDisposableProfile,
  removeDisposableProfile,
  assertDisposablePath,
  waitForChildExit,
  stopChild,
  stopChildTree,
  jsonForBrowser,
}
