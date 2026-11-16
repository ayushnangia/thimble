// settings.mjs: thimble's settings in the Copilot port. The switches, their modes, defaults, help and Minimal's preset
// are upstream's (settings/features.mjs SWITCHES, valueIn, PRESET, switchesFrom), read by path. What differs:
//   - the values live in a JSON file (<thimble home>/settings.json), not in Claude Code's userConfig;
//   - Verifier model and Verifier effort name Copilot's models and effort levels, with "same as session" for the
//     conversation's own (upstream: "same as Claude" and Anthropic's model names);
//   - the help says Copilot where it says Claude.
import fs from 'node:fs'
import path from 'node:path'

import { copilotize } from './prompts.mjs'
import { homeDir, importUpstream } from './upstream.mjs'

export const SAME = 'same as session'
/** Models offered for the verifier; any Copilot model id may be typed in the Settings tab. */
export const MODELS = ['auto', 'claude-haiku-4.5', 'claude-sonnet-4.5', 'claude-sonnet-5', 'claude-opus-5.5', 'gpt-5.3-codex', 'gpt-5.6-sol', 'gpt-6.1-sol']
/** Copilot CLI's --reasoning-effort levels. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/

export const settingsFile = () => path.join(homeDir(), 'settings.json')

let features = null
async function F() {
  if (!features) features = await importUpstream('settings/features.mjs')
  return features
}

/** The switches as the Settings tab lists them: upstream's, in Copilot's words, with Copilot's verifier choices. */
export async function switches() {
  const { SWITCHES } = await F()
  return SWITCHES.map(s => {
    const out = JSON.parse(copilotize(JSON.stringify(s)))
    if (s.key === 'checkerModel') Object.assign(out, { default: SAME, choices: [SAME, ...MODELS], free: true, help: 'The model of the verifier, a second model that checks each citation against your files. Any Copilot model id works.', modes: `${SAME}: the model of the conversation.` })
    if (s.key === 'checkerEffort') Object.assign(out, { default: SAME, choices: [SAME, ...EFFORTS], help: 'How long the verifier thinks before it rules on a citation.', modes: `${SAME}: the effort of the conversation.` })
    delete out.firstParty
    out.does = out.modes ? `${out.help} ${out.modes}` : out.help
    return out
  })
}

/** The saved values, as the file holds them ({} when there is none). */
export function readSaved(file = settingsFile()) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

function writeSaved(values, file = settingsFile()) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(values, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

/** A setting's value in `values`: upstream's valueIn, and for the verifier's model and effort Copilot's choices. */
export async function valueOf(values, key) {
  const v = values?.[key]
  if (key === 'checkerModel') return typeof v === 'string' && (v === SAME || MODEL_ID.test(v)) && v !== 'same as Claude' ? v : SAME
  if (key === 'checkerEffort') return EFFORTS.includes(v) ? v : SAME
  return (await F()).valueIn(values, key)
}

/** Every setting's value. */
export async function currentValues(file = settingsFile()) {
  const saved = readSaved(file)
  const out = {}
  for (const s of await switches()) out[s.key] = await valueOf(saved, s.key)
  return out
}

/**
 * Set one setting and save. Minimal on saves the modes its preset sets (upstream PRESET), keeping the rows' values
 * from before under `_beforeMinimal`; Minimal off puts them back; a preset row changed away from the preset turns
 * Minimal off. Answers the values after the change, or throws for a key or value the setting does not take.
 */
export async function setSetting(key, value, file = settingsFile()) {
  const { PRESET } = await F()
  const list = await switches()
  const s = list.find(x => x.key === key)
  if (!s) throw new Error(`no setting ${key}`)
  if (key === 'checkerModel' ? !(value === SAME || (typeof value === 'string' && MODEL_ID.test(value))) : s.choices ? !s.choices.includes(value) : typeof value !== 'boolean') {
    throw new Error(`${key} takes ${s.choices ? s.choices.join(', ') : 'true or false'}`)
  }
  const saved = readSaved(file)
  if (key === 'minimal') {
    if (value && !saved.minimal) {
      const before = {}
      for (const k of Object.keys(PRESET)) before[k] = await valueOf(saved, k)
      Object.assign(saved, PRESET, { minimal: true, _beforeMinimal: before })
    } else if (!value && saved.minimal) {
      Object.assign(saved, saved._beforeMinimal || {}, { minimal: false })
      delete saved._beforeMinimal
    }
  } else {
    saved[key] = value
    if (saved.minimal && key in PRESET && PRESET[key] !== value) { saved.minimal = false; delete saved._beforeMinimal }
  }
  writeSaved(saved, file)
  return currentValues(file)
}

/** What acts now, as functions of the values: `on(key)` (a feature with modes is on unless off; `cite` is c's) and
 *  `choice(key)`, from upstream's switchesFrom and valueIn. */
export async function featuresOf(values) {
  const f = await F()
  const on = f.switchesFrom(values)
  return {
    on,
    choice: key => (key === 'checkerModel' || key === 'checkerEffort' ? values[key] : f.valueIn(values, key === 'claims' ? 'claimsMode' : key)),
    cites: () => ['auto + verify', 'auto'].includes(f.valueIn(values, 'citations')),
    lenses: () => ({
      explain: f.valueIn(values, 'explain') === 'auto',
      heads: f.valueIn(values, 'details') === 'auto',
      claims: f.valueIn(values, 'claimsMode') === 'auto',
    }),
  }
}
