// Coverage: lines read by view, files a grep names, shell commands, from the tool events.
import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'

import { folder } from './helpers.mjs'
import { coverageText, mergeRanges, newCoverage, recordTool, summary } from '../lib/coverage.mjs'

const lines = n => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n'

test('ranges merge', () => {
  assert.deepEqual(mergeRanges([[5, 8], [1, 3], [4, 4], [10, 12]]), [[1, 8], [10, 12]])
})

test('view ranges add up per file, and a whole view reads the file', () => {
  const dir = folder({ 'a.txt': lines(10), 'b.txt': lines(4) })
  const cov = newCoverage(dir)
  recordTool(cov, { toolName: 'view', toolArgs: { path: path.join(dir, 'a.txt'), view_range: [1, 3] }, toolResult: '' })
  recordTool(cov, { toolName: 'view', toolArgs: { path: 'a.txt', view_range: [3, 5] }, toolResult: '' })
  let a = cov.files['a.txt']
  assert.equal(a.lines, 10)
  assert.equal(a.readLines, 5)
  recordTool(cov, { toolName: 'view', toolArgs: { path: 'a.txt', view_range: [9, -1] }, toolResult: '' })
  a = cov.files['a.txt']
  assert.equal(a.readLines, 7)
  recordTool(cov, { toolName: 'view', toolArgs: { path: 'b.txt' }, toolResult: { textResultForLlm: lines(4) } })
  assert.equal(cov.files['b.txt'].readLines, 4)
  const s = summary(cov)
  assert.equal(s.read, 2)
  assert.equal(s.lines, 14)
  assert.equal(s.readLines, 11)
})

test('a grep counts the files it names as searched, and shell commands are counted', () => {
  const dir = folder({ 'x.csv': lines(3), 'y.csv': lines(3) })
  const cov = newCoverage(dir)
  recordTool(cov, { toolName: 'grep', toolArgs: { pattern: 'line 2' }, toolResult: `${path.join(dir, 'x.csv')}:2:line 2\ny.csv:2:line 2\nmissing.csv:1:z` })
  recordTool(cov, { toolName: 'powershell', toolArgs: { command: 'Get-Content x.csv' }, toolResult: '' })
  recordTool(cov, { toolName: 'view', toolArgs: { path: 'nope.txt' }, toolResult: '' })
  const s = summary(cov)
  assert.equal(s.searchedOnly, 2)
  assert.equal(s.read, 0)
  assert.equal(s.searches, 1)
  assert.equal(s.shell, 1)
  assert.match(coverageText(cov), /2 only searched, 1 searches, 1 shell commands/)
})
