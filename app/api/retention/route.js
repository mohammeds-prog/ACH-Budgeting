import { NextResponse } from 'next/server'
import { refuseUnlessOwner } from '@/lib/serverAuth'
import { loadReportsByKind } from '@/lib/analysisData'
import { scheduleRange } from '@/lib/dentrixReports'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/retention?from=YYYY-MM-DD&to=YYYY-MM-DD — patient retention for a
// custom date range, worked out from the schedule report in /reports. Each
// patient counts once however many visits they had in the range, which is why
// this can't be added up from the monthly totals. Only counts are returned.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request) {
  try {
    const refused = await refuseUnlessOwner(request)
    if (refused) return refused

    const url = new URL(request.url)
    const from = url.searchParams.get('from'), to = url.searchParams.get('to')
    if (!ISO.test(from || '') || !ISO.test(to || '') || from > to) {
      return NextResponse.json({ error: 'Give a from and to date (YYYY-MM-DD), from on or before to.' }, { status: 400 })
    }

    const { schedule } = await loadReportsByKind({ kinds: ['schedule'] })
    if (!schedule) return NextResponse.json({ error: 'No schedule report uploaded yet.' }, { status: 404 })
    const index = schedule.index
    if (!index) return NextResponse.json({ error: 'The schedule\u2019s visit index is missing \u2014 upload the schedule report again.' }, { status: 500 })

    return NextResponse.json(scheduleRange(index, from, to))
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 })
  }
}
