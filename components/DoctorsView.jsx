'use client'

import { useEffect, useMemo, useState } from 'react'
import Select from '@/components/Select'
import ViewHeader, { LoadingBlocks } from '@/components/ViewHeader'
import { supabase } from '@/lib/supabase'
import { shortLocation } from '@/lib/constants'
import { periodLabel, currentPeriod } from '@/lib/dentrixReports'
import { useAnalysisGoto } from '@/lib/analysisNav'
import { doctorMonth, DENTIQUE } from '@/lib/doctorHours'

// ─────────────────────────────────────────────────────────────────────────────
// Doctor production — what each doctor produced, and per hour worked.
//
//   Production: the Dentrix production report, for providers who aren't
//               hygienists, temps or the office.
//   Hours:      the Doctor Hours Google Sheet (read live), matched to the
//               Dentrix doctor by name and office.
// Per hour = all the doctor's production ÷ all their hours, whatever office.
// ─────────────────────────────────────────────────────────────────────────────

const money = (n) => `$${Math.round(n || 0).toLocaleString('en-US')}`
const pct = (a, b) => (b ? (a / b) * 100 : null)
const fmtPct = (v) => (v == null ? '—' : `${Math.round(v)}%`)
const hrs = (n) => `${(Math.round((n || 0) * 10) / 10).toLocaleString('en-US')} h`
const officeName = (o) => (o === DENTIQUE ? 'Dentique' : shortLocation(o))
const MIN_DAYS = 3   // a rate from fewer days in the sheet is shown but not trusted

async function getJson(url) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(url, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

export default function DoctorsView() {
  const [state, setState] = useState({ status: 'loading' })
  const [period, setPeriod] = useState('')
  const [reload, setReload] = useState(0)
  const [sort, setSort] = useState({ key: 'gross', dir: -1 })

  useEffect(() => {
    let cancelled = false
    setState((st) => (st.status === 'ready' ? { ...st, refreshing: true } : { status: 'loading' }))
    ;(async () => {
      const [rep, hours] = await Promise.allSettled([
        getJson('/api/reports?only=production,schedule'),
        getJson(`/api/doctor-hours${reload ? '?refresh=1' : ''}`),
      ])
      if (cancelled) return
      if (rep.status === 'rejected') return setState({ status: 'error', error: rep.reason?.message })
      const prod = rep.value.files?.find((f) => f.parsed?.kind === 'production')?.parsed
      const sched = rep.value.files?.find((f) => f.parsed?.kind === 'schedule')?.parsed
      if (!prod) return setState({ status: 'error', error: 'No production report uploaded yet.' })
      setState({
        status: 'ready', rows: prod.rows, specialty: sched?.specialty || {},
        hours: hours.status === 'fulfilled' ? hours.value : null,
        hoursError: hours.status === 'rejected' ? hours.reason?.message : hours.value?.stale || null,
      })
    })()
    return () => { cancelled = true }
  }, [reload])

  const periods = useMemo(() => (state.rows ? [...new Set(state.rows.map((r) => r.period))].filter((p) => /^\d{4}-\d{2}$/.test(p)).sort() : []), [state.rows])
  const thisMonth = currentPeriod()
  const [focusDoc, setFocusDoc] = useState(null)   // { q, at } from a chat link
  useAnalysisGoto('doctors', (g) => {
    if (g.month && periods.includes(g.month)) setPeriod(g.month)
    if (g.provider) setFocusDoc({ q: String(g.provider).toLowerCase(), at: Date.now() })
  }, periods.length > 0)
  useEffect(() => {
    if (!focusDoc) return
    const t = setTimeout(() => {
      const rows = [...document.querySelectorAll('[data-doctor]')]
      const hit = rows.find((r) => r.dataset.doctor.toLowerCase() === focusDoc.q) || rows.find((r) => r.dataset.doctor.toLowerCase().includes(focusDoc.q))
      hit?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 350)
    return () => clearTimeout(t)
  }, [focusDoc?.at, period])
  useEffect(() => {
    if (period || !periods.length) return
    setPeriod(periods.filter((p) => p < thisMonth).pop() || periods[periods.length - 1])
  }, [periods])

  const readAt = state.hours?.readAt ? `Hours sheet read at ${new Date(state.hours.readAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''
  const header = (extra = {}) => (
    <ViewHeader
      title="Doctor production"
      subtitle="What each doctor produced, and per hour in the Doctor Hours sheet."
      controls={periods.length > 0 && (
        <Select value={period} onChange={(v) => v && setPeriod(v)} placeholder={null}
          options={[...periods].reverse().map((p) => ({ value: p, label: periodLabel(p) + (p === thisMonth ? ' (to date)' : '') }))} />
      )}
      busy={state.status === 'loading' || state.refreshing}
      onRefresh={() => setReload((n) => n + 1)}
      status={readAt}
      {...extra}
    />
  )
  if (state.status === 'loading') return <div className="space-y-4">{header()}<LoadingBlocks rows={3} /></div>
  if (state.status === 'error') return <div className="space-y-4">{header({ errors: [`Couldn’t load doctor production: ${state.error}`] })}</div>
  if (!period) return null

  const hoursMonth = state.hours?.months?.[period] || []
  // Hours that couldn't be read aren't the same as hours that aren't in the sheet.
  const noRead = !state.hours
  const missing = noRead ? 'sheet not read' : 'not in the sheet'
  const noSheetMonth = !!state.hours && !hoursMonth.length
  const { list, unmatched } = doctorMonth(period, state.rows, state.specialty, hoursMonth)

  // ── Totals ──
  const T = list.reduce((a, d) => ({
    gross: a.gross + d.gross, net: a.net + d.net, hours: a.hours + d.hours,
    grossWithHours: a.grossWithHours + (d.gross - d.grossNoHours), noHours: a.noHours + d.grossNoHours,
  }), { gross: 0, net: 0, hours: 0, grossWithHours: 0, noHours: 0 })
  const allGross = state.rows.filter((r) => r.period === period).reduce((s, r) => s + r.gross, 0)
  const withHours = list.filter((d) => d.hours > 0).length

  // ── By office ──
  const byOffice = {}
  for (const d of list) for (const [o, v] of Object.entries(d.offices)) {
    const x = (byOffice[o] ||= { gross: 0, net: 0, hours: 0, grossWithHours: 0, doctors: 0 })
    x.gross += v.gross; x.net += v.net; x.hours += v.hours
    if (v.hours > 0) x.grossWithHours += v.gross
    if (Math.abs(v.gross) >= 1) x.doctors += 1
  }
  const offices = Object.entries(byOffice).map(([o, v]) => ({ o, ...v, perHour: v.hours >= 1 ? v.grossWithHours / v.hours : null }))
    .filter((x) => Math.abs(x.gross) >= 1 || x.hours > 0).sort((a, b) => b.gross - a.gross)

  // ── Sort ──
  const val = (d) => (sort.key === 'name' ? d.name : sort.key === 'perHour' || sort.key === 'perDay'
    ? (d.days >= MIN_DAYS ? d[sort.key] : null) : d[sort.key])
  const sorted = [...list].sort((a, b) => {
    const x = val(a), y = val(b)
    if (x == null && y == null) return b.gross - a.gross
    if (x == null) return 1
    if (y == null) return -1
    return typeof x === 'string' ? x.localeCompare(y) * -sort.dir : (x - y) * sort.dir
  })
  const maxGross = Math.max(1, ...list.map((d) => d.gross))
  const SortHead = ({ k, children, className = '' }) => (
    <button type="button" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : -1 }))}
      className={`inline-flex items-center gap-1 uppercase tracking-widest hover:text-slate-600 ${sort.key === k ? 'text-slate-700' : ''} ${className}`}>
      {children}<span className="text-[9px]">{sort.key === k ? (sort.dir < 0 ? '▼' : '▲') : '↕'}</span>
    </button>
  )
  const HEAD = 'hidden md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_170px_120px_100px_100px]'
  const ROW = 'grid grid-cols-2 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_170px_120px_100px_100px]'

  const notes = []
  if (noSheetMonth) notes.push(`The Doctor Hours sheet has no hours for ${periodLabel(period)} (it is read from 2025 on), so there are no per-hour figures this month.`)
  if (period === thisMonth) notes.push(`${periodLabel(period)} is still going: production and hours are to date.`)
  const errors = state.hoursError ? [`Couldn’t read the Doctor Hours sheet: ${state.hoursError}${state.hours ? ' (showing the last copy read)' : ' — try Refresh in a moment.'}`] : []

  return (
    <div className="space-y-4">
      {header({ notes, errors })}

      {/* ── Headline ── */}
      <Box>
        <div className="grid md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] gap-6 items-end">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Doctor production {'·'} {periodLabel(period)}</p>
            <p className="text-5xl font-bold tabular-nums text-indigo-700 mt-1">{money(T.gross)}</p>
            <p className="text-sm text-slate-600 mt-1">{fmtPct(pct(T.gross, allGross))} of all production {'·'} {money(T.net)} after write-offs</p>
          </div>
          <Figure label="Per doctor hour" value={T.hours >= 1 ? money(T.grossWithHours / T.hours) : '—'}
            note={T.hours >= 1 ? `gross, across ${withHours} doctor${withHours === 1 ? '' : 's'} with hours` : noRead ? 'the hours sheet couldn’t be read' : 'no hours in the sheet'} />
          <Figure label="Hours in the sheet" value={T.hours >= 1 ? hrs(T.hours) : '—'} note="doctor hours logged this month" />
          <Figure label="No hours in the sheet" value={noRead ? '—' : money(T.noHours)} tone={!noRead && T.noHours > 0 ? 'text-amber-600' : 'text-slate-900'}
            note={noRead ? 'the hours sheet couldn’t be read' : 'production by doctors with no hours in the sheet this month'} />
        </div>
      </Box>

      {/* ── Doctors ── */}
      <Box title="By doctor" sub="Production credited to each doctor in Dentrix this month, gross (full fees) and net (after insurance write-offs). Hours are from the Doctor Hours sheet. Click a column to sort.">
        <div className={`${HEAD} gap-4 pb-2 text-[10px] font-bold text-slate-400`}>
          <SortHead k="name">Doctor</SortHead><span />
          <SortHead k="gross" className="justify-end">Gross {'·'} net</SortHead>
          <SortHead k="hours" className="justify-end">Hours</SortHead>
          <SortHead k="perHour" className="justify-end">Per hour</SortHead>
          <SortHead k="perDay" className="justify-end">Per day</SortHead>
        </div>
        <div className="divide-y divide-slate-100">
          {sorted.map((d) => {
            const few = d.hours > 0 && d.days < MIN_DAYS
            return (
              <div key={d.name} data-doctor={d.name} className={`${ROW} gap-x-4 gap-y-1 py-2.5 items-center ${focusDoc && d.name.toLowerCase().includes(focusDoc.q) ? 'rounded-xl ring-2 ring-indigo-300 ring-offset-2 bg-indigo-50/40' : ''}`}>
                <span className="min-w-0 col-span-2 md:col-span-1">
                  <span className="block text-sm font-semibold truncate text-slate-800">{d.name}</span>
                  <span className="block text-[11px] text-slate-400 truncate">
                    {Object.entries(d.offices).filter(([, v]) => Math.abs(v.gross) >= 1 || v.hours > 0)
                      .sort((a, b) => b[1].gross - a[1].gross).map(([o]) => officeName(o)).join(', ')}
                  </span>
                </span>
                <span className="hidden md:block h-2 rounded-full bg-slate-100 overflow-hidden">
                  <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(2, (Math.max(0, d.gross) / maxGross) * 100)}%` }} />
                </span>
                <span className="md:text-right">
                  <span className="block text-sm font-bold tabular-nums text-slate-800">{money(d.gross)}</span>
                  <span className="block text-[10px] text-slate-500 tabular-nums">net {money(d.net)} {'·'} <span className={pct(d.gross - d.net, d.gross) >= 45 ? 'text-amber-600 font-semibold' : ''}>{fmtPct(pct(d.gross - d.net, d.gross))} written off</span></span>
                </span>
                <span className="md:text-right">
                  <span className="block text-sm tabular-nums text-slate-700">{d.hours > 0 ? hrs(d.hours) : '—'}</span>
                  <span className="block text-[10px] text-slate-400 tabular-nums">{d.hours > 0 ? `${d.days} day${d.days === 1 ? '' : 's'}` : missing}</span>
                </span>
                <Rate v={d.perHour} few={few} days={d.days} none={!d.hours} />
                <Rate v={d.perDay} few={few} days={d.days} none={!d.hours} />
              </div>
            )
          })}
        </div>
        <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
          <b className="font-semibold text-slate-500">Per hour</b> = all the doctor{'’'}s production this month {'÷'} all their hours in the sheet, whichever offices they worked at.
          <b className="font-semibold text-slate-500"> Per day</b> = the same production {'÷'} days worked (a day at two offices counts once).
          Rates from fewer than {MIN_DAYS} days are greyed and not sorted, since one day of a big case reads as a huge hourly rate.
          Production is what Dentrix credits to the doctor, so it includes exams and any hygiene work entered under the doctor{'’'}s name. The sheet has one Dentique column, so Lemont and Downers Grove are counted together.
        </p>
      </Box>

      {/* ── Offices ── */}
      <Box title="By office" sub="Doctor production and doctor hours at each office">
        <div className="hidden md:grid grid-cols-[minmax(0,1fr)_repeat(4,minmax(0,120px))] gap-4 pb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          <span>Office</span><span className="text-right">Production</span><span className="text-right">Doctors</span><span className="text-right">Hours</span><span className="text-right">Per hour</span>
        </div>
        <div className="divide-y divide-slate-100">
          {offices.map((x) => (
            <div key={x.o} className="grid grid-cols-2 md:grid-cols-[minmax(0,1fr)_repeat(4,minmax(0,120px))] gap-x-4 gap-y-1 py-2.5 text-sm items-center">
              <span className="font-semibold text-slate-800 col-span-2 md:col-span-1">{officeName(x.o)}</span>
              <span className="tabular-nums md:text-right font-bold text-indigo-700">{money(x.gross)}</span>
              <span className="tabular-nums md:text-right text-slate-600">{x.doctors}</span>
              <span className="tabular-nums md:text-right text-slate-600">{x.hours >= 1 ? hrs(x.hours) : '—'}</span>
              <span className="tabular-nums md:text-right text-slate-800 font-semibold">{x.perHour ? money(x.perHour) : <span className="text-slate-300">{'—'}</span>}</span>
            </div>
          ))}
        </div>
      </Box>

      {unmatched.length > 0 && (
        <Box title="Hours not matched to a doctor" sub="Names in the sheet that don't clearly match one Dentrix doctor at that office, so their hours aren't counted above">
          <div className="flex flex-wrap gap-2">
            {unmatched.map((u, i) => (
              <span key={i} className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-2.5 py-1">
                {u.doctor} {'·'} {officeName(u.office)} {'·'} {hrs(u.hours)}
              </span>
            ))}
          </div>
        </Box>
      )}
    </div>
  )
}

function Rate({ v, few, days, none, extra }) {
  if (none || v == null) return <span className="md:text-right"><span className="block text-sm font-bold tabular-nums text-slate-300">{'—'}</span><span className="block text-[10px] text-slate-400">no hours</span></span>
  return (
    <span className="md:text-right">
      <span className={`block text-sm font-bold tabular-nums ${few ? 'text-slate-400' : 'text-slate-800'}`}>{money(v)}</span>
      {few
        ? <span className="block text-[10px] text-amber-600">only {days} day{days === 1 ? '' : 's'}</span>
        : extra && <span className="block text-[10px] text-slate-400 tabular-nums">{extra}</span>}
    </span>
  )
}

function Box({ title, sub, children }) {
  return (
    <div className="glass-card rounded-2xl px-5 py-4">
      {title && (
        <div className="mb-3">
          <p className="text-sm font-bold text-slate-800">{title}</p>
          {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
        </div>
      )}
      {children}
    </div>
  )
}

function Figure({ label, value, note, tone = 'text-slate-900' }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${tone}`}>{value}</p>
      <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{note}</p>
    </div>
  )
}
