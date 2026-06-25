'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import TuskLogo from '@/components/TuskLogo'
import { supabase } from '@/lib/supabase'

const MAX_ATTEMPTS = 5
const LOCKOUT_MS   = 15 * 60 * 1000 // 15 minutes

export default function LoginPage() {
  const router = useRouter()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [attempts, setAttempts] = useState(0)
  const [lockedUntil, setLockedUntil] = useState(null)

  const isLocked = lockedUntil && Date.now() < lockedUntil
  const remaining = isLocked ? Math.ceil((lockedUntil - Date.now()) / 60000) : 0

  async function handleSubmit(e) {
    e.preventDefault()
    if (isLocked) return
    setError('')
    if (!email || !password) { setError('Email and password are required.'); return }
    setLoading(true)
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) {
        const newAttempts = attempts + 1
        setAttempts(newAttempts)
        if (newAttempts >= MAX_ATTEMPTS) {
          setLockedUntil(Date.now() + LOCKOUT_MS)
          setError(`Too many failed attempts. Try again in 15 minutes.`)
        } else {
          setError(`Invalid email or password. ${MAX_ATTEMPTS - newAttempts} attempt${MAX_ATTEMPTS - newAttempts === 1 ? '' : 's'} remaining.`)
        }
        setLoading(false)
        return
      }
      router.push('/')
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 relative flex items-center justify-center p-4 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-indigo-950/60 via-slate-900 to-slate-900" />
      <div className="absolute inset-0 opacity-[0.025] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #818cf8 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <TuskLogo size="xl" />
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-[11px] font-semibold tracking-widest uppercase">
            Clinic Finance Portal
          </div>
          <h1 className="mt-4 text-2xl font-bold text-white tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-slate-400">Enter your credentials to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError('') }}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              className={inp}
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError('') }}
              placeholder="Your account password"
              autoComplete="current-password"
              className={inp}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-500/[0.08] border border-red-500/20 rounded-xl">
              <svg className="w-4 h-4 text-red-400 shrink-0 mt-px" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-xs text-red-400 font-medium leading-relaxed">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || isLocked}
            className="w-full py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all shadow-lg shadow-indigo-900/30 active:scale-[0.98]"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Signing in…
              </span>
            ) : isLocked ? `Locked — try again in ${remaining} min` : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

const inp = 'w-full px-3 py-2.5 text-sm bg-slate-800/80 border border-white/[0.08] rounded-xl text-white placeholder:text-white/25 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20 transition-all [color-scheme:dark]'
