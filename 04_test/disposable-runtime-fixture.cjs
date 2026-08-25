/* Self-contained disposable runtime used only for the service-restart probe. */
'use strict'

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { fixtureHtml } = require('./control-room-acceptance.cjs')

const bundlePath = path.resolve(__dirname, '..', '01_content', 'lib', 'client.js')
const port = Number(process.env.DSH_RUNTIME_PORT)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DSH_RUNTIME_PORT must be an explicit TCP port')
const bundle = fs.readFileSync(bundlePath)
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

let closing = false
function close() {
  if (closing) return
  closing = true
  server.close(() => process.exit(0))
}
process.once('SIGTERM', close)
process.once('SIGINT', close)
server.listen(port, '127.0.0.1')
