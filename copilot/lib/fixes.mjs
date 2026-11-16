// fixes.mjs: /thimble-fix in the Copilot port. Upstream (fix/*.ts) forks Claude in the background into a scratch
// copy of thimble's repository, and the analyst keeps or drops the fix with a key, then `thimble file pr N` sends it.
// Copilot has no fork of the session an extension can start, so the main agent does the fix itself, in a copy this
// module makes: <thimble home>/fixes/<N>, a clone of the fork on its own branch `fix-<N>`. The analyst tries it with
// `copilot --plugin-dir <copy>/copilot`, and a PR goes to the fork only when they say so.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { ownText, upstreamText } from './prompts.mjs'
import { DEFAULT_REPO, homeDir } from './upstream.mjs'

export const fixesDir = () => path.join(homeDir(), 'fixes')
const listFile = () => path.join(fixesDir(), 'fixes.json')

export function listFixes() {
  try { const v = JSON.parse(fs.readFileSync(listFile(), 'utf8')); return Array.isArray(v) ? v : [] } catch { return [] }
}
function saveFixes(list) {
  fs.mkdirSync(fixesDir(), { recursive: true })
  fs.writeFileSync(listFile(), JSON.stringify(list, null, 1))
}

function git(args, cwd) {
  const r = spawnSync(process.env.THIMBLE_GIT || 'git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 600000 })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${(r.stderr || r.error?.message || '').trim()}`)
  return r.stdout.trim()
}

/**
 * Start fix `which` ('new' or a number) from the analyst's words: make or reuse its copy, and answer what the agent
 * does next. `clone` is injectable for tests.
 */
export async function startFix(words, which = 'new', { repo = process.env.THIMBLE_UPSTREAM_REPO || DEFAULT_REPO, clone = defaultClone } = {}) {
  const said = String(words || '').trim()
  if (!said) throw new Error('say what should work differently: /thimble-fix <what should work differently>')
  const list = listFixes()
  let fix
  if (String(which) === 'new' || !which) {
    const n = list.reduce((m, f) => Math.max(m, f.n), 0) + 1
    const dir = path.join(fixesDir(), String(n))
    clone(repo, dir, `fix-${n}`)
    fix = { n, dir, branch: `fix-${n}`, words: [said], title: '', at: new Date().toISOString() }
    list.push(fix)
  } else {
    fix = list.find(f => String(f.n) === String(which))
    if (!fix) throw new Error(`no fix ${which}; the fixes are ${list.map(f => f.n).join(', ') || 'none yet'}`)
    fix.words.push(said)
  }
  saveFixes(list)
  const fixer = await upstreamText('fixer')
  return ownText('fix', { N: fix.n, DIR: fix.dir, BRANCH: fix.branch, WORDS: fix.words.map(w => `- ${w}`).join('\n'), REPO: repo }) + '\n\n' + fixer
}

function defaultClone(repo, dir, branch) {
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  git(['-c', 'core.longpaths=true', 'clone', '--depth', '50', '--config', 'core.longpaths=true', repo, dir])
  git(['checkout', '-b', branch], dir)
}

/** A fix's title, once the agent has one (the fixer's `Title:` line). */
export function nameFix(n, title) {
  const list = listFixes()
  const f = list.find(x => String(x.n) === String(n))
  if (!f) throw new Error(`no fix ${n}`)
  f.title = String(title || '').slice(0, 80)
  saveFixes(list)
  return f
}
