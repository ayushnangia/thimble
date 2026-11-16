// Citations: marks recorded from an answer, the verifier's prompt (upstream checker.md), its verdicts read and checked
// against the file, all with a mocked model.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { folder } from './helpers.mjs'
import { applyVerdict, checkerPrompt, parseVerdicts, recordAsked, recordMarks, verify } from '../lib/citations.mjs'
import { setRunner } from '../lib/model.mjs'
import { Store } from '../lib/store.mjs'

const CSV = 'id,status\n1,shipped\n2,refunded\n3,shipped\n4,refunded\n'
const ANSWER = 'Of the orders, [2 were refunded](#) and [3 shipped](#).'

test('the marks of an answer become unchecked citations, once', async () => {
  const st = new Store({ sessionId: 'marks', cwd: folder(), persist: false })
  const a = st.add('answers', { text: ANSWER })
  const got = await recordMarks(st, a)
  assert.deepEqual(got.map(c => c.words), ['2 were refunded', '3 shipped'])
  assert.ok(got.every(c => c.status === 'unchecked' && c.answerId === a.id))
  assert.equal((await recordMarks(st, a)).length, 0)
})

test('an asked citation finds its sentence in the last answer', () => {
  const st = new Store({ sessionId: 'asked', cwd: folder(), persist: false })
  st.add('answers', { text: 'The file has 4 orders. Half of them were refunded in May.' })
  const c = recordAsked(st, { words: 'Half of them' })
  assert.equal(c.sentence, '[Half of them] were refunded in May.')
  assert.throws(() => recordAsked(st, { words: ' ' }), /give the words/)
})

test("the verifier's prompt fills upstream's checker with the marks and the folder", async () => {
  const p = await checkerPrompt({ items: [{ n: 1, words: '2 were refunded', sentence: ANSWER }], cwd: '/data/x', transcript: 'TRANSCRIPT-HERE' })
  assert.match(p, /1\. \[2 were refunded\] in: /)
  assert.match(p, /\/data\/x/)
  assert.match(p, /TRANSCRIPT-HERE/)
  assert.doesNotMatch(p, /\{\{[A-Z_]+\}\}/, 'every slot is filled')
  assert.match(p, /view, grep and glob/)
})

test('verdicts are read from the last JSON block', () => {
  assert.deepEqual(parseVerdicts('x\n```json\n[{"mark":1,"status":"verified"}]\n```\nthen\n```json\n[{"mark":2,"status":"wrong"}]\n```'), [{ mark: 2, status: 'wrong' }])
  assert.deepEqual(parseVerdicts('[{"mark": 1, "status": "narrowed"}]'), [{ mark: 1, status: 'narrowed' }])
  assert.equal(parseVerdicts('no json'), null)
})

test('a verdict reads its quoted evidence in the file', () => {
  const dir = folder({ 'orders.csv': CSV })
  const ok = applyVerdict(dir, { mark: 1, status: 'verified', kind: 'quote', evidence: { file: 'orders.csv', line: '3', substring: '2,refunded' } })
  assert.equal(ok.evidenceShown, true)
  assert.equal(ok.places[0].text, '2,refunded')
  const bad = applyVerdict(dir, { mark: 1, status: 'bogus', kind: 'quote', evidence: { file: 'orders.csv', line: '2', substring: 'refunded' } })
  assert.equal(bad.status, 'unconfirmed')
  assert.equal(bad.evidenceShown, false)
})

test('verify asks the model once and applies each verdict; a missing verdict is unconfirmed', async t => {
  const dir = folder({ 'orders.csv': CSV })
  const st = new Store({ sessionId: 'verify', cwd: dir, persist: false })
  const a = st.add('answers', { text: ANSWER })
  const cites = await recordMarks(st, a)
  const asked = []
  setRunner(async (prompt, opts) => {
    asked.push({ prompt, opts })
    return { ok: true, text: '```json\n[{"mark":1,"status":"verified","kind":"quote","evidence":{"file":"orders.csv","line":"3","substring":"2,refunded"},"reason":"row 3"}]\n```' }
  })
  t.after(() => setRunner(null))
  const logs = []
  const done = await verify(st, cites.map(c => c.id), { model: 'gpt-x', tmpdir: folder(), log: m => logs.push(m) })
  assert.equal(asked.length, 1)
  assert.equal(asked[0].opts.model, 'gpt-x')
  assert.equal(asked[0].opts.cwd, dir)
  assert.match(asked[0].prompt, /2 were refunded/)
  assert.equal(done[0].status, 'verified')
  assert.equal(done[0].evidenceShown, true)
  assert.equal(done[1].status, 'unconfirmed')
  assert.match(done[1].error, /no verdict/)
  assert.match(logs[0], /checked 2 citations: 1 verified, 1 unconfirmed/)
})

test('a failed verifier leaves the citations unconfirmed with its error', async t => {
  const st = new Store({ sessionId: 'fail', cwd: folder(), persist: false })
  const [c] = await recordMarks(st, st.add('answers', { text: '[x](#)' }))
  setRunner(async () => ({ ok: false, text: '', error: 'boom' }))
  t.after(() => setRunner(null))
  const [d] = await verify(st, [c.id], { tmpdir: folder() })
  assert.equal(d.status, 'unconfirmed')
  assert.match(d.error, /boom/)
})
