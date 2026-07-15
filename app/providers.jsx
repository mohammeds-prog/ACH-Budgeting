'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ProfileContext } from '@/lib/profileContext'
import { can } from '@/lib/permissions'

const Spinner = () => (
  <div className="min-h-screen bg-slate-900 flex items-center justify-center">
    <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin" />
  </div>
)

async function fetchProfile(userId) {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
  return data
}

function isAllowed(profile, pathname) {
  if (profile?.role === 'admin' || profile?.role === 'management') {
    if (pathname === '/admin') return can(profile, 'admin_panel')
    return true
  }
  if (pathname === '/ach'         && !profile?.can_view_ach)       return false
  if (pathname === '/expenditure' && !profile?.can_view_budgeting) return false
  if (pathname === '/admin'       && !can(profile, 'admin_panel')) return false
  return true
}

export default function Providers({ children }) {
  const router   = useRouter()
  const pathname = usePathname()
  const [ready, setReady]     = useState(false)
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    let mounted = true
    let timedOut = false

    // Safety net: getSession() hangs when a stale token triggers a network refresh that
    // stalls. router.replace() is client-side — it doesn't kill the pending request or
    // release the Web Lock it holds, so signInWithPassword() would also hang.
    // window.location.href does a full page navigation: kills all pending JS, releases
    // the lock, and starts the login page completely clean.
    const safetyTimer = setTimeout(() => {
      timedOut = true
      try {
        Object.keys(localStorage)
          .filter(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
          .forEach(k => localStorage.removeItem(k))
      } catch {}
      if (pathname !== '/login') window.location.href = '/login'
    }, 5000)

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (timedOut) return
      if (!session) {
        clearTimeout(safetyTimer)
        if (mounted) setProfile(null)
        setReady(true)
        if (mounted && pathname !== '/login') router.replace('/login')
        return
      }
      try {
        const p = await fetchProfile(session.user.id)
        if (timedOut) return
        clearTimeout(safetyTimer)
        if (mounted) setProfile(p)
        setReady(true)
        if (mounted && !isAllowed(p, pathname)) router.replace('/')
      } catch {
        if (timedOut) return
        clearTimeout(safetyTimer)
        setReady(true)
        if (mounted && pathname !== '/login') router.replace('/login')
      }
    }).catch(() => {
      if (timedOut) return
      clearTimeout(safetyTimer)
      setReady(true)
      if (mounted && pathname !== '/login') router.replace('/login')
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (_event === 'INITIAL_SESSION') return
      if (!session) {
        if (mounted) setProfile(null)
        if (mounted) setReady(true)
        if (mounted && pathname !== '/login') router.replace('/login')
        return
      }
      const p = await fetchProfile(session.user.id)
      if (mounted) setProfile(p)
      if (mounted) setReady(true)
      if (mounted && !isAllowed(p, pathname)) router.replace('/')
    })

    return () => {
      mounted = false
      clearTimeout(safetyTimer)
      subscription.unsubscribe()
    }
  }, [])

  if (pathname === '/login') return children
  if (!ready) return <Spinner />

  // Hold spinner while redirect is in flight for protected routes
  if (profile && !isAllowed(profile, pathname)) return <Spinner />

  return (
    <ProfileContext.Provider value={profile}>
      {children}
    </ProfileContext.Provider>
  )
}
