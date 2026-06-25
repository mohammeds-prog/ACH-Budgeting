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

    // Explicitly fetch the current session — onAuthStateChange alone
    // can miss the INITIAL_SESSION event on first dev-server load
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return
      if (!session) {
        setProfile(null)
        setReady(true)
        if (pathname !== '/login') router.replace('/login')
        return
      }
      const p = await fetchProfile(session.user.id)
      if (!mounted) return
      setProfile(p)
      setReady(true)
      if (!isAllowed(p, pathname)) router.replace('/')
    })

    // Handle future sign-in / sign-out events (skip INITIAL_SESSION,
    // already handled by getSession above)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (_event === 'INITIAL_SESSION') return
      if (!session) {
        setProfile(null)
        setReady(true)
        if (pathname !== '/login') router.replace('/login')
        return
      }
      const p = await fetchProfile(session.user.id)
      setProfile(p)
      setReady(true)
      if (!isAllowed(p, pathname)) router.replace('/')
    })

    return () => {
      mounted = false
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
