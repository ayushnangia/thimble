// store.mjs: one session's thimble state, what the workbench shows: the turns and answers, cards, citations, notes
// (explainers, heads-ups, simpler versions, catch-ups), side threads, claims and clusters, labels and coverage. Kept
// in memory, saved as JSON under <thimble home>/sessions/<session id>.json, and `current.json` names the newest
// session and its counts for the status line (statusline.mjs). Every change is an event the workbench's stream sends.
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'

import { newCoverage } from './coverage.mjs'
import { homeDir } from './upstream.mjs'

export const KINDS = ['prompts', 'answers', 'tools', 'cards', 'citations', 'notes', 'threads', 'claims', 'clusters', 'labels']
const MAX = { prompts: 200, answers: 200, tools: 400, cards: 200, citations: 2000, notes: 1000, threads: 200, claims: 2000, clusters: 200, labels: 200 }

// Hex after the prefix: upstream's cardRef reads a card link as `card:c` plus 8 to 16 hex digits.
export const newId = prefix => `${prefix}${crypto.randomBytes(6).toString('hex')}`

export class Store extends EventEmitter {
  constructor({ sessionId = 'local', cwd = process.cwd(), dir = path.join(homeDir(), 'sessions'), persist = true } = {}) {
    super()
    this.setMaxListeners(50)
    this.dir = dir
    this.persist = persist
    this.file = path.join(dir, `${String(sessionId).replace(/[^A-Za-z0-9_.-]/g, '_')}.json`)
    this.state = { sessionId, cwd, model: '', url: '', turn: 0, prompt: '', ...Object.fromEntries(KINDS.map(k => [k, []])), coverage: newCoverage(cwd) }
    if (persist) this.load()
    this.timer = null
  }

  load() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (saved && saved.sessionId === this.state.sessionId) this.state = { ...this.state, ...saved, url: '' }
    } catch { /* a new session */ }
  }

  /** Save soon (one write for a burst of changes). */
  save() {
    if (!this.persist || this.timer) return
    this.timer = setTimeout(() => { this.timer = null; this.flush() }, 250)
    this.timer.unref?.()
  }

  flush() {
    if (!this.persist) return
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.state))
      const bar = JSON.stringify({ sessionId: this.state.sessionId, cwd: this.state.cwd, url: this.state.url, at: new Date().toISOString(), counts: this.counts(), file: this.file })
      fs.writeFileSync(this.file.replace(/\.json$/, '.counts.json'), bar)
      fs.writeFileSync(path.join(path.dirname(this.dir), 'current.json'), bar)
    } catch { /* state is best effort */ }
  }

  changed(kind, item) {
    this.save()
    this.emit('change', { kind, item })
  }

  set(key, value) {
    this.state[key] = value
    this.changed(key, value)
  }

  add(kind, item) {
    const list = this.state[kind]
    const it = { id: item.id || newId(kind[0]), at: new Date().toISOString(), turn: this.state.turn, ...item }
    list.push(it)
    if (list.length > MAX[kind]) list.splice(0, list.length - MAX[kind])
    this.changed(kind, it)
    return it
  }

  get(kind, id) {
    return this.state[kind].find(x => x.id === id) ?? null
  }

  update(kind, id, patch) {
    const it = this.get(kind, id)
    if (!it) return null
    Object.assign(it, typeof patch === 'function' ? patch(it) : patch)
    this.changed(kind, it)
    return it
  }

  /** The last answer of the main agent, or null. */
  lastAnswer() {
    return this.state.answers.at(-1) ?? null
  }

  counts() {
    const s = this.state
    const by = st => s.citations.filter(c => c.status === st).length
    const files = Object.values(s.coverage.files)
    const lines = files.reduce((a, f) => a + (f.lines || 0), 0)
    const read = files.reduce((a, f) => a + (f.readLines || 0), 0)
    return {
      answers: s.answers.length,
      cards: s.cards.length,
      citations: s.citations.length,
      verified: by('verified'),
      corrected: by('corrected') + by('narrowed'),
      wrong: by('wrong'),
      unconfirmed: by('unconfirmed'),
      checking: by('checking'),
      explainers: s.notes.filter(n => n.kind === 'explainer').length,
      headsups: s.notes.filter(n => n.kind === 'headsup').length,
      threads: s.threads.length,
      claims: s.claims.length,
      labels: s.labels.length,
      filesRead: files.filter(f => f.readLines > 0).length,
      filesSeen: files.length,
      coverage: lines ? read / lines : 0,
    }
  }

  /** The session's id once the host has said it (saved under the new name from now on). */
  rename(sessionId) {
    this.state.sessionId = sessionId
    this.file = path.join(this.dir, `${String(sessionId).replace(/[^A-Za-z0-9_.-]/g, '_')}.json`)
    this.save()
  }

  snapshot() {
    const { tools, ...rest } = this.state
    return { ...rest, tools: tools.length, counts: this.counts() }
  }
}
