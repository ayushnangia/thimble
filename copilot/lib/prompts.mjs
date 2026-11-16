// prompts.mjs: thimble's prompts as the Copilot port reads them. Every text comes from upstream (plugin/prompts) through
// upstream's own registry (prompts/registry.mjs compose: includes and slots), in the terminal mode, with the slots
// that name Claude Code's parts given Copilot's words (COPILOT_SLOTS), then the few names of Claude Code that the texts
// write outright turned into Copilot's (copilotize). The port's own texts (copilot/prompts/*.md) say only what
// differs in Copilot: its tools, and that a side process does not see the session.
import fs from 'node:fs'
import path from 'node:path'

import { COPILOT_DIR, importUpstream, readUpstream } from './upstream.mjs'

/** The slots of upstream's slots.json whose terminal value names a part of Claude Code, in Copilot's words. */
export const COPILOT_SLOTS = {
  SURFACE: 'a GitHub Copilot CLI plugin',
  CARD_ADD: 'the `thimble_card` tool',
  CARD_TOOL: 'the `thimble_card` tool',
  CARD_DRAWN: "a view of rows from a data file, drawn with the `thimble_card` tool in thimble's workbench",
  THREAD_ON: "of their Copilot CLI session: a citation or an explainer in a reply, a card, or a tab of thimble's workbench such as labels or coverage",
  REPAIR_ASKED: 'asked thimble to repair',
  CHECK_LABEL_VALUES: " Label values are in thimble's session state, which `thimble_status` names.",
  RULE_SOURCE: 'the rule its `thimble_label` call gave',
  LABEL_VALUES: 'with the values a `thimble_label` call recorded',
  LABEL_LIMIT: '`limit`',
  LABELS_SHOWN: "in the Labels tab of thimble's workbench, with its name, how it was made and its values",
  LABEL_MAKE: 'Make a label with the `thimble_label` tool: its name, the rule in plain words (`says`), how it was made (`method`: regex, code or prompt), and the value of each record your code computed.',
}

/** The words of Claude Code that upstream's texts write outright, in Copilot's. Order matters: longer first. */
const WORDS = [
  [/Claude Code's/g, "GitHub Copilot CLI's"],
  [/Claude Code/g, 'GitHub Copilot CLI'],
  [/\bClaude's\b/g, "Copilot's"],
  [/\ba second Claude\b/g, 'a second model'],
  [/\bClaude\b/g, 'Copilot'],
  [/\bone Bash call\b/g, 'one shell call'],
  [/\bBash call\b/g, 'shell call'],
  [/\bwith Bash\b/g, 'with the shell'],
  [/\bBash\b/g, 'shell'],
  [/above in the session/g, 'in the transcript above'],
]

/** A text of upstream's with Claude Code's names in Copilot's. */
export function copilotize(text) {
  let t = String(text ?? '')
  for (const [re, to] of WORDS) t = t.replace(re, to)
  return t
}

/** Upstream's slots.json with COPILOT_SLOTS over its terminal values. */
export async function slotValues() {
  const reg = await importUpstream('prompts/registry.mjs')
  const base = JSON.parse(readUpstream(reg.SLOTS_FILE))
  for (const [k, v] of Object.entries(COPILOT_SLOTS)) base[k] = { ...(base[k] || {}), terminal: v }
  return base
}

/** Upstream text `name` composed (includes, slots) in Copilot's words, with `fills` filled. */
export async function upstreamText(name, fills = {}) {
  const reg = await importUpstream('prompts/registry.mjs')
  const text = await reg.compose(name, 'terminal', n => readUpstream(reg.fileOf(n)), slotValues)
  return copilotize(reg.fill(text, fills))
}

/** A text of the port's own (copilot/prompts/<name>.md), with `{{NAME}}` filled from `fills`. */
export function ownText(name, fills = {}) {
  const t = fs.readFileSync(path.join(COPILOT_DIR, 'prompts', `${name}.md`), 'utf8')
  return t.replace(/\{\{([A-Z_]+)\}\}/g, (all, k) => (k in fills ? String(fills[k]) : all))
}

/** The upstream texts the port reads: the tests check that each composes, which catches a rename upstream. */
export const USED = [
  'main', 'checker', 'observer', 'observer-turn', 'lens-explain', 'lens-heads', 'lens-claims', 'squeeze',
  'explain-expand', 'thread', 'designer', 'fix-request', 'fixer', 'card-tool',
]
