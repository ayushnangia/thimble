// citations.mjs: thimble's citations in the Copilot port. A citation is a mark, `[words](#)`, in an answer of the main
// agent (upstream marks/message.js marksIn, sentenceOf). The verifier, a second model, checks each against the files
// with upstream's prompt (prompts/checker.md, filled as upstream marks/checker.ts checkerPrompt fills it) and answers
// one verdict per mark: verified, corrected, narrowed, wrong or unconfirmed, with its evidence. The port then reads
// each quote's and code's evidence in the file itself, so the workbench shows the lines, and says when they are not
// there.
import fs from 'node:fs'
import path from 'node:path'

import { ask, shellTool } from './model.mjs'
import { ownText, upstreamText } from './prompts.mjs'
import { transcriptOf } from './transcript.mjs'
import { importUpstream } from './upstream.mjs'

export const STATUSES = ['verified', 'corrected', 'narrowed', 'wrong', 'unconfirmed']
/** upstream marks/checker.ts LAST_REPLY; in a child the reply is the transcript's last message. */
export const LAST_REPLY = "Copilot's last message in the transcript above"

/** The marks of an answer, numbered from 1: {n, words, sentence, start, end}. */
export async function marksOf(text) {
  const { marksIn, sentenceOf } = await importUpstream('marks/message.js')
  return marksIn(text).map((m, i) => ({ n: i + 1, words: m.words, sentence: sentenceOf(text, m), start: m.start, end: m.end }))
}

/** Add the marks of an answer to the store as citations not yet checked (auto modes). Answers the new ones. */
export async function recordMarks(store, answer, source = 'auto') {
  const have = new Set(store.state.citations.filter(c => c.answerId === answer.id).map(c => `${c.words}\u0000${c.sentence}`))
  const out = []
  for (const m of await marksOf(answer.text)) {
    if (have.has(`${m.words}\u0000${m.sentence}`)) continue
    out.push(store.add('citations', { answerId: answer.id, words: m.words, sentence: m.sentence, status: 'unchecked', source }))
  }
  return out
}

/** Record words the analyst asked to cite (manual mode, /thimble-cite): the sentence of the answer that holds them. */
export function recordAsked(store, { words, answerId, sentence }) {
  const w = String(words || '').trim()
  if (!w) throw new Error('give the words to cite')
  const answer = (answerId && store.get('answers', answerId)) || store.lastAnswer()
  let s = String(sentence || '').trim()
  if (!s && answer) {
    const at = answer.text.indexOf(w)
    if (at >= 0) {
      const before = answer.text.slice(0, at)
      const a = Math.max(before.lastIndexOf('. '), before.lastIndexOf('\n')) + 1
      const rest = answer.text.slice(at + w.length)
      const m = /[.!?](\s|$)|\n/.exec(rest)
      s = `${answer.text.slice(a, at)}[${w}]${m ? rest.slice(0, m.index + 1) : rest}`.replace(/\s+/g, ' ').trim()
    }
  }
  return store.add('citations', { answerId: answer?.id ?? null, words: w, sentence: s || `[${w}]`, status: 'unchecked', source: 'asked' })
}

/** The file that lists each card's places and values for the verifier (checker.md's CARDS). */
export function writeCardsIndex(store, dir) {
  const lines = []
  for (const c of store.state.cards) {
    const rows = Array.isArray(c.rows) ? c.rows : []
    rows.forEach((r, i) => {
      if (r && typeof r === 'object') for (const [k, v] of Object.entries(r)) lines.push(`card:${c.id}#${k}/${i}\t${typeof v === 'object' ? JSON.stringify(v) : v}`)
    })
    String(c.text || '').split('\n').forEach((l, i) => { if (l.trim()) lines.push(`card:${c.id}@out1#L${i + 1}\t${l}`) })
  }
  for (const l of store.state.labels) for (const [k, v] of Object.entries(l.values || {})) lines.push(`label:${l.id}#${k}\t${v}`)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `cards-${String(store.state.sessionId).replace(/[^A-Za-z0-9_.-]/g, '_')}.tsv`)
  fs.writeFileSync(file, lines.join('\n') + '\n')
  return file
}

/** The verifier's prompt: the side preamble with the transcript, upstream's checker filled, the port's addendum. */
export async function checkerPrompt({ items, cwd, cards = '', transcript = '', shell = false }) {
  const marks = items.map((m, i) => `${m.n ?? i + 1}. [${m.words}] in: ${m.sentence}`).join('\n')
  const checker = await upstreamText('checker', { MARKS: marks, CWD: cwd, ROOT: cwd, CARDS: cards || '(no cards yet)', REPLY: LAST_REPLY })
  const tools = shell ? `view, grep, glob and ${shellTool()}` : 'view, grep and glob, which read files'
  const compute = shell
    ? `Where the text says Bash or \`python3 - <<'PY'\`, use your ${shellTool()} tool${process.platform === 'win32' ? " with `python -c` or a here-string piped to `python -`" : ''}.`
    : 'You cannot run code here. Use quote, code or card evidence. Where only computing would show the words, give `unconfirmed` and say in `reason` what to compute.'
  return [ownText('side', { CWD: cwd, TRANSCRIPT: transcript }), checker, ownText('checker-copilot', { TOOLS: tools, COMPUTE: compute })].join('\n\n')
}

/** The verdicts in the verifier's answer: the last ```json block (or bare array) that parses, one object per mark. */
export function parseVerdicts(text) {
  const t = String(text || '')
  const blocks = [...t.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map(m => m[1])
  const a = t.lastIndexOf('[')
  const tries = [...blocks.reverse(), ...(a >= 0 ? [t.slice(t.indexOf('['), t.lastIndexOf(']') + 1)] : [])]
  for (const b of tries) {
    try {
      const v = JSON.parse(b)
      const list = Array.isArray(v) ? v : Array.isArray(v?.verdicts) ? v.verdicts : null
      if (list) return list.filter(x => x && typeof x === 'object' && Number.isFinite(Number(x.mark)))
    } catch { /* the next */ }
  }
  return null
}

const norm = s => String(s ?? '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim()

/** One evidence place read in its file: {file, line, substring, found, text}. */
export function readPlace(cwd, ev) {
  const out = { file: ev?.file ?? '', line: ev?.line ?? '', substring: ev?.substring ?? '', found: false, text: '' }
  if (!out.file) return out
  try {
    const all = fs.readFileSync(path.resolve(cwd, out.file), 'utf8').split(/\r?\n/)
    const [a, b] = String(out.line).split('-').map(n => parseInt(n, 10))
    if (!Number.isFinite(a)) return out
    const lo = Math.max(1, a)
    const hi = Math.min(all.length, Number.isFinite(b) ? b : a)
    out.text = all.slice(lo - 1, hi).join('\n')
    const sub = norm(out.substring)
    out.found = !sub || norm(out.text).includes(sub)
  } catch (e) {
    out.error = String(e?.code || e?.message || e)
  }
  return out
}

/** A verdict applied to its citation: status, correction, reason, note, evidence and what the files show of it. */
export function applyVerdict(cwd, v) {
  const status = STATUSES.includes(v.status) ? v.status : 'unconfirmed'
  const ev = v.evidence
  const places = v.kind === 'quote' || v.kind === 'code' ? (Array.isArray(ev) ? ev : [ev]).filter(Boolean).map(e => readPlace(cwd, e)) : []
  const shown = places.length ? places.every(p => p.found) : null
  return {
    status,
    kind: String(v.kind || ''),
    evidence: ev ?? null,
    places,
    evidenceShown: shown,
    correction: v.correction && typeof v.correction === 'object' ? v.correction : null,
    reason: String(v.reason || ''),
    note: v.note ? String(v.note) : '',
  }
}

/**
 * Check citations with the verifier. Marks each `checking`, asks once for all of them, applies each verdict; a
 * citation with no verdict becomes `unconfirmed` with the error. Answers the citations.
 */
export async function verify(store, ids, { model = '', effort = '', tmpdir, shell = process.env.THIMBLE_VERIFIER_SHELL === '1', log = () => {} } = {}) {
  const items = ids.map(id => store.get('citations', id)).filter(Boolean)
  if (!items.length) return []
  const cwd = store.state.cwd
  items.forEach((c, i) => store.update('citations', c.id, { status: 'checking', n: i + 1, error: '' }))
  const cards = writeCardsIndex(store, tmpdir)
  const prompt = await checkerPrompt({ items: items.map((c, i) => ({ n: i + 1, words: c.words, sentence: c.sentence })), cwd, cards, transcript: transcriptOf(store.state), shell })
  const r = await ask(prompt, { cwd, model, effort, shell })
  const verdicts = r.ok ? parseVerdicts(r.text) : null
  const byMark = new Map((verdicts || []).map(v => [Number(v.mark), v]))
  for (const [i, c] of items.entries()) {
    const v = byMark.get(i + 1)
    if (v) store.update('citations', c.id, { ...applyVerdict(cwd, v), checkedAt: new Date().toISOString(), model: model || 'session' })
    else store.update('citations', c.id, { status: 'unconfirmed', reason: '', error: r.ok ? 'the verifier gave no verdict for it' : `the verifier failed: ${r.error}` })
  }
  const done = items.map(c => store.get('citations', c.id))
  const tally = STATUSES.map(s => [s, done.filter(c => c.status === s).length]).filter(([, n]) => n).map(([s, n]) => `${n} ${s}`).join(', ')
  log(r.ok ? `thimble: checked ${items.length} citation${items.length === 1 ? '' : 's'}: ${tally}` : `thimble: verifier failed (${r.error})`)
  return done
}
