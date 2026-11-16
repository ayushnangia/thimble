// Every upstream path the port reads resolves, and every upstream prompt it uses composes. An upstream rename fails
// here on the daily sync, naming the path (see PORT_MAP.md).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { COPILOT, folder } from './helpers.mjs'
import { guidanceText, CARDS_OFF } from '../lib/guidance.mjs'
import { makeContext } from '../lib/main.mjs'
import { ownText, upstreamText, USED } from '../lib/prompts.mjs'
import { UPSTREAM_FILES } from '../lib/server.mjs'
import { currentValues } from '../lib/settings.mjs'
import { toolsFor } from '../lib/tools.mjs'
import { findUpstream, REQUIRED } from '../lib/upstream.mjs'

const root = findUpstream()

test('the upstream plugin folder is found', () => {
  assert.ok(root, `no upstream plugin folder holds ${REQUIRED.join(', ')}`)
})

for (const rel of [...REQUIRED, ...UPSTREAM_FILES]) {
  test(`upstream file ${rel} exists`, () => assert.ok(fs.existsSync(path.join(root, rel)), `plugin/${rel} is gone: update PORT_MAP.md`))
}

for (const name of USED) {
  test(`upstream prompt ${name} composes`, async () => {
    const t = await upstreamText(name)
    assert.ok(t.trim().length > 40, name)
    assert.doesNotMatch(t, /\{\{>|\{\{include/i, `${name} has an unresolved include`)
  })
}

test("the port's own prompts exist", () => {
  for (const n of fs.readdirSync(path.join(COPILOT, 'prompts'))) assert.ok(ownText(n.replace(/\.md$/, '')).trim())
})

test('the guidance follows the settings', async () => {
  const v = await currentValues(path.join(folder(), 's.json'))
  const on = await guidanceText({ ...v, cards: 'auto' }, '/tmp/x')
  assert.match(on, /## Cards/)
  assert.match(on, /thimble_card/)
  const off = await guidanceText({ ...v, cards: 'off' }, '/tmp/x')
  assert.doesNotMatch(off, /## Cards/)
  assert.ok(off.endsWith(CARDS_OFF) || off.includes(CARDS_OFF))
})

test('every skill names a thimble tool and has frontmatter', () => {
  const dir = path.join(COPILOT, 'skills')
  const skills = fs.readdirSync(dir)
  assert.ok(skills.length >= 13)
  for (const s of skills) {
    const t = fs.readFileSync(path.join(dir, s, 'SKILL.md'), 'utf8')
    assert.match(t, new RegExp(`^---\\nname: ${s}\\n`), s)
    assert.match(t, /\ndescription: /, s)
    assert.match(t, /thimble_\w+/, s)
  }
})

test('thimble_tour gives upstream tour with the sample path filled', async () => {
  const ctx = makeContext({ sessionId: 'tour', persist: false })
  const tour = (await toolsFor(ctx)).find(t => t.name === 'thimble_tour')
  const out = await tour.handler({})
  assert.ok(out.includes(path.join(root, 'tour', 'sample', 'orders.csv')))
  assert.doesNotMatch(out, /CLAUDE_PLUGIN_ROOT/)
})

test('a card id the store makes reads as a card link to upstream cardRef', async () => {
  const { Store } = await import('../lib/store.mjs')
  const { importUpstream } = await import('../lib/upstream.mjs')
  const { cardRef } = await importUpstream('marks/message.js')
  const st = new Store({ sessionId: 'cardref', cwd: folder(), persist: false })
  for (let i = 0; i < 20; i++) {
    const { id } = st.add('cards', { title: 'T', status: 'drawing' })
    assert.equal(cardRef(`[T](card:${id})`), id)
  }
})