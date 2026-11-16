// server.mjs: the workbench's local web server, which the `thimble` canvas (and a browser tab) shows. It listens on
// 127.0.0.1 at a random port. Every path carries a random token (`/s/<token>/...`), so another local page or process
// that does not know the URL gets 403, and the relative imports of the page keep the token. The Host header must name
// the loopback address (no DNS rebinding), and a POST must come from the page's own origin.
//
// The page (ui/workbench.html) gets the state and its changes (server-sent events), and posts the analyst's actions.
// A card's view is code the agent wrote: it runs only in ui/frame.html, inside `<iframe sandbox="allow-scripts">`
// without allow-same-origin, so it has an opaque origin, no cookies, no storage, and a CSP with no network at all.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

import { COPILOT_DIR, upstreamRoot } from './upstream.mjs'

const UI_DIR = path.join(COPILOT_DIR, 'ui')
/** The upstream modules the page imports by path (pure; no Node, no DOM): marks, text widths, coverage shares. */
export const UPSTREAM_FILES = new Set(['marks/message.js', 'core/text.js', 'panes/coverage-view.mjs'])
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' }
export const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors *"
export const FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"
const MAX_BODY = 2 * 1024 * 1024

const same = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y) }

/**
 * @param {{store: import('./store.mjs').Store, onAction: (name: string, input: any) => Promise<any>,
 *          onSettings: (key: string, value: any) => Promise<any>, getSettings: () => Promise<any>,
 *          onCardResult?: (r: any) => void, token?: string}} o
 */
export function createServer({ store, onAction, onSettings, getSettings, onCardResult = () => {}, token = crypto.randomBytes(24).toString('base64url') }) {
  const clients = new Set()
  let port = 0
  const base = `/s/${token}/`

  const headers = (type, extra = {}) => ({
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...extra,
  })
  const send = (res, code, body, type = 'text/plain; charset=utf-8', extra = {}) => { res.writeHead(code, headers(type, extra)); res.end(body) }
  const json = (res, code, v) => send(res, code, JSON.stringify(v), 'application/json; charset=utf-8')

  const file = (res, abs, extra = {}) => {
    try {
      const body = fs.readFileSync(abs)
      send(res, 200, body, TYPES[path.extname(abs)] || 'application/octet-stream', extra)
    } catch {
      send(res, 404, 'not found')
    }
  }

  const body = req => new Promise((resolve, reject) => {
    let n = 0
    const chunks = []
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { reject(new Error('too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { reject(new Error('bad JSON')) } })
    req.on('error', reject)
  })

  const okHost = h => h === `127.0.0.1:${port}` || h === `localhost:${port}` || h === `[::1]:${port}`
  const okOrigin = o => !o || o === `http://127.0.0.1:${port}` || o === `http://localhost:${port}`

  const server = http.createServer(async (req, res) => {
    try {
      if (!okHost(req.headers.host || '')) return send(res, 403, 'forbidden')
      const url = new URL(req.url || '/', 'http://x')
      const m = /^\/s\/([^/]+)\/(.*)$/.exec(url.pathname)
      if (!m || !same(m[1], token)) return send(res, 403, 'forbidden')
      const rest = decodeURIComponent(m[2])
      if (rest.includes('..') || rest.includes('\\')) return send(res, 403, 'forbidden')

      if (req.method === 'GET') {
        if (rest === '' || rest === 'index.html') return file(res, path.join(UI_DIR, 'workbench.html'), { 'Content-Security-Policy': PAGE_CSP })
        if (rest === 'frame.html') return file(res, path.join(UI_DIR, 'frame.html'), { 'Content-Security-Policy': FRAME_CSP })
        if (/^ui\/[A-Za-z0-9_.-]+\.(js|css|svg)$/.test(rest)) return file(res, path.join(UI_DIR, rest.slice(3)))
        if (rest.startsWith('upstream/')) {
          const rel = rest.slice('upstream/'.length)
          if (!UPSTREAM_FILES.has(rel)) return send(res, 404, 'not found')
          return file(res, path.join(upstreamRoot(), rel))
        }
        if (rest === 'api/state') return json(res, 200, { ...store.snapshot(), tools: undefined, settings: await getSettings() })
        if (rest === 'api/events') {
          res.writeHead(200, headers('text/event-stream', { Connection: 'keep-alive' }))
          res.write(': thimble\n\n')
          clients.add(res)
          req.on('close', () => clients.delete(res))
          return
        }
        return send(res, 404, 'not found')
      }
      if (req.method === 'POST') {
        if (!okOrigin(req.headers.origin)) return send(res, 403, 'forbidden')
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, 'JSON only')
        const b = await body(req)
        if (rest === 'api/action') return json(res, 200, await onAction(String(b.name || ''), b.input ?? {}))
        if (rest === 'api/settings') return json(res, 200, await onSettings(String(b.key || ''), b.value))
        if (rest === 'api/card-result') { onCardResult(b); return json(res, 200, { ok: true }) }
        return send(res, 404, 'not found')
      }
      return send(res, 405, 'method not allowed')
    } catch (e) {
      if (!res.headersSent) json(res, 500, { ok: false, error: String(e?.message || e) })
    }
  })

  const push = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const c of clients) c.write(msg)
  }
  const onChange = ({ kind, item }) => { if (kind !== 'tools') push('change', { kind, item, counts: store.counts() }) }
  store.on('change', onChange)
  const ping = setInterval(() => push('ping', Date.now()), 25000)
  ping.unref?.()

  return {
    token,
    push,
    pages: () => clients.size,
    get port() { return port },
    get url() { return port ? `http://127.0.0.1:${port}${base}` : '' },
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { port = server.address().port; server.unref(); resolve(`http://127.0.0.1:${port}${base}`) })
    }),
    close: () => new Promise(resolve => { clearInterval(ping); store.off('change', onChange); for (const c of clients) c.end(); server.close(() => resolve()) }),
  }
}
