// index.js: lets `node --test copilot/test` (a folder, which Node's test runner resolves to this file) run every
// *.test.mjs here in one process. `node --test copilot/test/*.test.mjs` runs them one process each.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.test.mjs')).sort()) await import(pathToFileURL(path.join(dir, f)).href)
