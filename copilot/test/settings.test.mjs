// Settings round trip through the JSON file, with upstream's switches.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { folder } from './helpers.mjs'
import { currentValues, readSaved, SAME, setSetting, switches } from '../lib/settings.mjs'

test('every switch has a default value, and checkerModel/checkerEffort name Copilot choices', async () => {
  const file = path.join(folder(), 'settings.json')
  const list = await switches()
  const v = await currentValues(file)
  for (const k of ['minimal', 'cards', 'squeezeAnswers', 'catchUp', 'citations', 'checkerModel', 'checkerEffort', 'explain', 'details', 'labels', 'claimsMode']) {
    assert.ok(list.some(s => s.key === k), `switch ${k}`)
    assert.ok(k in v, `value ${k}`)
  }
  assert.equal(v.checkerModel, SAME)
  assert.equal(v.checkerEffort, SAME)
  assert.ok(!JSON.stringify(list).includes('Claude Code'), 'the settings speak of Copilot')
})

test('a setting saves, reads back, and rejects values it does not take', async () => {
  const file = path.join(folder(), 'settings.json')
  const citations = (await switches()).find(s => s.key === 'citations')
  const other = citations.choices.find(c => c !== (citations.default ?? ''))
  let after = await setSetting('citations', other, file)
  assert.equal(after.citations, other)
  assert.equal(readSaved(file).citations, other)
  assert.equal((await currentValues(file)).citations, other)
  after = await setSetting('checkerModel', 'gpt-5.3-codex', file)
  assert.equal(after.checkerModel, 'gpt-5.3-codex')
  await assert.rejects(setSetting('citations', 'sometimes', file), /citations takes/)
  await assert.rejects(setSetting('checkerModel', 'bad model; rm -rf', file), /checkerModel takes/)
  await assert.rejects(setSetting('nope', true, file), /no setting/)
})

test('Minimal on applies its preset and Minimal off puts the values back', async () => {
  const file = path.join(folder(), 'settings.json')
  const before = await currentValues(file)
  const on = await setSetting('minimal', true, file)
  assert.equal(on.minimal, true)
  const changed = Object.keys(before).filter(k => k !== 'minimal' && before[k] !== on[k])
  assert.ok(changed.length > 0, 'the preset changes some modes')
  const off = await setSetting('minimal', false, file)
  for (const k of changed) assert.equal(off[k], before[k], k)
  assert.ok(fs.existsSync(file))
})
