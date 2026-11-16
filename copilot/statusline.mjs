#!/usr/bin/env node
// statusline.mjs: thimble's bar for Copilot CLI's footer. Copilot runs the `statusLine.command` setting with the
// session's status as JSON on stdin (session_id, cwd, model…); this prints one line from the counts thimble saved for
// that session (<thimble home>/sessions/<id>.counts.json), or for the newest session. Opt in (README.md):
//   "statusLine": { "command": "node <plugin dir>/statusline.mjs" }
// It reads files only, and prints nothing when thimble has no state yet.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const home = process.env.THIMBLE_COPILOT_HOME || path.join(os.homedir(), '.thimble-copilot')
const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }

/** The bar's line from a session's counts. */
export function barLine(bar) {
  const c = bar?.counts
  if (!c) return ''
  const parts = ['thimble']
  if (c.cards) parts.push(`v ${c.cards} card${c.cards === 1 ? '' : 's'}`)
  if (c.citations) parts.push(`c ${c.verified}✓ ${c.corrected}~ ${c.wrong}✗${c.checking ? ` ${c.checking}…` : ''}${c.unconfirmed ? ` ${c.unconfirmed}?` : ''}`)
  const notes = (c.explainers || 0) + (c.headsups || 0)
  if (notes) parts.push(`e ${notes} note${notes === 1 ? '' : 's'}`)
  if (c.threads) parts.push(`t ${c.threads} thread${c.threads === 1 ? '' : 's'}`)
  if (c.claims) parts.push(`${c.claims} claim${c.claims === 1 ? '' : 's'}`)
  if (c.labels) parts.push(`l ${c.labels} label${c.labels === 1 ? '' : 's'}`)
  if (c.filesRead) parts.push(`r ${c.filesRead} file${c.filesRead === 1 ? '' : 's'} read${c.coverage ? ` ${Math.round(c.coverage * 100)}%` : ''}`)
  parts.push('/thimble-open')
  return parts.join(' · ')
}

async function stdin() {
  if (process.stdin.isTTY) return {}
  let s = ''
  for await (const chunk of process.stdin) s += chunk
  try { return JSON.parse(s) } catch { return {} }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = await stdin()
  const id = String(input.session_id || '').replace(/[^A-Za-z0-9_.-]/g, '_')
  const bar = (id && read(path.join(home, 'sessions', `${id}.counts.json`))) || (!id && read(path.join(home, 'current.json')))
  const line = barLine(bar)
  if (line) process.stdout.write(`${line}\n`)
}
