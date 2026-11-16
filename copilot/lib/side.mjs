// side.mjs: the features that ask a second model about the conversation, as upstream's s, b, e and a keys do:
//   simplify  a shorter, plainer version of the last answer (squeeze/chips.mjs request at SIMPLIFY_AT, prompts/squeeze.md)
//   catchUp   one message that catches the analyst up on Copilot's messages since their last prompt (CATCHUP_HEAD)
//   explain   an explainer of words the analyst picked (prompts/explain-expand.md)
//   ask       a side thread about one thing on the screen (prompts/thread.md), answered by a child, kept in the store
// Each prompt is upstream's, put together by upstream's code; the port adds the side preamble (the transcript) and runs
// a Copilot child (model.mjs) in place of upstream's $.model.complete or forked session.
import { ask } from './model.mjs'
import { copilotize, ownText, upstreamText } from './prompts.mjs'
import { featuresOf } from './settings.mjs'
import { transcriptOf } from './transcript.mjs'
import { importUpstream } from './upstream.mjs'

const preamble = store => ownText('side', { CWD: store.state.cwd, TRANSCRIPT: transcriptOf(store.state) })

/** Upstream's squeeze request as one prompt for a child: the system texts, then the request. */
const asPrompt = req => copilotize([...req.system.map(s => s.text), ...req.prompt.map(p => p.text)].join('\n\n'))

/** The analyst's last prompt in the store, or ''. */
const lastPrompt = store => store.state.prompts.at(-1)?.text ?? ''

/** The prompt that rewrites `text` (kind: 'simplify' or 'catchup'). */
export async function squeezePrompt(store, text, kind, values) {
  const chips = await importUpstream('squeeze/chips.mjs')
  const f = await featuresOf(values)
  const rec = kind === 'simplify'
    ? { text, catchup: { kind: 'simplify' }, squeeze: { at: { ...chips.SIMPLIFY_AT }, scale: chips.SCALE } }
    : { text, catchup: { kind: 'catchup' }, squeeze: { at: { length: chips.ARRIVE }, scale: chips.SCALE } }
  const system = await upstreamText('squeeze')
  const asked = store.state.citations.filter(c => c.source === 'asked').map(c => c.words)
  const terms = store.state.notes.filter(n => n.kind === 'explainer').map(n => n.term).slice(-8)
  const req = chips.request(rec, { system, question: lastPrompt(store), cites: f.cites(), asked, terms })
  return `${preamble(store)}\n\n${asPrompt(req)}`
}

async function rewrite(store, kind, text, values, opts) {
  const r = await ask(await squeezePrompt(store, text, kind, values), { cwd: store.state.cwd, ...opts })
  if (!r.ok) throw new Error(r.error)
  const { readReply } = await importUpstream('squeeze/chips.mjs')
  const out = readReply(r.text).text
  if (!out) throw new Error('the model gave no text')
  return out
}

/** s: a simpler version of the last answer, as a note. */
export async function simplify(store, values, opts = {}) {
  const a = store.lastAnswer()
  if (!a) throw new Error('there is no answer yet')
  const text = await rewrite(store, 'simplify', a.text, values, opts)
  return store.add('notes', { kind: 'simpler', answerId: a.id, title: 'Simpler version', text })
}

/** b: catch-up on the messages since the analyst's last prompt, as a note. */
export async function catchUp(store, values, opts = {}) {
  const { catchUpText } = await importUpstream('squeeze/chips.mjs')
  const lastTurn = store.state.prompts.at(-1)?.turn ?? 0
  const msgs = store.state.answers.filter(a => a.turn >= lastTurn).map(a => a.text)
  if (!msgs.length) throw new Error('there are no messages since the last prompt')
  const text = await rewrite(store, 'catchup', catchUpText(msgs), values, opts)
  return store.add('notes', { kind: 'catchup', title: `Catch-up on ${msgs.length} message${msgs.length === 1 ? '' : 's'}`, text })
}

/** e: an explainer of words the analyst picked. */
export async function explain(store, words, opts = {}) {
  const term = String(words || '').trim()
  if (!term) throw new Error('give the words to explain')
  const { jsonIn } = await importUpstream('observer/reply.mjs')
  const prompt = `${preamble(store)}\n\n${await upstreamText('explain-expand')}\n\nThe words the analyst picked: ${term}`
  const r = await ask(prompt, { cwd: store.state.cwd, ...opts })
  if (!r.ok) throw new Error(r.error)
  const d = jsonIn(r.text)
  return store.add('notes', { kind: 'explainer', term, body: String(d?.body ?? r.text), here: String(d?.here ?? ''), answerId: store.lastAnswer()?.id ?? null, by: 'asked' })
}

/** The prompt of a side thread's next answer. */
export async function threadPrompt(store, thread) {
  const sys = await upstreamText('thread', { TMPDIR: '' })
  const talk = thread.messages.map(m => `${m.role === 'analyst' ? 'The analyst' : 'You'}: ${m.text}`).join('\n\n')
  return `${preamble(store)}\n\n${sys}\n\n## The side thread\n\nIt is about: ${thread.about || 'the last answer'}\n\n${talk}\n\nAnswer the analyst's last message.`
}

/** a: open a side thread (or add to one) with a question; the answer comes from a child. */
export async function askThread(store, { question, about = '', threadId = '' }, opts = {}) {
  const q = String(question || '').trim()
  if (!q) throw new Error('give the question')
  let t = threadId && store.get('threads', threadId)
  if (!t) t = store.add('threads', { about: String(about || '').trim() || 'the last answer', messages: [], status: 'idle' })
  store.update('threads', t.id, x => ({ messages: [...x.messages, { role: 'analyst', text: q, at: new Date().toISOString() }], status: 'answering' }))
  const r = await ask(await threadPrompt(store, store.get('threads', t.id)), { cwd: store.state.cwd, shell: process.env.THIMBLE_SIDE_SHELL === '1', ...opts })
  store.update('threads', t.id, x => ({ messages: [...x.messages, { role: 'copilot', text: r.ok ? r.text : `(no answer: ${r.error})`, at: new Date().toISOString() }], status: r.ok ? 'idle' : 'failed' }))
  return store.get('threads', t.id)
}
