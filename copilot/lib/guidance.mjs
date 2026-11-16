// guidance.mjs: thimble's guidance for the main agent, the port of upstream guidance/guidance.ts (TypeScript bound to
// Claude Code's Register API, so not importable). The text is upstream's `main` (prompts/main.md: thimble,
// communicating, citing, cards, labels) with the port's tools section (copilot/prompts/tools.md). As upstream does,
// the `## ` section of a switched-off feature is left out, citations in the examples read as plain words while the
// agent does not cite, and the modes that change what the agent does add a sentence at the end.
import { featuresOf } from './settings.mjs'
import { ownText, upstreamText } from './prompts.mjs'

const SECTIONS = { cites: 'Citing claims', cards: 'Cards', labels: 'Labels' }
const MARK = /\[([^\]]*)\]\(#\)/g
export const ON_DEMAND = 'Draw a card only when the analyst asks for one.'
export const CARDS_OFF = 'Cards are off, so draw no cards.'
const ASKED = 'These come only when the analyst asks:'

/** upstream guidanceFor: the text without the sections of features that are off. */
export function guidanceFor(text, on, modes = []) {
  const off = new Set(Object.keys(SECTIONS).filter(f => !on(f)).map(f => SECTIONS[f]))
  const kept = text.split(/^(?=## )/m).filter(part => !off.has(/^## (.+)/.exec(part)?.[1]?.trim() ?? '')).join('')
  const out = (on('cites') ? kept : kept.replace(MARK, '$1')).trim()
  return modes.length ? `${out}\n\n${modes.join(' ')}` : out
}

/** upstream modesNow, with Copilot's way of asking (the /thimble-* commands and the workbench). */
export function modesNow(choice) {
  const asked = [
    choice('citations') === 'manual' && 'citations (/thimble-cite, or c in the workbench)',
    choice('explain') === 'on demand' && 'explainers (/thimble-explain)',
  ].filter(Boolean)
  const list = asked.length > 1 ? `${asked.slice(0, -1).join(', ')} and ${asked.at(-1)}` : asked[0]
  return [
    ...(choice('cards') === 'on demand' ? [ON_DEMAND] : []),
    ...(choice('cards') === 'off' ? [CARDS_OFF] : []),
    ...(list ? [`${ASKED} ${list}.`] : []),
  ]
}

/** The guidance for these settings, or '' when every feature it teaches is off. */
export async function guidanceText(values, tmpdir) {
  const f = await featuresOf(values)
  const on = key => (key === 'cites' ? f.cites() : f.on(key))
  const main = await upstreamText('main')
  // a tool of a feature that is off is not named, as upstream leaves out the Labels section with Labels off
  const tools = ownText('tools', { TMPDIR: tmpdir }).split('\n')
    .filter(l => !(l.startsWith('- `thimble_card`') && !f.on('cards')) && !(l.startsWith('- `thimble_label`') && !f.on('labels')))
    .join('\n')
  return guidanceFor(`${main.trim()}\n\n${tools.trim()}\n`, on, modesNow(f.choice))
}
