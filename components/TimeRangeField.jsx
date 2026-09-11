'use client'

import { useState, useRef, useEffect, useLayoutEffect } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// A shift-hours field: a themed trigger showing "9:00 AM - 5:00 PM", opening a
// scrollable clock-style picker for the start and end time — replaces a fixed
// list of preset shifts, which couldn't express a time nobody had thought to
// add to the list (this is exactly how the "8:00 AM - 1:00 PM" request came
// about last time).
//
// Storage format is unchanged: "H:MM AM/PM - H:MM AM/PM", the same string the
// old preset dropdown wrote. Existing rows and CSV-imported values parse the
// same way, so nothing downstream (exports, the DB column) needed to change.
//
// Minutes step in 5s (00, 05, …, 55) — a hygiene shift is scheduled to the
// nearest five minutes in practice, and a 1-minute wheel would be 5x longer to
// scroll for no real precision gained. Change MINUTES below if that's wrong.
// ─────────────────────────────────────────────────────────────────────────────

const HOURS   = Array.from({ length: 12 }, (_, i) => i + 1)           // 1-12
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)           // 0,5,…,55
const MERIDIEMS = ['AM', 'PM']

const DEFAULT_RANGE = { sh: 9, sm: 0, sp: 'AM', eh: 5, em: 0, ep: 'PM' }

function pad2(n) { return String(n).padStart(2, '0') }

function formatRange({ sh, sm, sp, eh, em, ep }) {
  return `${sh}:${pad2(sm)} ${sp} - ${eh}:${pad2(em)} ${ep}`
}

function parseRange(text) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((text || '').trim())
  if (!m) return null
  const [, sh, sm, sp, eh, em, ep] = m
  return { sh: Number(sh), sm: Number(sm), sp: sp.toUpperCase(), eh: Number(eh), em: Number(em), ep: ep.toUpperCase() }
}

// Compact geometry: 3 visible rows (not 5) and a shorter row height. The
// first version was a full-height card that dominated the screen for what is
// just an hour/minute/AM-PM pick — this keeps the wheel feel with far less
// footprint.
const ITEM_H = 22
const VISIBLE = 3
const WHEEL_H = ITEM_H * VISIBLE
const PAD = (WHEEL_H - ITEM_H) / 2

function Wheel({ items, value, onChange, ariaLabel }) {
  const scrollRef = useRef(null)
  const timeoutRef = useRef(null)
  const scrollingRef = useRef(false)
  const index = Math.max(0, items.indexOf(value))

  // Snap to the current value on open / when it changes from outside (picking
  // the other column, or the popover just mounted) — never while the user is
  // mid-scroll, or this fights their gesture.
  useLayoutEffect(() => {
    if (scrollingRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = index * ITEM_H
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  function handleScroll() {
    scrollingRef.current = true
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      scrollingRef.current = false
      const el = scrollRef.current
      if (!el) return
      const nearest = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_H)))
      // Settle exactly on the item even if the browser's own snap left it a
      // pixel or two off, then report the value if it actually changed.
      el.scrollTop = nearest * ITEM_H
      if (items[nearest] !== value) onChange(items[nearest])
    }, 120)
  }

  function pick(i) {
    onChange(items[i])
    scrollRef.current?.scrollTo({ top: i * ITEM_H, behavior: 'smooth' })
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowUp')   { e.preventDefault(); pick(Math.max(0, index - 1)) }
    if (e.key === 'ArrowDown') { e.preventDefault(); pick(Math.min(items.length - 1, index + 1)) }
  }

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ height: WHEEL_H, width: 38 }}>
        {/* Selection band behind the centered item — stays fixed, the list moves. */}
        <div
          className="pointer-events-none absolute left-0 right-0 rounded-lg bg-indigo-50 border border-indigo-100"
          style={{ top: PAD, height: ITEM_H }}
        />
        <div
          ref={scrollRef}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={0}
          onScroll={handleScroll}
          onKeyDown={onKeyDown}
          className="relative h-full overflow-y-scroll outline-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          style={{
            scrollSnapType: 'y mandatory',
            WebkitOverflowScrolling: 'touch',
            // Fade the top and bottom rows so the wheel reads as a cylinder,
            // not a flat list with a box drawn around the middle row.
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 32%, black 68%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 32%, black 68%, transparent 100%)',
          }}
        >
          <div style={{ height: PAD }} />
          {items.map((it, i) => (
            <div
              key={it}
              role="option"
              aria-selected={i === index}
              onClick={() => pick(i)}
              style={{ height: ITEM_H, scrollSnapAlign: 'center' }}
              className={`flex items-center justify-center text-xs cursor-pointer tabular-nums transition-colors ${
                i === index ? 'text-indigo-700 font-semibold' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {typeof it === 'number' ? pad2(it) : it}
            </div>
          ))}
          <div style={{ height: PAD }} />
        </div>
      </div>
    </div>
  )
}

function TimePicker({ label, hour, minute, meridiem, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 w-9 shrink-0">{label}</span>
      <div className="flex items-center gap-0.5 bg-slate-50 rounded-lg p-1">
        <Wheel items={HOURS} value={hour} onChange={(v) => onChange({ hour: v })} ariaLabel={`${label} hour`} />
        <span className="text-slate-300 font-semibold text-xs">:</span>
        <Wheel items={MINUTES} value={minute} onChange={(v) => onChange({ minute: v })} ariaLabel={`${label} minute`} />
        <Wheel items={MERIDIEMS} value={meridiem} onChange={(v) => onChange({ meridiem: v })} ariaLabel={`${label} AM or PM`} />
      </div>
    </div>
  )
}

export default function TimeRangeField({ value, onChange, disabled, title }) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState(null)
  const btnRef  = useRef(null)
  const panelRef = useRef(null)

  const parsed = parseRange(value) || DEFAULT_RANGE
  const [draft, setDraft] = useState(parsed)

  useEffect(() => {
    if (open) setDraft(parseRange(value) || DEFAULT_RANGE)
  }, [open, value])

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (btnRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  function toggle() {
    if (disabled) return
    if (open) { setOpen(false); return }
    const r = btnRef.current.getBoundingClientRect()
    const height = 190
    const below = window.innerHeight - r.bottom - 8
    setRect({
      left: Math.min(r.left, window.innerWidth - 210),
      top:    below < height ? undefined : r.bottom + 6,
      bottom: below < height ? window.innerHeight - r.top + 6 : undefined,
    })
    setOpen(true)
  }

  // Every wheel change commits immediately — same "no save button, it just
  // saves itself" rule as every other cell control in the app.
  function patch(side, fields) {
    const next = { ...draft, ...(
      side === 'start'
        ? { sh: fields.hour ?? draft.sh, sm: fields.minute ?? draft.sm, sp: fields.meridiem ?? draft.sp }
        : { eh: fields.hour ?? draft.eh, em: fields.minute ?? draft.em, ep: fields.meridiem ?? draft.ep }
    ) }
    setDraft(next)
    onChange(formatRange(next))
  }

  if (disabled) {
    return <span className="text-slate-400 text-xs px-1">{value || '—'}</span>
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={title}
        onClick={(e) => { e.stopPropagation(); toggle() }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex w-full items-center gap-1.5 rounded-lg border pl-2 pr-1.5 py-1 text-xs outline-none transition-colors bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300 ${open ? 'ring-2 ring-indigo-100 border-indigo-400' : ''}`}
      >
        <svg className="w-3 h-3 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 7.5V12l3 2" /></svg>
        <span className="flex-1 truncate text-left tabular-nums">{value || formatRange(DEFAULT_RANGE)}</span>
      </button>

      {open && rect && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Set shift hours"
          style={{ position: 'fixed', top: rect.top, bottom: rect.bottom, left: rect.left, width: 198, zIndex: 9999, boxShadow: '0 12px 32px rgba(99,102,241,0.18)' }}
          className="bg-white border border-slate-200 rounded-xl p-2"
        >
          <div className="space-y-1.5">
            <TimePicker label="Start" hour={draft.sh} minute={draft.sm} meridiem={draft.sp} onChange={(f) => patch('start', f)} />
            <TimePicker label="End"   hour={draft.eh} minute={draft.em} meridiem={draft.ep} onChange={(f) => patch('end', f)} />
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-full mt-1.5 py-1 text-[11px] font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      )}
    </>
  )
}

export { formatRange as formatTimeRange, parseRange as parseTimeRange, DEFAULT_RANGE }
