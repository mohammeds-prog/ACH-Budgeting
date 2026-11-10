import { reportNames, readReport } from '@/lib/reportsCache'
import { storedReports } from '@/lib/analysisStore'
import { newPatientsSheet } from '@/lib/newPatientsSheet'

// ─────────────────────────────────────────────────────────────────────────────
// Server only. Where every Analysis page, the Summary and the chat get their
// report data — one place, so they always agree:
//
//   1. the database (latest upload of each report) — what the live site uses
//   2. the /reports folder, for any report not in the database yet — only
//      exists on the computer the exports are saved to
//   3. the New Patients Google Sheet, read live, which wins over both
//
// Returns [{ name, parsed, source }] — totals only.
// ─────────────────────────────────────────────────────────────────────────────

const LABEL = {
  production: 'Production', collections: 'Collections', aging: 'Aging', schedule: 'Schedule',
  adjustments: 'Adjustment summary', adSpend: 'Ad spend', newPatients: 'New patients',
}

/**
 * opts.kinds: only these report kinds (e.g. ['production','schedule']);
 * opts.skipKinds: leave these out. The folder's schedule file (90 MB) is
 * only read when the schedule is wanted and the database has none.
 */
export async function loadReportFiles(opts = {}) {
  const want = (k) => (!opts.kinds || opts.kinds.includes(k)) && !(opts.skipKinds || []).includes(k)
  const out = new Map()   // kind → file

  const stored = await storedReports()
  for (const [kind, v] of Object.entries(stored)) {
    if (want(kind) && v?.parsed) out.set(kind, { name: `${LABEL[kind] || kind} (database, uploaded ${String(v.uploadedAt).slice(0, 10)})`, parsed: v.parsed, source: 'database' })
  }

  const names = (await reportNames()) || []
  for (const n of names) {
    const guess = /schedule/i.test(n) ? 'schedule' : /aging/i.test(n) ? 'aging' : /collection/i.test(n) ? 'collections'
      : /adjust/i.test(n) ? 'adjustments' : /ad-?spend/i.test(n) ? 'adSpend' : /new-?patient/i.test(n) ? 'newPatients' : /production/i.test(n) ? 'production' : null
    if (guess && (out.has(guess) || !want(guess))) continue
    const r = await readReport(n)
    const kind = r.parsed?.kind
    if (kind && (out.has(kind) || !want(kind))) continue
    out.set(kind || n, { ...r, source: 'folder' })
  }

  if (want('newPatients')) {
    const sheet = await newPatientsSheet()
    if (sheet?.parsed) out.set('newPatients', { ...sheet, source: 'sheet' })
    else if (sheet?.error && !out.has('newPatients')) out.set('newPatients', sheet)
  }
  return [...out.values()]
}

/** { kind: parsed } — for the chat and the Summary. */
export async function loadReportsByKind(opts) {
  const files = await loadReportFiles(opts)
  const byKind = {}
  for (const f of files) if (f.parsed?.kind) byKind[f.parsed.kind] = f.source === 'sheet' ? { ...f.parsed, source: 'Google Sheet (live)' } : f.parsed
  // A spread copy drops the schedule's hidden index; put it back.
  for (const f of files) if (f.parsed?.kind === 'schedule' && f.parsed.index && byKind.schedule !== f.parsed) {
    Object.defineProperty(byKind.schedule, 'index', { value: f.parsed.index, enumerable: false })
  }
  return byKind
}
