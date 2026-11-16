// cards.mjs: thimble's cards in the Copilot port. The agent's `thimble_card` call gives a title, a JSON file of rows
// and a view (plain JavaScript, upstream's card surface: prompts/card-tool.md). The extension never runs the view: it
// keeps the card, and the workbench draws it in a sandboxed frame (ui/frame.html), which sends back a text copy of
// what it drew, or the view's error, for the tool's result. Upstream draws in Claude Code's terminal with
// cards/runner.mjs, in a node:vm; that module starts a server when imported with an argument and binds Ink, so the
// port reimplements its surface in the frame instead.
import fs from 'node:fs'
import path from 'node:path'

export const MAX_DATA = 5 * 1024 * 1024

/** A data file's rows: a JSON list, JSON Lines, or one object (whose `rows` list is the rows). */
export function readData(file, cwd = process.cwd()) {
  const abs = path.resolve(cwd, String(file || ''))
  const st = fs.statSync(abs)
  if (st.size > MAX_DATA) throw new Error(`${file} is ${Math.round(st.size / 1024)} KB; a card's data must be under ${MAX_DATA / 1024 / 1024} MB`)
  const text = fs.readFileSync(abs, 'utf8')
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text.split(/\r?\n/).filter(l => l.trim()).map((l, i) => { try { return JSON.parse(l) } catch { throw new Error(`${file} is neither JSON nor JSON Lines (line ${i + 1})`) } })
  }
  // upstream cards/runner.mjs parseRows: a list is the rows; an object is `props.data`, its `rows` list the rows
  const rows = Array.isArray(data) ? data : data && typeof data === 'object' ? (Array.isArray(data.rows) ? data.rows : []) : []
  return { data, rows, file: abs }
}

/** A view with edits applied: each {old, new} replaces one exact passage. */
export function applyEdits(view, edits) {
  let v = String(view || '')
  for (const e of edits || []) {
    const old = String(e?.old ?? e?.old_str ?? '')
    if (!old || !v.includes(old)) throw new Error(`edit not applied: ${JSON.stringify(old.slice(0, 80))} is not in the view`)
    if (v.indexOf(old) !== v.lastIndexOf(old)) throw new Error(`edit not applied: ${JSON.stringify(old.slice(0, 80))} is in the view more than once`)
    v = v.replace(old, () => String(e?.new ?? e?.new_str ?? ''))
  }
  return v
}

/** The card tool's arguments as a card for the store; `prev` is the card an `id` names. */
export function cardFrom(args, cwd, prev = null) {
  const title = String(args.title || prev?.title || '').trim()
  if (!title) throw new Error('give the card a title')
  const view = args.edits ? applyEdits(prev?.view ?? '', args.edits) : String(args.view ?? prev?.view ?? '')
  if (!/function\s+view\s*\(/.test(view)) throw new Error('the view must define `function view(props, surface)`')
  const dataFile = args.data ?? prev?.dataFile
  if (!dataFile) throw new Error('give `data`, the path of a JSON file of rows')
  const { data, rows, file } = readData(dataFile, cwd)
  return { title, view, data, rows, dataFile: file, takeaway: String(args.takeaway ?? prev?.takeaway ?? ''), actions: Array.isArray(args.actions) ? args.actions.map(String).slice(0, 20) : [], version: (prev?.version ?? 0) + 1, status: 'drawing', text: '', error: '' }
}
