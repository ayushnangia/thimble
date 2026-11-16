// The workbench server: the token in the URL, the Host and Origin checks, and the card frame's sandbox.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { COPILOT, folder } from './helpers.mjs'
import { createServer, FRAME_CSP, PAGE_CSP } from '../lib/server.mjs'
import { Store } from '../lib/store.mjs'

let srv
let url
const actions = []

before(async () => {
  const store = new Store({ sessionId: 'server', cwd: folder(), persist: false })
  store.add('citations', { words: 'w', sentence: '[w]', status: 'unchecked' })
  srv = createServer({ store, onAction: async (n, i) => { actions.push([n, i]); return { ok: true } }, onSettings: async () => ({}), getSettings: async () => ({ values: {} }) })
  url = new URL(await srv.listen())
})
after(() => srv.close())

/** A request with Node's http (fetch would not let a test set Host). */
function req(p, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: url.port, path: p, method, headers }, res => {
      let text = ''
      res.setEncoding('utf8').on('data', d => { text += d }).on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }))
    })
    r.on('error', reject)
    r.end(body)
  })
}

test('the URL is on 127.0.0.1 with a long random token', () => {
  assert.equal(url.hostname, '127.0.0.1')
  assert.match(url.pathname, /^\/s\/[A-Za-z0-9_-]{30,}\/$/)
})

test('the workbench is served with the token, with its CSP', async () => {
  const r = await req(url.pathname)
  assert.equal(r.status, 200)
  assert.match(r.headers['content-type'], /text\/html/)
  assert.match(r.text, /workbench\.js/)
  assert.equal(r.headers['content-security-policy'], PAGE_CSP)
  const s = await req(`${url.pathname}api/state`)
  assert.equal(s.status, 200)
  assert.equal(JSON.parse(s.text).citations.length, 1)
})

test('without the token, or with a wrong one, it answers 403', async () => {
  assert.equal((await req('/')).status, 403)
  assert.equal((await req('/index.html')).status, 403)
  assert.equal((await req('/s/wrong-token/')).status, 403)
  assert.equal((await req(`/s/${srv.token.slice(0, -1)}x/api/state`)).status, 403)
})

test('another Host (DNS rebinding) answers 403', async () => {
  assert.equal((await req(url.pathname, { headers: { Host: `evil.example:${url.port}` } })).status, 403)
})

test('a POST from another origin answers 403; JSON from the page is taken', async () => {
  const body = JSON.stringify({ name: 'verify', input: {} })
  const bad = await req(`${url.pathname}api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body })
  assert.equal(bad.status, 403)
  const form = await req(`${url.pathname}api/action`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: url.origin }, body })
  assert.equal(form.status, 415)
  assert.equal(actions.length, 0)
  const ok = await req(`${url.pathname}api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url.origin }, body })
  assert.equal(ok.status, 200)
  assert.deepEqual(actions, [['verify', {}]])
})

test('no path leaves the ui folder or the upstream files it names', async () => {
  assert.equal((await req(`${url.pathname}..%2f..%2fpackage.json`)).status, 403)
  assert.equal((await req(`${url.pathname}upstream/settings/features.mjs`)).status, 404)
  const up = await req(`${url.pathname}upstream/marks/message.js`)
  assert.equal(up.status, 200)
  assert.match(up.headers['content-type'], /javascript/)
})

test('cards run in a sandboxed iframe with no same-origin and no network', async () => {
  const js = fs.readFileSync(path.join(COPILOT, 'ui', 'workbench.js'), 'utf8')
  const frames = [...js.matchAll(/sandbox(?:="|\s*:\s*'|\s*=\s*')([^"']*)["']/g)].map(m => m[1])
  assert.ok(frames.length > 0, 'workbench.js sets a sandbox')
  for (const s of frames) {
    assert.deepEqual(s.trim().split(/\s+/), ['allow-scripts'])
  }
  assert.doesNotMatch(js, /allow-same-origin/)
  assert.match(FRAME_CSP, /default-src 'none'/)
  assert.doesNotMatch(FRAME_CSP, /connect-src (?!'none')/)
  const f = await req(`${url.pathname}frame.html`)
  assert.equal(f.status, 200)
  assert.equal(f.headers['content-security-policy'], FRAME_CSP)
})
