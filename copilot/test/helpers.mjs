// helpers.mjs: what every test shares. Each test file gets a thimble home of its own in the OS temp folder, set before
// any port module runs, so no test reads or writes ~/.thimble-copilot.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const COPILOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'thimble-copilot-test-'))
process.env.THIMBLE_COPILOT_HOME = HOME
delete process.env.THIMBLE_COPILOT_CHILD
process.on('exit', () => { try { fs.rmSync(HOME, { recursive: true, force: true }) } catch { /* the OS cleans temp */ } })

/** A folder of its own for one test, with these files ({name: text}). */
export function folder(files = {}) {
  const dir = fs.mkdtempSync(path.join(HOME, 'w-'))
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), text)
  }
  return dir
}

/** A fake of the SDK's session and joinSession, which keeps what the extension declared. */
export function fakeSdk() {
  const seen = { config: null, canvases: [], logs: [], handlers: [] }
  const session = {
    sessionId: 'test-session',
    log: async (msg, opts) => { seen.logs.push({ msg, opts }) },
    on: (a, b) => { seen.handlers.push(typeof a === 'function' ? ['*', a] : [a, b]); return () => {} },
    send: async () => 'msg',
  }
  return {
    seen,
    session,
    joinSession: async config => { seen.config = config; return session },
    createCanvas: def => { seen.canvases.push(def); return def },
  }
}
