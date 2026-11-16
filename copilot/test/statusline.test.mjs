// The status line: one line from the counts the store saves for a session.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { test } from 'node:test'

import { COPILOT, folder, HOME } from './helpers.mjs'
import { Store } from '../lib/store.mjs'
import { barLine } from '../statusline.mjs'

test('the bar names what thimble holds', () => {
  assert.equal(barLine(null), '')
  const line = barLine({ counts: { cards: 1, citations: 3, verified: 2, corrected: 0, wrong: 1, checking: 0, unconfirmed: 0, explainers: 1, headsups: 1, threads: 0, claims: 0, labels: 0, filesRead: 2, coverage: 0.5 } })
  assert.equal(line, 'thimble · v 1 card · c 2✓ 0~ 1✗ · e 2 notes · r 2 files read 50% · /thimble-open')
})

test("statusline.mjs prints the line for the session Copilot names on stdin", () => {
  const st = new Store({ sessionId: 'bar-session', cwd: folder(), persist: true })
  st.add('cards', { title: 'x' })
  st.flush()
  const r = spawnSync(process.execPath, [path.join(COPILOT, 'statusline.mjs')], { input: JSON.stringify({ session_id: 'bar-session', cwd: '.' }), encoding: 'utf8', env: { ...process.env, THIMBLE_COPILOT_HOME: HOME } })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^thimble · v 1 card · \/thimble-open\n$/)
  const none = spawnSync(process.execPath, [path.join(COPILOT, 'statusline.mjs')], { input: JSON.stringify({ session_id: 'other' }), encoding: 'utf8', env: { ...process.env, THIMBLE_COPILOT_HOME: HOME } })
  assert.equal(none.stdout, '')
})
