'use client'

import { useEffect, useMemo, useState } from 'react'
import Select from '@/components/Select'
import ViewHeader, { LoadingBlocks } from '@/components/ViewHeader'
import { supabase } from '@/lib/supabase'
import { shortLocation } from '@/lib/constants'
import { periodLabel, currentPeriod } from '@/lib/dentrixReports'
import { useAnalysisGoto } from '@/lib/analysisNav'

// ─────────────────────────────────────────────────────────────────────────────
// Hygiene production — what the hygiene chairs produce, and per hour.
//
//   Production: the Dentrix production report, for providers whose specialty
//               is Hygienist (from the schedule report). Temp and office
//               "providers" are shown apart, since they aren't a person.
//   Hours:      estimated from the schedule report only (the app's Hygiene
//               Utilization entries are deliberately not used here).
// ─────────────────────────────────────────────────────────────────────────────

const money = (n) => `$${Math.round(n || 0).toLocaleString('en-US')}`
const pct = (a, b) => (b ? (a / b) * 100 : null)
const fmtPct = (v) => (v == null ? '—' : `${Math.round(v)}%`)
const TEMP = /^(temp\b|hygienist,|rdh |m rdh)|\btemp$|rdh, temp|temp, rdh/i
const OFFICE_ENTITY = /^(valley view dental|dentique|alora|edc of)/i

export default function HygieneView() {
  const [state, setState] = useState({ status: 'loading' })
  const [period, setPeriod] = useState('')
  const [readAt, setReadAt] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState((st) => (st.status === 'ready' ? { ...st, refreshing: true } : { status: 'loading' }))
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch('/api/reports?only=production,schedule', { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) return setState({ status: 'error', error: json.error || `HTTP ${res.status}` })
        const prod = json.files?.find((f) => f.parsed?.kind === 'production')?.parsed
        const sched = json.files?.find((f) => f.parsed?.kind === 'schedule')?.parsed
        if (!prod) return setState({ status: 'error', error: 'No production report in the reports folder.' })
        setState({ status: 'ready', rows: prod.rows, specialty: sched?.specialty || {}, schedMonths: sched?.months || {} })
        setReadAt(`Reports read at ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`)
      } catch (e) {
        if (!cancelled) setState({ status: 'error', error: e?.message || 'network error' })
      }
    })()
    return () => { cancelled = true }
  }, [reload])

  const isHygiene = (p) => (state.specialty?.[p] === 'Hygienist') || TEMP.test(p) || /\brdh\b|hygienist/i.test(p)
  const periods = useMemo(() => (state.rows ? [...new Set(state.rows.map((r) => r.period))].filter((p) => /^\d{4}-\d{2}$/.test(p)).sort() : []), [state.rows])
  const thisMonth = currentPeriod()
  useAnalysisGoto('hygiene', (g) => { if (g.month && periods.includes(g.month)) setPeriod(g.month) }, periods.length > 0)
  useEffect(() => {
    if (period || !periods.length) return
    setPeriod(periods.filter((p) => p < thisMonth).pop() || periods[periods.length - 1])
  }, [periods])

  const header = (extra = {}) => (
    <ViewHeader
      title="Hygiene production"
      subtitle="What the hygiene chairs produce, by hygienist and by office."
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
  if (state.status === 'error') return <div className="space-y-4">{header({ errors: [`Couldn\u2019t load hygiene production: ${state.error}`] })}</div>
  if (!period) return null

  // ── This month's hygiene production, by office and by hygienist ──
  const rows = state.rows.filter((r) => r.period === period && isHygiene(r.provider))
  const allRows = state.rows.filter((r) => r.period === period)
  const kind = (p) => (TEMP.test(p) ? 'temp' : OFFICE_ENTITY.test(p) ? 'office' : 'person')
  const byOffice = {}
  for (const r of rows) {
    const o = (byOffice[r.location] ||= { gross: 0, net: 0, person: 0, temp: 0, office: 0 })
    o.gross += r.gross; o.net += r.net
    o[kind(r.provider)] += r.gross
  }
  const offices = Object.entries(byOffice).map(([loc, v]) => ({ loc, ...v })).filter((o) => o.gross > 0).sort((a, b) => b.gross - a.gross)
  const T = offices.reduce((a, o) => ({ gross: a.gross + o.gross, net: a.net + o.net, person: a.person + o.person, temp: a.temp + o.temp, office: a.office + o.office }),
    { gross: 0, net: 0, person: 0, temp: 0, office: 0 })
  const allGross = allRows.reduce((s, r) => s + r.gross, 0)

  const people = {}
  for (const r of rows) {
    const k = kind(r.provider)
    // Temps keep their own Dentrix name ("Temp, RDH", "Hygienist, Temp"…);
    // only bookings under an office name are grouped together.
    const name = k === 'office' ? 'Booked under the office' : r.provider
    const p = (people[name] ||= { name, kind: k, gross: 0, net: 0, offices: {} })
    p.gross += r.gross; p.net += r.net; p.offices[r.location] = (p.offices[r.location] || 0) + r.gross
  }
  const list = Object.values(people).filter((p) => Math.abs(p.gross) >= 1)
    // One leaderboard by production; temps and office bookings keep their yellow mark.
    .sort((a, b) => b.gross - a.gross)
  const maxGross = Math.max(1, ...list.map((p) => p.gross))

  // Hours per hygienist, estimated from the schedule report: for each day they
  // had appointments, first to last appointment plus one hour. Most cleanings
  // are booked under the dentist, so a hygienist's schedule hours can be far
  // below the hours they worked; a per-hour figure is only shown when the
  // schedule has a reasonable share of their days.
  const sh = state.schedMonths?.[period]?.hygiene || {}
  for (const p of list) {
    const h = p.kind === 'office' ? null : sh[p.name]
    p.days = h?.days || 0
    p.hours = h?.hours || 0
    p.visits = h?.visits || 0
    // Per day needs only the days, which hold up even when most visits are
    // booked under the dentist: one patient under their name marks the day.
    // Temps and office bookings mix several people, so neither rate applies.
    p.perDay = p.kind === 'person' && p.days >= 3 ? p.gross / p.days : null
  }

  const named = list.filter((p) => p.kind === 'person').length
  return (
    <div className="space-y-4">
      {header()}

      {/* ── Headline ── */}
      <Box>
        <div className="grid md:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))] gap-6 items-end">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Hygiene production {'·'} {periodLabel(period)}</p>
            <p className="text-5xl font-bold tabular-nums text-sky-700 mt-1">{money(T.gross)}</p>
            <p className="text-sm text-slate-600 mt-1">{fmtPct(pct(T.gross, allGross))} of all production {'·'} {money(T.net)} after write-offs</p>
          </div>
          <Figure label="Credited to hygienists" value={money(T.person)} note={`${named} hygienist${named === 1 ? '' : 's'} with production this month`} />
          <Figure label="Not tied to a hygienist" value={money(T.temp + T.office)} tone={T.temp + T.office > 0 ? 'text-amber-600' : 'text-slate-900'}
            note="booked under a temp or the office, so it can't be credited to a person" />
        </div>
      </Box>

      {/* ── Hygienists ── */}
      <Box title="By hygienist" sub="Production credited to each hygienist in Dentrix this month: gross (full fees, the work done) and net (after insurance write-offs and discounts). Ranked by gross; write-offs mostly reflect the office's insurance mix, not the hygienist.">
        <div className="hidden md:grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_170px_120px_90px] gap-4 pb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          <span>Hygienist</span><span /><span className="text-right">Gross {'\u00b7'} net</span><span className="text-right">Days (schedule)</span><span className="text-right">Per day</span>
        </div>
        <div className="divide-y divide-slate-100">
          {list.map((p) => (
            <div key={p.name} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_170px_120px_90px] gap-4 py-2.5 items-center">
              <span className="min-w-0">
                <span className={`block text-sm font-semibold truncate ${p.kind === 'person' ? 'text-slate-800' : 'text-amber-700'}`}>{p.name}</span>
                <span className="block text-[11px] text-slate-400 truncate">
                  {p.kind === 'temp' && <span className="font-semibold text-amber-600">Temp hygienist {'·'} </span>}
                  {Object.keys(p.offices).map(shortLocation).join(', ')}
                </span>
              </span>
              <span className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <span className={`block h-full rounded-full ${p.kind === 'person' ? 'bg-sky-500' : 'bg-amber-400'}`} style={{ width: `${Math.max(2, (p.gross / maxGross) * 100)}%` }} />
              </span>
              <span className="text-right">
                <span className="block text-sm font-bold tabular-nums text-slate-800">{money(p.gross)}</span>
                <span className="block text-[10px] text-slate-500 tabular-nums">net {money(p.net)} {'\u00b7'} <span className={pct(p.gross - p.net, p.gross) >= 45 ? 'text-amber-600 font-semibold' : ''}>{fmtPct(pct(p.gross - p.net, p.gross))} written off</span></span>
              </span>
              <span className="text-right">
                <span className="block text-sm tabular-nums text-slate-700">{p.days ? `${p.days} day${p.days === 1 ? '' : 's'}` : '\u2014'}</span>
                <span className="block text-[10px] text-slate-400 tabular-nums">{p.days ? `${Math.round(p.hours)} h on the schedule` : 'not on the schedule'}</span>
              </span>
              <span className="text-right">
                {p.perDay ? (
                  <span className="block text-sm font-bold tabular-nums text-slate-800">{money(p.perDay)}</span>
                ) : <>
                  <span className="block text-sm font-bold tabular-nums text-slate-300">{'\u2014'}</span>
                  <span className="block text-[10px] text-slate-400">{p.kind !== 'person' ? 'several people' : p.days ? `only ${p.days} day${p.days === 1 ? '' : 's'}` : 'not on the schedule'}</span>
                </>}
              </span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-3">
          <b className="font-semibold text-slate-500">Per day</b> = production {'\u00f7'} days with at least one of their patients on the schedule (shown from 3 days).
          Days hold up even though most cleanings are booked under the dentist{'\u2019'}s name; hours don{'\u2019'}t, so they are only a rough guide.
          Temps and office bookings mix several people, so they get no rate. Timeclock hours would make this exact.
        </p>
      </Box>

      {/* ── Offices ── */}
      <Box title="By office" sub="Hygiene production at each office, and how much of it is credited to a hygienist">
        <div className="hidden md:grid grid-cols-[minmax(0,1fr)_repeat(4,minmax(0,120px))] gap-4 pb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          <span>Office</span><span className="text-right">Production</span><span className="text-right">Share</span><span className="text-right">Hygienists</span><span className="text-right">Temp / office</span>
        </div>
        <div className="divide-y divide-slate-100">
          {offices.map((o) => (
            <div key={o.loc} className="grid grid-cols-2 md:grid-cols-[minmax(0,1fr)_repeat(4,minmax(0,120px))] gap-x-4 gap-y-1 py-2.5 text-sm items-center">
              <span className="font-semibold text-slate-800 col-span-2 md:col-span-1">{shortLocation(o.loc)}</span>
              <span className="tabular-nums md:text-right font-bold text-sky-700">{money(o.gross)}</span>
              <span className="tabular-nums md:text-right text-slate-600">{fmtPct(pct(o.gross, T.gross))}</span>
              <span className="tabular-nums md:text-right text-slate-600">{money(o.person)}</span>
              <span className={`tabular-nums md:text-right ${o.temp + o.office > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{money(o.temp + o.office)}</span>
            </div>
          ))}
        </div>
      </Box>

    </div>
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
