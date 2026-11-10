import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// ─────────────────────────────────────────────────────────────────────────────
// Server-side caller check for API routes that return owner-level numbers
// (/api/reports, /api/marketing). Same approach as app/api/admin/users: verify
// the bearer token with Supabase Auth, then read the caller's role with the
// service key.
// ─────────────────────────────────────────────────────────────────────────────

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  // Next.js caches server fetches unless told not to; never reuse a stored reply.
  { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: (url, init) => fetch(url, { ...init, cache: 'no-store' }) } }
)

// { profile } or { reason }, so a refusal can say which step failed.
export async function getCaller(request) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '').trim()
  if (!token) return { reason: 'no sign-in token was sent' }
  // auth.getUser(jwt) silently fails when persistSession:false — call the REST API directly
  const authRes = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, { cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
  })
  if (!authRes.ok) return { reason: `sign-in token rejected (${authRes.status})` }
  const { id: userId } = await authRes.json()
  if (!userId) return { reason: 'sign-in token has no user' }
  const { data, error } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).single()
  if (!data) return { reason: `profile lookup failed${error?.message ? ': ' + error.message : ''}` }
  return { profile: data }
}

// Returns a refusal response for anyone but admin/management, or null to proceed.
export async function refuseUnlessOwner(request) {
  const { profile, reason } = await getCaller(request)
  if (!profile) return NextResponse.json({ error: `Unauthorized — ${reason}` }, { status: 401 })
  if (profile.role !== 'admin' && profile.role !== 'management') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}
