'use client'

import { useEffect, useRef, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// The header every Analysis view shares, so each one reads the same way:
//
//   Title                                        [period] [↻] [⋯]
//   One line on what the view shows
//   Data read at 9:13 PM · 2 notes ▾
//
// Notes (where the data comes from, what's missing) stay folded into one
// quiet line; only errors that stop the view are shown in full.
// ─────────────────────────────────────────────────────────────────────────────

export default function ViewHeader({ title, subtitle, controls, busy, onRefresh, onUpload, status, notes = [], errors = [] }) {
  const [menu, setMenu] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const menuRef = useRef(null)
  const warn = notes.filter((n) => n.tone === 'warn').length

  useEffect(() => {
    if (!menu) return
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false) }
    const esc = (e) => { if (e.key === 'Escape') setMenu(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [menu])

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h2>
          {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {controls}
          {onRefresh && (
            <button onClick={onRefresh} disabled={busy} title="Read the latest reports" aria-label="Read the latest reports"
              className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:border-slate-300 disabled:opacity-50 transition-colors">
              <svg className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            </button>
          )}
          {onUpload && (
            <div className="relative" ref={menuRef}>
              <button onClick={() => setMenu((m) => !m)} aria-label="More" aria-expanded={menu}
                className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:border-slate-300 transition-colors">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
              </button>
              {menu && (
                <div className="absolute right-0 mt-1 w-56 rounded-xl border border-slate-200 bg-white shadow-lg py-1 z-40">
                  <button onClick={() => { setMenu(false); onUpload() }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    Upload a report file{'…'}
                    <span className="block text-[11px] text-slate-400">Instead of the reports folder</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {(status || notes.length > 0) && (
        <div className="text-[12px] text-slate-400">
          {status}
          {notes.length > 0 && (
            <>
              {status && ' · '}
              <button onClick={() => setShowNotes((v) => !v)} className={`underline-offset-2 hover:underline ${warn ? 'text-amber-600' : ''}`}>
                {notes.length} note{notes.length === 1 ? '' : 's'} {showNotes ? '▴' : '▾'}
              </button>
            </>
          )}
          {showNotes && (
            <ul className="mt-1.5 space-y-1 rounded-xl bg-white/70 border border-slate-200 px-3 py-2">
              {notes.map((n, i) => (
                <li key={i} className={`flex gap-2 text-[12px] ${n.tone === 'warn' ? 'text-amber-700' : 'text-slate-500'}`}>
                  <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${n.tone === 'warn' ? 'bg-amber-500' : 'bg-slate-300'}`} />
                  <span>{n.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {errors.length > 0 && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-2.5 space-y-0.5">
          {errors.map((e, i) => <p key={i} className="text-xs text-red-700">{e}</p>)}
        </div>
      )}
    </div>
  )
}

// Grey blocks shaped like the view, while its reports load.
export function LoadingBlocks({ rows = 3 }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <div className="h-28 rounded-2xl bg-white/60 animate-pulse" />
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-16 rounded-2xl bg-white/50 animate-pulse" />)}
    </div>
  )
}
