'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import TuskLogo from '@/components/TuskLogo'
import { supabase } from '@/lib/supabase'
import { useProfile } from '@/lib/profileContext'

const ALL_SECTIONS = [
  {
    key: 'ach',
    href: '/ach',
    title: 'ACH',
    description: 'Track and filter ACH transactions by date, type, location, match status, and more.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2"/>
        <path d="M2 10h20"/>
      </svg>
    ),
    accent: 'from-indigo-500 to-violet-500',
  },
  {
    key: 'budgeting',
    href: '/expenditure',
    title: 'Supply Budget',
    description: 'Log clinic supply spending per location and track against the monthly 6% budget cap.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    ),
    accent: 'from-violet-500 to-purple-500',
  },
]

const ADMIN_SECTION = {
  key: 'admin',
  href: '/admin',
  title: 'User Management',
  description: 'Create users, assign access, and manage roles for your team.',
  icon: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  accent: 'from-slate-500 to-slate-600',
}

const ACTIVITY_SECTION = {
  key: 'activity',
  href: '/admin/activity-log',
  title: 'Activity Log',
  description: 'Full audit trail of every action across ACH, Supply Budget, and Admin.',
  icon: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z"/>
    </svg>
  ),
  accent: 'from-slate-600 to-slate-700',
}

export default function HomePage() {
  const router  = useRouter()
  const profile = useProfile()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  const alwaysOn = profile?.role === 'admin' || profile?.role === 'management'
  const sections = ALL_SECTIONS.filter((s) => {
    if (s.key === 'ach')       return alwaysOn || profile?.can_view_ach
    if (s.key === 'budgeting') return alwaysOn || profile?.can_view_budgeting
    return true
  })

  const allCards = (profile?.role === 'admin' || profile?.role === 'management') ? [...sections, ADMIN_SECTION, ACTIVITY_SECTION] : sections

  return (
    <div className="min-h-screen bg-slate-900 relative overflow-hidden flex flex-col">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-indigo-950/60 via-slate-900 to-slate-900" />
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, #818cf8 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-violet-600/15 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 flex justify-end items-center gap-2 px-6 pt-4 flex-wrap">
        {profile && (
          <span className="text-xs text-slate-600 mr-2">
            {profile.full_name || profile.email}
            {profile.role === 'admin' && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 text-[10px] font-semibold uppercase tracking-wider">Admin</span>}
          </span>
        )}
        <button onClick={handleSignOut} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-red-400 hover:bg-red-500/[0.06] transition-all">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75"/></svg>
          Sign out
        </button>
      </div>

      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-2xl">
          <div className="text-center mb-14">
            <div className="flex justify-center mb-1">
              <TuskLogo size="xl" />
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/15 border border-indigo-500/25 text-indigo-300 text-xs font-semibold tracking-widest uppercase mb-6">
              Clinic Finance Portal
            </div>
            <h1 className="text-5xl font-bold text-white mb-4 tracking-tight leading-tight">
              Finance<br />
              <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
                Management
              </span>
            </h1>
            <p className="text-slate-400 text-base leading-relaxed max-w-sm mx-auto">
              Track ACH documents and manage clinic supply budgets.
            </p>
          </div>

          {allCards.length === 0 ? (
            <div className="text-center py-12 bg-white/[0.03] border border-white/[0.08] rounded-2xl">
              <p className="text-slate-400 text-sm">No modules assigned to your account.</p>
              <p className="text-slate-600 text-xs mt-1">Contact your administrator to get access.</p>
            </div>
          ) : (
            <div className="flex flex-wrap justify-center gap-4">
              {allCards.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className="group relative bg-white/[0.04] backdrop-blur-sm border border-white/10 rounded-2xl p-6 transition-all duration-300 hover:bg-white/[0.07] hover:border-white/20 hover:-translate-y-0.5 hover:shadow-2xl w-full sm:w-[calc(50%-8px)]"
                >
                  <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${s.accent} flex items-center justify-center text-white mb-5 shadow-lg group-hover:scale-105 transition-transform duration-300`}>
                    {s.icon}
                  </div>
                  <h2 className="text-lg font-semibold text-white mb-2">{s.title}</h2>
                  <p className="text-sm text-slate-400 leading-relaxed mb-5">{s.description}</p>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-slate-400 group-hover:text-white transition-colors duration-200">
                    <span>Open</span>
                    <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-200" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"/>
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
