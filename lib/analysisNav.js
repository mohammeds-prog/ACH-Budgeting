'use client'

import { useEffect, useRef } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// "Open in Analysis": jump to a view with its filters set — the office, month
// or dates a chat answer's numbers came from.
//
//   goToAnalysis({ view: 'money', office: 'Valley View Dental Romeoville', month: '2026-10' })
//
// The Analysis page switches tab; the view (which may not be mounted yet —
// tabs load on first open) picks the filters up with useAnalysisGoto().
// ─────────────────────────────────────────────────────────────────────────────

const EVENT = 'analysis:goto'

export function goToAnalysis(link) {
  if (!link?.view || typeof window === 'undefined') return
  window.__analysisGoto = { ...link, at: Date.now() }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: window.__analysisGoto }))
}

/** For the Analysis page: switch to the asked-for tab. */
export function useAnalysisTab(onView) {
  const cb = useRef(onView)
  cb.current = onView
  useEffect(() => {
    const h = (e) => cb.current(e.detail.view)
    window.addEventListener(EVENT, h)
    return () => window.removeEventListener(EVENT, h)
  }, [])
}

/**
 * For a view: apply the filters of a jump to this view — one waiting from
 * before it mounted, and any later ones. `ready` holds the apply back until
 * the view's data is loaded (so a month can be checked against its list).
 */
export function useAnalysisGoto(view, apply, ready = true) {
  const cb = useRef(apply)
  cb.current = apply
  useEffect(() => {
    if (!ready) return
    const pending = typeof window !== 'undefined' ? window.__analysisGoto : null
    if (pending?.view === view && !pending.done) { pending.done = true; cb.current(pending) }
    const h = (e) => { if (e.detail.view === view) { e.detail.done = true; cb.current(e.detail) } }
    window.addEventListener(EVENT, h)
    return () => window.removeEventListener(EVENT, h)
  }, [view, ready])
}
