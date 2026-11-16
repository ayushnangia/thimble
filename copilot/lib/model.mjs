// model.mjs: the second model thimble asks (the verifier, the observer, simplify, catch-up, explain, a side thread), as
// a separate non-interactive Copilot CLI process. Upstream forks Claude Code's own session for these
// (core/fork.ts, `claude -p --resume <id> --fork-session`); Copilot CLI has no fork of a running session that an
// extension can start, so the child gets the parts of the session it needs as a transcript in its prompt
// (prompts/side.md) and reads the files itself with read-only tools.
//
// The prompt goes on stdin, so its length is free of the command line's limit. The child's environment drops the
// variables that would load this extension in it (THIMBLE_COPILOT_CHILD stops it if it loads anyway), so a child never
// starts children.
import { spawn } from 'node:child_process'

export const READ_TOOLS = ['view', 'grep', 'glob']
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash'
const DROP = /^(COPILOT_(AGENT|EXTENSION|LOADER|PLUGIN|SDK|CLI$)|CLAUDE_PLUGIN|PLUGIN_ROOT$|PLUGIN_DATA$)/

/** The copilot binary a child runs: $THIMBLE_COPILOT_BIN, the CLI that runs this extension, or `copilot` on PATH. */
export const copilotBin = () => process.env.THIMBLE_COPILOT_BIN || process.env.COPILOT_CLI_PATH || 'copilot'

export function childEnv(env = process.env) {
  const out = {}
  for (const [k, v] of Object.entries(env)) if (!DROP.test(k)) out[k] = v
  out.THIMBLE_COPILOT_CHILD = '1'
  return out
}

/** The arguments of a child run. `shell` adds the shell tool (the verifier's computed evidence, when allowed). */
export function childArgs({ model = '', effort = '', shell = false } = {}) {
  const tools = shell ? [...READ_TOOLS, SHELL] : READ_TOOLS
  const args = ['-s', '--no-color', '--stream', 'off', '--no-ask-user', '--no-custom-instructions', '--disable-builtin-mcps', '--available-tools', ...tools, '--allow-tool', ...tools]
  if (model && model !== 'same as session') args.push('--model', model)
  if (effort && effort !== 'same as session') args.push('--reasoning-effort', effort)
  return args
}

export const shellTool = () => SHELL

/**
 * Ask a child Copilot. Answers {ok, text, code, ms, error}; never throws. `signal` stops it.
 * @param {string} prompt
 * @param {{cwd?: string, model?: string, effort?: string, shell?: boolean, timeoutMs?: number, signal?: AbortSignal}} o
 */
export function runCopilot(prompt, { cwd = process.cwd(), model = '', effort = '', shell = false, timeoutMs = 600000, signal } = {}) {
  const t0 = Date.now()
  return new Promise(resolve => {
    let out = ''
    let err = ''
    let done = false
    const finish = r => { if (!done) { done = true; clearTimeout(timer); resolve({ ms: Date.now() - t0, ...r }) } }
    let child
    try {
      child = spawn(copilotBin(), childArgs({ model, effort, shell }), { cwd, env: childEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false })
    } catch (e) {
      return finish({ ok: false, text: '', code: -1, error: String(e?.message || e) })
    }
    const timer = setTimeout(() => { child.kill(); finish({ ok: false, text: out, code: -1, error: `no answer in ${Math.round(timeoutMs / 1000)}s` }) }, timeoutMs)
    timer.unref?.()
    signal?.addEventListener('abort', () => { child.kill(); finish({ ok: false, text: out, code: -1, error: 'stopped' }) }, { once: true })
    child.stdout.setEncoding('utf8').on('data', d => { out += d })
    child.stderr.setEncoding('utf8').on('data', d => { err += d })
    child.on('error', e => finish({ ok: false, text: out, code: -1, error: String(e?.message || e) }))
    child.on('close', code => finish({ ok: code === 0 && !!out.trim(), text: out.trim(), code, error: code === 0 ? (out.trim() ? '' : 'empty answer') : (err.trim().split('\n').slice(-3).join(' ') || `exit ${code}`) }))
    child.stdin.on('error', () => {})
    child.stdin.end(prompt)
  })
}

/** The model runner the features use; tests set a fake. */
let runner = runCopilot
export const ask = (prompt, opts) => runner(prompt, opts)
export const setRunner = fn => { runner = fn || runCopilot }
