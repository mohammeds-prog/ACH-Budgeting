'use client'

import { useEffect, useMemo, useState } from 'react'
import Select from '@/components/Select'
import { supabase } from '@/lib/supabase'
import ViewHeader, { LoadingBlocks } from '@/components/ViewHeader'
import { shortLocation } from '@/lib/constants'
import { periodLabel } from '@/lib/dentrixReports'

// ─────────────────────────────────────────────────────────────────────────────
// Summary — the owner's first screen: are we OK, what's off, who needs to act.
// A few numbers for the last complete month, each against last month and the
// same month last year (and a target where the industry has one); what needs
// attention; and the six offices side by side, with the outliers marked.
// The Money, Retention and Hygiene views are the "why" behind each number.
// ─────────────────────────────────────────────────────────────────────────────

const money = (n) => `$${Math.round(n || 0).toLocaleString('en-US')}`
const moneyShort = (n) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `$${Math.round(n / 1e3).toLocaleString('en-US')}k` : money(n))
const pctText = (v) => (v == null ? '—' : `${Math.round(v)}%`)


export default function OwnerSummary({ onGo }) {
  const [state, setState] = useState({ status: 'loading' })
  const [reload, setReload] = useState(0)
  // The period: a preset, one month ('m|2026-11'), or a custom month range.
  const [pick, setPick] = useState('last')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [months, setMonths] = useState([])          // every month with data, from the first answer
  const [lastComplete, setLastComplete] = useState('')

  const latest = months[months.length - 1] || ''
  const presets = useMemo(() => {
    if (!lastComplete) return []
    const back = (p, n) => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7) }
    const list = [
      { value: 'last', label: `Last complete month \u00b7 ${periodLabel(lastComplete)}`, from: lastComplete, to: lastComplete },
      ...(latest > lastComplete ? [{ value: 'now', label: `This month so far \u00b7 ${periodLabel(latest)}`, from: latest, to: latest }] : []),
      { value: 'q', label: 'Last 3 complete months', from: back(lastComplete, 2), to: lastComplete },
      { value: 'ytd', label: `Year to date \u00b7 ${latest.slice(0, 4)}`, from: `${latest.slice(0, 4)}-01`, to: latest },
      { value: '12', label: 'Last 12 complete months', from: back(lastComplete, 11), to: lastComplete },
    ]
    return list.filter((x) => months.includes(x.from) || x.value === 'last')
  }, [lastComplete, latest, months])
  const range = pick.startsWith('m|') ? { from: pick.slice(2), to: pick.slice(2) }
    : pick === 'custom' ? (custom.from && custom.to ? { from: custom.from <= custom.to ? custom.from : custom.to, to: custom.from <= custom.to ? custom.to : custom.from } : null)
    : pick === 'last' ? null
    : presets.find((x) => x.value === pick) || null

  useEffect(() => {
    if (pick === 'custom' && !range) return
    let cancelled = false
    setState((st) => (st.status === 'ready' ? { ...st, refreshing: true } : { status: 'loading' }))
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const q = range ? `?from=${range.from}&to=${range.to}` : ''
        const res = await fetch(`/api/summary${q}`, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) return setState({ status: 'error', error: json.error || `HTTP ${res.status}` })
        if (json.months?.length) setMonths(json.months)
        if (json.lastComplete) setLastComplete(json.lastComplete)
        setState({ status: 'ready', data: json, readAt: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) })
      } catch (e) {
        if (!cancelled) setState({ status: 'error', error: e?.message || 'network error' })
      }
    })()
    return () => { cancelled = true }
  }, [reload, range?.from, range?.to])

  const d = state.data
  const periodName = (from, to) => (from === to ? periodLabel(from) : `${periodLabel(from)} \u2013 ${periodLabel(to)}`)
  const monthOptions = [...months].reverse().map((p) => ({ value: p, label: periodLabel(p) + (p === latest && latest > lastComplete ? ' (so far)' : '') }))
  const controls = months.length > 0 && (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={pick} onChange={(v) => v && setPick(v)} placeholder={null} wide
        options={[
          ...presets.map(({ value, label }) => ({ value, label })),
          ...monthOptions.map((o) => ({ value: `m|${o.value}`, label: o.label })),
          { value: 'custom', label: 'Custom months\u2026' },
        ]} />
      {pick === 'custom' && (
        <>
          <Select value={custom.from} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} placeholder="From" options={monthOptions} />
          <span className="text-xs text-slate-400">to</span>
          <Select value={custom.to} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} placeholder="To" options={monthOptions} />
        </>
      )}
    </div>
  )
  const header = (extra = {}) => (
    <ViewHeader
      title={d ? `${periodName(d.from, d.to)}${d.partial ? ' so far' : ''} at a glance` : 'At a glance'}
      controls={controls}
      subtitle="Are we on track? Click any number to see why."
      busy={state.status === 'loading' || state.refreshing}
      onRefresh={() => setReload((n) => n + 1)}
      status={[state.readAt ? `Reports read at ${state.readAt}` : '', d?.partial ? `${periodLabel(d.to)} runs to ${d.asOf} (${Math.round(d.done * 100)}% of the month) \u2014 arrows compare its pace` : ''].filter(Boolean).join(' \u00b7 ')}
      {...extra}
    />
  )
  if (state.status === 'loading') return <div className="space-y-4">{header()}<LoadingBlocks rows={3} /></div>
  if (state.status === 'error') return <div className="space-y-4">{header({ errors: [`Couldn’t load the summary: ${state.error}`] })}</div>

  const prevName = d.span === 1 ? periodLabel(d.prevFrom).split(' ')[0] : `prior ${d.span} months`
  const lyName = d.span === 1 ? periodLabel(d.lastYearFrom) : 'a year earlier'
  if (pick === 'custom' && !range) return <div className="space-y-4">{header()}<p className="text-sm text-slate-500 px-1">Pick the first and last month.</p></div>

  const tiles = Object.fromEntries(d.kpis.map((k) => [k.key, k]))
  const moneyTiles = ['gross', 'net', 'collections', 'rate'].map((k) => tiles[k]).filter(Boolean)
  const patientTiles = ['kept', 'new', 'hygiene'].map((k) => tiles[k]).filter(Boolean)
  const off = d.kpis.filter((k) => k.status === 'bad').length
  const watch = d.kpis.filter((k) => k.status === 'ok').length
  const good = d.kpis.filter((k) => k.status === 'good').length
  const maxNet = Math.max(1, ...d.offices.map((o) => o.net))

  return (
    <div className="space-y-4">
      {header()}

      {/* ── The scorecards, first ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-7 gap-2.5">
        {[...moneyTiles, ...patientTiles].map((k) => <Tile key={k.key} k={k} prevName={prevName} lyName={lyName} onGo={onGo} />)}
      </div>

      {/* ── Insurance A/R by age, right under the scorecards ── */}
      {d.arAging && <ArAging a={d.arAging} onGo={onGo} over90={tiles.over90} />}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
        {/* ── Offices side by side ── */}
        <section className="rounded-2xl bg-white border border-slate-200/80 shadow-sm px-5 py-4 min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Offices side by side</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{periodName(d.from, d.to)}{d.partial ? ' (so far)' : ''} {'·'} red = 5+ points worse than the group</p>
            </div>
          </div>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[13px] min-w-[820px]">
              <thead>
                <tr className="text-right align-bottom">
                  <Th left>Office</Th>
                  <Th left wide sub="what can be collected">Net production</Th>
                  <Th sub="money received">Collections</Th>
                  <Th sub="collections ÷ net">Collection rate</Th>
                  <Th sub="paid for this period's own work">Paid same month</Th>
                  <Th sub="of open insurance $">A/R over 120 days</Th>
                  <Th sub="came back or booked">Patients kept</Th>
                  <Th sub="first visits" last>New patients</Th>
                </tr>
              </thead>
              <tbody>
                {d.offices.map((o) => (
                  <tr key={o.name} className="text-right tabular-nums border-t border-slate-100">
                    <td className="text-left py-2 pl-1 font-semibold text-slate-900 whitespace-nowrap">{shortLocation(o.name)}</td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2.5">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(2, (o.net / maxNet) * 100)}%` }} />
                        </div>
                        <span className="w-20 text-right text-slate-900 font-medium">{money(o.net)}</span>
                      </div>
                    </td>
                    <td className="py-2 text-slate-600">{money(o.collections)}</td>
                    <Pct v={o.rate} flag={o.flags.rate} />
                    <Pct v={o.sameMonth} flag={o.flags.sameMonth} />
                    <Pct v={o.over120} flag={o.flags.over120} />
                    <Pct v={o.kept} flag={o.flags.kept} />
                    <td className="py-2 pr-1 text-slate-600">{o.newPatients.toLocaleString('en-US')}</td>
                  </tr>
                ))}
                <tr className="text-right tabular-nums border-t-2 border-slate-200 text-slate-900 font-semibold">
                  <td className="text-left py-2 pl-1">Group</td>
                  <td className="py-2 pr-4"><span className="block text-right">{money(d.offices.reduce((s, o) => s + o.net, 0))}</span></td>
                  <td className="py-2">{money(d.offices.reduce((s, o) => s + o.collections, 0))}</td>
                  <td className="py-2 px-2"><span className="inline-block w-14 text-right px-1.5">{pctText(d.groupAvg.rate)}</span></td>
                  <td className="py-2 px-2"><span className="inline-block w-14 text-right px-1.5">{pctText(d.groupAvg.sameMonth)}</span></td>
                  <td className="py-2 px-2"><span className="inline-block w-14 text-right px-1.5">{pctText(d.groupAvg.over120)}</span></td>
                  <td className="py-2 px-2"><span className="inline-block w-14 text-right px-1.5">{pctText(d.groupAvg.kept)}</span></td>
                  <td className="py-2 pr-1">{d.offices.reduce((s, o) => s + o.newPatients, 0).toLocaleString('en-US')}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[10.5px] text-slate-400 mt-3 leading-relaxed">
            <b className="font-semibold text-slate-500">Paid same month</b> {'—'} of the money collected, the share that paid for this period{'’'}s own work; the rest paid older work catching up, so lower means slower payment.
            {' '}<b className="font-semibold text-slate-500">Patients kept</b> {'—'} of the patients seen, the share who came back for a completed visit or have an appointment booked.
            {' '}<b className="font-semibold text-slate-500">A/R over 120 days</b> {'—'} share of the office{'’'}s open insurance dollars that are 120+ days old.
          </p>
        </section>

        {/* ── In short + needs attention ── */}
        <section className="rounded-2xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="px-4 pt-3.5 pb-3 border-b border-slate-100">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-indigo-600">In short</p>
              <div className="flex gap-1">
                {off > 0 && <Badge tone="bad">{off} off</Badge>}
                {watch > 0 && <Badge tone="ok">{watch} watch</Badge>}
                {good > 0 && <Badge tone="good">{good} on target</Badge>}
              </div>
            </div>
            <Verdict d={d} prevName={prevName} />
          </div>
          <p className="px-4 pt-3 text-[11px] font-semibold text-slate-500">Needs attention</p>
          {d.attention.length ? (
            <ol className="divide-y divide-slate-100">
              {d.attention.map((a, i) => (
                <li key={i}>
                  <button onClick={() => onGo?.(a.view)} className="w-full flex items-stretch gap-2.5 px-4 py-2.5 text-left hover:bg-slate-50 group">
                    <span className={`w-1 rounded-full shrink-0 ${a.tone === 'bad' ? 'bg-red-500' : 'bg-amber-400'}`} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12.5px] text-slate-800 leading-snug">{a.text}</span>
                      <span className="block text-[10.5px] text-slate-400 mt-0.5 group-hover:text-indigo-600">
                        {a.view === 'retention' ? 'Patient retention' : a.view === 'hygiene' ? 'Hygiene' : 'Money'} {'→'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : <p className="px-4 py-5 text-sm text-slate-500">Nothing stands out this period.</p>}
        </section>
      </div>

      <p className="text-[10.5px] text-slate-400 px-1 leading-relaxed">
        Targets are industry rules of thumb from dental billing and practice-management guides, not an official benchmark: collection rate {d.targets.collectionRate.text};
        insurance AR over 90 days {d.targets.over90.text}; patients kept {d.targets.retention.text}. AR is as of the aging report date and includes the patient share.
      </p>
    </div>
  )
}

const STATUS_STYLE = {
  good: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ok: 'bg-amber-50 text-amber-700 ring-amber-200',
  bad: 'bg-red-50 text-red-700 ring-red-200',
}
const STATUS_WORD = { good: 'On target', ok: 'Watch', bad: 'Off target' }

function Badge({ tone, children }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ${STATUS_STYLE[tone]}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${tone === 'good' ? 'bg-emerald-500' : tone === 'ok' ? 'bg-amber-500' : 'bg-red-500'}`} />{children}
  </span>
}

function Group({ title, sub, children }) {
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-2.5 px-1">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="text-[11px] text-slate-500">{sub}</p>
      </div>
      {children}
    </section>
  )
}

// The period in one sentence: production and cash against the period before,
// then the most serious flag.
function Verdict({ d, prevName }) {
  const k = Object.fromEntries(d.kpis.map((x) => [x.key, x]))
  const change = (x) => {
    const v = x?.pace ?? x?.value
    if (v == null || !x?.prev) return null
    return ((v - x.prev) / Math.abs(x.prev)) * 100
  }
  const part = (label, x, plural = false) => {
    const c = change(x)
    if (c == null) return null
    const up = c >= 0
    return (
      <span>{label} {d.partial ? `${plural ? 'are' : 'is'} on pace to be ` : plural ? 'were ' : 'was '}
        <span className={up ? 'text-emerald-700' : 'text-red-600'}>{up ? 'up' : 'down'} {Math.abs(c).toFixed(1)}%</span> on {prevName}
      </span>
    )
  }
  const bits = [part('Net production', k.net), part('collections', k.collections, true)].filter(Boolean)
  return (
    <p className="text-[14px] font-semibold text-slate-900 leading-snug mt-1.5">
      {bits.length ? <>{bits.reduce((acc, b, i) => (i ? [...acc, i === bits.length - 1 ? ', and ' : ', ', b] : [b]), [])}.</> : 'The numbers for this period.'}
    </p>
  )
}

function Tile({ k, prevName, lyName, onGo }) {
  const fmt = (v) => (v == null ? '—' : k.money ? moneyShort(v) : k.percent ? pctText(v) : Math.round(v).toLocaleString('en-US'))
  // A running month compares its pace (so far, scaled to a full month).
  const cmp = k.pace != null ? k.pace : k.value
  const vs = (base, name) => {
    if (base == null || cmp == null || !base) return null
    // Percent figures compare in points; amounts and counts in percent change.
    const diff = k.percent ? cmp - base : ((cmp - base) / Math.abs(base)) * 100
    if (Math.abs(diff) < 0.5) return <span key={name} className="px-1 py-px rounded bg-slate-100 text-slate-500">{'\u2248'} {name}</span>
    const up = diff > 0
    return (
      <span key={name} className={`px-1 py-px rounded ${up ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
        {up ? '▲' : '▼'} {Math.abs(diff).toFixed(1)}{k.percent ? ' pts' : '%'} <span className="opacity-70">{k.pace != null ? 'pace ' : ''}vs {name}</span>
      </span>
    )
  }
  const comps = [vs(k.prev, prevName), vs(k.lastYear, lyName)].filter(Boolean)
  return (
    <button onClick={() => onGo?.(k.view)}
      className="group h-full flex flex-col rounded-xl bg-white border border-slate-200/80 shadow-sm px-3 pt-2.5 pb-2.5 text-left hover:border-indigo-300 hover:shadow-md transition-all" title={k.note}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-slate-500 truncate">{k.label}</p>
        {k.status && <span className={`w-2 h-2 rounded-full shrink-0 ${k.status === 'good' ? 'bg-emerald-500' : k.status === 'ok' ? 'bg-amber-500' : 'bg-red-500'}`} title={STATUS_WORD[k.status]} />}
      </div>
      <p className="mt-1 text-[22px] leading-none font-semibold tracking-tight tabular-nums text-slate-900">
        {fmt(k.value)}{k.pace != null && <span className="text-xs font-medium text-slate-400 ml-1.5 tracking-normal">so far</span>}
      </p>
      {k.pace != null && <p className="text-[10.5px] text-slate-500 tabular-nums mt-1">on pace for <b className="font-semibold text-slate-700">{fmt(k.pace)}</b></p>}
      {comps.length > 0 && <p className="flex flex-wrap gap-1 mt-1.5 text-[10px] font-medium tabular-nums">{comps}</p>}
      <div className="mt-auto pt-2">
        {k.trend?.some((x) => x.v != null)
          ? <Spark k={k} fmt={fmt} />
          : k.target != null && k.value != null ? <Meter k={k} /> : null}
        {k.asOf && <p className="text-[10px] text-slate-400 mt-1">as of {k.asOf}</p>}
      </div>
    </button>
  )
}

// The last 12 months as a line, with the target (dashed) where there is one.
// The period's own months are drawn darker.
function Spark({ k, fmt }) {
  const pts = k.trend
  const vals = pts.map((x) => x.v).filter((v) => v != null)
  let lo = Math.min(...vals), hi = Math.max(...vals)
  if (k.target != null) { lo = Math.min(lo, k.target); hi = Math.max(hi, k.target) }
  if (hi === lo) { hi += 1; lo -= 1 }
  const pad = (hi - lo) * 0.12
  lo -= pad; hi += pad
  const W = 100, H = 30
  const x = (i) => (pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * W)
  const y = (v) => H - ((v - lo) / (hi - lo)) * H
  const line = pts.map((p, i) => (p.v == null ? null : `${x(i).toFixed(2)},${y(p.v).toFixed(2)}`)).filter(Boolean).join(' ')
  const last = [...pts].reverse().find((p) => p.v != null)
  const li = pts.lastIndexOf(last)
  const stroke = k.status === 'bad' ? '#dc2626' : k.status === 'ok' ? '#d97706' : '#4f46e5'
  return (
    <div>
      <div className="relative h-7">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible" aria-hidden="true">
          {k.target != null && <line x1="0" x2={W} y1={y(k.target)} y2={y(k.target)} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
          <polyline points={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {/* Points as HTML so they stay round on a stretched chart; hover for the month. */}
        {pts.map((p, i) => p.v != null && (
          <span key={p.p} title={`${periodLabel(p.p)}: ${fmt(p.v)}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 w-3 h-3 flex items-center justify-center"
            style={{ left: `${x(i)}%`, top: `${(y(p.v) / H) * 100}%` }}>
            <span className={`rounded-full ${i === li ? 'w-2 h-2 ring-2 ring-white' : 'w-1 h-1 opacity-0 group-hover:opacity-60'}`} style={{ background: stroke }} />
          </span>
        ))}
      </div>
      <div className="flex justify-between text-[9.5px] text-slate-400 mt-0.5 tabular-nums">
        <span>{periodLabel(pts[0].p).replace(/ 20(\d\d)$/, " \u2019$1")}</span>
        {k.target != null && <span>target {k.lowerIsBetter ? '<' : ''}{k.target}%</span>}
        <span>{periodLabel(pts[pts.length - 1].p).replace(/ 20(\d\d)$/, " \u2019$1")}</span>
      </div>
    </div>
  )
}

// One figure against its target on a 0–100% bar (for snapshots with no history).
function Meter({ k }) {
  const v = Math.max(0, Math.min(100, k.value))
  const color = k.status === 'bad' ? 'bg-red-500' : k.status === 'ok' ? 'bg-amber-400' : 'bg-emerald-500'
  return (
    <div>
      <div className="relative h-2 rounded-full bg-slate-100 mt-3">
        <div className={`absolute inset-y-0 left-0 rounded-full ${color}`} style={{ width: `${v}%` }} />
        <div className="absolute -top-1 -bottom-1 w-0.5 bg-slate-500 rounded" style={{ left: `${k.target}%` }} title={`target ${k.target}%`} />
      </div>
      <p className="text-[9.5px] text-slate-400 mt-1.5 tabular-nums">target {k.lowerIsBetter ? 'under ' : ''}{k.target}% {'\u00b7'} the mark on the bar</p>
    </div>
  )
}

// A column heading with a one-line explanation under it.
function Th({ children, sub, left, wide, last }) {
  return (
    <th className={`pb-2 align-bottom font-semibold ${left ? 'text-left' : 'text-right'} ${left && !wide ? 'pl-1' : ''} ${wide ? 'w-[24%]' : ''} ${last ? 'pr-1' : left ? '' : 'px-2'}`}>
      <span className="block text-[11px] text-slate-600 leading-tight">{children}</span>
      {sub && <span className="block text-[10px] font-normal text-slate-400 leading-tight mt-0.5">{sub}</span>}
    </th>
  )
}

function Pct({ v, flag }) {
  return (
    <td className="py-2 px-2">
      <span className={`inline-block w-14 text-right px-1.5 py-px rounded ring-1 ${flag ? 'bg-red-50 text-red-700 font-semibold ring-red-200' : 'text-slate-600 ring-transparent'}`}>{pctText(v)}</span>
    </td>
  )
}

// ── Insurance A/R by age ─────────────────────────────────────────────────
// The aging report's open claims, like the A/R pivot: tabs for all offices
// and each office; rows are the age groups, columns billed and expected with
// each group's share of the total.

// Age colours, calm to urgent: the older the claim, the warmer.
const AGE = [
  { fill: '#cbd5e1', ink: '#334155' },   // 0–30
  { fill: '#fcd34d', ink: '#78350f' },   // 31–60
  { fill: '#fb923c', ink: '#7c2d12' },   // 61–90
  { fill: '#ef4444', ink: '#ffffff' },   // 91–120
  { fill: '#991b1b', ink: '#ffffff' },   // 120+
]
const pct2 = (v) => (v == null ? '\u2014' : `${v.toFixed(2)}%`)

function ArAging({ a, onGo, over90 }) {
  // Tabs: all offices together first, then each office (biggest first).
  const tabs = [a.group, ...a.offices]
  const [pick, setPick] = useState(a.group.name)
  const o = tabs.find((t) => t.name === pick) || a.group
  const tb = o.total.billed || 0, te = o.total.expected || 0
  const o90 = (f) => (o.buckets['91-120']?.[f] || 0) + (o.buckets['120+']?.[f] || 0)
  const o90share = te ? (o90('expected') / te) * 100 : null
  const name = (t) => (t === a.group ? 'All offices' : shortLocation(t.name))

  return (
    <section className="rounded-2xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-4">
        <div>
          <p className="text-sm font-semibold text-slate-900">Insurance A/R by age</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Open claims as of {a.asOf} {'·'} billed = full fees on the claims {'·'} expected = what insurance should pay (incl. the patient share)
          </p>
        </div>
        {a.group.total.expected > 0 && (() => {
          const v = ((a.group.buckets['120+']?.expected || 0) / a.group.total.expected) * 100
          return (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 ${v >= 30 ? STATUS_STYLE.bad : v >= 15 ? STATUS_STYLE.ok : STATUS_STYLE.good}`}>
              All offices over 120 days: {pct2(v)}
            </span>
          )
        })()}
      </div>

      {/* ── Office tabs ── */}
      <div role="tablist" aria-label="Office" className="flex gap-1 px-4 mt-3 border-b border-slate-100 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => {
          const on = t.name === o.name
          const share = t.total.expected ? ((t.buckets['120+']?.expected || 0) / t.total.expected) * 100 : null
          return (
            <button key={t.name} role="tab" aria-selected={on} onClick={() => setPick(t.name)}
              className={`shrink-0 px-3 pt-2 pb-2.5 -mb-px border-b-2 text-left transition-colors ${on ? 'border-indigo-600' : 'border-transparent hover:border-slate-200'}`}>
              <span className={`block text-[12.5px] font-semibold ${on ? 'text-slate-900' : 'text-slate-500'}`}>{name(t)}</span>
              <span className="block text-[10.5px] tabular-nums text-slate-400">
                {money(t.total.expected)} {'·'} <span className={share >= 30 ? 'text-red-600 font-semibold' : ''}>{pct2(share)} 120+</span>
              </span>
            </button>
          )
        })}
      </div>

      {/* ── The age strip and the cards: the A/R pivot, drawn ── */}
      <div className="px-5 py-4 space-y-4">
        {/* One bar: expected dollars by age, young to old. */}
        <div>
          <div className="flex h-9 rounded-xl overflow-hidden gap-0.5 bg-slate-100">
            {a.buckets.map((b, i) => {
              const v = o.buckets[b].expected || 0
              const w = te ? (v / te) * 100 : 0
              // Sized by its share, but never too thin to carry its number.
              return v > 0 ? (
                <div key={b} title={`${b}: ${money(v)} (${pct2(w)})`}
                  className="flex items-center justify-center px-1.5 text-[11px] font-semibold tabular-nums whitespace-nowrap overflow-hidden"
                  style={{ flexGrow: w, flexBasis: 0, minWidth: 54, background: AGE[i].fill, color: AGE[i].ink }}>
                  {w >= 12 ? `${b} · ${pct2(w)}` : pct2(w)}
                </div>
              ) : null
            })}
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 mt-1 px-0.5">
            <span>newest claims</span><span>oldest claims</span>
          </div>
        </div>

        {/* Cards read like the pivot: each has Billed and Expected, same weight, with their %. */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <div className="rounded-2xl bg-slate-900 text-white px-4 py-3.5 flex flex-col">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[12px] font-semibold">Grand total</p>
              <p className="text-[10.5px] text-slate-400 tabular-nums">{o.total.claims.toLocaleString('en-US')} claims</p>
            </div>
            <p className="text-[10.5px] text-slate-400">{name(o)}</p>
            <div className="mt-3 space-y-2.5">
              <PivotLine label="Billed" amount={tb} share={100} dark />
              <PivotLine label="Expected" amount={te} share={100} dark />
            </div>
            <p className="mt-auto pt-3 text-[10.5px] text-slate-400 tabular-nums">
              Over 90 days: <span className={o90share >= 30 ? 'text-red-300 font-semibold' : 'text-white'}>{pct2(o90share)}</span> of expected
            </p>
          </div>

          {a.buckets.map((b, i) => {
            const x = o.buckets[b]
            const pb = tb ? (x.billed / tb) * 100 : 0, pe = te ? (x.expected / te) * 100 : 0
            const alarm = (b === '91-120' || b === '120+') && pe >= 30
            return (
              <div key={b} className={`relative rounded-2xl bg-white border px-4 py-3.5 overflow-hidden ${alarm ? 'border-red-200 ring-1 ring-red-100' : 'border-slate-200'}`}>
                <span className="absolute inset-x-0 top-0 h-1" style={{ background: AGE[i].fill }} />
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[12px] font-semibold text-slate-800">{b === '120+' ? '120+ days' : `${b} days`}</p>
                  <p className="text-[10.5px] text-slate-400 tabular-nums">{x.claims.toLocaleString('en-US')} claims</p>
                </div>
                <div className="mt-3 space-y-2.5">
                  <PivotLine label="Billed" amount={x.billed} share={pb} color="#94a3b8" />
                  <PivotLine label="Expected" amount={x.expected} share={pe} color={AGE[i].fill} alarm={alarm} />
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex justify-end">
          <button onClick={() => onGo?.('money')} className="text-[11px] font-semibold text-slate-500 hover:text-indigo-600">See the claims behind it in Money {'\u2192'}</button>
        </div>
      </div>
    </section>
  )
}

// One line of an A/R card: "Billed  $830,406  28.46%" with a thin bar.
function PivotLine({ label, amount, share, color = '#94a3b8', dark, alarm }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 tabular-nums">
        <span className={`text-[11px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{label}</span>
        <span className={`text-[11px] font-semibold ${alarm ? 'text-red-600' : dark ? 'text-slate-300' : 'text-slate-500'}`}>{pct2(share)}</span>
      </div>
      <p className={`text-[17px] leading-tight font-semibold tabular-nums ${dark ? 'text-white' : 'text-slate-900'}`}>{money(amount)}</p>
      <div className={`h-1 rounded-full overflow-hidden mt-1 ${dark ? 'bg-white/15' : 'bg-slate-100'}`}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, share || 0))}%`, background: dark ? '#e2e8f0' : color }} />
      </div>
    </div>
  )
}
