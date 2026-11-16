// coverage.mjs: how much of each file the main agent read, from its tool calls (the port of upstream's coverage, which
// engine/kernel/coverage.py computes from Claude Code's transcript). A `view` of a file puts the lines it showed into
// the agent's context: its view_range, or the lines of its result. A `grep` or `glob` searched files without reading
// them; the files a grep's result names count as searched. A shell command is counted, not parsed.
import fs from 'node:fs'
import path from 'node:path'

const READ_TOOLS = new Set(['view', 'read', 'read_file', 'Read'])
const SEARCH_TOOLS = new Set(['grep', 'rg', 'Grep', 'glob', 'Glob', 'search'])
const SHELL_TOOLS = new Set(['powershell', 'bash', 'shell', 'Bash'])
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache', 'dist', 'build'])
const MAX_COUNT_BYTES = 64 * 1024 * 1024

export function newCoverage(cwd = process.cwd()) {
  return { cwd, files: {}, searches: [], shell: 0, total: null }
}

const rel = (cwd, p) => path.relative(cwd, path.resolve(cwd, p)).split(path.sep).join('/') || '.'

/** Ranges [a, b] (1-based, inclusive) merged. */
export function mergeRanges(ranges) {
  const out = []
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const last = out.at(-1)
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

const covered = ranges => ranges.reduce((s, [a, b]) => s + (b - a + 1), 0)

/** A file's lines, or null for one too large, binary or unreadable. */
export function countLines(file) {
  try {
    const st = fs.statSync(file)
    if (!st.isFile() || st.size > MAX_COUNT_BYTES) return null
    const buf = fs.readFileSync(file)
    if (buf.subarray(0, 8000).includes(0)) return null
    if (!buf.length) return 0
    let n = 0
    for (const b of buf) if (b === 10) n++
    return buf[buf.length - 1] === 10 ? n : n + 1
  } catch {
    return null
  }
}

function entry(cov, file) {
  const key = rel(cov.cwd, file)
  if (!cov.files[key]) {
    const abs = path.resolve(cov.cwd, file)
    let bytes = 0
    try { bytes = fs.statSync(abs).size } catch { /* gone */ }
    cov.files[key] = { path: key, lines: countLines(abs), bytes, ranges: [], readLines: 0, read: false, searched: 0 }
  }
  return cov.files[key]
}

const resultText = r => (typeof r === 'string' ? r : r?.textResultForLlm ?? r?.content ?? (r ? JSON.stringify(r) : ''))

/** Note one finished tool call. Answers the file entries it touched. */
export function recordTool(cov, { toolName, toolArgs, toolResult }) {
  const args = toolArgs && typeof toolArgs === 'object' ? toolArgs : {}
  const text = String(resultText(toolResult) ?? '')
  const touched = []
  if (READ_TOOLS.has(toolName)) {
    const p = args.path ?? args.file_path ?? args.file
    if (typeof p !== 'string') return touched
    const abs = path.resolve(cov.cwd, p)
    let isFile = false
    try { isFile = fs.statSync(abs).isFile() } catch { /* not there */ }
    if (!isFile) return touched
    const f = entry(cov, abs)
    const all = f.lines ?? 0
    const vr = Array.isArray(args.view_range) ? args.view_range.map(Number) : null
    let range
    if (vr && vr.length === 2 && vr[0] >= 1) range = [vr[0], vr[1] < 0 ? Math.max(all, vr[0]) : vr[1]]
    else range = [1, Math.max(1, Math.min(all || 1, text ? text.split('\n').length : all))]
    if (all) range[1] = Math.min(range[1], all)
    f.ranges = mergeRanges([...f.ranges, range])
    f.readLines = all ? covered(f.ranges) : 0
    f.read = true
    touched.push(f)
  } else if (SEARCH_TOOLS.has(toolName)) {
    cov.searches.push({ tool: toolName, pattern: String(args.pattern ?? args.query ?? '').slice(0, 200), path: String(args.path ?? '.'), at: Date.now() })
    if (cov.searches.length > 500) cov.searches.splice(0, cov.searches.length - 500)
    const seen = new Set()
    for (const line of text.split('\n').slice(0, 2000)) {
      const m = /^((?:[A-Za-z]:)?[^:\n]+?)(?::\d+[:-]|$)/.exec(line.trim())
      if (!m || seen.has(m[1])) continue
      seen.add(m[1])
      const abs = path.resolve(cov.cwd, m[1])
      try { if (!fs.statSync(abs).isFile()) continue } catch { continue }
      const f = entry(cov, abs)
      f.searched++
      touched.push(f)
    }
  } else if (SHELL_TOOLS.has(toolName)) {
    cov.shell++
  }
  return touched
}

/** How many files the folder holds (up to `limit`), skipping version control and dependency folders. */
export function countFiles(dir, limit = 20000) {
  let n = 0
  const stack = [dir]
  while (stack.length && n < limit) {
    const d = stack.pop()
    let ents = []
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of ents) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(path.join(d, e.name)) } else if (e.isFile() && ++n >= limit) break
    }
  }
  return { files: n, capped: n >= limit }
}

/** The coverage as a table of files, most read first, with totals. */
export function summary(cov) {
  const files = Object.values(cov.files).map(f => ({ ...f, share: f.lines ? f.readLines / f.lines : f.read ? 1 : 0 }))
  files.sort((a, b) => b.share - a.share || b.searched - a.searched || a.path.localeCompare(b.path))
  const lines = files.reduce((s, f) => s + (f.lines || 0), 0)
  const readLines = files.reduce((s, f) => s + (f.readLines || 0), 0)
  return { files, lines, readLines, read: files.filter(f => f.read).length, searchedOnly: files.filter(f => !f.read && f.searched).length, searches: cov.searches.length, shell: cov.shell, total: cov.total }
}

/** The coverage as the observer reads it (observer-turn.md's COVERAGE). */
export function coverageText(cov, max = 40) {
  const s = summary(cov)
  if (!s.files.length) return 'No file was read or searched yet.'
  const lines = s.files.slice(0, max).map(f => `- ${f.path}: ${f.read ? `read ${f.lines ? `${f.readLines} of ${f.lines} lines` : 'whole'}` : 'not read'}${f.searched ? `, searched ${f.searched}x` : ''}`)
  const more = s.files.length > max ? [`- … ${s.files.length - max} more files`] : []
  const total = s.total ? `The folder holds ${s.total.files}${s.total.capped ? '+' : ''} files. ` : ''
  return `${total}${s.read} files read, ${s.searchedOnly} only searched, ${s.searches} searches, ${s.shell} shell commands.\n${[...lines, ...more].join('\n')}`
}
