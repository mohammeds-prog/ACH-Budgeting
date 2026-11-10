'use client'

import { useMemo, useState } from 'react'
import { shortLocation } from '@/lib/constants'
import { periodLabel, guessRole } from '@/lib/dentrixReports'

// ─────────────────────────────────────────────────────────────────────────────
// Patient retention, from readSchedule's monthly counts. Not a tree: retention
// is a comparison (which provider keeps patients) and a trend (are we keeping
// more over time), so it reads as headline numbers → trend → providers →
// offices → who is drifting away.
// ─────────────────────────────────────────────────────────────────────────────

const pct = (a, b) => (b ? (a / b) * 100 : null)
const fmtPct = (v) => (v == null ? '—' : `${Math.round(v)}%`)
const num = (n) => Math.round(n || 0).toLocaleString('en-US')
const shiftMonth = (p, by) => {
  const [y, m] = p.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const shortMonth = (p) => periodLabel(p).replace(/ (\d\d)(\d\d)$/, ' ’$2')
const lapsedOf = (v) => (v?.lapsed ? Object.values(v.lapsed).reduce((s, n) => s + n, 0) : 0)

export default function RetentionView({ schedule, period, range }) {
  const months = schedule.months
  const keys = useMemo(() => Object.keys(months).sort(), [months])
  const allTime = period === 'all'
  const isRange = period === 'range' && range?.data
  // The last complete month (the export's own month is only partly over).
  const latestP = keys.filter((p) => p < schedule.asOf.slice(0, 7)).pop() || keys[keys.length - 1]
  // The month the charts and "haven't been back" are read at.
  const at = allTime ? latestP : isRange ? (keys.filter((p) => p <= range.to.slice(0, 7) && p < schedule.asOf.slice(0, 7)).pop() || latestP) : period
  const m = months[at]
  const series = useMemo(() => keys.filter((p) => p <= at), [keys, at])

  const [who, setWho] = useState('all')          // all | dentist | hygienist
  // Every number sorts: { k, dir } - dir -1 = highest first. Clicking the
  // same one again flips it.
  const [sort, setSortState] = useState({ k: 'base', dir: -1 })
  const setSort = (k) => setSortState((st) => (st.k === k ? { k, dir: -st.dir } : { k, dir: k === 'name' ? 1 : -1 }))
  const [officeSort, setOfficeSortState] = useState({ k: 'base', dir: -1 })
  const setOfficeSort = (k) => setOfficeSortState((st) => (st.k === k ? { k, dir: -st.dir } : { k, dir: k === 'name' ? 1 : -1 }))
  const [openProv, setOpenProv] = useState(null)

  if (!m || (allTime && !schedule.all)) return null
  const when = allTime ? 'all time' : isRange ? range.label : periodLabel(period)

  // One shape for both views: base patients, split into good (coming back)
  // and bad (not), plus the call-back count and new patients.
  const L = allTime
    ? { base: 'Their patients', baseSub: 'everyone they have ever seen', good: 'still coming', bad: 'stopped coming',
        question: 'of all the patients this provider has ever seen, how many are still coming — to them, or to someone else?' }
    : { base: isRange ? 'Seen' : `Seen in ${periodLabel(period)}`, baseSub: isRange ? range.label : 'patients they treated', good: 'came back or booked', bad: 'not back, nothing booked',
        question: `of the patients this provider saw ${isRange ? `between ${range.label.replace(' \u2013 ', ' and ')}` : `in ${periodLabel(period)}`}, how many came back or are booked to?` }
  const rowOf = (v, lapsedFrom) => (allTime
    ? { base: v.patients, good: v.still, same: v.stillSame ?? null, bad: v.stopped, call: lapsedOf(lapsedFrom), newPts: v.newJudged, newBack: v.newBack }
    : { base: v.seen, good: v.seenNext, same: v.seenSame ?? null, bad: v.seen - v.seenNext, call: lapsedOf(v), newPts: isRange ? v.newJudged : v.newPts, newBack: isRange || src.newMature ? v.newBack : v.newNext })
  const src = allTime ? schedule.all : isRange ? range.data : m
  const T = rowOf(src.total, m.total)
  const avg = pct(T.good, T.base)

  // Providers still working: seen patients in the last 12 months.
  const recent = new Set(keys.slice(-12).flatMap((p) => Object.entries(months[p].byProv).filter(([, v]) => v.seen > 0).map(([k]) => k)))
  const specialtyOf = (p) => (schedule.specialty?.[p] || '').toLowerCase()
  const providers = Object.entries(src.byProv)
    .filter(([p]) => recent.has(p) && guessRole(p) !== 'office' && !/^(temp|hygienist|rdh |no provider)/i.test(p))
    .filter(([p]) => who === 'all' || (who === 'hygienist' ? specialtyOf(p) === 'hygienist' : specialtyOf(p) !== 'hygienist'))
    .map(([p, v]) => ({ name: p, specialty: schedule.specialty?.[p] || '', ...rowOf(v, m.byProv[p]) }))
    .filter((r) => r.base >= 5)
    .sort(bySort(sort, (r) => r.name))
  const offices = Object.entries(src.byLoc)
    .map(([loc, v]) => ({ loc, ...rowOf(v, m.byLoc[loc]), lapsed: m.byLoc[loc]?.lapsed || { '6-12': 0, '12-18': 0, '18-36': 0 } }))
    .filter((o) => o.base > 0).sort(bySort(officeSort, (o) => shortLocation(o.loc)))

  return (
    <div className="space-y-4">
      {/* ── Retention: the one number, and how it has moved ── */}
      <RetentionHeadline months={months} series={series} at={at} allTime={allTime} isRange={!!isRange} T={T} avg={avg} periodText={when} />
      <HowCounted allTime={allTime} asOf={schedule.asOf} when={when} />

      {/* ── Providers ── */}
      <Panel title={`Providers · ${allTime ? 'All time' : when}`}
        sub={`Each row answers: ${L.question}`}
        right={
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Show</span>
            <Pills value={who} onChange={setWho} options={[['all', 'All providers'], ['dentist', 'Dentists only'], ['hygienist', 'Hygienists only']]} />
          </div>
        }>
        <div className="divide-y divide-slate-100">
          <div className="hidden md:grid grid-cols-[minmax(0,1.3fr)_110px_minmax(0,3fr)] gap-5 pb-2 items-end">
            <SortHead k="name" sort={sort} onSort={setSort}><span className="text-[10px] tracking-widest text-slate-400">Provider</span></SortHead>
            <ColHead title={L.base} sub={L.baseSub} k="base" sort={sort} onSort={setSort} />
            <span className="block">
              <ColHead title="Coming back?" sub="" k="rate" sort={sort} onSort={setSort} />
              <BarLegend sort={sort} onSort={setSort} labels={allTime ? ['still with them', 'now with someone else', 'stopped coming'] : ['to them', 'to someone else', 'not back']} />
            </span>
          </div>
          {providers.map((v) => (
            <div key={v.name}>
              <button onClick={() => setOpenProv(openProv === v.name ? null : v.name)}
                className="w-full text-left grid grid-cols-2 md:grid-cols-[minmax(0,1.3fr)_110px_minmax(0,3fr)] gap-x-5 gap-y-2 py-3 items-center hover:bg-slate-50/70 rounded-lg px-1 -mx-1">
                <span className="min-w-0 col-span-2 md:col-span-1">
                  <span className="block text-sm font-semibold text-slate-800 truncate">{v.name}</span>
                  <span className="block text-[11px] text-slate-400">{v.specialty}{v.newPts ? <>{' \u00b7 '}
                    <SortNum k="newPts" sort={sort} onSort={setSort}>{num(v.newPts)} new patient{v.newPts === 1 ? '' : 's'}</SortNum>{', '}
                    <SortNum k="newBack" sort={sort} onSort={setSort}>{num(v.newBack)} came back</SortNum></> : null}</span>
                </span>
                <Cell value={num(v.base)} label="patients" />
                <SplitBar good={v.good} same={v.same} bad={v.bad} goodLabel={L.good} badLabel={L.bad} sameLabel={allTime ? 'still with them' : 'to them'} otherLabel={allTime ? 'now with someone else' : 'to someone else'} sort={sort} onSort={setSort} />
              </button>
              {openProv === v.name && <ProviderDetail name={v.name} months={months} series={series} period={at} />}
            </div>
          ))}
          {!providers.length && <p className="py-6 text-center text-sm text-slate-400">No providers for this filter.</p>}
        </div>
        <p className="text-[11px] text-slate-400 mt-3">
          All offices together: {fmtPct(avg)} {L.good}.
          {allTime && ' All time counts every patient a provider has ever seen, so those who have been here longest carry patients who left years ago — pick a month or date range to compare providers fairly.'}
          {' '}Click a heading, a colour on a bar, or a number to sort by it (again to flip high and low); click a provider{'\u2019'}s name to see their retention month by month.
        </p>
      </Panel>

      {/* ── Where patients are lost: the moments that decide it ── */}
      <WhereLost schedule={schedule} allTime={allTime} src={src} when={when} />

      {/* ── Offices ── */}
      <Panel title="Offices" sub={allTime ? 'Every patient ever seen at each office' : `Patients seen at each office, ${when}`}>
        <div className="grid grid-cols-[minmax(0,0.6fr)_80px_minmax(0,3fr)] gap-4 items-end pb-2">
          <SortHead k="name" sort={officeSort} onSort={setOfficeSort}><span className="text-[10px] tracking-widest text-slate-400">Office</span></SortHead>
          <ColHead title="Patients" sub="" k="base" sort={officeSort} onSort={setOfficeSort} />
          <span className="block">
            <ColHead title="Coming back?" sub="" k="rate" sort={officeSort} onSort={setOfficeSort} />
            <BarLegend sort={officeSort} onSort={setOfficeSort} labels={allTime ? ['still at this office', 'now at another office', 'stopped coming'] : ['to this office', 'to another office', 'not back']} />
          </span>
        </div>
        <div className="space-y-3">
          {offices.map((o) => (
            <div key={o.loc} className="grid grid-cols-[minmax(0,0.6fr)_80px_minmax(0,3fr)] gap-4 items-center">
              <span className="text-sm font-semibold text-slate-800 truncate">{shortLocation(o.loc)}</span>
              <Cell value={num(o.base)} label="patients" />
              <SplitBar good={o.good} same={o.same} bad={o.bad} goodLabel={L.good} badLabel={L.bad} sameLabel={allTime ? 'still at this office' : 'to this office'} otherLabel={allTime ? 'now at another office' : 'to another office'} sort={officeSort} onSort={setOfficeSort} />
            </div>
          ))}
        </div>
      </Panel>

      <p className="text-[11px] text-slate-400">
        From the Dentrix schedule report, appointments back to {periodLabel(schedule.since)}, as of {schedule.asOf}.
        {allTime
          ? ' Each patient counts for every provider and office that has seen them. Still coming = seen in the last 18 months or has an appointment booked; “still with them” = their latest dentist (or hygienist) visit or booking is with that provider.'
          : ' Each provider and office that saw a patient in the month counts them. For recent months, “next visit” means something is booked; for older months it means the patient actually came back.'}
      </p>
    </div>
  )
}

// How many are coming back, as one bar: green for coming back, amber for
// not, with the counts written on it and the share in large type.
// How many are coming back, as one bar with the counts written on it and
// the share coming back in large type. With `same`, the coming-back part is
// split: dark green came back to this provider (or office), light green came
// back to someone else.
function SplitBar({ good, same, bad, goodLabel, badLabel, sameLabel, otherLabel, compact, sort, onSort }) {
  const total = good + bad
  const split = same != null
  const parts = split
    ? [
        { k: 'same', n: same, label: sameLabel, cls: 'bg-emerald-600 text-white' },
        { k: 'other', n: good - same, label: otherLabel, cls: 'bg-emerald-200 text-emerald-900' },
        { k: 'bad', n: bad, label: badLabel, cls: 'bg-amber-100 text-amber-800 justify-center' },
      ]
    : [
        { k: 'same', n: good, label: goodLabel, cls: 'bg-emerald-500 text-white' },
        { k: 'bad', n: bad, label: badLabel, cls: 'bg-amber-100 text-amber-800 justify-center' },
      ]
  // Sorting from the bar: a click on a colour sorts the list by it.
  const sortOn = (k) => (onSort ? (e) => { e.stopPropagation(); onSort(k) } : undefined)
  const w = (n) => (total ? (n / total) * 100 : 0)
  // Each part carries its count when it's wide enough for one; the words
  // (and any count too narrow to fit) are spelled out beneath.
  const fits = (n) => w(n) >= (compact ? 7 : 5)
  const inside = false
  return (
    <span className="flex items-center gap-3 min-w-0 col-span-2 md:col-span-1">
      <span className={`${compact ? 'text-sm w-10' : 'text-lg w-12'} font-bold tabular-nums text-emerald-700 text-right shrink-0`}
        title={split ? `${fmtPct(w(good))} came back: ${fmtPct(w(same))} ${sameLabel}, ${fmtPct(w(good - same))} ${otherLabel}` : undefined}>
        {fmtPct(total ? w(good) : null)}
      </span>
      <span className="flex-1 min-w-0">
        <span className={`flex ${compact ? 'h-5' : 'h-7'} rounded-md overflow-hidden text-[11px] font-semibold`}>
          {parts.map((x) => (
            <span key={x.label} onClick={sortOn(x.k)} title={`${num(x.n)} ${x.label}${onSort ? ' \u00b7 click to sort by this' : ''}`} className={`${x.cls} ${onSort ? 'cursor-pointer hover:brightness-95' : ''} ${sort?.k === x.k ? 'ring-2 ring-inset ring-slate-900/30' : ''} flex items-center ${x.cls.includes('justify-end') ? '' : 'justify-center'} px-1.5 tabular-nums whitespace-nowrap overflow-hidden`} style={{ width: `${w(x.n)}%` }}>
              {fits(x.n) ? num(x.n) : ''}
            </span>
          ))}
        </span>
        {!inside && (
          <span className="block text-[11px] text-slate-500 mt-1">
            {parts.map((x, i) => <span key={x.label}>{i ? ' \u00b7 ' : ''}<span onClick={sortOn(x.k)} className={onSort ? `cursor-pointer hover:text-slate-800 hover:underline underline-offset-2 ${sort?.k === x.k ? 'font-semibold text-slate-800' : ''}` : ''}>{num(x.n)} {x.label}</span></span>)}
          </span>
        )}
      </span>
    </span>
  )
}

// The three moments where patients are lost, as numbers the office can act
// on, each with what usually happens next (from a year that has played out).
function WhereLost({ schedule, allTime, src, when }) {
  const [sort, setSortState] = useState({ k: 'total', dir: -1 })
  const setSort = (k) => setSortState((st) => (st.k === k ? { k, dir: -st.dir } : { k, dir: k === 'name' ? 1 : -1 }))
  // All time reads the last 12 months; a month or range reads itself.
  const base = allTime ? schedule.all?.last12 : src
  const missed = (allTime ? schedule.all : src)?.missedOpen
  const ev = schedule.evidence
  if (!base || !missed || !ev) return null
  const stop = (k) => (ev[k]?.patients ? Math.round((ev[k].stopped / ev[k].patients) * 100) : null)
  const label = allTime ? 'last 12 months' : when
  const left = base.total.seen - base.total.seenNext
  const fresh = base.total.newPts - base.total.newNext
  const offices = Object.keys({ ...base.byLoc, ...missed.byLoc })
    .map((loc) => {
      const v = base.byLoc[loc] || { seen: 0, seenNext: 0, newPts: 0, newNext: 0 }
      return { loc, missed: missed.byLoc[loc] || 0, left: v.seen - v.seenNext, fresh: v.newPts - v.newNext, seen: v.seen }
    })
    .filter((o) => o.missed || o.left || o.fresh)
    .map((o) => ({ ...o, total: o.missed + o.left + o.fresh, name: shortLocation(o.loc) }))
    .sort(bySort(sort, (o) => o.name))
  const moments = [
    { n: missed.total, title: 'Missed an appointment, not rebooked',
      why: `When patients break their next appointment, ${stop('broke')}% never come back (${stop('noShow')}% after a no-show) \u2014 against ${stop('kept')}% of those who keep it.` },
    { n: left, title: 'Left without booking a next visit',
      why: 'Nothing is on the schedule for them — unless someone calls and books them, they don’t come back.' },
    { n: fresh, title: 'New patients without a second visit',
      why: `About half of new patients never come back after their first visit (${stop('oneVisit')}%), against ${stop('returning')}% of returning patients.` },
  ]
  return (
    <Panel title={`Where patients are lost \u00b7 ${label}`}
      sub="The moments that decide whether a patient stays. Each one is a phone call that can still save them.">
      <div className="grid md:grid-cols-3 gap-3">
        {moments.map((x) => (
          <div key={x.title} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-3xl font-bold tabular-nums text-red-600">{num(x.n)}</p>
            <p className="text-sm font-semibold text-slate-800 mt-0.5">{x.title}</p>
            <p className="text-[12px] text-slate-500 mt-1.5 leading-snug">{x.why}</p>
          </div>
        ))}
      </div>
      {offices.length > 0 && (
        <div className="mt-4">
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,120px))] gap-x-4 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <SortHead k="name" sort={sort} onSort={setSort}>By office</SortHead>
            <SortHead k="missed" sort={sort} onSort={setSort} right>Missed, not rebooked</SortHead>
            <SortHead k="left" sort={sort} onSort={setSort} right>Left without booking</SortHead>
            <SortHead k="fresh" sort={sort} onSort={setSort} right>New, no 2nd visit</SortHead>
          </div>
          <div className="divide-y divide-slate-100">
            {offices.map((o) => (
              <div key={o.loc} className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,120px))] gap-x-4 py-1.5 text-sm items-center">
                <span className="font-semibold text-slate-800 truncate">{shortLocation(o.loc)}</span>
                <span className="text-right tabular-nums text-slate-700">{num(o.missed)}</span>
                <span className="text-right tabular-nums text-slate-700">{num(o.left)}</span>
                <span className="text-right tabular-nums text-slate-700">{num(o.fresh)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] text-slate-400 mt-3">
        &ldquo;What usually happens next&rdquo; follows the patients seen {periodLabel(ev.from.slice(0, 7))} {'\u2013'} {periodLabel(ev.to.slice(0, 7))} for a year after their last visit, so it has had time to play out.
        {!allTime && ' For a recent month, some of these patients will still book on their own.'}
      </p>
    </Panel>
  )
}

// -- Sorting ----------------------------------------------------------------
const SORT_VALUE = {
  base: (r) => r.base,
  rate: (r) => (r.base ? r.good / r.base : 0),
  same: (r) => r.same ?? r.good,
  other: (r) => (r.same != null ? r.good - r.same : 0),
  bad: (r) => r.bad,
  badRate: (r) => (r.base ? r.bad / r.base : 0),
  newPts: (r) => r.newPts || 0,
  newBack: (r) => r.newBack || 0,
}
// A comparator for { k, dir }: a number from SORT_VALUE or the row itself,
// or the name (A-Z first) for k = 'name'.
function bySort({ k, dir }, nameOf) {
  if (k === 'name') return (a, b) => dir * String(nameOf(a)).localeCompare(String(nameOf(b)))
  const val = SORT_VALUE[k] || ((r) => r[k] || 0)
  return (a, b) => dir * (val(a) - val(b)) || String(nameOf(a)).localeCompare(String(nameOf(b)))
}
function sortOptions(allTime, L, offices = false) {
  return [
    ['base', offices ? 'Patients' : L.base],
    ['rate', 'Coming back %'],
    ['same', allTime ? (offices ? 'Still at this office' : 'Still with them') : (offices ? 'To this office' : 'To them')],
    ['other', allTime ? (offices ? 'Now at another office' : 'Now with someone else') : (offices ? 'To another office' : 'To someone else')],
    ['bad', allTime ? 'Stopped coming' : 'Not back'],
    ['badRate', allTime ? 'Stopped %' : 'Not back %'],
    ...(offices ? [] : [['newPts', 'New patients'], ['newBack', 'New, came back']]),
    ['name', 'Name'],
  ]
}

// The bar's colours as a legend that sorts: dark green, light green, amber.
function BarLegend({ sort, onSort, labels }) {
  const keys = ['same', 'other', 'bad']
  const sw = ['bg-emerald-600', 'bg-emerald-200', 'bg-amber-200']
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
      {labels.map((l, i) => {
        const on = sort.k === keys[i]
        return (
          <button key={l} onClick={() => onSort(keys[i])} title="Sort by this"
            className={`inline-flex items-center gap-1.5 text-[10.5px] ${on ? 'text-slate-900 font-semibold' : 'text-slate-500 hover:text-slate-800'}`}>
            <span className={`w-2.5 h-2.5 rounded-sm ${sw[i]}`} />{l}
            <span className={`text-[9px] ${on ? '' : 'opacity-0'}`}>{on && sort.dir > 0 ? '\u25B2' : '\u25BC'}</span>
          </button>
        )
      })}
    </span>
  )
}

// A number inside a row that sorts the list when clicked (the row itself
// opens the provider, so this stops the click there).
function SortNum({ k, sort, onSort, children }) {
  const on = sort.k === k
  return (
    <span role="button" tabIndex={0} title="Sort by this"
      onClick={(e) => { e.stopPropagation(); onSort(k) }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onSort(k) } }}
      className={`cursor-pointer hover:text-slate-700 hover:underline underline-offset-2 ${on ? 'text-slate-700 font-semibold' : ''}`}>
      {children}{on && <span className="text-[9px] ml-0.5">{sort.dir > 0 ? '\u25B2' : '\u25BC'}</span>}
    </span>
  )
}

function SortBar({ sort, onSort, options }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-3">
      <span className="text-[11px] text-slate-500 mr-1">Sort by</span>
      {options.map(([k, label]) => {
        const on = sort.k === k
        return (
          <button key={k} onClick={() => onSort(k)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
              on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
            {label}
            {on && <span className="text-[9px]">{k === 'name' ? (sort.dir > 0 ? 'A\u2192Z' : 'Z\u2192A') : sort.dir < 0 ? '\u25BC high' : '\u25B2 low'}</span>}
          </button>
        )
      })}
    </div>
  )
}

function SortHead({ k, sort, onSort, right, children }) {
  const on = sort.k === k
  return (
    <button onClick={() => onSort(k)} className={`flex items-center gap-1 uppercase tracking-widest font-bold ${right ? 'justify-end text-right' : 'text-left'} ${on ? 'text-slate-700' : 'hover:text-slate-600'}`}>
      {children}<span className={`text-[9px] ${on ? '' : 'opacity-40'}`}>{on && sort.dir > 0 ? '\u25B2' : '\u25BC'}</span>
    </button>
  )
}

// Plain-words definition of the numbers on this page, for the period shown.
function HowCounted({ allTime, asOf, when }) {
  const items = allTime ? [
    ['Still coming', 'the patient had a completed visit in the last 18 months, or has an appointment booked after ' + asOf + '. 18 months is the usual dental definition of an “active patient” (Dentrix’s default too).'],
    ['Stopped coming', 'no completed visit in the last 18 months and nothing booked.'],
    ['Still with them', 'of those still coming, their latest dentist (or hygienist) visit or booking is with this same provider; “now with someone else” means it’s with another one.'],
  ] : [
    ['Came back or booked', `the patient was seen in ${when} and afterwards either had a completed visit (at any later date) or has an appointment booked after ${asOf}.`],
    ['Not back', 'no completed visit since and nothing booked. Broken, no-show and cancelled appointments do not count as coming back.'],
    ['To them / someone else', 'whether that next visit or booking is with the same provider (dentist for a dentist, hygienist for a hygienist) or the same office.'],
  ]
  return (
    <details className="group rounded-2xl bg-white/70 border border-slate-200 px-5 py-3">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-[13px] font-semibold text-slate-700">
        <span>How retention is counted</span>
        <span className="text-[11px] font-normal text-slate-400 group-open:hidden">Show {'▾'}</span>
        <span className="text-[11px] font-normal text-slate-400 hidden group-open:inline">Hide {'▴'}</span>
      </summary>
      <div className="mt-2.5 space-y-1.5 text-[12.5px] text-slate-600 leading-snug">
        <p>From the Dentrix schedule: every appointment is tied to the patient{'’'}s chart number. A <b className="font-semibold text-slate-800">completed visit</b> is an appointment marked Complete, Checkout, Chair, Ready, Here or Late.</p>
        <ul className="space-y-1">
          {items.map(([k, v]) => <li key={k}><b className="font-semibold text-slate-800">{k}</b> {'—'} {v}</li>)}
        </ul>
        <p className="text-[11.5px] text-slate-500">A patient counts for every provider and office that saw them, so the rows add up to more than the total.
          {!allTime && ' For recent months most patients are counted because they have something booked — they haven’t had time to come back yet.'}
          {' '}Patients whose treatment is finished and don{'’'}t need to return (emergency-only, referrals, moved away) currently count as not coming back.</p>
      </div>
    </details>
  )
}

function Panel({ title, sub, right, children }) {
  return (
    <div className="glass-card rounded-2xl px-5 py-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <p className="text-sm font-bold text-slate-800">{title}</p>
          {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

// A column heading that sorts the list, highest first, when clicked.
function ColHead({ title, sub, tone = 'text-slate-500', k, sort, onSort }) {
  const on = sort.k === k
  return (
    <button onClick={() => onSort(k)} title="Sort by this column" className="block text-left group">
      <span className={`flex items-center gap-1 text-[11px] font-bold ${tone}`}>
        {title}
        <span className={`text-[10px] ${on ? 'text-slate-700' : 'text-slate-300 group-hover:text-slate-500'}`}>{on && sort.dir > 0 ? '\u25B2' : '\u25BC'}</span>
      </span>
      <span className="block text-[10px] text-slate-400">{sub}</span>
    </button>
  )
}

function Cell({ value, label, tone = 'text-slate-800' }) {
  return (
    <span className="block">
      <span className={`block text-lg font-bold tabular-nums leading-tight ${tone}`}>{value}</span>
      <span className="block text-[11px] text-slate-500">{label}</span>
    </span>
  )
}

function Pills({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-full border border-slate-200 bg-white p-0.5">
      {options.map(([k, l]) => (
        <button key={k} onClick={() => onChange(k)}
          className={`px-3 py-1 text-xs font-semibold rounded-full transition-colors ${value === k ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-800'}`}>
          {l}
        </button>
      ))}
    </div>
  )
}

function ProviderDetail({ name, months, series, period }) {
  const points = series.slice(-12).map((p) => ({ p, v: monthRate(months[p].byProv[name]) })).filter((d) => d.v != null)
  return (
    <div className="pb-4 pt-1 px-1">
      <p className="text-[11px] font-semibold text-slate-500 mb-1">Each month: of the patients they saw, how many came back or are booked to</p>
      <LineChart points={points} selected={period} unit="came back" fmt={fmtPct} height={120} />
    </div>
  )
}

// ── Charts ──────────────────────────────────────────────────────────────
// Each opens with one plain sentence saying what it shows, so the chart only
// has to back it up.

// Retention for a month: of the patients seen, the share who came back or
// are booked to.
const monthRate = (v) => (v?.seen ? (v.seenNext / v.seen) * 100 : null)

function RetentionHeadline({ months, series, at, allTime, isRange, T, avg, periodText }) {
  const yearAgo = isRange ? null : monthRate(months[shiftMonth(at, -12)]?.total)
  return (
    <div className="glass-card rounded-2xl px-6 py-5">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Patient retention {'\u00b7'} {periodText}</p>
        <p className="text-6xl font-bold tabular-nums text-emerald-700 mt-2">{fmtPct(avg)}</p>
        <p className="text-[15px] leading-snug text-slate-700 mt-2">
          {allTime
            ? <>of your patients are <b className="text-slate-900">still coming</b>: {num(T.good)} of {num(T.base)} have been in within the last 18 months or have an appointment booked.</>
            : <>of the patients seen {isRange ? `between ${periodText.replace(' – ', ' and ')}` : `in ${periodText}`} {isRange ? <>have <b className="text-slate-900">come back or are booked</b></> : <>are <b className="text-slate-900">booked to come back</b></>}: {num(T.good)} of {num(T.base)}.
              {yearAgo != null && <span className="text-slate-500"> A year earlier it was {fmtPct(yearAgo)}.</span>}</>}
        </p>
      </div>
    </div>
  )
}

function LineChart({ points, selected, unit = '', height = 160, fmt = num }) {
  const [hover, setHover] = useState(null)
  if (points.length < 2) return <p className="text-xs text-slate-400">Not enough months yet.</p>
  const W = 600, H = height, P = { l: 46, r: 10, t: 10, b: 22 }
  const vals = points.map((d) => d.v)
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const pad = (hi - lo) * 0.15 || 1
  const y0 = lo - pad, y1 = hi + pad
  const y = (v) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b)
  const x = (i) => P.l + (i / (points.length - 1)) * (W - P.l - P.r)
  const d = points.map((pt, i) => `${i ? 'L' : 'M'}${x(i)},${y(pt.v)}`).join(' ')
  const ticks = [lo, (lo + hi) / 2, hi]
  const at = hover ?? points.findIndex((pt) => pt.p === selected)
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" style={{ height }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const i = Math.round((((e.clientX - r.left) / r.width) * W - P.l) / (W - P.l - P.r) * (points.length - 1))
          setHover(Math.max(0, Math.min(points.length - 1, i)))
        }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="#eef2f7" />
            <text x={P.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#94a3b8">{fmt(t)}</text>
          </g>
        ))}
        {points.map((pt, i) => ((/-(01|07)$/.test(pt.p) || i === points.length - 1) ? (
          <text key={pt.p} x={x(i)} y={H - 4} textAnchor="middle" fontSize="11" fill="#94a3b8">{shortMonth(pt.p)}</text>
        ) : null))}
        {at >= 0 && <line x1={x(at)} x2={x(at)} y1={P.t} y2={H - P.b} stroke="#cbd5e1" />}
        <path d={d} fill="none" stroke="#059669" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {at >= 0 && <circle cx={x(at)} cy={y(points[at].v)} r="5" fill="#059669" stroke="#fff" strokeWidth="2" />}
      </svg>
      {at >= 0 && (
        <div className="absolute top-0 pointer-events-none text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1 shadow-sm -translate-x-1/2 whitespace-nowrap"
          style={{ left: `${Math.min(82, Math.max(22, (x(at) / W) * 100))}%` }}>
          <span className="text-slate-500">{periodLabel(points[at].p)}:</span> <b className="text-slate-800 tabular-nums">{fmt(points[at].v)}</b> {unit}
        </div>
      )}
    </div>
  )
}
