'use client'

import { useState, useRef, useEffect } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// A date field that always reads MM/DD/YYYY, with a themed calendar.
//
// Why the text side exists: a native <input type="date"> renders in the
// BROWSER's locale. A machine set to en-GB shows 30-07-2026 for the same value
// a US machine shows as 07/30/2026, and there is no CSS, attribute or React
// prop that overrides it. Rendering the text ourselves is the only fix.
//
// Why the calendar is custom, not the native picker: a browser draws its date
// picker with OS chrome — system font, square corners, its own highlight — and
// no CSS reaches inside it, so it looked foreign next to every other themed
// control in the app (Select, CellSelect, RowMenu all went through this).
//
// Both are always live: type a date, or open the calendar and click one.
//
// Value in and out is always ISO (yyyy-mm-dd) — the format the database and
// every existing filter/sort already use. Only the display changes.
// ─────────────────────────────────────────────────────────────────────────────

function isoToUS(iso) {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[2]}/${m[3]}/${m[1]}` : ''
}

// Forgiving on input: 7/4/26 · 07-04-2026 · 07042026 all land on 2026-07-04.
function usToISO(text) {
  if (!text) return ''
  const t = text.trim()
  let mm, dd, yy

  let m = /^(\d{1,2})\s*[/\-. ]\s*(\d{1,2})\s*[/\-. ]\s*(\d{2}|\d{4})$/.exec(t)
  if (m) { [, mm, dd, yy] = m }
  else if ((m = /^(\d{2})(\d{2})(\d{4})$/.exec(t))) { [, mm, dd, yy] = m }
  else if ((m = /^(\d{2})(\d{2})(\d{2})$/.exec(t)))  { [, mm, dd, yy] = m }
  else return null   // unparseable — caller keeps the previous value

  if (yy.length === 2) yy = '20' + yy
  const M = Number(mm), D = Number(dd), Y = Number(yy)
  if (M < 1 || M > 12 || D < 1 || D > 31 || Y < 1900 || Y > 2199) return null

  // Reject dates that don't exist, e.g. 02/31/2026
  const probe = new Date(Date.UTC(Y, M - 1, D))
  if (probe.getUTCMonth() !== M - 1 || probe.getUTCDate() !== D) return null

  return `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Calendar grid for one month, in UTC throughout — this is display-only
// bookkeeping, never a real instant, so there is no timezone to get wrong.
function buildMonth(year, month) {
  const first = Date.UTC(year, month, 1)
  const startDow = new Date(first).getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const daysInPrev = new Date(Date.UTC(year, month, 0)).getUTCDate()

  const cells = []
  for (let i = startDow - 1; i >= 0; i--) cells.push({ day: daysInPrev - i, inMonth: false, month: month - 1 })
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, inMonth: true, month })
  while (cells.length % 7 !== 0 || cells.length < 42) cells.push({ day: cells.length - (startDow + daysInMonth) + 1, inMonth: false, month: month + 1 })
  return cells
}

function iso(year, month, day) {
  // month can drift outside 0-11 from the grid padding above — Date.UTC
  // normalizes it (month -1 rolls back a year), so this stays correct at
  // every boundary without special-casing December/January.
  const d = new Date(Date.UTC(year, month, day))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function Calendar({ value, onPick, onClose, anchorRect }) {
  const base = value ? new Date(value + 'T00:00:00Z') : new Date()
  const [year, setYear]   = useState(base.getUTCFullYear())
  const [month, setMonth] = useState(base.getUTCMonth())
  const panelRef = useRef(null)

  useEffect(() => {
    const close = (e) => { if (!panelRef.current?.contains(e.target)) onClose() }
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [onClose])

  function shift(delta) {
    let m = month + delta, y = year
    if (m < 0) { m = 11; y-- } else if (m > 11) { m = 0; y++ }
    setMonth(m); setYear(y)
  }

  const cells = buildMonth(year, month)
  const today = todayISO()

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Choose a date"
      style={{
        position: 'fixed',
        top: anchorRect.top, bottom: anchorRect.bottom, left: anchorRect.left,
        zIndex: 9999,
        boxShadow: '0 12px 32px rgba(99,102,241,0.18)',
      }}
      className="w-64 bg-white border border-slate-200 rounded-2xl p-3"
    >
      <div className="flex items-center justify-between mb-2 px-0.5">
        <button type="button" onClick={() => shift(-1)} aria-label="Previous month"
          className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
        </button>
        <span className="text-xs font-semibold text-slate-700">{MONTH_NAMES[month]} {year}</span>
        <button type="button" onClick={() => shift(1)} aria-label="Next month"
          className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="text-[10px] font-semibold text-slate-400 text-center py-1">{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((c, i) => {
          const cellISO = iso(year, month, c.day)
          const isToday = cellISO === today
          const isSelected = cellISO === value
          return (
            <button
              key={i}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onPick(cellISO) }}
              className={`h-7 rounded-lg text-xs tabular-nums transition-colors ${
                isSelected
                  ? 'bg-indigo-600 text-white font-semibold'
                  : isToday
                  ? 'text-indigo-600 font-semibold bg-indigo-50 hover:bg-indigo-100'
                  : c.inMonth
                  ? 'text-slate-700 hover:bg-violet-50'
                  : 'text-slate-300 hover:bg-slate-50'
              }`}
            >
              {c.day}
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 px-0.5">
        <button type="button" onMouseDown={(e) => { e.preventDefault(); onPick('') }} className="text-[11px] text-slate-400 hover:text-slate-700 font-medium">
          Clear
        </button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onPick(today); setYear(Number(today.slice(0, 4))); setMonth(Number(today.slice(5, 7)) - 1) }}
          className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
        >
          Today
        </button>
      </div>
    </div>
  )
}

export default function DateInput({
  value,               // ISO yyyy-mm-dd
  onChange,            // (iso: string) => void
  className = '',
  placeholder = 'mm/dd/yyyy',
  disabled,
  title,
}) {
  const [text, setText] = useState(() => isoToUS(value))
  const [focused, setFocused] = useState(false)
  const [anchorRect, setAnchorRect] = useState(null)
  const wrapRef = useRef(null)

  // Re-sync when the row's saved value changes underneath us, but never while
  // the user is mid-keystroke.
  useEffect(() => { if (!focused) setText(isoToUS(value)) }, [value, focused])

  function commit(raw) {
    const trimmed = (raw ?? '').trim()
    if (trimmed === '') { onChange(''); return }
    const isoVal = usToISO(trimmed)
    if (isoVal) onChange(isoVal)
    else setText(isoToUS(value))   // unparseable: snap back, don't lose the value
  }

  function openPicker() {
    if (disabled) return
    if (anchorRect) { setAnchorRect(null); return }
    const r = wrapRef.current.getBoundingClientRect()
    const height = 300
    const below = window.innerHeight - r.bottom - 8
    setAnchorRect({
      left: Math.min(r.left, window.innerWidth - 268),
      top:    below < height ? undefined : r.bottom + 6,
      bottom: below < height ? window.innerHeight - r.top + 6 : undefined,
    })
  }

  function pick(isoVal) {
    onChange(isoVal)
    setText(isoToUS(isoVal))
    setAnchorRect(null)
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`} title={title}>
      <input
        type="text"
        inputMode="numeric"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => { setFocused(false); commit(e.target.value) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter')  { e.preventDefault(); e.currentTarget.blur() }
          if (e.key === 'Escape') { setText(isoToUS(value)); e.currentTarget.blur() }
        }}
        className="w-full rounded-lg border border-slate-200 bg-white pl-2 pr-7 py-1 text-xs tabular-nums text-slate-700 placeholder:text-slate-300 outline-none transition-colors hover:border-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
      />

      <button
        type="button"
        tabIndex={-1}
        onClick={openPicker}
        disabled={disabled}
        aria-label="Open calendar"
        aria-expanded={!!anchorRect}
        className={`absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded transition-colors disabled:opacity-40 ${
          anchorRect ? 'text-indigo-600' : 'text-slate-400 hover:text-indigo-600'
        }`}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
        </svg>
      </button>

      {anchorRect && (
        <Calendar value={value} onPick={pick} onClose={() => setAnchorRect(null)} anchorRect={anchorRect} />
      )}
    </div>
  )
}

export { isoToUS, usToISO }
