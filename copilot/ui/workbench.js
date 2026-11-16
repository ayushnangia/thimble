// workbench.js: thimble's workbench page, the `thimble` canvas (and a browser tab). It reads the session's state
// from the extension's local server, follows its changes (server-sent events), and posts the analyst's actions. It
// draws everything with textContent (the agent's words and the files' lines are text, never HTML). Cards draw in
// frame.html, in a sandboxed frame (allow-scripts only): their code never runs in this page.
// The upstream modules it imports are pure and served by path from the plugin (server.mjs UPSTREAM_FILES).
import { marksIn, cardRef } from '../upstream/marks/message.js'
import { pct } from '../upstream/panes/coverage-view.mjs'

const BASE = location.pathname.replace(/[^/]*$/, '')
const TABS = [
  ['answer', 'Answer', ''], ['cards', 'Cards', 'v'], ['citations', 'Citations', 'c'], ['notes', 'Notes', 'e'],
  ['threads', 'Threads', 't'], ['claims', 'Claims', 'w'], ['coverage', 'Coverage', 'r'], ['labels', 'Labels', 'l'], ['settings', 'Settings', ''],
]
const LIGHT = matchMedia('(prefers-color-scheme: light)')
let S = null
let tab = (location.hash.slice(1) || 'answer')
if (!TABS.some(t => t[0] === tab)) tab = 'answer'
const frames = new Map() // card id -> {wrap, iframe, version, reported}
let askAbout = ''

// ------------------------------------------------------------------ small DOM helpers
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = v
    else if (k === 'text') el.textContent = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c))
  return el
}
const $ = id => document.getElementById(id)
const toast = (msg, ms = 6000) => { const t = $('toast'); t.textContent = msg; clearTimeout(toast.t); toast.t = setTimeout(() => { t.textContent = '' }, ms) }
const when = at => { try { return new Date(at).toLocaleTimeString() } catch { return '' } }

async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}
async function action(name, input = {}) {
  try {
    const r = await post('api/action', { name, input })
    toast(r.ok === false ? `thimble: ${r.error}` : r.started ? `started: ${r.started}` : 'done')
    return r
  } catch (e) { toast(`thimble: ${e.message}`) }
}

// ------------------------------------------------------------------ selection: cite / explain / ask the words
const selbar = h('div', { class: 'selbar', id: 'selbar' },
  h('button', { text: 'cite', onclick: () => doSel('cite') }),
  h('button', { text: 'explain', onclick: () => doSel('explain') }),
  h('button', { text: 'ask', onclick: () => doSel('ask') }))
document.body.append(selbar)
const selected = () => String(getSelection()?.toString() || '').replace(/\s+/g, ' ').trim()
function doSel(what) {
  const words = selected()
  selbar.classList.remove('on')
  if (what === 'ask') { askAbout = words; show('threads'); setTimeout(() => $('ask-q')?.focus(), 0); return }
  if (!words) { toast(`select words of an answer first, then ${what}`); return }
  if (what === 'cite') action('cite', { words, answerId: S?.answers.at(-1)?.id })
  else action('explain', { words })
}
document.addEventListener('mouseup', e => {
  if (selbar.contains(e.target)) return
  setTimeout(() => {
    const w = selected()
    const r = w && getSelection().rangeCount ? getSelection().getRangeAt(0).getBoundingClientRect() : null
    if (!r || !r.width) { selbar.classList.remove('on'); return }
    selbar.style.left = `${Math.max(4, r.left)}px`
    selbar.style.top = `${Math.max(4, r.top - 36)}px`
    selbar.classList.add('on')
  }, 0)
})

// ------------------------------------------------------------------ tabs
function count(id) {
  const c = S?.counts || {}
  return { cards: c.cards, citations: c.citations, notes: (c.explainers || 0) + (c.headsups || 0), threads: c.threads, claims: c.claims, labels: c.labels, coverage: c.filesRead }[id]
}
function renderTabs() {
  $('tabs').replaceChildren(...TABS.map(([id, name, key]) => {
    const n = count(id)
    return h('button', { role: 'tab', 'aria-selected': id === tab ? 'true' : 'false', title: key ? `${name} (${key})` : name, onclick: () => show(id) }, name, n ? h('span', { class: 'n', text: n }) : null)
  }))
  const c = S?.counts || {}
  $('counts').textContent = S ? `${c.answers || 0} answers · ${c.verified || 0}✓ ${c.corrected || 0}~ ${c.wrong || 0}✗ of ${c.citations || 0} citations${c.checking ? ` · checking ${c.checking}` : ''}` : 'connecting…'
}
function show(id) {
  if (!TABS.some(t => t[0] === id)) return
  tab = id
  history.replaceState(null, '', `#${id}`)
  render()
}

const VIEWS = {}
let pending = false
function render() {
  if (pending) return
  pending = true
  requestAnimationFrame(() => {
    pending = false
    renderTabs()
    const main = $('main')
    if (!S) { main.replaceChildren(h('p', { class: 'empty', text: 'connecting to thimble…' })); return }
    // the cards tab keeps its frames: a card draws again only for a new version
    if (tab !== 'cards') for (const f of frames.values()) f.wrap.remove()
    const keepFocus = document.activeElement && main.contains(document.activeElement) && ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement.tagName)
    if (keepFocus && tab !== 'cards') return
    VIEWS[tab](main)
  })
}

// ------------------------------------------------------------------ Answer: the last answer, its marks by status
VIEWS.answer = main => {
  const a = S.answers.at(-1)
  if (!a) { main.replaceChildren(h('p', { class: 'empty', text: 'No answer yet. Ask Copilot something; its last answer shows here, with its citations.' })); return }
  const cites = S.citations.filter(c => c.answerId === a.id && c.source !== 'asked')
  const text = String(a.text || '')
  const box = h('div', { class: 'answer' })
  const marks = marksIn(text)
  let at = 0
  const plain = s => {
    for (const [i, line] of s.split('\n').entries()) {
      if (i) box.append('\n')
      const id = cardRef(line)
      const card = id && S.cards.find(c => c.id === id)
      if (card) box.append(h('span', { class: 'cardref', text: `▣ ${card.title}`, onclick: () => show('cards') }))
      else box.append(line)
    }
  }
  marks.forEach((m, k) => {
    plain(text.slice(at, m.start))
    const c = cites[k]
    box.append(h('span', { class: `mark ${c?.status || ''}`, title: c ? `${c.status}${c.reason ? `: ${c.reason}` : ''}` : 'citation', text: m.words, onclick: () => show('citations') }))
    at = m.end
  })
  plain(text.slice(at))
  main.replaceChildren(
    h('p', { class: 'dim', text: `${when(a.at)}${a.model ? ` · ${a.model}` : ''} · select words to cite, explain or ask about them` }),
    box,
  )
}

// ------------------------------------------------------------------ Cards: each in a sandboxed frame
function theme() { return LIGHT.matches ? 'light' : 'dark' }
function cardFrame(card) {
  let f = frames.get(card.id)
  if (f && f.version === card.version) return f
  if (f) f.wrap.remove()
  const iframe = h('iframe', { class: 'card', sandbox: 'allow-scripts', src: `${BASE}frame.html`, title: card.title, referrerpolicy: 'no-referrer' })
  const top = h('div')
  const wrap = h('div', { class: 'item', 'data-card': card.id }, top, iframe)
  f = { wrap, top, iframe, version: card.version, reported: card.status !== 'drawing', card }
  frames.set(card.id, f)
  return f
}
window.addEventListener('message', e => {
  const m = e.data
  if (!m || typeof m !== 'object' || m.thimble !== 1) return
  const f = [...frames.values()].find(x => x.iframe.contentWindow === e.source)
  if (!f) return
  if (m.type === 'ready') f.iframe.contentWindow.postMessage({ type: 'draw', card: { id: f.card.id, version: f.card.version, title: f.card.title, view: f.card.view, rows: f.card.rows, data: f.card.data, actions: f.reported ? [] : f.card.actions }, theme: theme() }, '*')
  else if (m.type === 'height') f.iframe.style.height = `${Math.min(2000, Math.max(40, Number(m.height) || 0) + 4)}px`
  else if (m.type === 'drawn' && m.id === f.card.id && m.version === f.card.version && !f.reported) {
    f.reported = true
    post('api/card-result', { id: m.id, version: m.version, ok: !!m.ok, text: String(m.text || ''), error: String(m.error || ''), keys: String(m.keys || '') }).catch(() => {})
  } else if (m.type === 'key') onKey(m.key)
})
VIEWS.cards = main => {
  const list = S.cards.slice().reverse()
  if (!list.length) { main.replaceChildren(h('p', { class: 'empty', text: 'No card yet. Press v (or /thimble-visualize) to draw the last answer as a card.' })); return }
  const out = []
  for (const c of list) {
    const f = cardFrame(c)
    f.card = c
    const head = h('div', { class: 'row' }, h('h3', { text: c.title }), h('span', { class: 'meta', text: `${c.id} · v${c.version} · ${c.status}${c.keys ? ` · keys ${c.keys}` : ''}` }))
    const take = c.takeaway ? h('p', { class: 'meta', text: c.takeaway }) : null
    const err = c.error ? h('pre', { class: 'ev ev-miss', text: c.error }) : null
    // Only the heading changes; moving the iframe would reload it and run the card's code again.
    f.top.replaceChildren(...[head, take, err].filter(Boolean))
    out.push(f.wrap)
  }
  for (const [id, f] of frames) if (!S.cards.some(c => c.id === id)) { f.wrap.remove(); frames.delete(id) }
  const now = [...main.children]
  const k = out.length - now.length
  if (k > 0 && now.every((el, i) => el === out[k + i])) main.prepend(...out.slice(0, k))
  else if (now.length !== out.length || now.some((el, i) => el !== out[i])) main.replaceChildren(...out)
}

// ------------------------------------------------------------------ Citations: each span, its verdict, its evidence
VIEWS.citations = main => {
  const list = S.citations.slice().reverse()
  if (!list.length) { main.replaceChildren(h('p', { class: 'empty', text: 'No citation yet. Select words of an answer and press c (or /thimble-cite); with citations set to auto, each answer brings its own.' })); return }
  main.replaceChildren(...list.map(c => {
    const places = (c.places || []).map(p => h('div', {},
      h('div', { class: 'meta mono', text: `${p.file}:${p.line}${p.found === false ? ' · the quoted words are not on these lines' : ''}${p.error ? ` · ${p.error}` : ''}` }),
      p.text ? h('pre', { class: `ev${p.found === false ? ' ev-miss' : ''}`, text: p.text }) : null))
    const ev = !places.length && c.evidence ? h('pre', { class: 'ev', text: typeof c.evidence === 'string' ? c.evidence : JSON.stringify(c.evidence, null, 1) }) : null
    return h('div', { class: 'item' },
      h('div', {}, h('span', { class: `badge ${c.status}`, text: c.status }), h('b', { text: c.words })),
      c.sentence ? h('div', { class: 'meta', text: c.sentence }) : null,
      c.reason ? h('p', { text: c.reason }) : null,
      c.correction?.words ? h('p', {}, h('span', { class: 'dim', text: 'correction: ' }), c.correction.words) : null,
      c.note ? h('p', { class: 'meta', text: c.note }) : null,
      c.error ? h('p', { class: 'meta', text: c.error }) : null,
      ...places, ev,
      h('div', { class: 'row' },
        h('span', { class: 'meta', text: `${c.source || ''}${c.kind ? ` · ${c.kind}` : ''}${c.model ? ` · ${c.model}` : ''}${c.checkedAt ? ` · ${when(c.checkedAt)}` : ''}` }),
        c.status !== 'checking' ? h('button', { text: c.status === 'unchecked' ? 'verify' : 'verify again', onclick: () => action('verify', { ids: [c.id] }) }) : null))
  }))
}

// ------------------------------------------------------------------ Notes: explainers, heads-ups, simpler versions, catch-ups
VIEWS.notes = main => {
  const list = S.notes.filter(n => !n.dismissed).slice().reverse()
  if (!list.length) { main.replaceChildren(h('p', { class: 'empty', text: 'No note yet. Explainers and heads-ups come after answers (auto), or select words and press e. Press s for a simpler version, b to catch up.' })); return }
  const NAME = { explainer: 'explainer', headsup: 'heads-up', simpler: 'simpler version', catchup: 'catch-up' }
  main.replaceChildren(...list.map(n => h('div', { class: 'item' },
    h('div', { class: 'row' }, h('span', { class: 'badge', text: NAME[n.kind] || n.kind }), h('h3', { text: n.term || n.title || '' }), h('span', { class: 'meta', text: `${n.by || ''} · ${when(n.at)}` })),
    n.kind === 'headsup' && n.title ? h('p', { text: n.title }) : null,
    n.body ? h('p', { class: 'answer', text: n.body }) : null,
    n.here ? h('p', { class: 'meta answer', text: n.here }) : null,
    n.text ? h('div', { class: 'answer', text: n.text }) : null,
    Array.isArray(n.bullets) && n.bullets.length ? h('ul', {}, ...n.bullets.map(b => h('li', { text: b }))) : null,
    h('button', { text: 'dismiss', onclick: () => action('dismiss', { kind: 'notes', id: n.id }) }))))
}

// ------------------------------------------------------------------ Threads: side questions
VIEWS.threads = main => {
  const q = h('textarea', { id: 'ask-q', placeholder: 'A side question (Ctrl+Enter asks). A second model answers it with your files; the conversation does not change.' })
  const about = h('input', { type: 'text', id: 'ask-about', placeholder: 'about (words of an answer, a card…)', value: askAbout, size: 50 })
  const send = () => { const question = q.value.trim(); if (!question) return; action('ask', { question, about: about.value.trim() }); q.value = ''; askAbout = '' }
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send() })
  const list = S.threads.slice().reverse().map(t => {
    const more = h('input', { type: 'text', placeholder: 'continue this thread', size: 60 })
    more.addEventListener('keydown', e => { if (e.key === 'Enter' && more.value.trim()) { action('ask', { question: more.value.trim(), thread: t.id }); more.value = '' } })
    return h('div', { class: 'item thread' },
      h('div', { class: 'row' }, h('h3', { text: t.about }), h('span', { class: 'meta', text: `${t.id} · ${t.status}` })),
      ...t.messages.map(m => h('div', { class: `msg ${m.role}`, text: m.text })), more)
  })
  main.replaceChildren(h('div', { class: 'item' }, q, h('div', { class: 'row' }, about, h('button', { text: 'ask', onclick: send }))), ...list)
}

// ------------------------------------------------------------------ Claims: by cluster
VIEWS.claims = main => {
  if (!S.claims.length) { main.replaceChildren(h('p', { class: 'empty', text: 'No claim yet. Set Claims to auto in Settings, and the observer gathers the claims of each answer.' })); return }
  const by = new Map()
  for (const c of S.claims) { const k = c.cluster || ''; if (!by.has(k)) by.set(k, []); by.get(k).push(c) }
  main.replaceChildren(...[...by].map(([k, list]) => {
    const cl = S.clusters.find(x => x.id === k)
    return h('div', { class: 'item' },
      h('h3', { text: cl?.name || k || 'claims' }), cl?.about ? h('p', { class: 'meta', text: cl.about }) : null,
      h('ul', {}, ...list.map(c => h('li', {},
        h('span', { text: c.claim, style: c.revisedBy ? 'text-decoration: line-through' : null }),
        h('span', { class: 'meta', text: ` · ${c.by}${c.said > 1 ? ` · said ${c.said}x` : ''}${c.revises ? ` · revises ${c.revises}` : ''}` }),
        c.because ? h('div', { class: 'meta', text: c.because }) : null))))
  }))
}

// ------------------------------------------------------------------ Coverage: files read vs their size
VIEWS.coverage = main => {
  const cov = S.coverage || { files: {} }
  const files = Object.values(cov.files || {}).sort((a, b) => (b.readLines || 0) / (b.lines || 1) - (a.readLines || 0) / (a.lines || 1) || a.path.localeCompare(b.path))
  const lines = files.reduce((s, f) => s + (f.lines || 0), 0)
  const read = files.reduce((s, f) => s + (f.readLines || 0), 0)
  const total = cov.total ? `The folder holds ${cov.total.files}${cov.total.capped ? '+' : ''} files. ` : ''
  const head = h('p', { class: 'meta', text: `${total}${files.filter(f => f.read).length} files read, ${files.filter(f => !f.read && f.searched).length} only searched; ${pct(read, lines)} of the lines of the files touched (${read} of ${lines}); ${(cov.searches || []).length} searches, ${cov.shell || 0} shell commands.` })
  if (!files.length) { main.replaceChildren(head, h('p', { class: 'empty', text: 'No file read yet. Coverage counts the lines Copilot reads with view, and the files its searches touch.' })); return }
  main.replaceChildren(head, ...files.slice(0, 500).map(f => h('div', { class: 'covrow' },
    h('span', { class: 'mono', text: f.path, title: f.path }),
    h('span', { class: 'covbar' }, h('span', { style: `width: ${f.lines ? Math.round((100 * (f.readLines || 0)) / f.lines) : f.read ? 100 : 0}%` })),
    h('span', { class: 'meta', text: f.lines ? `${f.readLines || 0}/${f.lines}` : f.read ? 'read' : '' }),
    h('span', { class: 'meta', text: f.read ? pct(f.readLines || 0, f.lines || 0) : f.searched ? `searched ${f.searched}x` : '' }))))
}

// ------------------------------------------------------------------ Labels
VIEWS.labels = main => {
  if (!S.labels.length) { main.replaceChildren(h('p', { class: 'empty', text: 'No label yet. When Copilot labels records with code, it records the label (thimble_label) and it shows here.' })); return }
  main.replaceChildren(...S.labels.map(l => h('div', { class: 'item' },
    h('div', { class: 'row' }, h('h3', { text: l.name }), h('span', { class: 'meta', text: `${l.method} · ${l.records} records · v${l.version || 1}` })),
    h('p', { text: l.says }), l.limit ? h('p', { class: 'meta', text: `leaves out: ${l.limit}` }) : null,
    h('table', { class: 'kv' }, ...Object.entries(l.counts || {}).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, n]) => h('tr', {}, h('td', { text: k }), h('td', { class: 'meta', text: n })))))))
}

// ------------------------------------------------------------------ Settings
VIEWS.settings = main => {
  const { values = {}, switches = [] } = S.settings || {}
  const set = async (key, value) => {
    try { const after = await post('api/settings', { key, value }); S.settings.values = after; toast(`${key}: ${JSON.stringify(value)}`); render() } catch (e) { toast(`thimble: ${e.message}`) }
  }
  main.replaceChildren(h('p', { class: 'meta', text: 'Saved for every session (thimble-copilot settings.json). The guidance changes at your next prompt.' }), ...switches.map(s => {
    let input
    if (s.choices && s.free) {
      const id = `dl-${s.key}`
      input = h('span', {}, h('input', { type: 'text', list: id, value: values[s.key] ?? '', onchange: e => set(s.key, e.target.value.trim()) }), h('datalist', { id }, ...s.choices.map(c => h('option', { value: c }))))
    } else if (s.choices) {
      input = h('select', { onchange: e => set(s.key, e.target.value) }, ...s.choices.map(c => h('option', { value: c, selected: values[s.key] === c }, c)))
    } else {
      input = h('label', {}, h('input', { type: 'checkbox', checked: !!values[s.key], onchange: e => set(s.key, e.target.checked) }), values[s.key] ? ' on' : ' off')
    }
    return h('div', { class: 'setting' }, h('b', { text: s.title || s.key }), input, h('div', { class: 'help' }, s.help || '', s.modes ? h('div', { text: s.modes }) : null))
  }))
}

// ------------------------------------------------------------------ keys: upstream's bar letters
function onKey(k) {
  switch (k) {
    case 'v': return action('visualize')
    case 's': return action('simplify')
    case 'c': return doSel('cite')
    case 'e': return doSel('explain')
    case 'a': return doSel('ask')
    case 't': return show('threads')
    case 'b': return action('catchup')
    case 'r': return show('coverage')
    case 'l': return show('labels')
    case 'w': return show('claims')
    default: return null
  }
}
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return
  if (['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement?.tagName)) return
  if (onKey(e.key) !== null) e.preventDefault()
})
for (const b of document.querySelectorAll('#bar button')) b.addEventListener('click', () => {
  const a = b.dataset.act
  if (['cite', 'explain', 'ask'].includes(a)) doSel(a)
  else action(a)
})

// ------------------------------------------------------------------ state and its changes
async function load() {
  const r = await fetch(`${BASE}api/state`)
  S = await r.json()
  render()
}
let soon = null
function loadSoon() { if (!soon) soon = setTimeout(() => { soon = null; load().catch(() => {}) }, 400) }
function listen() {
  const es = new EventSource(`${BASE}api/events`)
  es.addEventListener('change', e => {
    const { kind, item, counts } = JSON.parse(e.data)
    if (!S) return
    S.counts = counts
    if (Array.isArray(S[kind]) && item && typeof item === 'object' && item.id) {
      const i = S[kind].findIndex(x => x.id === item.id)
      if (i >= 0) S[kind][i] = item
      else S[kind].push(item)
    } else if (kind === 'coverage') {
      return loadSoon()
    } else if (kind in S && !Array.isArray(S[kind])) S[kind] = item
    render()
  })
  es.addEventListener('settings', e => { if (S?.settings) S.settings.values = JSON.parse(e.data); render() })
  es.addEventListener('tab', e => show(JSON.parse(e.data)))
  es.onerror = () => { toast('lost the connection to thimble; retrying…', 3000) }
  es.onopen = () => load().catch(() => {})
}
LIGHT.addEventListener('change', () => { for (const f of frames.values()) f.version = -1; render() })
listen()
load().catch(e => { $('main').replaceChildren(h('p', { class: 'empty', text: `thimble: ${e.message}` })) })
