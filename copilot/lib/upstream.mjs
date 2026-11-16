// upstream.mjs: where thimble's own plugin (the upstream `plugin/` folder) is, so the port reuses its prompts and pure
// modules by path instead of copying them. Upstream improvements then reach the port with each merge.
//
// The upstream root is the first of these that holds the files in REQUIRED:
//   1. $THIMBLE_UPSTREAM                     an explicit folder (tests, a checkout elsewhere)
//   2. <this plugin>/../plugin               a clone of the repository, or `copilot --plugin-dir <clone>/copilot`
//   3. <thimble home>/upstream/plugin        a sparse, shallow clone of the fork, made on first use and refreshed by
//                                            scripts/update.(ps1|sh). `copilot plugin install owner/repo:copilot` copies
//                                            only the copilot/ folder, so an installed plugin needs this cache.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** This plugin's root: the copilot/ folder. */
export const COPILOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Where the port keeps its settings, session state, logs and the upstream cache. */
export const homeDir = () => process.env.THIMBLE_COPILOT_HOME || path.join(os.homedir(), '.thimble-copilot')

export const DEFAULT_REPO = 'https://github.com/ayushnangia/thimble.git'

/** Files the port reads from upstream. A rename upstream fails `isUpstream`, and the tests name the file. */
export const REQUIRED = [
  'prompts/registry.mjs',
  'prompts/slots.json',
  'settings/features.mjs',
  'core/models.js',
  'core/text.js',
  'marks/message.js',
  'observer/compose.mjs',
  'observer/lenses.mjs',
  'observer/reply.mjs',
  'observer/messages.mjs',
  'squeeze/chips.mjs',
  'panes/coverage-view.mjs',
  'skills/tour/SKILL.md',
  'tour/sample/orders.csv',
]

export const isUpstream = dir => !!dir && REQUIRED.every(f => fs.existsSync(path.join(dir, f)))

/** The folders tried, in order. */
export function candidates() {
  return [process.env.THIMBLE_UPSTREAM, path.join(COPILOT_DIR, '..', 'plugin'), path.join(homeDir(), 'upstream', 'plugin')].filter(Boolean)
}

/** The upstream root found on disk, or null. */
export function findUpstream() {
  for (const c of candidates()) if (isUpstream(c)) return path.resolve(c)
  return null
}

function git(args, opts = {}) {
  const r = spawnSync(process.env.THIMBLE_GIT || 'git', args, { encoding: 'utf8', windowsHide: true, timeout: 180000, ...opts })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.error?.message || '').trim()}`)
  return r.stdout
}

/**
 * Make or refresh the sparse, shallow clone of the fork that holds only plugin/, and answer its plugin folder.
 * Long paths are on, since the repository holds deep fixture paths that a default Windows clone cannot write.
 */
export function fetchUpstream({
  repo = process.env.THIMBLE_UPSTREAM_REPO || DEFAULT_REPO,
  ref = process.env.THIMBLE_UPSTREAM_REF || 'main',
  dir = path.join(homeDir(), 'upstream'),
} = {}) {
  if (fs.existsSync(path.join(dir, '.git'))) {
    git(['-C', dir, 'fetch', '--depth', '1', 'origin', ref])
    git(['-C', dir, 'reset', '--hard', 'FETCH_HEAD'])
  } else {
    fs.mkdirSync(path.dirname(dir), { recursive: true })
    git(['-c', 'core.longpaths=true', 'clone', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', ref, '--config', 'core.longpaths=true', repo, dir])
    git(['-C', dir, 'sparse-checkout', 'set', 'plugin'])
  }
  const root = path.join(dir, 'plugin')
  if (!isUpstream(root)) throw new Error(`${root} does not hold thimble's plugin (missing ${REQUIRED.filter(f => !fs.existsSync(path.join(root, f))).join(', ')})`)
  return root
}

let ROOT = null

/** The upstream root, found or fetched once per process. */
export function upstreamRoot() {
  if (!ROOT) ROOT = findUpstream() ?? fetchUpstream()
  return ROOT
}

export const setUpstreamRoot = r => { ROOT = r ? path.resolve(r) : null }

/** An upstream module, imported by its path from the upstream root (`prompts/registry.mjs`). */
export const importUpstream = rel => import(pathToFileURL(path.join(upstreamRoot(), rel)).href)

/** An upstream file's text. */
export const readUpstream = rel => fs.readFileSync(path.join(upstreamRoot(), rel), 'utf8')

/** The upstream commit the root is at, when it is in a git checkout; '' when unknown. */
export function upstreamCommit() {
  try { return git(['-C', upstreamRoot(), 'rev-parse', '--short', 'HEAD']).trim() } catch { return '' }
}
