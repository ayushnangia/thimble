// The extension's entry loads as Copilot CLI loads it, with a fake "@github/copilot-sdk/extension", and declares
// thimble's tools, hooks and canvas.
import assert from 'node:assert/strict'
import path from 'node:path'
import { register } from 'node:module'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import { COPILOT, fakeSdk } from './helpers.mjs'

const TOOLS = [
  'thimble_card', 'thimble_cite', 'thimble_verify', 'thimble_explain', 'thimble_headsup', 'thimble_label', 'thimble_claim',
  'thimble_open', 'thimble_simplify', 'thimble_catchup', 'thimble_ask', 'thimble_visualize', 'thimble_tour', 'thimble_fix',
  'thimble_status', 'thimble_settings',
]
const ACTIONS = ['add_card', 'add_citation', 'add_note', 'add_claim', 'add_label', 'show_tab', 'get_state']

test('extension.mjs loads and joins the session with tools, hooks and the thimble canvas', async () => {
  const sdk = fakeSdk()
  globalThis.__thimbleFakeSdk = sdk
  const fake = `export const joinSession = c => globalThis.__thimbleFakeSdk.joinSession(c); export const createCanvas = d => globalThis.__thimbleFakeSdk.createCanvas(d)`
  const hooks = `export async function resolve(s, c, next) { return s === '@github/copilot-sdk/extension' ? { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(fake)}), shortCircuit: true } : next(s, c) }`
  register(`data:text/javascript,${encodeURIComponent(hooks)}`)
  await import(pathToFileURL(path.join(COPILOT, 'com.github.copilot', 'extensions', 'thimble', 'extension.mjs')).href)

  const { config, canvases, handlers } = sdk.seen
  assert.ok(config, 'joinSession was called')
  assert.deepEqual(config.tools.map(t => t.name).sort(), [...TOOLS].sort())
  for (const t of config.tools) {
    assert.equal(typeof t.handler, 'function', t.name)
    assert.equal(t.parameters.type, 'object', t.name)
    assert.ok(t.description.length > 20, t.name)
  }
  for (const h of ['onSessionStart', 'onUserPromptSubmitted', 'onPreToolUse', 'onPostToolUse', 'onSessionEnd']) assert.equal(typeof config.hooks[h], 'function', h)
  assert.equal(config.canvases.length, 1)
  assert.equal(canvases[0].id, 'thimble')
  assert.equal(typeof canvases[0].open, 'function')
  assert.deepEqual(canvases[0].actions.map(a => a.name), ACTIONS)
  assert.ok(handlers.some(([e]) => e === 'session.idle'), 'listens for the end of each answer')
  assert.ok(handlers.some(([e]) => e === 'assistant.message'))
})

test('a child thimble started joins with nothing', async () => {
  const { start } = await import('../lib/main.mjs')
  const sdk = fakeSdk()
  process.env.THIMBLE_COPILOT_CHILD = '1'
  try { await start(sdk) } finally { delete process.env.THIMBLE_COPILOT_CHILD }
  assert.deepEqual(sdk.seen.config, {})
})

test('the session start hook gives the guidance, and a prompt gives it again only after a change', async () => {
  const { makeContext, hooksFor } = await import('../lib/main.mjs')
  const ctx = makeContext({ sessionId: 'hooks', persist: false })
  const hooks = hooksFor(ctx)
  const first = await hooks.onSessionStart({})
  assert.match(first.additionalContext, /<thimble-guidance>/)
  assert.match(first.additionalContext, /thimble_card/)
  assert.equal(await hooks.onUserPromptSubmitted({ prompt: 'hi' }), undefined)
  ctx.told = ''
  assert.match((await hooks.onUserPromptSubmitted({ prompt: 'again' })).additionalContext, /<thimble-guidance>/)
  assert.equal(ctx.store.state.turn, 2)
})

test('the pre-tool hook allows file tools in thimble temp folder only', async () => {
  const { makeContext, hooksFor } = await import('../lib/main.mjs')
  const ctx = makeContext({ sessionId: 'pre', persist: false })
  const { onPreToolUse } = hooksFor(ctx)
  assert.equal(onPreToolUse({ toolName: 'view', toolArgs: { path: path.join(ctx.tmpdir, 'rows.json') } }).permissionDecision, 'allow')
  assert.equal(onPreToolUse({ toolName: 'view', toolArgs: { path: path.join(ctx.tmpdir, '..', 'other.json') } }), undefined)
  assert.equal(onPreToolUse({ toolName: 'powershell', toolArgs: { command: 'rm -r x', path: path.join(ctx.tmpdir, 'a') } }), undefined)
})
