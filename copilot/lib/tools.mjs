// tools.mjs: the tools thimble gives the main agent in Copilot CLI. Upstream gives Claude Code's agent one tool, card
// (cards/register.ts, described by prompts/card-tool.md, which this port reuses as thimble_card's description), and does
// the rest from its bar's keys. Copilot has no keys an extension can bind, so each key is a /thimble-* skill that
// calls one of these tools, and the workbench's buttons call the same functions (main.mjs actions).
import path from 'node:path'

import { recordAsked, verify } from './citations.mjs'
import { cardFrom } from './cards.mjs'
import { summary } from './coverage.mjs'
import { listFixes, nameFix, startFix } from './fixes.mjs'
import { askThread, catchUp, explain, simplify } from './side.mjs'
import { setSetting, switches } from './settings.mjs'
import { copilotize, ownText, upstreamText } from './prompts.mjs'
import { readUpstream, upstreamRoot } from './upstream.mjs'

/** The letters thimble's workbench keeps (upstream KEPT: its bar's keys, here the workbench's). */
export const KEPT = 'v s c e a t b r l w'
export const TABS = ['answer', 'cards', 'citations', 'notes', 'threads', 'claims', 'coverage', 'labels', 'settings']

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const str = description => ({ type: 'string', description })
const text = v => (typeof v === 'string' ? v : JSON.stringify(v, null, 1))

/** The thimble_card description: upstream's card-tool.md, both parts, in Copilot's words. */
export async function cardDescription(tmpdir) {
  const t = await upstreamText('card-tool', { TMPDIR: tmpdir, KEPT })
  return t.replace('<!-- view -->', '').trim()
}

/** Draw or redraw a card; waits a few seconds for the workbench's text copy. */
export async function drawCard(ctx, args) {
  const prev = args.id ? ctx.store.get('cards', args.id) : null
  if (args.id && !prev) throw new Error(`no card ${args.id}`)
  const c = cardFrom(args, ctx.cwd, prev)
  const card = prev ? ctx.store.update('cards', prev.id, c) : ctx.store.add('cards', c)
  const url = await ctx.ensureServer()
  if (!ctx.pages()) {
    return `Card ${card.id} saved (version ${card.version}), not drawn yet: no workbench is open. Open the \`thimble\` canvas, or ${url}, and it draws there. Place it in your answer with a line that holds only [${card.title}](card:${card.id}).`
  }
  const r = await ctx.waitCard(card.id, card.version, 10000)
  const place = `Place it in your answer with a line that holds only [${card.title}](card:${card.id}).`
  if (!r) return `Card ${card.id} (version ${card.version}) sent to the workbench; it gave no text copy in 10s. ${place}`
  if (!r.ok) return `The view of card ${card.id} failed: ${r.error}`
  return `Card ${card.id}, version ${card.version}. Text copy:\n${r.text}\n\n${place}`
}

/** The tools, for joinSession. */
export async function toolsFor(ctx) {
  const list = await switches()
  const keys = list.map(s => s.key)
  const tool = (name, description, parameters, handler) => ({
    name, description, parameters, skipPermission: true,
    handler: async args => { try { return text(await handler(args || {})) } catch (e) { return `thimble: ${e?.message || e}` } },
  })
  const background = (name, fn, done) => {
    ctx.job(name, async () => { const r = await fn(); done?.(r); return r })
    return `thimble started ${name} in the background (a second model reads the files, about a minute or two). It shows in the workbench (${ctx.serverUrl() || 'open the thimble canvas'}) and as a line in the timeline. Do not wait for it; go on.`
  }
  return [
    tool('thimble_card', await cardDescription(ctx.tmpdir), obj({
      title: str('The card title (thimble draws it).'),
      data: str('Path of a JSON file of rows your code wrote (a list, JSON Lines, or one object).'),
      view: str('Plain JavaScript that defines `function view(props, surface)`; may define `keys` and `onKey`.'),
      id: str('The id of a card to draw a new version of.'),
      edits: { type: 'array', description: 'Edits to the view of card `id`: each replaces one exact passage.', items: obj({ old: str('Exact passage of the view'), new: str('Its replacement') }, ['old', 'new']) },
      actions: { type: 'array', description: 'Keys to press in order after drawing (letters the card takes); the result has a text copy after each.', items: { type: 'string' } },
      takeaway: str('One sentence: what the card shows.'),
    }, ['title']), a => drawCard(ctx, a)),

    tool('thimble_cite', 'Cite words of your last answer that the analyst asked to check (/thimble-cite). thimble records the citation and its verifier, a second model, checks it against the files in the background.', obj({
      words: str('The exact words of your answer to cite.'),
      sentence: str('The sentence that holds them, with the words in [brackets]. Optional.'),
      wait: { type: 'boolean', description: 'Wait for the verdict (minutes). Default false.' },
    }, ['words']), async a => {
      const c = recordAsked(ctx.store, a)
      if (a.wait) { const [v] = await verify(ctx.store, [c.id], await ctx.verifierOpts()); return { id: v.id, status: v.status, reason: v.reason, correction: v.correction, evidence: v.evidence } }
      return background(`check of citation ${c.id}`, async () => verify(ctx.store, [c.id], await ctx.verifierOpts()))
    }),

    tool('thimble_verify', "Check citations with thimble's verifier now: those named, or every unchecked citation of the last answer.", obj({
      ids: { type: 'array', items: { type: 'string' }, description: 'Citation ids. Default: the unchecked ones of the last answer.' },
      wait: { type: 'boolean', description: 'Wait for the verdicts (minutes). Default false.' },
    }), async a => {
      const last = ctx.store.lastAnswer()
      const ids = a.ids?.length ? a.ids : ctx.store.state.citations.filter(c => c.answerId === last?.id && c.status === 'unchecked').map(c => c.id)
      if (!ids.length) return 'No unchecked citation.'
      if (a.wait) return (await verify(ctx.store, ids, await ctx.verifierOpts())).map(c => ({ id: c.id, words: c.words, status: c.status, reason: c.reason }))
      return background(`check of ${ids.length} citation${ids.length === 1 ? '' : 's'}`, async () => verify(ctx.store, ids, await ctx.verifierOpts()))
    }),

    tool('thimble_explain', 'Explain words for the analyst (/thimble-explain): give `body` (and `here`) to record your own explainer, or only `term` to have a second model write one in the background.', obj({
      term: str('The exact words to explain.'),
      body: str('What they mean, for a reader new to the field.'),
      here: str('Where they mattered in this work, with links to the lines ([words](path#L12-20)).'),
    }, ['term']), async a => {
      if (a.body) return ctx.store.add('notes', { kind: 'explainer', term: a.term, body: a.body, here: a.here || '', answerId: ctx.store.lastAnswer()?.id ?? null, by: 'agent' }).id
      return background(`explainer of "${a.term}"`, async () => explain(ctx.store, a.term, await ctx.sideOpts()), n => ctx.log(`thimble · ${n.term}: ${n.body}`))
    }),

    tool('thimble_headsup', 'Record a heads-up the analyst asked for: one important detail of an answer to know before relying on it.', obj({
      term: str('Exact words from the answer.'),
      title: str('What the detail means for the answer, in a few words.'),
      bullets: { type: 'array', items: { type: 'string' }, description: 'Points, their words linked to the lines of a file that show it.' },
    }, ['term', 'title']), async a => ctx.store.add('notes', { kind: 'headsup', term: a.term, title: a.title, bullets: a.bullets || [], answerId: ctx.store.lastAnswer()?.id ?? null, by: 'agent' }).id),

    tool('thimble_label', "Record a label your code computed over the records, for the Labels tab and the verifier.", obj({
      name: str('The label name.'),
      says: str('The rule in plain words.'),
      method: { type: 'string', enum: ['regex', 'code', 'prompt'], description: 'How it was made.' },
      values: { type: 'object', description: 'The value of each record, by record key.', additionalProperties: true },
      file: str('Or: path of a JSON file of {key: value}.'),
      limit: str('What the label leaves out, if anything.'),
    }, ['name', 'says']), async a => {
      let values = a.values || {}
      if (a.file) values = JSON.parse((await import('node:fs')).readFileSync((await import('node:path')).resolve(ctx.cwd, a.file), 'utf8'))
      const counts = {}
      for (const v of Object.values(values)) counts[String(v)] = (counts[String(v)] || 0) + 1
      const was = ctx.store.state.labels.find(l => l.name === a.name)
      const it = { name: a.name, says: a.says, method: a.method || 'code', values, counts, limit: a.limit || '', records: Object.keys(values).length }
      return was ? `${ctx.store.update('labels', was.id, { ...it, version: (was.version || 1) + 1 }).id} (new version)` : ctx.store.add('labels', { ...it, version: 1 }).id
    }),

    tool('thimble_claim', 'Record a claim the analyst asked to track in the Claims tab.', obj({
      claim: str('A full sentence that reads alone.'),
      quote: str('The exact words of the message that say it.'),
      cluster: str('The question it is about (a cluster name or id).'),
      because: str('Why it holds, citation links kept.'),
    }, ['claim']), async a => {
      const { mergeClaims } = await import('./observer.mjs')
      const [c] = mergeClaims(ctx.store, { claims: [{ claim: a.claim, quote: a.quote || '', cluster: a.cluster || 'claims', because: a.because || '' }] }, ctx.store.lastAnswer()?.id ?? null)
      return c?.id ?? 'not recorded'
    }),

    tool('thimble_open', "The address of thimble's workbench (a local page). Where the host shows canvases, the `thimble` canvas shows the same page.", obj({ tab: { type: 'string', enum: TABS } }), async a => {
      const url = await ctx.ensureServer()
      if (a.tab) ctx.showTab(a.tab)
      return `${url}${a.tab ? `#${a.tab}` : ''}`
    }),

    tool('thimble_simplify', 'Write a shorter, plainer version of your last answer with a second model (/thimble-simplify). It shows in the workbench and the timeline.', obj({ wait: { type: 'boolean' } }), async a => {
      if (a.wait) return (await simplify(ctx.store, await ctx.values(), await ctx.sideOpts())).text
      return background('simpler version', async () => simplify(ctx.store, await ctx.values(), await ctx.sideOpts()), n => ctx.log(`thimble · simpler version:\n${n.text}`))
    }),

    tool('thimble_catchup', "Catch the analyst up on your messages since their last prompt, in one message (/thimble-catchup).", obj({ wait: { type: 'boolean' } }), async a => {
      if (a.wait) return (await catchUp(ctx.store, await ctx.values(), await ctx.sideOpts())).text
      return background('catch-up', async () => catchUp(ctx.store, await ctx.values(), await ctx.sideOpts()), n => ctx.log(`thimble · catch-up:\n${n.text}`))
    }),

    tool('thimble_ask', 'Ask a side question in a thread of its own (/thimble-ask); a second model answers it with the files, without changing this conversation.', obj({
      question: str("The analyst's question."),
      about: str('What it is about: words of an answer, a card, a tab.'),
      thread: str('A thread id to continue.'),
      wait: { type: 'boolean' },
    }, ['question']), async a => {
      const go = async () => askThread(ctx.store, { question: a.question, about: a.about, threadId: a.thread }, await ctx.sideOpts())
      if (a.wait) { const t = await go(); return { thread: t.id, answer: t.messages.at(-1)?.text } }
      return background('side thread', go, t => ctx.log(`thimble · thread ${t.id}: ${t.messages.at(-1)?.text ?? ''}`))
    }),

    tool('thimble_visualize', 'Instructions for drawing your last answer as one card (/thimble-visualize, the v key). Follow them, then call thimble_card.', obj({}), async () => upstreamText('designer', { TMPDIR: ctx.tmpdir })),

    tool('thimble_tour', "thimble's two-minute tour on made-up sample data (/thimble-tour). Returns what to write; follow it exactly.", obj({}), async () => {
      const sample = path.join(upstreamRoot(), 'tour', 'sample', 'orders.csv')
      const skill = copilotize(readUpstream('skills/tour/SKILL.md').replace(/^---[\s\S]*?---\s*/, '')).replaceAll('${CLAUDE_PLUGIN_ROOT}/tour/sample/orders.csv', sample)
      return `${ownText('tour', { SAMPLE: sample })}\n${skill}`
    }),

    tool('thimble_fix', "Start or continue a fix to thimble itself from the analyst's words (/thimble-fix), list the fixes, or name one. Returns what to do.", obj({
      words: str("The analyst's words, as they typed them."),
      fix: str('"new", or the number of the fix these words change.'),
      title: str('With `fix`: the fix\'s title, to name it once done.'),
      list: { type: 'boolean', description: 'List the fixes.' },
    }), async a => {
      if (a.list) return listFixes().map(f => ({ fix: f.n, title: f.title, dir: f.dir, branch: f.branch, asked: f.words }))
      if (a.title && a.fix) return nameFix(a.fix, a.title)
      if (!a.words) return upstreamText('fix-request', { WORDS: '(none given)' })
      return startFix(a.words, a.fix || 'new')
    }),

    tool('thimble_status', "thimble's state: counts, the workbench address, settings, coverage and the last citations.", obj({}), async () => {
      const s = ctx.store.state
      const cov = summary(s.coverage)
      return {
        workbench: ctx.serverUrl() || '(not started; thimble_open starts it)',
        counts: ctx.store.counts(),
        settings: await ctx.values(),
        coverage: { filesRead: cov.read, searchedOnly: cov.searchedOnly, linesRead: cov.readLines, lines: cov.lines, searches: cov.searches, shell: cov.shell, top: cov.files.slice(0, 15).map(f => `${f.path} ${f.readLines}/${f.lines ?? '?'}`) },
        citations: s.citations.slice(-12).map(c => ({ id: c.id, words: c.words, status: c.status, reason: c.reason })),
        threads: s.threads.slice(-5).map(t => ({ id: t.id, about: t.about, status: t.status })),
        labels: s.labels.map(l => ({ id: l.id, name: l.name, says: l.says, records: l.records, counts: l.counts })),
      }
    }),

    tool('thimble_settings', `Read or change thimble's settings (/thimble-settings). With no key, lists them. Keys: ${keys.join(', ')}.`, obj({
      key: { type: 'string', enum: keys },
      value: { type: 'string', description: 'The new value: "true"/"false", or one of the choices the list gives.' },
    }), async a => {
      if (!a.key) { const now = await ctx.values(); return (await switches()).map(s => ({ key: s.key, title: s.title, value: now[s.key], choices: s.choices ?? [true, false], help: s.help })) }
      const v = a.value === 'true' ? true : a.value === 'false' ? false : a.value
      const after = await setSetting(a.key, v)
      ctx.settingsChanged(after)
      return after
    }),
  ]
}
