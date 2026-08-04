'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useProfile } from '@/lib/profileContext'

const PAGE_LABELS = {
  '/ach': 'ACH Documents',
  '/zero-payments': 'Zero Payments',
  '/expenditure': 'Supply Budget',
  '/admin': 'User Management',
  '/admin/activity-log': 'Activity Log',
}

export default function AppHeader() {
  const path    = usePathname()
  const router  = useRouter()
  const profile = useProfile()
  const pageLabel = PAGE_LABELS[path] ?? ''

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-violet-200/60" style={{boxShadow: '0 1px 0 rgba(139,92,246,0.10), 0 4px 16px -4px rgba(99,102,241,0.08)'}}>
      <div className="max-w-screen-xl mx-auto px-6 h-14 flex items-center gap-2">
        <Link
          href="/"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-slate-500 hover:text-slate-900 hover:bg-violet-100/60 transition-all"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline strokeLinecap="round" strokeLinejoin="round" points="9 22 9 12 15 12 15 22"/>
          </svg>
          Home
        </Link>

        {pageLabel && (
          <>
            <svg className="w-3.5 h-3.5 text-slate-300 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6"/>
            </svg>
            <span className="text-sm font-semibold text-slate-900">{pageLabel}</span>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {profile?.role === 'admin' && path !== '/admin/activity-log' && (
            <Link
              href="/admin"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-all ${path === '/admin' ? 'text-slate-900 bg-violet-100/60' : 'text-slate-500 hover:text-slate-900 hover:bg-violet-100/60'}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"/></svg>
              Admin
            </Link>
          )}
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-slate-500 hover:text-red-400 hover:bg-red-500/[0.06] transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75"/>
            </svg>
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}
