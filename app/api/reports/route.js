import { NextResponse } from 'next/server'
import { refuseUnlessOwner } from '@/lib/serverAuth'
import { loadReportFiles } from '@/lib/analysisData'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports — the report totals for the Analysis pages: from the
// database (the latest upload of each), falling back to the /reports folder
// on the computer the exports are saved to. Only totals are returned.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request) {
  try {
    return await handle(request)
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 })
  }
}

async function handle(request) {
  // Provider pay-level numbers: owners and management only.
  const refused = await refuseUnlessOwner(request)
  if (refused) return refused

  // ?only=production,schedule picks report kinds (by the words in their
  // names, as before); ?skip=schedule leaves the schedule out.
  const url = new URL(request.url)
  const only = url.searchParams.get('only'), skip = url.searchParams.get('skip')
  const KIND_WORDS = { production: 'production', collections: 'collections', aging: 'aging', schedule: 'schedule',
    adjustments: 'adjustment', adSpend: 'ad-spend', newPatients: 'new-patients' }
  const kinds = only ? Object.keys(KIND_WORDS).filter((k) => only.toLowerCase().split(',').some((w) => KIND_WORDS[k].includes(w) || w.includes(KIND_WORDS[k]))) : null
  const skipKinds = skip ? Object.keys(KIND_WORDS).filter((k) => skip.toLowerCase().split(',').some((w) => KIND_WORDS[k].includes(w))) : []
  const files = await loadReportFiles({ kinds, skipKinds })
  if (!files.length) return NextResponse.json({ files: [], noFolder: true })
  return NextResponse.json({ files })
}

