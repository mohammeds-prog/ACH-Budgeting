import { NextResponse } from 'next/server'
import { refuseUnlessOwner } from '@/lib/serverAuth'
import { loadReports } from '@/lib/analysisTools'
import { buildSummary } from '@/lib/ownerSummary'

// GET /api/summary?from=YYYY-MM&to=YYYY-MM — the owner summary (default:
// the last complete month). Totals only.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request) {
  try {
    const refused = await refuseUnlessOwner(request)
    if (refused) return refused
    const q = new URL(request.url).searchParams
    return NextResponse.json(await buildSummary(await loadReports(), { from: q.get('from'), to: q.get('to') }))
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 })
  }
}
