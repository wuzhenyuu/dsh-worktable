'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

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

function removeDisposableProfile(profilePath) {
  if (profilePath && path.resolve(profilePath).startsWith(path.join(os.tmpdir(), ''))) {
    try {
      fs.rmSync(profilePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    } catch (error) {
      // Chrome can release its lock just after the child receives SIGTERM. The
      // caller has already stopped the disposable process; leave a precise
      // cleanup note instead of masking the probe result with EPERM.
      if (!error || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error
      process.stderr.write(`test-harness: deferred cleanup for ${profilePath} (${error.code})\n`)
    }
  }
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
  jsonForBrowser,
}
