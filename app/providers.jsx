'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ProfileContext } from '@/lib/profileContext'
import { can } from '@/lib/permissions'

// Matches the app shell. The old spinner was bg-slate-900, so even a brief
// delay read as a jarring dark flash in front of a light product.
const Spinner = () => (
  <div className="min-h-screen futuristic-bg flex items-center justify-center">
    <div className="w-6 h-6 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
  </div>
)

// ─────────────────────────────────────────────────────────────────────────────
// Why this reads localStorage directly instead of just awaiting getSession():
//
// getSession() is NOT a cheap local read. When the stored access token has
// expired it performs a network refresh first, and browser fetch() has no
// default timeout — a stalled request hangs forever, which is exactly what left
// the app spinning until someone hit refresh. (lib/supabase.js now bounds every
// request, but we still shouldn't make a logged-out visitor wait on the network
// to be told they're logged out.)
//
// The session lives synchronously in localStorage under `sb-<ref>-auth-token`.
// No token means definitively signed out, so we can route to /login on the
// first tick with zero network round-trips.
// ─────────────────────────────────────────────────────────────────────────────
const AUTH_KEY_RE = /^sb-.+-auth-token$/

function authKeys() {
  try {
    return Object.keys(window.localStorage).filter((k) => AUTH_KEY_RE.test(k))
  } catch {
    return []
  }
}

function hasStoredSession() {
  for (const k of authKeys()) {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(k) || 'null')
      if (parsed?.access_token) return true
    } catch {
      // Corrupt entry — treat as no session and let it be cleared below.
    }
  }
  return false
}

function clearStoredSession() {
  for (const k of authKeys()) {
    try { window.localStorage.removeItem(k) } catch {}
  }
}

async function fetchProfile(userId) {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
  return data
}

function isAllowed(profile, pathname) {
  if (profile?.role === 'admin' || profile?.role === 'management') {
    if (pathname === '/admin') return can(profile, 'admin_panel')
    return true
  }
  if (pathname === '/ach'            && !profile?.can_view_ach)       return false
  if (pathname === '/zero-payments'  && !profile?.can_view_ach)       return false
  if (pathname === '/expenditure'    && !profile?.can_view_budgeting) return false
  // startsWith, not equality — '/admin/activity-log' must be gated too
  if (pathname.startsWith('/admin')  && !can(profile, 'admin_panel')) return false
  return true
}

export default function Providers({ children }) {
  const router   = useRouter()
  const pathname = usePathname()
  // 'checking' → still resolving | 'authed' → profile loaded | 'anon' → signed out
  const [status, setStatus]   = useState('checking')
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    let cancelled = false

    // Send a signed-out visitor to the login page. Status stays out of 'authed'
    // so the children never render without a profile.
    function bailToLogin() {
      clearStoredSession()
      setProfile(null)
      setStatus('anon')
      if (pathname !== '/login') router.replace('/login')
    }

    // ── Fast path: no stored token, so no network needed at all. ──────────
    if (!hasStoredSession()) {
      bailToLogin()
      return
    }

    // ── Token present: resolve it, then load the profile. Both calls go
    //    through the timeout-bounded fetch, so neither can hang forever. ──
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (cancelled) return
        if (!session) { bailToLogin(); return }

        const p = await fetchProfile(session.user.id)
        if (cancelled) return

        // Signed in but no profile row — nothing would render correctly.
        if (!p) { bailToLogin(); return }

        setProfile(p)
        setStatus('authed')
        if (!isAllowed(p, pathname)) router.replace('/')
      } catch {
        // Refresh timed out, network died, or the token is no longer valid.
        // Drop it so the login page starts clean rather than retrying a
        // request that will fail the same way.
        if (!cancelled) bailToLogin()
      }
    })()

    return () => { cancelled = true }
  }, [])

  // Sign-in / sign-out / token refresh after the initial load.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION') return

      if (!session) {
        setProfile(null)
        setStatus('anon')
        if (pathname !== '/login') router.replace('/login')
        return
      }

      // A plain token refresh doesn't change permissions; skip the extra query.
      if (event === 'TOKEN_REFRESHED') return

      try {
        const p = await fetchProfile(session.user.id)
        if (!p) {
          setProfile(null)
          setStatus('anon')
          if (pathname !== '/login') router.replace('/login')
          return
        }
        setProfile(p)
        setStatus('authed')
        if (!isAllowed(p, pathname)) router.replace('/')
      } catch {
        // Leave the previous state in place — a transient failure here
        // shouldn't sign a working session out.
      }
    })
    return () => subscription.unsubscribe()
  }, [pathname, router])

  if (pathname === '/login') return children

  // Children are only ever rendered with a real profile. Anything else — still
  // checking, signed out with a redirect in flight, or on a route this user
  // can't see — shows the spinner.
  //
  // This matters: app/page.js returns null when profile is null, so rendering
  // children too early produced a blank page instead of a redirect.
  if (status !== 'authed' || !profile) return <Spinner />
  if (!isAllowed(profile, pathname)) return <Spinner />

  return (
    <ProfileContext.Provider value={profile}>
      {children}
    </ProfileContext.Provider>
  )
}
