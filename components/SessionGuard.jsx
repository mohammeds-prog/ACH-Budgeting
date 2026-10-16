'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  IDLE_MS, WARN_MS, HEARTBEAT_MS,
  markActivity, markHeartbeat, lastActivity, clearSessionMarks, setSignoutReason,
} from '@/lib/session'

// Mounted only while signed in (see app/providers.jsx). Tracks activity, keeps
// the heartbeat going, warns a minute before the inactivity sign-out, and
// signs out when the time is up. Rules and reasoning: lib/session.js.

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'wheel', 'touchstart']
// Writing localStorage on every mousemove is wasteful; once every few seconds
// is plenty when the limit is 30 minutes.
const ACTIVITY_WRITE_EVERY_MS = 5000

export default function SessionGuard() {
  const [secondsLeft, setSecondsLeft] = useState(null)   // non-null = warning showing
  const lastWrite  = useRef(0)
  const localLast  = useRef(Date.now())   // in-memory fallback if storage is blocked
  const signingOut = useRef(false)
  const warningOn  = useRef(false)

  async function signOut(reason) {
    if (signingOut.current) return
    signingOut.current = true
    if (reason) setSignoutReason(reason)
    clearSessionMarks()
    // scope 'local': end THIS browser's session only. The default ('global')
    // would also sign the user out on every other device they use.
    try { await supabase.auth.signOut({ scope: 'local' }) } catch {}
    window.location.replace('/login')
  }

  function stayActive() {
    const now = Date.now()
    localLast.current = now
    lastWrite.current = now
    markActivity(now)
    warningOn.current = false
    setSecondsLeft(null)
  }

  useEffect(() => {
    const now = Date.now()
    localLast.current = now
    markActivity(now)
    markHeartbeat(now)

    // Passive events (mouse drift, scroll) keep a session alive, but must not
    // dismiss the warning by themselves — it would vanish before it's read.
    // Once it shows, only a deliberate click or keypress counts.
    const PASSIVE = new Set(['mousemove', 'scroll', 'wheel'])
    function onActivity(e) {
      if (warningOn.current && PASSIVE.has(e.type)) return
      const t = Date.now()
      localLast.current = t
      if (t - lastWrite.current < ACTIVITY_WRITE_EVERY_MS) return
      lastWrite.current = t
      markActivity(t)
    }
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }))

    const heartbeat = setInterval(() => markHeartbeat(), HEARTBEAT_MS)
    const onHide = () => markHeartbeat()
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onHide)

    // Shared across tabs: the newest activity in ANY tab counts. After a
    // laptop sleeps, the first tick sees the gap and signs out at once.
    function check() {
      const last = Math.max(lastActivity(), localLast.current)
      const idle = Date.now() - last
      if (idle >= IDLE_MS) { signOut('idle'); return }
      const left = IDLE_MS - idle
      const warn = left <= WARN_MS
      warningOn.current = warn
      setSecondsLeft(warn ? Math.ceil(left / 1000) : null)
    }
    const tick = setInterval(check, 1000)

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }))
      clearInterval(heartbeat)
      clearInterval(tick)
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onHide)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (secondsLeft == null) return null

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      <div role="alertdialog" aria-labelledby="idle-title" className="relative bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
        <div className="mx-auto w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center mb-4">
          <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 7.5V12l3 2" />
          </svg>
        </div>
        <h2 id="idle-title" className="text-base font-semibold text-slate-900">Still there?</h2>
        <p className="text-sm text-slate-500 mt-1.5">
          You’ll be signed out in <b className="tabular-nums text-slate-800">{secondsLeft}s</b> because of inactivity.
        </p>
        <div className="flex gap-2 justify-center mt-5">
          <button onClick={() => signOut(null)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-xl transition-all">
            Sign out now
          </button>
          <button autoFocus onClick={stayActive} className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all">
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  )
}
