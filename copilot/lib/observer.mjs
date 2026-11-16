// observer.mjs: thimble's observer after each answer, the port of upstream observer/observer.ts (TypeScript bound to
// Claude Code's Register API). Its prompt is upstream's: the frame (prompts/observer.md) with the fragments of the lenses
// whose features are on (observer/lenses.mjs LENSES: explainers, heads-ups, claims), composed by observer/compose.mjs,
// and the turn (prompts/observer-turn.md) with upstream's messagesText, the coverage, and each lens's digest of what
// thimble already gave. The reply is read by upstream's parseAnswer and its lenses' `read`. What the port does itself:
// it asks a Copilot child (model.mjs) with the transcript, and places what came back in the store (claims merged by id).
import { ask } from './model.mjs'
import { copilotize, ownText, upstreamText } from './prompts.mjs'
import { featuresOf } from './settings.mjs'
import { coverageText } from './coverage.mjs'
import { transcriptOf } from './transcript.mjs'
import { importUpstream } from './upstream.mjs'

const LENS_ON = { explain: 'explain', heads: 'heads', claims: 'claims' }

/** The lenses that run for these settings, each with its fragment's text. */
export async function lensParts(values) {
  const { LENSES } = await importUpstream('observer/lenses.mjs')
  const on = (await featuresOf(values)).lenses()
  const parts = []
  for (const lens of LENSES) if (on[LENS_ON[lens.name]]) parts.push({ lens, text: await upstreamText(lens.feature) })
  return parts
}

/** The claims lens's digest (claims/seam.ts claimsState's lines): claims and clusters so far. */
export function claimsDigest(state) {
  const claims = state.claims.filter(c => !c.same).slice(-80)
  const size = id => state.claims.filter(c => c.cluster === id && !c.same).length
  return {
    CLAIMS: claims.length ? claims.map(c => `${c.id} · ${c.cluster || '-'} · ${c.claim}`).join('\n') : '(none yet)',
    CLUSTERS: state.clusters.length ? state.clusters.map(k => `${k.id} · ${k.name} · ${size(k.id)} · ${k.about || ''}`).join('\n') : '(none yet)',
    GROWN: '',
  }
}

/** The state the lenses' digests read: the terms already explained, the heads-ups given, the claims. */
export function digestState(state) {
  return {
    glossed: state.notes.filter(n => n.kind === 'explainer').map(n => n.term),
    headsGiven: state.notes.filter(n => n.kind === 'headsup').map(n => `${n.term}: ${n.title}`),
    claims: claimsDigest(state),
  }
}

/** The observer's whole prompt for one answer, or null when no lens is on. */
export async function observerPrompt(store, answer, values) {
  const parts = await lensParts(values)
  if (!parts.length) return null
  const { composeSystem, composeTurn, skeletonOf } = await importUpstream('observer/compose.mjs')
  const { messagesText } = await importUpstream('observer/messages.mjs')
  const frame = await upstreamText('observer')
  const tmpl = await upstreamText('observer-turn')
  const system = composeSystem(frame, parts)
  const prompt = store.state.prompts.findLast?.(p => p.turn === answer.turn) ?? store.state.prompts.filter(p => p.turn === answer.turn).at(-1)
  const msg = { kind: 'answer', text: answer.text, turnNo: answer.turn, prompt: { text: prompt?.text ?? '', by: 'composer' } }
  const vals = { MESSAGES: copilotize(messagesText([msg])).replace(/in the transcript above/g, 'the last message in the transcript above'), SHOWN: '', COVERAGE: coverageText(store.state.coverage), SKELETON: skeletonOf(parts.map(p => p.lens)) }
  const turn = composeTurn(tmpl, vals, parts, digestState(store.state))
  return { text: [ownText('side', { CWD: store.state.cwd, TRANSCRIPT: transcriptOf(store.state) }), system.text, turn.text].join('\n\n'), parts }
}

/** Merge the claims lens's part into the store: new claims get ids, "#N" names this turn's Nth, clusters by name. */
export function mergeClaims(store, { claims = [], clusters = [] }, answerId) {
  const made = []
  const clusterId = ref => {
    if (!ref) return ''
    const r = String(ref)
    const hash = /^#(\d+)$/.exec(r)
    if (hash) return made[Number(hash[1]) - 1]?.cluster ?? ''
    if (store.get('clusters', r)) return r
    const named = store.state.clusters.find(k => k.name === r)
    if (named) return named.id
    return store.add('clusters', { id: `k${store.state.clusters.length + 1}`, name: r, about: '' }).id
  }
  const claimId = ref => { const hash = /^#(\d+)$/.exec(String(ref ?? '')); return hash ? made[Number(hash[1]) - 1]?.id ?? '' : String(ref ?? '') }
  for (const c of claims) {
    if (!c || typeof c !== 'object') continue
    if (c.same) {
      const id = claimId(c.same)
      const was = store.get('claims', id)
      if (was) store.update('claims', id, { said: (was.said || 1) + 1 })
      made.push(was ?? null)
      continue
    }
    if (typeof c.claim !== 'string') { made.push(null); continue }
    const it = store.add('claims', {
      id: `c${store.state.claims.length + 1}`, claim: c.claim, quote: String(c.quote || ''), by: c.by === 'analyst' ? 'analyst' : 'copilot',
      because: String(c.because || ''), why: String(c.why || ''), answerId, said: 1, cluster: '', links: [],
    })
    made.push(it)
    store.update('claims', it.id, { cluster: clusterId(c.cluster) })
    if (c.revises) { const r = claimId(c.revises); if (store.get('claims', r)) { store.update('claims', r, { revisedBy: it.id }); store.update('claims', it.id, { revises: r }) } }
    if (Array.isArray(c.links)) store.update('claims', it.id, { links: c.links.map(l => ({ to: claimId(l?.to), how: l?.how === 'supports' ? 'supports' : 'same topic' })).filter(l => l.to) })
  }
  for (const k of clusters) {
    if (!k || typeof k !== 'object') continue
    if (k.split) {
      const nk = store.add('clusters', { id: `k${store.state.clusters.length + 1}`, name: String(k.name || 'split'), about: String(k.about || '') })
      for (const id of Array.isArray(k.claims) ? k.claims : []) if (store.get('claims', claimId(id))) store.update('claims', claimId(id), { cluster: nk.id })
    } else if (k.id && store.get('clusters', k.id)) {
      store.update('clusters', k.id, { ...(k.name ? { name: String(k.name) } : {}), ...(k.about ? { about: String(k.about) } : {}) })
    } else if (k.name) {
      const id = clusterId(k.name)
      if (k.about) store.update('clusters', id, { about: String(k.about) })
    }
  }
  return made.filter(Boolean)
}

/** Place a parsed reply: explainers and the heads-up as notes, claims merged. Answers what was added, counted. */
export async function placeReply(store, parsed, parts, answer) {
  const out = { explainers: 0, headsups: 0, claims: 0 }
  for (const { lens } of parts) {
    const got = lens.read(parsed)
    if (lens.name === 'explain') {
      const known = new Set(store.state.notes.filter(n => n.kind === 'explainer').map(n => n.term.toLowerCase()))
      for (const g of got) {
        if (!g || typeof g.term !== 'string' || known.has(g.term.toLowerCase())) continue
        store.add('notes', { kind: 'explainer', term: g.term, body: String(g.body || ''), here: String(g.here || ''), answerId: answer.id, by: 'observer' })
        out.explainers++
      }
    } else if (lens.name === 'heads' && got && typeof got.term === 'string') {
      store.add('notes', { kind: 'headsup', term: got.term, title: String(got.title || ''), bullets: Array.isArray(got.bullets) ? got.bullets.map(String) : [], answerId: answer.id, by: 'observer' })
      out.headsups++
    } else if (lens.name === 'claims') {
      out.claims = mergeClaims(store, got, answer.id).length
    }
  }
  return out
}

/** Run the observer on one answer. Answers the counts placed, or null when no lens is on. */
export async function observe(store, answer, values, { model = '', effort = '', log = () => {} } = {}) {
  const p = await observerPrompt(store, answer, values)
  if (!p) return null
  const r = await ask(p.text, { cwd: store.state.cwd, model, effort })
  if (!r.ok) { log(`thimble: observer failed (${r.error})`, 'warning'); return { error: r.error } }
  const { parseAnswer } = await importUpstream('observer/reply.mjs')
  const parsed = parseAnswer(r.text)
  if (!parsed) { log('thimble: the observer gave no JSON', 'warning'); return { error: 'no JSON' } }
  const n = await placeReply(store, parsed, p.parts, answer)
  const said = [n.headsups && `${n.headsups} heads-up`, n.explainers && `${n.explainers} explainer${n.explainers === 1 ? '' : 's'}`, n.claims && `${n.claims} claim${n.claims === 1 ? '' : 's'}`].filter(Boolean)
  if (said.length) log(`thimble: ${said.join(', ')} in the workbench`)
  return n
}
