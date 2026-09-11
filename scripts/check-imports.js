#!/usr/bin/env node
/**
 * Resolve every relative / @-aliased import using ONLY git-tracked files —
 * i.e. exactly what Vercel's checkout will contain.
 *
 * A new file that works locally but was never `git add`ed breaks the deploy and
 * nothing else catches it. That has happened here before.
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const tracked = new Set(
  execSync('git ls-files', { encoding: 'utf8' })
    .trim().split('\n').map((p) => p.split(path.sep).join('/'))
)

const exts = ['', '.js', '.jsx', '/index.js', '/index.jsx']
const sources = [...tracked].filter((p) => /\.(js|jsx)$/.test(p) && !p.startsWith('.claude/'))

let broken = 0
for (const f of sources) {
  if (!fs.existsSync(f)) continue
  const src = fs.readFileSync(f, 'utf8')
  for (const m of src.matchAll(/from\s+'((?:@\/|\.\/|\.\.\/)[^']+)'/g)) {
    const spec = m[1]
    const base = spec.startsWith('@/')
      ? spec.slice(2)
      : path.posix.join(path.posix.dirname(f), spec)
    if (!exts.some((x) => tracked.has(base + x))) {
      broken++
      console.error(`WOULD FAIL: ${spec}\n     <- ${f}`)
    }
  }
}

console.log(broken
  ? `\n✗ ${broken} import(s) would break the Vercel build (likely untracked files)`
  : '✓ all tracked imports resolve')
process.exit(broken ? 1 : 0)
