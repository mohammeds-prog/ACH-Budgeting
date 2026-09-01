#!/usr/bin/env node
/**
 * Guards against the silent 1000-row truncation bug.
 *
 * PostgREST caps every response at 1000 rows and gives NO error when it does.
 * A bare `.select()` on a growing table therefore starts losing data quietly:
 * this shipped once already and hid 89 ACH entries (~$33k) from every total.
 *
 * Any read that could return many rows must be paginated with fetchAllRows(),
 * or explicitly bounded with .limit()/.range()/.single()/.maybeSingle(), or
 * narrowed with .eq() to a single record.
 *
 * Run: node scripts/check-unbounded-selects.js
 * Exits non-zero if an unguarded query is found.
 */
const { execSync } = require('child_process')
const fs = require('fs')

const GUARDS = ['.single()', '.maybeSingle()', '.limit(', '.range(', '.eq(',
                '.insert(', '.update(', '.delete(', '.upsert(']

const files = execSync('git ls-files "*.js" "*.jsx"', { encoding: 'utf8' })
  .trim().split('\n')
  .filter((f) => f && !f.startsWith('.claude/') && !f.startsWith('scripts/'))

const offenders = []

for (const file of files) {
  let src
  try { src = fs.readFileSync(file, 'utf8') } catch { continue }
  if (!src.includes('.select(')) continue

  for (const m of src.matchAll(/\.from\([^)]*\)/g)) {
    // Look at the query chain only — stop at the end of the statement.
    let seg = src.slice(m.index, m.index + 600)
    const stop = seg.slice(10).search(/\n\s*(if|const|let|return|\}|export)/)
    if (stop !== -1) seg = seg.slice(0, stop + 10)
    if (!seg.includes('.select(')) continue

    // Paginated? fetchAllRows wraps the builder just above the .from(.
    const before = src.slice(Math.max(0, m.index - 300), m.index)
    if (before.includes('fetchAllRows')) continue
    if (GUARDS.some((g) => seg.includes(g))) continue

    offenders.push({
      file,
      line: src.slice(0, m.index).split('\n').length,
      snippet: seg.split('\n')[0].trim().slice(0, 80),
    })
  }
}

if (offenders.length === 0) {
  console.log('✓ no unbounded supabase selects — all reads are paginated or bounded')
  process.exit(0)
}

console.error(`✗ ${offenders.length} unbounded supabase select(s) — these will silently\n`
            + `  truncate at 1000 rows. Wrap with fetchAllRows() (see lib/fetchAll.js)\n`)
for (const o of offenders) console.error(`   ${o.file}:${o.line}\n     ${o.snippet}`)
process.exit(1)
