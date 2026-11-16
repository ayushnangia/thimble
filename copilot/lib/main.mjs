// main.mjs: thimble's Copilot CLI extension, wired into the session (the port of upstream's plugin entry and its
// Register calls: guidance/guidance.ts, hooks/register.ts, observer/observer.ts, marks/register.ts, cards/register.ts).
//   - guidance: upstream's main prompt and the port's tools section, as additional context at the session's start and
//     again after a settings change or a compaction (onSessionStart, onUserPromptSubmitted)
//   - tools: tools.mjs; canvas: `thimble`, the workbench (server.mjs, ui/), with actions the agent can call
//   - after each answer (session.idle): its citations (auto modes: verified now or when opened), the observer
//   - coverage and the transcript the side models read, from each tool call (onPostToolUse)
//   - temp-allow: the agent's file tools in thimble's temp folder need no prompt (upstream hooks/temp-allow.sh)
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

import { recordAsked, recordMarks, verify } from './citations.mjs'
import { countFiles, recordTool } from './coverage.mjs'
import { guidanceText } from './guidance.mjs'
import { observe } from './observer.mjs'
import { createServer } from './server.mjs'
import { currentValues, featuresOf, setSetting, SAME } from './settings.mjs'
import { askThread, catchUp, explain, simplify } from './side.mjs'
import { Store } from './store.mjs'
import { drawCard, TABS, toolsFor } from './tools.mjs'

const cut = (s, n) => { const t = String(s ?? ''); return t.length <= n ? t : `${t.slice(0, n - 1)}…` }
const hash = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12)
const FILE_TOOLS = new Set(['view', 'create', 'edit', 'str_replace_editor', 'write', 'grep', 'glob'])

/** Whether a path lies in a folder. */
export function within(dir, p) {
  if (typeof p !== 'string' || !p) return false
  const rel = path.relative(path.resolve(dir), path.resolve(p))
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** Everything thimble keeps for one session, and what the tools, hooks, canvas and server share. */
export function makeContext({ sessionId = process.env.COPILOT_AGENT_SESSION_ID || 'local', cwd = process.cwd(), persist = true } = {}) {
  const ctx = {
    cwd,
    session: null,
    store: new Store({ sessionId, cwd, persist }),
    tmpdir: path.join(os.tmpdir(), 'thimble-copilot', String(sessionId).replace(/[^A-Za-z0-9_.-]/g, '_')),
    model: '',
    effort: '',
    server: null,
    jobs: new Set(),
    told: '',
    cardWaits: new Map(),
    settings: null,
  }
  ctx.values = async () => (ctx.settings ??= await currentValues())
  ctx.settingsChanged = v => { ctx.settings = v; ctx.server?.push('settings', v) }
  ctx.log = (msg, level = 'info') => { ctx.session?.log(msg, { level }).catch(() => {}) }
  ctx.serverUrl = () => ctx.server?.url || ''
  ctx.pages = () => ctx.server?.pages?.() ?? 0
  ctx.showTab = tab => ctx.server?.push('tab', TABS.includes(tab) ? tab : 'answer')
  ctx.sideOpts = async () => ({ model: ctx.model })
  ctx.verifierOpts = async () => {
    const v = await ctx.values()
    return { model: v.checkerModel && v.checkerModel !== SAME ? v.checkerModel : ctx.model, effort: v.checkerEffort && v.checkerEffort !== SAME ? v.checkerEffort : ctx.effort, tmpdir: ctx.tmpdir, log: m => ctx.log(m) }
  }
  ctx.job = (name, fn) => {
    const p = (async () => fn())().catch(e => ctx.log(`thimble: ${name} failed: ${e?.message || e}`, 'warning')).finally(() => ctx.jobs.delete(p))
    ctx.jobs.add(p)
    return p
  }
  ctx.waitCard = (id, version, ms) => new Promise(resolve => {
    const key = `${id}@${version}`
    const t = setTimeout(() => { ctx.cardWaits.delete(key); resolve(null) }, ms)
    ctx.cardWaits.set(key, r => { clearTimeout(t); ctx.cardWaits.delete(key); resolve(r) })
  })
  ctx.cardResult = r => {
    const card = ctx.store.get('cards', String(r?.id || ''))
    if (!card || Number(r.version) !== card.version) return
    ctx.store.update('cards', card.id, { status: r.ok ? 'drawn' : 'failed', text: cut(r.text, 20000), error: cut(r.error, 2000), keys: cut(r.keys, 40) })
    ctx.cardWaits.get(`${card.id}@${card.version}`)?.(r)
  }
  ctx.ensureServer = async () => {
    if (!ctx.server) {
      const s = createServer({ store: ctx.store, onAction: (n, i) => uiAction(ctx, n, i), onSettings: async (k, v) => { const after = await setSetting(k, v); ctx.settingsChanged(after); return after }, getSettings: async () => ({ values: await ctx.values(), switches: await (await import('./settings.mjs')).switches() }), onCardResult: r => ctx.cardResult(r) })
      await s.listen()
      ctx.server = s
      ctx.store.set('url', s.url)
      // the home folder is no project: its walk takes minutes (upstream bar/counts.ts coverageRoot)
      if (path.resolve(ctx.cwd) !== path.resolve(os.homedir())) ctx.store.state.coverage.total ??= countFiles(ctx.cwd)
    }
    return ctx.server.url
  }
  return ctx
}

/** The workbench's buttons. Answers JSON for the page. */
export async function uiAction(ctx, name, input = {}) {
  const st = ctx.store
  const bg = (what, fn) => { ctx.job(what, fn); return { ok: true, started: what } }
  switch (name) {
    case 'verify': {
      const ids = Array.isArray(input.ids) && input.ids.length ? input.ids : st.state.citations.filter(c => c.status === 'unchecked').map(c => c.id)
      return ids.length ? bg('check of citations', async () => verify(st, ids, await ctx.verifierOpts())) : { ok: false, error: 'no unchecked citation' }
    }
    case 'cite': {
      const c = recordAsked(st, { words: input.words, answerId: input.answerId })
      return bg('check of a citation', async () => verify(st, [c.id], await ctx.verifierOpts()))
    }
    case 'explain': return bg('explainer', async () => explain(st, input.words, await ctx.sideOpts()))
    case 'simplify': return bg('simpler version', async () => simplify(st, await ctx.values(), await ctx.sideOpts()))
    case 'catchup': return bg('catch-up', async () => catchUp(st, await ctx.values(), await ctx.sideOpts()))
    case 'ask': return bg('side thread', async () => askThread(st, { question: input.question, about: input.about, threadId: input.thread }, await ctx.sideOpts()))
    case 'visualize': {
      if (!ctx.session) return { ok: false, error: 'no session' }
      await ctx.session.send({ prompt: 'thimble: draw your last answer as one card. Call thimble_visualize and follow it.' })
      return { ok: true, started: 'card' }
    }
    case 'dismiss': {
      const kind = ['notes', 'cards', 'threads'].includes(input.kind) ? input.kind : 'notes'
      st.update(kind, String(input.id || ''), { dismissed: true })
      return { ok: true }
    }
    default: return { ok: false, error: `no action ${name}` }
  }
}

/** The canvas: the workbench in a panel, with actions the agent can call. */
export function canvasFor(ctx, createCanvas) {
  const one = (name, description, inputSchema, handler) => ({ name, description, inputSchema, handler: async c => { try { return await handler(c?.input ?? {}) } catch (e) { return { ok: false, error: String(e?.message || e) } } } })
  return createCanvas({
    id: 'thimble',
    displayName: 'thimble',
    description: "thimble's workbench: cards, citations and their verdicts, explainers and heads-ups, side threads, claims, coverage and labels of this session.",
    inputSchema: { type: 'object', properties: { tab: { type: 'string', enum: TABS } } },
    open: async c => {
      const url = await ctx.ensureServer()
      const tab = c?.input?.tab
      // auto mode: citations are checked when the workbench opens
      if ((await ctx.values()).citations === 'auto') {
        const ids = ctx.store.state.citations.filter(x => x.status === 'unchecked').map(x => x.id)
        if (ids.length) ctx.job('check of citations', async () => verify(ctx.store, ids, await ctx.verifierOpts()))
      }
      const n = ctx.store.counts()
      return { url: `${url}${tab ? `#${tab}` : ''}`, title: 'thimble', status: `${n.cards} cards · ${n.citations} citations · ${n.explainers + n.headsups} notes` }
    },
    actions: [
      one('add_card', 'Draw a card (same as the thimble_card tool).', { type: 'object', properties: { title: { type: 'string' }, data: { type: 'string' }, view: { type: 'string' }, id: { type: 'string' }, takeaway: { type: 'string' } }, required: ['title'] }, i => drawCard(ctx, i)),
      one('add_citation', 'Cite words of the last answer; the verifier checks them in the background.', { type: 'object', properties: { words: { type: 'string' }, sentence: { type: 'string' } }, required: ['words'] }, async i => { const c = recordAsked(ctx.store, i); ctx.job('check of a citation', async () => verify(ctx.store, [c.id], await ctx.verifierOpts())); return { ok: true, id: c.id } }),
      one('add_note', 'Add an explainer or a heads-up.', { type: 'object', properties: { kind: { type: 'string', enum: ['explainer', 'headsup'] }, term: { type: 'string' }, body: { type: 'string' }, here: { type: 'string' }, title: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } } }, required: ['kind', 'term'] }, i => ({ ok: true, id: ctx.store.add('notes', { ...i, by: 'agent', answerId: ctx.store.lastAnswer()?.id ?? null }).id })),
      one('add_claim', 'Add a claim to the Claims tab.', { type: 'object', properties: { claim: { type: 'string' }, quote: { type: 'string' }, cluster: { type: 'string' }, because: { type: 'string' } }, required: ['claim'] }, async i => { const { mergeClaims } = await import('./observer.mjs'); return { ok: true, id: mergeClaims(ctx.store, { claims: [{ cluster: 'claims', ...i }] }, null)[0]?.id } }),
      one('add_label', 'Add a label with its values.', { type: 'object', properties: { name: { type: 'string' }, says: { type: 'string' }, method: { type: 'string' }, values: { type: 'object' } }, required: ['name', 'says'] }, i => ({ ok: true, id: ctx.store.add('labels', { method: 'code', values: {}, ...i, records: Object.keys(i.values || {}).length }).id })),
      one('show_tab', 'Show a tab of the workbench.', { type: 'object', properties: { tab: { type: 'string', enum: TABS } }, required: ['tab'] }, i => { ctx.showTab(i.tab); return { ok: true } }),
      one('get_state', "The workbench's counts and the last items of each tab.", { type: 'object', properties: {} }, () => {
        const s = ctx.store.state
        return { url: ctx.serverUrl(), counts: ctx.store.counts(), citations: s.citations.slice(-10), notes: s.notes.slice(-10), cards: s.cards.slice(-5).map(c => ({ id: c.id, title: c.title, status: c.status, error: c.error })) }
      }),
    ],
    onClose: () => {},
  })
}

/** The guidance to add now, or '' when it was given and nothing changed (settings, a compaction). */
async function guidanceNow(ctx, force = false) {
  const v = await ctx.values()
  const g = await guidanceText(v, ctx.tmpdir)
  const h = hash(g)
  if (!force && h === ctx.told) return ''
  ctx.told = h
  return g ? `<thimble-guidance>\n${g}\n</thimble-guidance>` : ''
}

/** What the verifier found since the last prompt that the agent should know (upstream tells main at the next prompt). */
export function verdictNews(ctx) {
  const news = ctx.store.state.citations.filter(c => ['corrected', 'narrowed', 'wrong'].includes(c.status) && !c.told)
  for (const c of news) c.told = true
  if (!news.length) return ''
  return `thimble's verifier checked your citations against the files:\n${news.map(c => `- [${c.words}] ${c.status}${c.correction?.words ? ` → "${c.correction.words}"` : ''}: ${c.reason}${c.note ? ` (${c.note})` : ''}`).join('\n')}\nCorrect them in your next answer where they matter.`
}

export function hooksFor(ctx) {
  return {
    onSessionStart: async () => {
      try { const g = await guidanceNow(ctx, true); return g ? { additionalContext: g } : undefined } catch (e) { ctx.log(`thimble: guidance failed: ${e?.message || e}`, 'warning') }
    },
    onUserPromptSubmitted: async input => {
      const st = ctx.store
      st.state.turn += 1
      st.add('prompts', { text: cut(input?.prompt, 8000) })
      try {
        const parts = [await guidanceNow(ctx), verdictNews(ctx)].filter(Boolean)
        return parts.length ? { additionalContext: parts.join('\n\n') } : undefined
      } catch (e) { ctx.log(`thimble: guidance failed: ${e?.message || e}`, 'warning') }
    },
    onPreToolUse: input => {
      const a = input?.toolArgs && typeof input.toolArgs === 'object' ? input.toolArgs : {}
      const p = a.path ?? a.file_path
      if (FILE_TOOLS.has(input?.toolName) && within(ctx.tmpdir, p)) return { permissionDecision: 'allow', permissionDecisionReason: "thimble's temp folder" }
    },
    onPostToolUse: input => {
      if (String(input?.toolName || '').startsWith('thimble_')) return
      try {
        recordTool(ctx.store.state.coverage, input)
        const r = input.toolResult
        ctx.store.add('tools', { name: input.toolName, args: cut(JSON.stringify(input.toolArgs ?? {}), 600), result: cut(typeof r === 'string' ? r : r?.textResultForLlm ?? '', 2000) })
        ctx.store.changed('coverage', null)
      } catch { /* coverage is best effort */ }
    },
    onSessionEnd: async () => { ctx.store.flush(); await ctx.server?.close() },
  }
}

/** After an answer: record it, its citations, and run the checks and the observer the settings ask for. */
export async function afterAnswer(ctx, text) {
  const st = ctx.store
  const answer = st.add('answers', { text, model: ctx.model })
  const v = await ctx.values()
  const f = await featuresOf(v)
  if (f.cites()) {
    const marks = await recordMarks(st, answer)
    if (marks.length && v.citations === 'auto + verify') ctx.job('check of citations', async () => verify(st, marks.map(m => m.id), await ctx.verifierOpts()))
  }
  const lenses = f.lenses()
  if (lenses.explain || lenses.heads || lenses.claims) ctx.job('observer', async () => observe(st, answer, v, { model: ctx.model, log: (m, l) => ctx.log(m, l) }))
  return answer
}

/** Join the session. `sdk`: {joinSession, createCanvas} from "@github/copilot-sdk/extension". */
export async function start(sdk) {
  // a side process thimble started (model.mjs) runs no thimble of its own
  if (process.env.THIMBLE_COPILOT_CHILD === '1') return sdk.joinSession({})
  const ctx = makeContext()
  const session = await sdk.joinSession({ tools: await toolsFor(ctx), hooks: hooksFor(ctx), canvases: [canvasFor(ctx, sdk.createCanvas)] })
  ctx.session = session
  if (session.sessionId && session.sessionId !== ctx.store.state.sessionId) ctx.store.rename(session.sessionId)
  let last = ''
  session.on('assistant.message', e => {
    const d = e?.data || {}
    if (d.parentToolCallId) return
    if (d.model) ctx.model = d.model
    if (typeof d.content === 'string' && d.content.trim()) last = d.content
  })
  session.on('session.model_change', e => { if (e?.data?.newModel) ctx.model = e.data.newModel })
  session.on('session.idle', () => {
    if (!last) return
    const text = last
    last = ''
    ctx.job('answer', () => afterAnswer(ctx, text))
  })
  session.on(e => { if (/compaction/.test(String(e?.type || ''))) ctx.told = '' })
  return { ctx, session }
}
