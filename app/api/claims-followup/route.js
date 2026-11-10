import { NextResponse } from 'next/server'
import { refuseUnlessOwner } from '@/lib/serverAuth'
import { rcmMissing, rcmClaimsByCarrier } from '@/lib/rcmClaims'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/claims-followup — claims follow-up from the RCM app, by insurer:
// claims worked, closed, follow-ups, and AI-classified denial reasons. Joined
// to the aging report's open claims on the money page. Counts only.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const refused = await refuseUnlessOwner(request)
    if (refused) return refused
    const missing = rcmMissing()
    if (missing.length) return NextResponse.json({ status: 'not-connected', missing })
    return NextResponse.json({ status: 'ready', ...(await rcmClaimsByCarrier()) })
  } catch (e) {
    return NextResponse.json({ status: 'error', error: e?.message || 'Server error' }, { status: 502 })
  }
}
