import { NextResponse } from 'next/server'
import { refuseUnlessOwner } from '@/lib/serverAuth'
import { doctorHoursSheet } from '@/lib/doctorHoursSheet'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/doctor-hours[?refresh=1] — doctors' hours by month from the Doctor
// Hours Google Sheet (doctor, office, hours, days). No patient data.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const refused = await refuseUnlessOwner(request)
    if (refused) return refused
    const refresh = new URL(request.url).searchParams.get('refresh') === '1'
    const r = await doctorHoursSheet({ refresh })
    if (!r) return NextResponse.json({ error: 'Google Sheets isn’t set up (GOOGLE_SHEETS_CLIENT_ID / _SECRET / _REFRESH_TOKEN).' }, { status: 503 })
    if (r.error) return NextResponse.json({ error: r.error }, { status: 502 })
    return NextResponse.json(r)
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 })
  }
}
