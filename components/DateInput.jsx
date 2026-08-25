'use client'

import { useState, useRef, useEffect } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// A date field that always reads MM/DD/YYYY.
//
// Why this exists: a native <input type="date"> renders in the BROWSER's
// locale. A machine set to en-GB shows 30-07-2026 for the same value a US
// machine shows as 07/30/2026, and there is no CSS, attribute or React prop
// that overrides it. The only way to guarantee one format for every viewer is
// to render the text ourselves.
//
// The native picker is kept: a hidden date input sits alongside and the
// calendar button opens it, so typing and clicking both still work.
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
  const nativeRef = useRef(null)

  // Re-sync when the row's saved value changes underneath us, but never while
  // the user is mid-keystroke.
  useEffect(() => { if (!focused) setText(isoToUS(value)) }, [value, focused])

  function commit(raw) {
    const trimmed = (raw ?? '').trim()
    if (trimmed === '') { onChange(''); return }
    const iso = usToISO(trimmed)
    if (iso) onChange(iso)
    else setText(isoToUS(value))   // unparseable: snap back, don't lose the value
  }

  function openPicker() {
    const el = nativeRef.current
    if (!el || disabled) return
    // showPicker() is the reliable route in modern browsers; focus is the fallback.
    if (typeof el.showPicker === 'function') { try { el.showPicker(); return } catch {} }
    el.focus()
    el.click()
  }

  return (
    <div className={`relative ${className}`} title={title}>
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
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-indigo-600 transition-colors disabled:opacity-40"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"/>
        </svg>
      </button>

      {/* Hidden native input — supplies the calendar UI only. */}
      <input
        ref={nativeRef}
        type="date"
        value={value || ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
        className="absolute right-1 bottom-0 w-0 h-0 opacity-0 pointer-events-none"
      />
    </div>
  )
}

export { isoToUS, usToISO }
