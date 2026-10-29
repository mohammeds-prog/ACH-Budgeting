'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { searchArchive, searchTerms, parseAmountFilter } from '@/lib/archiveStorage'
import { isoToUS } from './DateInput'

// ─────────────────────────────────────────────────────────────────────────────
// "Also in the ACH Archive" — shown on the ACH tracker while someone searches.
//
// A payment someone is hunting for may only exist in the Archive. Rather than
// mixing archive rows into the tracker's table (they have no match / status /
// initials, and would distort the stat cards, bulk edit and Transfer Complete
// tab), the matches are listed in their own panel and each one links straight
// to that payment in the Archive.
//
// Only runs for a search or an amount — the "find this payment" cases. A date
// filter alone would match thousands of archive rows on every change.
// ─────────────────────────────────────────────────────────────────────────────

const PREVIEW_ROWS = 5
const DEBOUNCE_MS = 400

// The tracker filters by month/year; the Archive by a date range.
function monthYearRange(month, year) {
  const y = Number(year)
  if (!y) return {}
  const m = Number(month)
  if (!m) return { from: `${y}-01-01`, to: `${y}-12-31` }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${last}` }
}

export function archiveHref(params) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v)
  const s = qs.toString()
  return s ? `/archive?${s}` : '/archive'
}

// The bank's TRACE# identifies one transaction, so linking by it opens the
// Archive on exactly that payment.
function traceOf(description) {
  return /TRACE#:?\s*(\d{6,})/i.exec(description || '')?.[1] || null
}

function fmtMoney(n) {
  if (n == null) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ArchiveMatches({ search, amount, from, to, month, year, insurance }) {
  const query = useMemo(() => {
    const range = from || to ? { from, to } : monthYearRange(month, year)
    return { q: search || '', amount: amount || '', from: range.from || '', to: range.to || '', insurance: insurance || '' }
  }, [search, amount, from, to, month, year, insurance])

  const amt = parseAmountFilter(query.amount)
  const active = searchTerms(query.q).length > 0 || (amt && !amt.invalid)

  const [result, setResult] = useState(null)   // { rows, total }
  const seq = useRef(0)

  useEffect(() => {
    const mine = ++seq.current
    if (!active) { setResult(null); return }
    const t = setTimeout(() => {
      searchArchive(query, { page: 1 })
        .then((r) => { if (mine === seq.current) setResult(r) })
        // The panel is a convenience; if the archive can't be reached, the
        // tracker just carries on without it.
        .catch(() => { if (mine === seq.current) setResult(null) })
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query, active])

  if (!active || !result || result.total === 0) return null

  const allHref = archiveHref(query)

  return (
    <div className="glass-card rounded-2xl overflow-hidden border border-indigo-100">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-indigo-50/60 border-b border-indigo-100">
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-4 h-4 text-indigo-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m16.5 0h-16.5m16.5 0a1.5 1.5 0 0 0 0-3h-16.5a1.5 1.5 0 0 0 0 3m6.75 4.5h3" />
          </svg>
          <p className="text-xs text-slate-700">
            Also in the <b>ACH Archive</b> — {result.total.toLocaleString()} {result.total === 1 ? 'payment matches' : 'payments match'} this search
          </p>
        </div>
        <Link href={allHref} className="shrink-0 text-xs font-semibold text-indigo-600 hover:text-indigo-800">
          {result.total > PREVIEW_ROWS ? `View all ${result.total.toLocaleString()} in Archive →` : 'Open in Archive →'}
        </Link>
      </div>
      <ul className="divide-y divide-slate-100">
        {result.rows.slice(0, PREVIEW_ROWS).map((r) => {
          const trace = traceOf(r.description)
          const href = trace ? archiveHref({ q: trace }) : allHref
          return (
            <li key={r.id}>
              <Link href={href} title="Open this payment in the Archive"
                className="flex items-center gap-4 px-4 py-2 text-xs hover:bg-indigo-50/50 transition-colors">
                <span className="w-20 shrink-0 tabular-nums text-slate-600">{isoToUS(r.postingDate)}</span>
                <span className="w-36 shrink-0 truncate text-slate-700">{r.insuranceName || '—'}</span>
                <span className="w-24 shrink-0 text-right tabular-nums font-semibold text-slate-900">{fmtMoney(r.amount)}</span>
                <span className="flex-1 min-w-0 truncate font-mono text-slate-500" title={r.description}>{r.description}</span>
                <span className="shrink-0 text-indigo-400">→</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
