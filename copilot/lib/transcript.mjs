// transcript.mjs: the parts of the session a side process reads (prompts/side.md's TRANSCRIPT), since a Copilot child
// cannot resume the analyst's session as upstream's fork resumes Claude Code's. Newest turns are kept whole and older
// ones cut first; tool results are cut short, as the child can read the files again itself.
const cut = (s, n) => { const t = String(s ?? ''); return t.length <= n ? t : `${t.slice(0, n - 1)}…` }

/** The turns of the state as text: each prompt, the tool calls of its turn, and the answer. */
export function transcriptOf(state, { maxChars = 60000, turns = 6, toolChars = 1500 } = {}) {
  const byTurn = new Map()
  const at = n => { if (!byTurn.has(n)) byTurn.set(n, { prompt: '', tools: [], answers: [] }); return byTurn.get(n) }
  for (const p of state.prompts || []) at(p.turn).prompt = p.text
  for (const t of state.tools || []) at(t.turn).tools.push(t)
  for (const a of state.answers || []) at(a.turn).answers.push(a)
  const nums = [...byTurn.keys()].sort((a, b) => a - b).slice(-turns)
  const parts = nums.map(n => {
    const t = byTurn.get(n)
    const lines = [`### Turn ${n}`]
    if (t.prompt) lines.push(`The analyst: ${cut(t.prompt, 4000)}`)
    for (const c of t.tools.slice(-40)) lines.push(`[tool ${c.name}] ${cut(c.args, 400)}${c.result ? `\n${cut(c.result, toolChars)}` : ''}`)
    for (const a of t.answers) lines.push(`Copilot's message:\n${a.text}`)
    return lines.join('\n\n')
  })
  let text = parts.join('\n\n')
  // drop the oldest turns, then cut the front, until it fits
  while (text.length > maxChars && parts.length > 1) { parts.shift(); text = parts.join('\n\n') }
  return text.length > maxChars ? `…${text.slice(-maxChars)}` : text
}
