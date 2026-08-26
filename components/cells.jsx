'use client'

// Shared inline-editing cell controls, used by both the ACH table and the
// Zero Payments table so the two behave identically.
//
// These are ALWAYS rendered as controls, never as text that turns into a control
// on click. Two reasons: you can see at a glance which columns are editable, and
// a cell's width never changes, so a fixed-layout table can't reflow.

import { useState, useRef, useEffect } from 'react'

// Money as integer cents so totals compare exactly. Comparing floats lets a 1c
// error through: 253.20 - (100 + 153.19) is 0.00999999999999 in binary.
export const toCents = (v) => Math.round((Number(v) || 0) * 100)

export const TONE_NEUTRAL = 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'

export function matchTone(v) {
  if (v === 'Yes')     return 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:border-emerald-300'
  if (v === 'No')      return 'bg-red-50 text-red-700 border-red-200 hover:border-red-300'
  if (v === 'Partial') return 'bg-amber-50 text-amber-700 border-amber-200 hover:border-amber-300'
  return TONE_NEUTRAL
}

export function statusTone(v) {
  if (v === 'Posted')      return 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:border-indigo-300'
  if (v === 'In Progress') return 'bg-amber-50 text-amber-700 border-amber-200 hover:border-amber-300'
  if (v === 'Not Posted')  return 'bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300'
  return TONE_NEUTRAL
}

export function locationTone(v) {
  return v
    ? 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300'
    : TONE_NEUTRAL
}

// A dropdown that looks like a badge. Saves on selection — no confirm step.
export function CellSelect({ value, options, onChange, tone = TONE_NEUTRAL, disabled, title }) {
  if (disabled) {
    const label = options.find((o) => o.value === (value || ''))?.label
    return <span className="text-slate-400 text-xs px-1">{label || '—'}</span>
  }
  return (
    <div className="relative" title={title}>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full appearance-none cursor-pointer rounded-lg border pl-2 pr-5 py-1 text-[11px] font-semibold outline-none transition-colors focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 ${tone}`}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <svg
        className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 opacity-40"
        fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7"/>
      </svg>
    </div>
  )
}

// A text input that stays quiet until hovered or focused. Commits on Enter or
// blur; Escape reverts. Used for Initials and Notes.
export function CellInput({ value, onCommit, placeholder, maxLength, multiline, disabled, title }) {
  const [draft, setDraft] = useState(value ?? '')
  const [focused, setFocused] = useState(false)
  const [peek, setPeek] = useState(null)   // { top, left, width } while hovering a clipped note
  const escaped = useRef(false)
  const elRef = useRef(null)

  // Re-sync when the row's saved value changes and we're not mid-edit.
  useEffect(() => { if (!focused) setDraft(value ?? '') }, [value, focused])

  // Show the full text on hover when it doesn't fit. The table wrapper has
  // overflow-x-auto, which clips absolutely-positioned children — so the
  // popover is position:fixed with measured coordinates to escape it.
  function openPeek() {
    const el = elRef.current
    if (!el || focused || !multiline) return
    const clipped = el.scrollHeight > el.clientHeight + 1
    if (!clipped) return
    const r = el.getBoundingClientRect()
    const width = Math.max(r.width, 260)
    setPeek({
      top: r.bottom + 6,
      left: Math.min(r.left, window.innerWidth - width - 12),
      width,
    })
  }
  const closePeek = () => setPeek(null)

  if (disabled) {
    return <span className="text-slate-400 text-xs px-1" title={value || undefined}>{value || '—'}</span>
  }

  // A multi-row textarea is taller than the single-line controls beside it, and
  // because cells are vertically centred its first line ends up above their
  // shared baseline. So it stays one row at rest and only grows while focused.
  function grow(el) {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }
  function shrink(el) {
    if (el) el.style.height = ''
  }

  const common = {
    value: draft,
    placeholder,
    maxLength,
    // Native tooltip as the always-available fallback: shows the note itself,
    // not the column name. Works for keyboard and screen-reader users too.
    title: multiline ? (value || title) : title,
    onChange: (e) => { setDraft(e.target.value); if (multiline) grow(e.target) },
    onFocus:  (e) => { setFocused(true); escaped.current = false; if (multiline) grow(e.target) },
    onBlur:   (e) => {
      setFocused(false)
      if (multiline) shrink(e.target)
      if (escaped.current) { setDraft(value ?? ''); return }
      if ((draft ?? '') !== (value ?? '')) onCommit(draft)
    },
    onKeyDown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur() }
      if (e.key === 'Escape') { escaped.current = true; e.currentTarget.blur() }
    },
    className: 'w-full rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-xs text-slate-700 placeholder:text-slate-300 outline-none transition-colors hover:border-slate-200 hover:bg-white focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100',
  }

  if (!multiline) return <input type="text" {...common} />

  return (
    <>
      <textarea
        {...common}
        ref={elRef}
        rows={1}
        onMouseEnter={openPeek}
        onMouseLeave={closePeek}
        className={`${common.className} resize-none leading-relaxed overflow-hidden focus:overflow-y-auto`}
      />
      {peek && (
        <div
          style={{ position: 'fixed', top: peek.top, left: peek.left, width: peek.width, zIndex: 60 }}
          className="pointer-events-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-700 shadow-xl shadow-slate-300/40 whitespace-pre-wrap break-words"
        >
          {draft}
        </div>
      )}
    </>
  )
}

export function MatchBadge({ value }) {
  if (!value) return <span className="text-slate-300 text-xs">—</span>
  const map = { Yes: 'bg-emerald-100 text-emerald-700 border-emerald-200', No: 'bg-red-100 text-red-700 border-red-200', Partial: 'bg-amber-100 text-amber-700 border-amber-200' }
  return <span className={`badge text-[10px] border ${map[value] ?? 'bg-slate-100 text-slate-700 border-slate-200'}`}>{value}</span>
}

export function StatusBadge({ value }) {
  if (!value) return <span className="text-slate-300 text-xs">—</span>
  const map = { 'Posted': 'bg-indigo-100 text-indigo-700 border-indigo-200', 'In Progress': 'bg-amber-100 text-amber-700 border-amber-200', 'Not Posted': 'bg-slate-100 text-slate-500 border-slate-200' }
  return <span className={`badge text-[10px] border ${map[value] ?? 'bg-slate-100 text-slate-700 border-slate-200'}`}>{value}</span>
}


// ─────────────────────────────────────────────────────────────────────────────
// Overflow menu for a table row.
//
// A row accumulates actions over time and five flat icons give a paperclip you
// click hourly the same weight as a delete you click monthly. This holds the
// occasional and the destructive ones so the row stays calm and the frequent
// actions stay one click away.
//
// Positioned `fixed` from a measured rect: the table wrapper has
// overflow-x-auto, which clips absolutely-positioned children. Flips above the
// button when there isn't room below.
// ─────────────────────────────────────────────────────────────────────────────
export function RowMenu({ items = [], label = 'More actions' }) {
  const [pos, setPos] = useState(null)
  const wrapRef = useRef(null)
  const btnRef = useRef(null)

  const visible = items.filter(Boolean)

  useEffect(() => {
    if (!pos) return
    const close = (e) => { if (!wrapRef.current?.contains(e.target)) setPos(null) }
    const esc = (e) => { if (e.key === 'Escape') setPos(null) }
    // Named, so removeEventListener actually matches what was added — an inline
    // arrow here would leave a listener behind on every open.
    const dismiss = () => setPos(null)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    // A menu pinned to a measured rect goes stale the moment anything scrolls.
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [pos])

  if (visible.length === 0) return null

  function toggle() {
    if (pos) { setPos(null); return }
    const r = btnRef.current.getBoundingClientRect()
    const height = visible.length * 34 + 10
    const below = window.innerHeight - r.bottom - 6
    setPos({
      top: below < height ? undefined : r.bottom + 6,
      bottom: below < height ? window.innerHeight - r.top + 6 : undefined,
      left: Math.min(r.right - 190, window.innerWidth - 202),
    })
  }

  return (
    <div ref={wrapRef} className="inline-block">
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); toggle() }}
        title={label}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        className={`p-1.5 rounded-lg transition-colors ${pos ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`}
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
          <circle cx="4" cy="10" r="1.6" /><circle cx="10" cy="10" r="1.6" /><circle cx="16" cy="10" r="1.6" />
        </svg>
      </button>

      {pos && (
        <div
          role="menu"
          style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: 190, zIndex: 60 }}
          className="rounded-xl border border-slate-200 bg-white py-1 shadow-xl shadow-slate-300/40"
        >
          {visible.map((it, i) => (
            <button
              key={i}
              role="menuitem"
              onClick={(e) => { e.stopPropagation(); setPos(null); it.onClick() }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors ${
                it.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="shrink-0 opacity-70">{it.icon}</span>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
