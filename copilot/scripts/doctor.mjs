#!/usr/bin/env node
// doctor.mjs: checks that thimble for Copilot CLI can run, and says what to do when it cannot. doctor.ps1 and
// doctor.sh run it. Read-only: it changes nothing, except that it fetches the upstream cache when it is missing and
// --fetch is given.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const lib = rel => import(new URL(`../lib/${rel}`, import.meta.url).href)
let bad = 0
const ok = (name, detail = '') => process.stdout.write(`ok    ${name}${detail ? `: ${detail}` : ''}\n`)
const fail = (name, detail, fix) => { bad++; process.stdout.write(`FAIL  ${name}: ${detail}${fix ? `\n      fix: ${fix}` : ''}\n`) }
const warn = (name, detail) => process.stdout.write(`warn  ${name}: ${detail}\n`)
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 60000, shell: process.platform === 'win32' })

const major = Number(process.versions.node.split('.')[0])
if (major >= 20) ok('node', process.versions.node)
else fail('node', `${process.versions.node} (tests and scripts need 20+)`, 'install Node 22')

const cp = run(process.env.COPILOT_CLI_PATH || 'copilot', ['--version'])
if (cp.status === 0) ok('copilot', cp.stdout.trim().split('\n')[0])
else fail('copilot', 'not found on PATH', 'install GitHub Copilot CLI: https://docs.github.com/copilot/how-tos/set-up/install-copilot-cli')

const list = run(process.env.COPILOT_CLI_PATH || 'copilot', ['plugin', 'list', '--json'])
try {
  const p = JSON.parse(list.stdout).find(x => x.name === 'thimble')
  if (p) ok('plugin', `thimble ${p.version}${p.enabled === false ? ' (disabled: copilot plugin enable thimble)' : ''}`)
  else warn('plugin', 'not installed in this profile (fine with --plugin-dir); install: copilot plugin install ayushnangia/thimble:copilot')
} catch { warn('plugin', 'could not read `copilot plugin list --json`') }

try {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'))
  ok('manifest', `${json.name} ${json.version}`)
} catch (e) { fail('manifest', String(e.message)) }
if (fs.existsSync(path.join(ROOT, 'com.github.copilot', 'extensions', 'thimble', 'extension.mjs'))) ok('extension', 'com.github.copilot/extensions/thimble/extension.mjs')
else fail('extension', 'extension.mjs is missing', 'reinstall the plugin')

const up = await lib('upstream.mjs')
let root = up.findUpstream()
if (!root && process.argv.includes('--fetch')) {
  try { root = up.fetchUpstream() } catch (e) { fail('upstream', e.message, 'check git and the network') }
}
if (root) {
  ok('upstream', `${root}${up.upstreamCommit() ? ` @ ${up.upstreamCommit()}` : ''}`)
  try {
    const { USED, upstreamText } = await lib('prompts.mjs')
    for (const n of USED) await upstreamText(n)
    ok('prompts', `${USED.length} upstream prompts compose`)
  } catch (e) { fail('prompts', e.message, 'update the plugin (scripts/update) or see PORT_MAP.md') }
} else {
  fail('upstream', `thimble's upstream plugin/ folder is not on disk (looked in ${up.candidates().join(', ')})`, 'run this doctor with --fetch, or scripts/update')
}

const home = up.homeDir()
ok('home', home)
try {
  const s = await lib('settings.mjs')
  if (root) ok('settings', JSON.stringify(await s.currentValues()))
} catch (e) { fail('settings', e.message, `delete ${path.join(home, 'settings.json')} to reset them`) }

if (root) {
  try {
    const { createServer } = await lib('server.mjs')
    const { Store } = await lib('store.mjs')
    const srv = createServer({ store: new Store({ sessionId: 'doctor', persist: false }), onAction: async () => ({}), onSettings: async () => ({}), getSettings: async () => ({}) })
    const url = new URL(await srv.listen())
    const page = await fetch(url)
    const bare = await fetch(`${url.origin}/`)
    await srv.close()
    if (page.status === 200 && bare.status === 403) ok('workbench', `serves on 127.0.0.1 with a token (403 without it)`)
    else fail('workbench', `with token ${page.status}, without ${bare.status}`, 'reinstall the plugin')
  } catch (e) { fail('workbench', e.message, 'check that 127.0.0.1 accepts local connections') }
}

if (!process.argv.includes('--quiet')) {
  process.stdout.write('\nCanvases and extensions need experimental mode: start copilot with --experimental (or /experimental on).\n')
}
process.stdout.write(bad ? `\n${bad} problem${bad === 1 ? '' : 's'}.\n` : '\nAll good.\n')
process.exit(bad ? 1 : 0)
