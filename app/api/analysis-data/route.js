import { NextResponse } from 'next/server'
import { refuseUnlessOwner } from '@/lib/serverAuth'
import { reportNames, readReport } from '@/lib/reportsCache'
import { storedReports, saveReport, forgetStored, KINDS } from '@/lib/analysisStore'

// ─────────────────────────────────────────────────────────────────────────────
// /api/analysis-data — the report data kept in the database for Analysis.
//
//   GET                  what's stored (per report: uploaded when, report
//                        date, file name), and whether this server has a
//                        /reports folder to sync from. ?refresh=1 re-reads.
//   POST {action:'sync'} save every report in the /reports folder to the
//                        database (totals only). Only where the folder exists
//                        — i.e. the computer the exports are saved to.
//
// Daily uploads from a browser go straight to the database instead (the
// "Update data" window reads the files in the browser and saves the totals).
// Admin and management only.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request) {
  try {
    const refused = await refuseUnlessOwner(request)
    if (refused) return refused
    if (new URL(request.url).searchParams.get('refresh')) forgetStored()
    const stored = await storedReports()
    const names = await reportNames()
    return NextResponse.json({
      reports: KINDS.map((kind) => ({ kind, uploadedAt: stored[kind]?.uploadedAt || null, asOf: stored[kind]?.asOf || null, fileName: stored[kind]?.fileName || null })),
      folder: names ? names : null,
    })
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const refused = await refuseUnlessOwner(request)
    if (refused) return refused
    const body = await request.json().catch(() => ({}))
    if (body.action !== 'sync') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    const names = await reportNames()
    if (!names) return NextResponse.json({ error: 'There is no reports folder on this server — upload the files instead.' }, { status: 400 })
    const results = []
    for (const n of names) {
      const r = await readReport(n)
      if (!r.parsed?.kind) { results.push({ file: n, error: r.error || 'not a recognised report' }); continue }
      try {
        await saveReport(r.parsed.kind, r.parsed, n)
        results.push({ file: n, kind: r.parsed.kind, saved: true })
      } catch (e) {
        results.push({ file: n, kind: r.parsed.kind, error: e.message })
      }
    }
    forgetStored()
    return NextResponse.json({ results })
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 })
  }
}
