'use client'

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { OFFICE_CAN_FIX, carrierKey } from '@/lib/claimReasons'
import { LOCATIONS, shortLocation } from '@/lib/constants'
import { isoMonthKey } from '@/lib/dates'
import { periodLabel, AGE_BUCKETS, NP_CHANNELS, referralChannel, LAPSE_BUCKETS } from '@/lib/dentrixReports'
import { SPEND_CATEGORIES, MONTHLY_RENT, DEFAULT_RENT, RENT_HINT } from '@/lib/spendingEstimates'

// ─────────────────────────────────────────────────────────────────────────────
// The money story as one tree, growing down from gross production:
//
//   Gross production
//   ├─ Write-offs ─────────── insurance contracts · office discounts
//   └─ Net production
//      ├─ Collected ───────── from insurance · from patients · supplies · left
//      └─ Owed by insurance ─ by age · needs attention · by insurer
//
// Any card can also break down by location → team → provider. Clicking a card
// opens the row of cards beneath it; only one path is open at a time, so the
// tree always reads as a single line from the top.
//
// "Owed by insurance" is drawn with a dashed link: it is every open claim on
// the aging report, not a share of this month's production.
// ─────────────────────────────────────────────────────────────────────────────

const TONE = {
  gross:     { bar: 'bg-indigo-500',  text: 'text-indigo-700',  ring: 'ring-indigo-300',  stroke: '#a5b4fc' },
  writeoffs: { bar: 'bg-amber-500',   text: 'text-amber-700',   ring: 'ring-amber-300',   stroke: '#fcd34d' },
  net:       { bar: 'bg-emerald-500', text: 'text-emerald-700', ring: 'ring-emerald-300', stroke: '#6ee7b7' },
  cash:      { bar: 'bg-sky-500',     text: 'text-sky-700',     ring: 'ring-sky-300',     stroke: '#7dd3fc' },
  owed:      { bar: 'bg-violet-500',  text: 'text-violet-700',  ring: 'ring-violet-300',  stroke: '#c4b5fd' },
  cost:      { bar: 'bg-rose-400',    text: 'text-rose-600',    ring: 'ring-rose-300',    stroke: '#fda4af' },
  alert:     { bar: 'bg-red-500',     text: 'text-red-600',     ring: 'ring-red-300',     stroke: '#fca5a5' },
}

const TEAM_LABEL = { doctor: 'Doctors', hygiene: 'Hygiene', office: 'Office' }
const ATTENTION = ['Unsent', 'Rejected by eServices', 'Unprocessable Claim', 'Additional Information Requested']
const TOP_INSURERS = 12

function fmtShort(n) {
  const v = Number(n) || 0
  const a = Math.abs(v)
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `$${(a / 1e3).toFixed(1)}k` : `$${Math.round(a).toLocaleString('en-US')}`
  return v < 0 ? `-${s}` : s
}
function fmtFull(n) {
  const v = Math.round(Number(n) || 0)
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US')
}
const pct = (a, b) => (b > 0 ? (a / b) * 100 : null)
const fmtPct = (p) => (p == null ? '—' : `${p.toFixed(1)}%`)
function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function sum(rows) {
  let gross = 0, adj = 0, net = 0
  for (const r of rows) { gross += r.gross; adj += r.credit + r.charge; net += r.net }
  return { gross, writeoffs: -adj, net, rate: pct(-adj, gross) }
}

function groupBy(list, keyFn) {
  const m = new Map()
  for (const x of list) {
    const k = keyFn(x)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(x)
  }
  return m
}

// Supply Budget keeps both Dentique offices as one "Dentique" and Alora as "Alora".
function budgetLocation(loc) {
  if (/^dentique/i.test(loc)) return 'Dentique'
  if (/alora/i.test(loc)) return 'Alora'
  return LOCATIONS.includes(loc) ? loc : null
}

const ranked = (list) => list.filter((n) => Math.abs(n.value) >= 1).sort((a, b) => b.value - a.value)
const pill = (id, label, group, children) => ({ id, kind: 'pill', label, group, children })
const placeholder = (id, label, text, group) => ({ id, kind: 'placeholder', label, text, group })

// ── Building the tree ──────────────────────────────────────────────────────

// Production by location → team → provider, measuring net or write-offs.
// by = 'location': location → team → provider. by = 'team': team → provider,
// each provider summed across every location they worked at.
function productionBranch(prefix, rows, measure, tone, roleOf, by = 'location') {
  const node = (id, label, rs, kind, children) => {
    const t = sum(rs)
    return {
      id, label, kind, tone, rows: rs, totals: t, value: measure === 'writeoffs' ? t.writeoffs : measure === 'gross' ? t.gross : t.net,
      sub: measure === 'writeoffs' ? `${fmtPct(t.rate)} of its ${fmtShort(t.gross)} gross`
        : measure === 'gross' ? `${fmtShort(t.net)} net after write-offs`
        : `From ${fmtShort(t.gross)} gross · ${fmtPct(t.rate)} written off`,
      children,
    }
  }
  const providers = (id, rs) => () => ranked([...groupBy(rs, (r) => r.provider)]
    .map(([p, rsP]) => node(`${id}|${p}`, p, rsP, 'provider', null)))
  const teams = (id, rs) => () => ranked([...groupBy(rs, (r) => roleOf(r.provider))]
    .map(([team, rsTeam]) => node(`${id}|${team}`, TEAM_LABEL[team], rsTeam, 'money', providers(`${id}|${team}`, rsTeam))))
  if (by === 'team') return teams(prefix, rows)
  return () => ranked([...groupBy(rows, (r) => r.location)]
    .map(([loc, rsLoc]) => node(`${prefix}|${loc}`, shortLocation(loc), rsLoc, 'money', teams(`${prefix}|${loc}`, rsLoc))))
}

// The whole tree for one office: every input cut down to that location.
// Ad campaigns are bought per brand and shared across its offices by
// collections, so that split is worked out over all offices first (allocBase)
// and only then cut to the office. Supply Budget keeps the two Dentique
// offices as one, so supplies for either show Dentique as a whole.
function buildTree(props) {
  const loc = props.location
  if (!loc) return buildTreeFor(props)
  const allColl = props.collections.flatMap((c) => c.rows)
  const allocBase = {}
  if (allColl.length) for (const r of allColl) allocBase[r.location] = (allocBase[r.location] || 0) + r.total
  else for (const r of props.rows) allocBase[r.location] = (allocBase[r.location] || 0) + r.net
  const b = budgetLocation(loc)
  return buildTreeFor({
    ...props,
    allocBase,
    rows: props.rows.filter((r) => r.location === loc),
    collections: props.collections.map((c) => ({ ...c, rows: c.rows.filter((r) => r.location === loc) })),
    aging: props.aging ? { ...props.aging, locations: props.aging.locations[loc] ? { [loc]: props.aging.locations[loc] } : {} } : props.aging,
    newPatients: props.newPatients ? Object.fromEntries(Object.entries(props.newPatients).map(([p, byLoc]) => [p, byLoc?.[loc] ? { [loc]: byLoc[loc] } : {}])) : props.newPatients,
    budget: props.budget?.status === 'ready' ? {
      ...props.budget,
      entries: props.budget.entries.filter((e) => e.clinic === b),
      collections: Object.fromEntries(Object.entries(props.budget.collections || {}).map(([p, m]) => [p, b && m?.[b] != null ? { [b]: m[b] } : {}])),
    } : props.budget,
  })
}

function buildTreeFor({ rows, roleOf, periods, periodText, officeShare, budget, collections, aging, newPatients, marketing: ads, adSpend, schedule, followUp, allocBase }) {
  const prod = sum(rows)
  const inPeriods = new Set(periods)

  // Collected: the Dentrix collection report when there is one for these months,
  // otherwise the collections typed into Supply Budget.
  let collected = null
  if (collections.length) {
    const all = collections.flatMap((c) => c.rows)
    const byLoc = [...groupBy(all, (r) => r.location)].map(([loc, rs]) => ({
      loc, total: rs.reduce((s, r) => s + r.total, 0),
      insurance: rs.reduce((s, r) => s + r.insurance, 0), patients: rs.reduce((s, r) => s + r.patients, 0),
    }))
    collected = {
      source: 'Collection report', byLoc,
      total: all.reduce((s, r) => s + r.total, 0),
      insurance: all.reduce((s, r) => s + r.insurance, 0),
      patients: all.reduce((s, r) => s + r.patients, 0),
      refunds: all.reduce((s, r) => s + r.refunds, 0),
      months: collections.length,
    }
    // Reports broken down by month of service say which work each payment was
    // for. Only usable when every collection report in view has that.
    if (collections.every((c) => c.rows.some((r) => r.service))) {
      const byService = {}
      for (const r of all) byService[r.service] = (byService[r.service] || 0) + r.total
      collected.byService = byService
      collected.forThis = periods.reduce((s, p) => s + (byService[p] || 0), 0)
      collected.forThisIns = all.filter((r) => inPeriods.has(r.service)).reduce((s, r) => s + r.insurance, 0)
      collected.forThisPat = all.filter((r) => inPeriods.has(r.service)).reduce((s, r) => s + r.patients, 0)
      collected.byServiceLoc = {}
      for (const r of all) if (inPeriods.has(r.service)) collected.byServiceLoc[r.location] = (collected.byServiceLoc[r.location] || 0) + r.total
    }
  } else if (budget?.status === 'ready') {
    const byLoc = LOCATIONS.map((loc) => ({ loc, total: periods.reduce((s, p) => s + (budget.collections[p]?.[loc] ?? 0), 0) }))
    const total = byLoc.reduce((s, l) => s + l.total, 0)
    if (total > 0) collected = { source: 'Supply Budget', byLoc, total }
  }

  // Supplies always come from Supply Budget.
  let supplies = null
  if (budget?.status === 'ready') {
    const spend = budget.entries.filter((e) => inPeriods.has(isoMonthKey(e.date)))
    supplies = { spend, total: spend.reduce((s, e) => s + (e.amount || 0), 0) }
  }

  // ── Write-offs ──
  const writeoffKids = () => [
    ...(officeShare != null ? [
      { id: 'wo|ins', kind: 'money', tone: 'writeoffs', group: 'What they were', label: 'Insurance contracts', value: prod.writeoffs * (1 - officeShare / 100),
        sub: '≈ estimated from the Adjustment Summary mix' },
      { id: 'wo|office', kind: 'money', tone: 'writeoffs', group: 'What they were', label: 'Office discounts & courtesies', value: prod.writeoffs * (officeShare / 100),
        sub: '≈ the part the office chooses to give' },
    ] : [placeholder('wo|mix', 'Insurance vs office', 'Upload the Adjustment Summary to split this.', 'What they were')]),
    pill('wo|loc', 'By location', 'Break down', productionBranch('wo', rows, 'writeoffs', 'writeoffs', roleOf)),
    pill('wo|prov', 'By provider', 'Break down', productionBranch('wo|p', rows, 'writeoffs', 'writeoffs', roleOf, 'team')),
  ]

  // Payment types (card, check, financing…) when the report has them.
  const allColl = collections.flatMap((c) => c.rows)
  const byType = (prefix, who, onlyThis = false) => {
    if (!allColl.some((r) => r.type)) return null
    const rows = onlyThis ? allColl.filter((r) => inPeriods.has(r.service)) : allColl
    return () => ranked([...groupBy(rows.filter((r) => r[who]), (r) => r.type || 'Other')].map(([t, rs]) => ({
      id: `${prefix}|${t}`, kind: 'money', tone: 'cash', label: t, value: rs.reduce((s, r) => s + r[who], 0),
    })))
  }

  // Money paid for this month's own work: the same breakdown wherever it shows.
  const forThisKids = (prefix) => () => [
    { id: `${prefix}|ins`, kind: 'money', tone: 'cash', group: 'Where it came from', label: 'From insurance', value: collected.forThisIns,
      children: byType(`${prefix}|ins`, 'insurance', true) },
    { id: `${prefix}|pat`, kind: 'money', tone: 'cash', group: 'Where it came from', label: 'From patients', value: collected.forThisPat,
      children: byType(`${prefix}|pat`, 'patients', true) },
    pill(`${prefix}|loc`, 'By location', 'Break down', () => ranked(Object.entries(collected.byServiceLoc).map(([loc, v]) => ({
      id: `${prefix}|loc|${loc}`, kind: 'money', tone: 'cash', label: shortLocation(loc), value: v })))),
  ].filter((n) => n.kind === 'pill' || Math.abs(n.value) >= 1)

  // ── Collected ──
  const collectedNode = collected ? {
    // Its own tree, beside gross production: money arriving this month is
    // mostly for earlier months' work, so it can't be a branch of this
    // month's production without the branches stopping adding up.
    id: 'collected', kind: 'root', tone: 'cash', group: 'Cash received', label: 'Collected', value: collected.total, source: collected.source,
    sub: collected.forThis != null
      ? `Money that arrived in ${periodText}, across several months of work: ${fmtShort(collected.forThis)} for ${periodText} work (the same as “Collected so far”) + ${fmtShort(collected.total - collected.forThis)} for earlier months`
      : `Money that arrived in ${periodText}, for this and earlier months' work`,
    children: () => {
      const kids = []
      if (collected.forThis != null) {
        const earlier = Object.entries(collected.byService)
          .filter(([m]) => !inPeriods.has(m))
          .sort(([a], [b]) => (a === 'unknown' ? 1 : b === 'unknown' ? -1 : b.localeCompare(a)))
        kids.push(
          { id: 'c|this', kind: 'money', tone: 'cash', group: 'Which work it paid for', label: `${periodText} work`, value: collected.forThis,
            sub: `Same money as “Collected so far” · ${fmtShort(collected.forThisIns)} insurance, ${fmtShort(collected.forThisPat)} patients` },
          { id: 'c|earlier', kind: 'money', tone: 'cash', group: 'Which work it paid for', label: 'Other months\u2019 work', value: collected.total - collected.forThis,
            sub: 'Older claims and balances catching up, plus credits not yet tied to work',
            // The last few months one by one; the long tail as a single card.
            children: () => {
              const latest = [...periods].sort().pop()
              const ahead = earlier.filter(([m]) => m !== 'unknown' && m > latest)   // paid before the work was done
              const recent = earlier.filter(([m]) => m !== 'unknown' && m < latest).slice(0, 4)
              const unapplied = earlier.find(([m]) => m === 'unknown')
              const rest = earlier.filter((e) => !recent.includes(e) && !ahead.includes(e) && e !== unapplied)
              const aheadTotal = ahead.reduce((s, [, v]) => s + v, 0)
              const older = rest.reduce((s, [, v]) => s + v, 0)
              return [
                ...recent.map(([m, v]) => ({ id: `c|earlier|${m}`, kind: 'money', tone: 'cash', label: periodLabel(m), value: v })),
                ...(Math.abs(older) >= 1 ? [{ id: 'c|earlier|older', kind: 'money', tone: 'cash', label: 'Older', value: older,
                  sub: `${rest.length} earlier months, back to ${periodLabel(rest.map(([m]) => m).sort()[0])}` }] : []),
                ...(Math.abs(aheadTotal) >= 1 ? [{ id: 'c|earlier|ahead', kind: 'money', tone: 'cash', label: 'Paid ahead',
                  value: aheadTotal, sub: `For work dated after ${periodLabel(latest)}` }] : []),
                // No service month: received but not tied to a procedure yet.
                ...(unapplied && Math.abs(unapplied[1]) >= 1 ? [{ id: 'c|earlier|unapplied', kind: 'money', tone: 'alert', label: 'Not tied to a procedure yet',
                  value: unapplied[1], sub: 'Sitting as a credit on the account' }] : []),
              ].filter((n) => Math.abs(n.value) >= 1)
            } },
        )
      }
      if (collected.insurance != null) {
        kids.push(
          { id: 'c|ins', kind: 'money', tone: 'cash', group: 'Where it came from', label: 'From insurance', value: collected.insurance, sub: 'Insurance payments',
            children: byType('c|ins', 'insurance') },
          { id: 'c|pat', kind: 'money', tone: 'cash', group: 'Where it came from', label: 'From patients', value: collected.patients,
            sub: collected.refunds ? `Patient payments · ${fmtShort(collected.refunds)} refunded` : 'Patient payments',
            children: byType('c|pat', 'patients') },
        )
      }
      if (supplies && !supplies.spend.length) {
        kids.push(placeholder('c|sup', 'Supplies', `Nothing entered in Supply Budget for ${periodText}.`, 'What it covered'))
      } else if (supplies) {
        kids.push(
          { id: 'c|sup', kind: 'money', tone: 'cost', group: 'What it covered', label: 'Supplies', value: supplies.total,
            sub: `${fmtPct(pct(supplies.total, collected.total))} of collections · budget is 6%`,
            children: () => ranked(LOCATIONS.map((loc) => {
              const es = supplies.spend.filter((e) => e.clinic === loc)
              const total = es.reduce((s, e) => s + (e.amount || 0), 0)
              const coll = collected.byLoc.filter((l) => budgetLocation(l.loc) === loc).reduce((s, l) => s + l.total, 0)
              return {
                id: `c|sup|${loc}`, kind: 'money', tone: 'cost', label: shortLocation(loc), value: total,
                sub: `${fmtPct(pct(total, coll))} of ${shortLocation(loc)} collections`,
                children: () => ranked([...groupBy(es, (e) => e.vendor || 'No vendor')].map(([v, vs]) => ({
                  id: `c|sup|${loc}|${v}`, kind: 'money', tone: 'cost', label: v, value: vs.reduce((s, e) => s + (e.amount || 0), 0),
                  sub: `${vs.length} purchase${vs.length === 1 ? '' : 's'}`,
                }))),
              }
            })) },
          { id: 'c|left', kind: 'money', tone: 'cash', group: 'What it covered', label: 'Left after supplies', value: collected.total - supplies.total,
            sub: 'Before lab, payroll, rent and other costs' },
        )
      }
      kids.push(
        placeholder('c|more', 'Lab, payroll, rent…', 'Add a P&L export to carry this through to profit.', 'What it covered'),
        pill('c|loc', 'By location', 'Break down', () => ranked(collected.byLoc.map((l) => {
          const netLoc = rows.filter((r) => (collected.source === 'Supply Budget' ? budgetLocation(r.location) === l.loc : r.location === l.loc)).reduce((s, r) => s + r.net, 0)
          return {
            id: `c|loc|${l.loc}`, kind: 'money', tone: 'cash', label: shortLocation(l.loc), value: l.total,
            sub: l.insurance != null
              ? `${fmtShort(l.insurance)} insurance · ${fmtShort(l.patients)} patients`
              : `${fmtPct(pct(l.total, netLoc))} of net production`,
          }
        }))),
      )
      return kids
    },
  } : placeholder('collected', 'Collected', `Upload the collection report for ${periodText}.`, 'Cash received')

  // ── Still owed by insurance (aging) ──
  // The aging report lists every open claim. Claims are grouped by month of
  // service, so the tree shows what is still unpaid for THIS month's work — a
  // true part of its net production — with the whole backlog one click away.
  let agingFacts = null
  let owedNode = placeholder('owed', 'Still owed by insurance', 'Upload the aging report to see open claims.', 'What happened to it')
  if (aging) {
    const asOf = fmtDate(aging.asOf) || 'the report date'
    const locs = Object.entries(aging.locations)
    const byMonth = locs.some(([, l]) => l.months)
    const monthLocs = (ps) => locs.map(([loc, l]) => [loc, mergeAging(ps.map((p) => l.months?.[p]).filter(Boolean))])
    const allLocs = locs
    const backlogMonths = [...new Set(locs.flatMap(([, l]) => Object.keys(l.months || {})))]
      .sort((a, b) => (a === 'unknown' ? 1 : b === 'unknown' ? -1 : b.localeCompare(a)))

    const backlog = {
      id: 'o|backlog', kind: 'money', tone: 'owed', group: 'Every open claim', label: 'All months', noShare: true,
      ...owedTotals(allLocs),
      sub: `${owedTotals(allLocs).claims.toLocaleString()} open claims as of ${asOf}`,
      children: () => owedBreakdown('o|backlog', allLocs, followUp),
    }
    backlog.value = backlog.expected

    const scoped = byMonth ? monthLocs(periods) : allLocs
    const t = owedTotals(scoped)
    const scopedAll = mergeAging(scoped.map(([, l]) => l))
    agingFacts = {
      attention: ATTENTION.reduce((s, k) => s + (scopedAll.statuses[k]?.expected || 0), 0),
      attentionClaims: ATTENTION.reduce((s, k) => s + (scopedAll.statuses[k]?.claims || 0), 0),
      old: mergeAging(allLocs.map(([, l]) => l)).buckets['120+'] || { expected: 0, claims: 0 },
      asOf,
    }
    owedNode = {
      id: 'owed', kind: 'money', tone: 'owed', group: 'What happened to it', label: 'Still owed by insurance', value: t.expected,
      source: 'Aging report', noShare: !byMonth, dashed: !byMonth,
      sub: byMonth
        ? `${t.claims.toLocaleString()} claims for ${periodText} work still open on ${asOf} · ${fmtShort(t.billed)} billed`
        : `${t.claims.toLocaleString()} open claims as of ${asOf} — all months`,
      children: () => [
        ...owedBreakdown('o', scoped, followUp),
        ...(byMonth ? [pill('o|all', 'Whole backlog, every month', 'Every open claim', () => [
          backlog,
          ...backlogMonths.map((m) => {
            const ml = monthLocs([m])
            const mt = owedTotals(ml)
            return {
              id: `o|all|${m}`, kind: 'money', tone: 'owed', group: 'By month of service',
              label: m === 'unknown' ? 'No service date' : periodLabel(m), value: mt.expected, noShare: true,
              sub: `${mt.claims.toLocaleString()} claims`,
              children: () => owedBreakdown(`o|all|${m}`, ml, followUp),
            }
          }).filter((n) => n.value >= 1),
        ])] : []),
      ],
    }
  }

  // Net production splits into what insurance still owes for this month's work
  // and the rest, so the two always add back up to net.
  const netKids = () => {
    const owedKnown = owedNode.kind === 'money' && !owedNode.dashed
    // Best case: collections by month of service say how much of this
    // month's own work is already paid.
    if (collected?.forThis != null && owedKnown) {
      const paid = {
        id: 'paid', kind: 'money', tone: 'cash', group: 'What happened to it', label: 'Collected so far', value: collected.forThis,
        sub: `Paid in ${periodText} for ${periodText} work`,
        // Money that came in for older work is shown here too, as context, so
        // the whole cash story lives in this one flow.
        note: `+ ${fmtShort(collected.total - collected.forThis)} more came in for earlier months · ${fmtShort(collected.total)} collected in ${periodText}`,
        children: () => [
          ...forThisKids('paid')(),
          { ...collectedNode, kind: 'money', id: 'collected', group: `Everything collected in ${periodText}`, noShare: true, dashed: true,
            label: `All money collected in ${periodText}`,
            sub: `${fmtShort(collected.forThis)} for ${periodText} work + ${fmtShort(collected.total - collected.forThis)} for earlier months` },
        ],
      }
      // The aging report's "expected" amount is the full contracted amount on
      // each open claim — patient share included — so it overlaps with what
      // patients already paid. Net therefore splits into paid and not yet
      // paid, and the open claims hang beneath "not yet" as context, never
      // added on top.
      const notYet = prod.net - collected.forThis
      // Shown beneath "Not collected yet" as context only: the claims' full
      // contracted amount includes what patients already paid, so it overlaps
      // "Collected so far" and is not a slice of the $ not collected.
      const claims = { ...owedNode, id: 'owed', label: 'Open claims', noShare: true, dashed: true, group: 'Waiting on insurance',
        note: 'Context, not a part of “Not collected yet”: it includes what patients already paid.',
        sub: `${owedNode.sub} · full contracted amount, incl. the patient’s share` }
      const kids = [paid, {
        id: 'notyet', kind: 'money', tone: 'owed', group: 'What happened to it', label: 'Not collected yet', value: notYet,
        sub: `Net production for ${periodText} work that hasn't been paid yet`,
        children: () => [claims, pill('notyet|loc', 'By location', 'Break down', () => ranked([...groupBy(rows, (r) => r.location)].map(([loc, rs]) => {
          const net = rs.reduce((s, r) => s + r.net, 0)
          const paidLoc = collected.byServiceLoc?.[loc] || 0
          return { id: `notyet|loc|${loc}`, kind: 'money', tone: 'owed', label: shortLocation(loc), value: net - paidLoc,
            sub: `${fmtShort(net)} net · ${fmtShort(paidLoc)} paid so far` }
        })))],
      }]
      kids.push(
        pill('net|loc', 'By location', 'Break down', productionBranch('net', rows, 'net', 'net', roleOf)),
        pill('net|prov', 'By provider', 'Break down', productionBranch('net|p', rows, 'net', 'net', roleOf, 'team')),
      )
      return kids
    }
    // Without collections by month of service, net can't be split into paid
    // and not paid. The aging report's open claims include the patient's
    // share, so subtracting them from net would understate what's been paid —
    // they're shown as context only, never as a part of net.
    const kids = [placeholder('net|split', 'Collected vs not yet',
      `Needs the ${periodText} collections report broken down by month of service (the same report as October’s) to split this.`,
      'What happened to it')]
    if (owedNode.kind === 'money') {
      kids.push({ ...owedNode, id: 'owed', label: 'Open insurance claims', noShare: true, dashed: true, group: 'Waiting on insurance',
        sub: `${owedNode.sub} · full contracted amount, including the patients' share` })
    }
    kids.push(
        pill('net|loc', 'By location', 'Break down', productionBranch('net', rows, 'net', 'net', roleOf)),
        pill('net|prov', 'By provider', 'Break down', productionBranch('net|p', rows, 'net', 'net', roleOf, 'team')),
      )
    return kids
  }

  const work = {
    id: 'root', kind: 'root', tone: 'gross', group: 'Work done', label: 'Gross production', value: prod.gross, source: 'Dentrix',
    sub: `Full fees for all the work done in ${periodText}`,
    children: () => [
      { id: 'writeoffs', kind: 'money', tone: 'writeoffs', group: 'Where it went', label: 'Write-offs', value: prod.writeoffs, source: 'Dentrix',
        sub: `${fmtPct(prod.rate)} of gross · given up to insurance contracts and discounts`, children: writeoffKids },
      { id: 'net', kind: 'money', tone: 'net', group: 'Where it went', label: 'Net production', value: prod.net, source: 'Dentrix',
        sub: 'What can actually be collected',
        children: netKids },
      pill('gross|loc', 'By location', 'Break down', productionBranch('gross', rows, 'gross', 'gross', roleOf)),
      pill('gross|prov', 'By provider', 'Break down', productionBranch('gross|p', rows, 'gross', 'gross', roleOf, 'team')),
    ],
  }
  // ── Money out (placeholder estimates) ──
  // Scaled to each office's collections, or its net production when there is
  // no collection report. Supplies use the real Supply Budget figure when the
  // month has entries.
  const baseByLoc = {}
  if (collected?.byLoc && collected.source !== 'Supply Budget') for (const l of collected.byLoc) baseByLoc[l.loc] = l.total
  else for (const r of rows) baseByLoc[r.location] = (baseByLoc[r.location] || 0) + r.net
  const spendLocs = Object.keys(baseByLoc)
  const realSupplies = supplies && supplies.spend.length ? supplies : null
  const spendLines = SPEND_CATEGORIES.map((c) => ({
    ...c,
    byLoc: Object.fromEntries(spendLocs.map((loc) => [loc,
      c.key === 'supplies' && realSupplies
        ? realSupplies.spend.filter((e) => budgetLocation(loc) === e.clinic).reduce((s, e) => s + (e.amount || 0), 0)
        : baseByLoc[loc] * c.pct])),
    real: c.key === 'supplies' && !!realSupplies,
  }))
  spendLines.splice(2, 0, {
    key: 'rent', label: 'Rent', hint: RENT_HINT,
    byLoc: Object.fromEntries(spendLocs.map((loc) => [loc, (MONTHLY_RENT[loc] ?? DEFAULT_RENT) * periods.length])),
  })
  // Real ad spend replaces the marketing estimate. Each ad account belongs to
  // a brand; its spend is shared across that brand's offices by collections.
  // Billed amounts from reports/ad-spend.csv, plus whatever the APIs return.
  // A platform in the file wins over the same platform from an API, so it is
  // never counted twice.
  const fileAds = (adSpend || []).filter((r) => periods.includes(r.period))
  const filePlatforms = new Set(fileAds.map((r) => r.platform))
  const apiConnected = ads?.status === 'ready' ? Object.entries(ads.platforms || {}).filter(([, v]) => v === 'connected').map(([k]) => (k === 'meta' ? 'Meta' : 'Google')) : []
  const connected = [...new Set([...apiConnected, ...filePlatforms])]
  const metaReady = connected.length > 0   // any real ad spend
  const googleReady = connected.includes('Google')
  const adRows = [
    ...fileAds,
    ...(ads?.status === 'ready' ? (ads.rows || []).filter((r) => !filePlatforms.has(r.platform)) : []),
  ]
  // A brand is shared across its offices; an exact office name (a campaign
  // aimed at one town) stays with that office. Each campaign is split once,
  // here, so every card that shows campaigns adds up to the same totals.
  // Shared over every office (allocBase when the tree is cut to one office).
  const allocBy = allocBase || baseByLoc
  const allocLocs = Object.keys(allocBy)
  const officesOf = (brand) => allocLocs.includes(brand) ? [brand] : allocLocs.filter((loc) =>
    /valley view/i.test(brand) ? /^valley view dental/i.test(loc)
      : /dentique/i.test(brand) ? /^dentique/i.test(loc)
      : /alora/i.test(brand) ? /alora/i.test(loc) : false)
  const adAlloc = []   // { loc, campaign, platform, brand, amount, shared }
  for (const r of adRows) {
    const offices = officesOf(r.brand)
    const base = offices.reduce((s, loc) => s + Math.max(0, allocBy[loc] || 0), 0)
    for (const loc of offices) {
      if (!spendLocs.includes(loc)) continue   // another office's share
      adAlloc.push({
        loc, campaign: r.campaign, platform: r.platform, brand: r.brand, shared: offices.length > 1,
        amount: base > 0 ? r.spend * Math.max(0, allocBy[loc] || 0) / base : r.spend / offices.length,
      })
    }
  }
  if (metaReady) {
    const line = spendLines.find((l) => l.key === 'marketing')
    line.byLoc = Object.fromEntries(spendLocs.map((loc) => [loc, 0]))
    for (const a of adAlloc) line.byLoc[a.loc] += a.amount
    Object.assign(line, { real: true, pct: null, hint: `${connected.join(' + ')} ads, actual spend${googleReady ? '' : ' · Google Ads not connected yet'}` })
  }
  for (const l of spendLines) l.total = Object.values(l.byLoc).reduce((s, v) => s + v, 0)
  // Only real costs are added up — marketing from ad billing, supplies from
  // Supply Budget. Everything else is shown as "not tracked yet", with no number.
  const realLines = spendLines.filter((l) => l.real)
  const untracked = spendLines.filter((l) => !l.real)
  const spent = realLines.reduce((s, l) => s + l.total, 0)
  const income = collected?.total ?? null

  const campaignsAt = (prefix, loc) => adAlloc.length ? () => ranked(adAlloc.filter((a) => a.loc === loc).map((a, i) => ({
    id: `${prefix}|c|${i}|${a.campaign}`, kind: 'money', tone: 'cost', label: a.campaign, value: a.amount,
    sub: a.shared ? `${a.platform} · this office's share of a ${shortLocation(a.brand)} campaign` : `${a.platform} · aimed at this office`,
  }))) : undefined

  // ── New patients, hung under marketing: what the spend brought in ──
  const np = []   // { loc, source, channel, patients, production }
  for (const p of periods) for (const [loc, bySrc] of Object.entries(newPatients?.[p] || {})) {
    for (const [source, v] of Object.entries(bySrc)) np.push({ loc, source, channel: referralChannel(source), ...v })
  }
  const npTotal = np.reduce((s, x) => s + x.patients, 0)
  const marketing = spendLines.find((l) => l.key === 'marketing')
  marketing.total = Object.values(marketing.byLoc).reduce((s, v) => s + v, 0)
  // With only Meta connected, a per-patient cost would look far too cheap —
  // say what it covers.
  const perPatient = (cost, n) => (n <= 0 ? 'No new patients recorded'
    : metaReady && !googleReady ? `${fmtShort(cost / n)} of Meta spend per new patient (Google not counted yet)`
    : `${fmtShort(cost / n)} marketing per new patient`)
  const npNode = (id, label, list, cost, children) => {
    const n = list.reduce((s, x) => s + x.patients, 0)
    const prodNp = list.reduce((s, x) => s + x.production, 0)
    return {
      id, kind: 'money', tone: 'net', label, value: n, count: true, noShare: true,
      sub: `${fmtShort(prodNp)} of first-visit production${cost != null ? ' · ' + perPatient(cost, n) : ''}`,
      children,
    }
  }
  // Ad results: each platform's spend per brand against the new patients whose
  // "Referred By" names that platform. Dentrix can't tell a paid click from a
  // free visit (an ad from an organic listing or review), so it's approximate.
  const brandOfOffice = (loc) => /^valley view/i.test(loc) ? 'Valley View Dental' : /^dentique/i.test(loc) ? 'Dentique' : /alora/i.test(loc) ? 'Alora Dental Spa' : loc
  const brandOfSpend = (b) => /^valley view/i.test(b) ? 'Valley View Dental' : /^dentique/i.test(b) ? 'Dentique' : /alora/i.test(b) ? 'Alora Dental Spa' : b
  const AD_PLATFORMS = [
    { key: 'Google', source: /google/i },                                          // GOOGLE SEARCH / ADS / REVIEW
    { key: 'Meta', source: /facebook|instagram|\bmeta\b|\bfb\b|\big\b/i },          // FACEBOOK / INSTAGRAM, SOCIAL MEDIA
  ]
  const adResults = {}   // platform → brand → { spend, patients }
  for (const r of adRows) {
    const cell = ((adResults[r.platform] ||= {})[brandOfSpend(r.brand)] ||= { spend: 0, patients: 0 })
    cell.spend += r.spend
  }
  for (const x of np) for (const pl of AD_PLATFORMS) if (pl.source.test(x.source)) {
    const cell = ((adResults[pl.key] ||= {})[brandOfOffice(x.loc)] ||= { spend: 0, patients: 0 })
    cell.patients += x.patients
  }
  const resultCard = (id, label, g, platform) => ({
    id, kind: 'money', tone: g.spend >= 1000 && !g.patients ? 'alert' : 'cost', label, value: g.spend,
    outcome: { patients: g.patients, each: g.patients && g.spend ? g.spend / g.patients : null },
    sub: g.patients
      ? `New patients whose "Referred by" names ${platform}`
      : `No new patient recorded as coming from ${platform} in ${periodText}`,
  })
  // Marketing opens by platform first: what was spent on Google, Meta… and
  // how many new patients named that platform. Each platform then opens into
  // those patients (by office), its brands, and its campaigns.
  const platformCards = Object.entries(adResults).map(([pl, brands]) => {
    const t = Object.values(brands).reduce((a, g) => ({ spend: a.spend + g.spend, patients: a.patients + g.patients }), { spend: 0, patients: 0 })
    const fromPl = np.filter((x) => AD_PLATFORMS.find((a) => a.key === pl)?.source.test(x.source))
    const camps = adRows.filter((r) => r.platform === pl)
    return {
      ...resultCard(`s|marketing|pl|${pl}`, pl, t, pl), group: 'By platform',
      children: () => [
        ...(fromPl.length ? [npNode(`s|marketing|pl|${pl}|np`, `New patients from ${pl}`, fromPl, null, () => ranked([...groupBy(fromPl, (x) => x.loc)].map(([loc, xs]) => ({
          ...npNode(`s|marketing|pl|${pl}|np|${loc}`, shortLocation(loc), xs, null, () => ranked([...groupBy(xs, (x) => x.source)].map(([src, ys]) =>
            npNode(`s|marketing|pl|${pl}|np|${loc}|${src}`, src, ys, null)))),
        }))))].map((n) => ({ ...n, group: 'What it brought' })) : [placeholder(`s|marketing|pl|${pl}|np`, `New patients from ${pl}`, `No new patients recorded as coming from ${pl} in ${periodText}.`, 'What it brought')]),
        ...ranked(Object.entries(brands).filter(([, g]) => g.spend >= 1).map(([b, g]) => {
          const bc = camps.filter((r) => brandOfSpend(r.brand) === b)
          return {
            ...resultCard(`s|marketing|pl|${pl}|${b}`, b, g, pl), group: 'By brand',
            children: () => {
              const brought = fromPl.filter((x) => brandOfOffice(x.loc) === b)
              return [
                brought.length
                  ? { ...npNode(`s|marketing|pl|${pl}|${b}|np`, 'What it brought', brought, null, () => ranked([...groupBy(brought, (x) => x.loc)].map(([loc, xs]) =>
                      npNode(`s|marketing|pl|${pl}|${b}|np|${loc}`, shortLocation(loc), xs, null)))), group: 'What it brought' }
                  : { id: `s|marketing|pl|${pl}|${b}|np`, kind: 'money', tone: 'alert', group: 'What it brought', label: 'What it brought', value: 0, count: true, noShare: true,
                      sub: `${fmtShort(g.spend)} spent, and no ${b} new patient named ${pl}. Patients can\u2019t be traced to a single campaign.` },
                ...ranked(bc.map((r, i) => ({
                  id: `s|marketing|pl|${pl}|${b}|${i}`, kind: 'money', tone: 'cost', group: 'Campaigns', label: r.campaign, value: r.spend,
                  sub: officesOf(r.brand).length > 1 ? `Shared across ${officesOf(r.brand).map(shortLocation).join(', ')}` : `Aimed at ${shortLocation(r.brand)}`,
                }))),
              ]
            },
          }
        })),
      ],
    }
  }).sort((a, b) => b.value - a.value)

  const campaignKids = metaReady ? [
    pill('s|marketing|camp', 'By campaign', 'Other views', () => ranked(adRows.map((r, i) => ({
      id: `s|marketing|camp|${i}`, kind: 'money', tone: 'cost', label: r.campaign, value: r.spend,
      sub: `${r.platform} · ${r.brand}${r.leads ? ` · ${r.leads} lead${r.leads === 1 ? '' : 's'}` : ''}`,
    })))),
    ...(googleReady ? [] : [placeholder('s|marketing|google', 'Google Ads', 'Not connected yet \u2014 add the Google Ads API keys to include it.', 'Other views')]),
  ] : []
  // The main marketing path: spend → the patients it brought → which office →
  // which platform → that office's campaigns and the sources patients named.
  const isAdSource = (src) => AD_PLATFORMS.some((a) => a.source.test(src))
  const adNp = np.filter((x) => isAdSource(x.source))
  const adPatients = adNp.reduce((s, x) => s + x.patients, 0)
  const sumPatients = (xs) => xs.reduce((s, x) => s + x.patients, 0)
  const officeCards = ranked(spendLocs.map((loc) => {
    const spend = marketing.byLoc[loc] || 0
    const here = adNp.filter((x) => x.loc === loc)
    if (spend < 1 && !here.length) return null
    const plats = [...new Set([...adAlloc.filter((a) => a.loc === loc).map((a) => a.platform), ...AD_PLATFORMS.filter((a) => here.some((x) => a.source.test(x.source))).map((a) => a.key)])]
    const card = resultCard(`s|marketing|o|${loc}`, shortLocation(loc), { spend, patients: sumPatients(here) }, plats.length === 1 ? plats[0] : 'Google or Meta')
    return {
      ...card,
      // One platform only: the platform card would repeat this one, so say it
      // here and open straight into what patients said and the campaigns.
      sub: plats.length === 1 ? `All ${plats[0]} · ${card.sub}` : card.sub,
      group: 'Which location',
      children: () => {
        const kids = platKids()
        return kids.length === 1 && kids[0].children ? kids[0].children() : kids
      },
    }
    function platKids() {
      return ranked(plats.map((pl) => {
        const re = AD_PLATFORMS.find((a) => a.key === pl)?.source
        const from = re ? here.filter((x) => re.test(x.source)) : []
        const camps = adAlloc.filter((a) => a.loc === loc && a.platform === pl)
        const plSpend = camps.reduce((s, a) => s + a.amount, 0)
        return {
          ...resultCard(`s|marketing|o|${loc}|${pl}`, pl, { spend: plSpend, patients: sumPatients(from) }, pl),
          group: 'Which platform',
          children: () => [
            ...ranked([...groupBy(from, (x) => x.source)].map(([src, ys]) => ({
              ...npNode(`s|marketing|o|${loc}|${pl}|np|${src}`, src, ys, null), group: 'What patients said' }))),
            ...ranked(camps.map((a, i) => ({
              id: `s|marketing|o|${loc}|${pl}|c|${i}`, kind: 'money', tone: 'cost', group: 'Campaigns', label: a.campaign, value: a.amount,
              sub: a.shared ? `This office's share of a ${shortLocation(a.brand)} campaign` : 'Aimed at this office',
            }))),
          ],
        }
      }).filter((n) => n.value >= 1 || n.outcome.patients))
    }
  }).filter(Boolean))

  // The main path: Marketing → Google / Meta → which office → what patients
  // said and that office's campaigns on the platform.
  const platformFirst = ranked(AD_PLATFORMS.map(({ key: pl, source: re }) => {
    const from = adNp.filter((x) => re.test(x.source))
    const spend = adAlloc.filter((a) => a.platform === pl).reduce((s, a) => s + a.amount, 0)
    if (spend < 1 && !from.length) return null
    return {
      ...resultCard(`s|marketing|p|${pl}`, pl, { spend, patients: sumPatients(from) }, pl),
      group: 'Which platform',
      children: () => ranked(spendLocs.map((loc) => {
        const here = from.filter((x) => x.loc === loc)
        const camps = adAlloc.filter((a) => a.loc === loc && a.platform === pl)
        const locSpend = camps.reduce((s, a) => s + a.amount, 0)
        if (locSpend < 1 && !here.length) return null
        return {
          ...resultCard(`s|marketing|p|${pl}|${loc}`, shortLocation(loc), { spend: locSpend, patients: sumPatients(here) }, pl),
          group: 'Which location',
          children: () => [
            ...ranked([...groupBy(here, (x) => x.source)].map(([src, ys]) => ({
              ...npNode(`s|marketing|p|${pl}|${loc}|np|${src}`, src, ys, null), group: 'What patients said' }))),
            ...ranked(camps.map((a, i) => ({
              id: `s|marketing|p|${pl}|${loc}|c|${i}`, kind: 'money', tone: 'cost', group: 'Campaigns', label: a.campaign, value: a.amount,
              sub: a.shared ? `This office's share of a ${shortLocation(a.brand)} campaign` : 'Aimed at this office',
            }))),
          ],
        }
      }).filter(Boolean)),
    }
  }).filter(Boolean))

  const marketingKids = npTotal || metaReady ? () => [
    ...platformFirst,
    pill('s|marketing|loc', 'By location', 'Other views', () => officeCards),
    npTotal ? { ...npNode('s|marketing|np', 'All new patients', np, marketing.total, () => [
      ...ranked(NP_CHANNELS.map((ch) => {
        const list = np.filter((x) => x.channel === ch)
        const bySource = (id, xs) => () => ranked([...groupBy(xs, (x) => x.source)].map(([src, ys]) => npNode(`${id}|${src}`, src, ys, null)))
        // Online sources sit under the platform they belong to: Google
        // (search, reviews, ads), Meta (Facebook, Instagram), then the rest.
        const online = ch === 'Online' ? () => ranked([...groupBy(list, (x) => AD_PLATFORMS.find((a) => a.source.test(x.source))?.key || 'Other online')]
          .map(([pl, xs]) => {
            const spend = adAlloc.filter((a) => a.platform === pl).reduce((s, a) => s + a.amount, 0)
            return { ...npNode(`np|ch|${ch}|${pl}`, pl, xs, spend || null, bySource(`np|ch|${ch}|${pl}`, xs)), group: 'Which platform' }
          })) : null
        return list.length ? { ...npNode(`np|ch|${ch}`, ch, list, null, online || bySource(`np|ch|${ch}`, list)), group: 'How they found you' } : null
      }).filter(Boolean)),
      pill('np|loc', 'By location', 'Break down', () => ranked([...groupBy(np, (x) => x.loc)].map(([loc, xs]) =>
        npNode(`np|loc|${loc}`, shortLocation(loc), xs, marketing.byLoc[loc] ?? null)))),
    ]), group: 'Other views' } : null,
    ...campaignKids,
  ].filter(Boolean) : null

  const spendNode = {
    id: 'spent', kind: 'root', tone: 'cost', group: 'Money out', label: 'Known costs', value: spent, source: 'Real',
    sub: realLines.length
      ? `${realLines.map((l) => l.label).join(' + ')} so far · payroll, rent, lab and others not tracked yet`
      : 'No real costs loaded yet',
    children: () => [
      ...ranked(realLines.map((l) => ({
        id: `s|${l.key}`, kind: 'money', tone: 'cost', group: 'Where it went', label: l.label, value: l.total,
        source: l.real ? (l.key === 'marketing' ? connected.join(' + ') : 'Supply Budget') : 'Estimate',
        sub: l.pct != null && !l.real ? `${(l.pct * 100).toFixed(0)}% of collections · ${l.hint}` : l.hint,
        children: l.key === 'marketing' && marketingKids
          ? marketingKids
          : () => ranked(spendLocs.map((loc) => ({ id: `s|${l.key}|${loc}`, kind: 'money', tone: 'cost', label: shortLocation(loc), value: l.byLoc[loc] }))),
        ...(l.key === 'marketing' && npTotal ? {
          outcome: { patients: adPatients, each: adPatients ? l.total / adPatients : null },
          sub: `New patients who named Google or Meta · ${npTotal} new patients from every source`,
        } : {}),
      }))),
      // What isn't tracked yet — named in one card, never given a made-up number.
      ...(untracked.length ? [placeholder('s|untracked', 'Not tracked yet',
        `${untracked.map((l) => (l.key === 'supplies' ? `supplies (nothing in Supply Budget for ${periodText})` : l.label.toLowerCase())).join(' · ')}. Add the real figures to include them.`,
        'Not tracked yet')] : []),
      pill('s|loc', 'By location', 'Break down', () => ranked(spendLocs.map((loc) => {
        const total = realLines.reduce((s, l) => s + l.byLoc[loc], 0)
        return {
          id: `s|loc|${loc}`, kind: 'money', tone: 'cost', label: shortLocation(loc), value: total,
          sub: `vs ${fmtShort(baseByLoc[loc])} ${collected ? 'collected' : 'net production'} · ${fmtShort(baseByLoc[loc] - total)} left after known costs`,
          children: () => ranked(realLines.map((l) => ({ id: `s|loc|${loc}|${l.key}`, kind: 'money', tone: 'cost', label: l.label, value: l.byLoc[loc],
            children: l.key === 'marketing' && l.real ? campaignsAt(`s|loc|${loc}|marketing`, loc) : undefined }))),
        }
      }))),
    ],
  }

  const bottom = income != null ? { income, spent, left: income - spent, margin: pct(income - spent, income) } : null

  // ── Problems & fixes ──
  // Each is worked out from the figures above.
  const problems = []
  if (agingFacts?.attention >= 1) problems.push({
    title: 'Claims waiting on the office', amount: agingFacts.attention, tone: 'alert',
    detail: `${agingFacts.attentionClaims.toLocaleString()} ${periodText} claims are unsent, rejected, unprocessable or missing information.`,
    fix: 'Send, correct or answer them this week \u2014 insurance can\u2019t pay what it hasn\u2019t accepted.',
  })
  if (collected?.byServiceLoc) {
    const locs = [...groupBy(rows, (r) => r.location)].map(([loc, rs]) => {
      const net = rs.reduce((s, r) => s + r.net, 0)
      return { loc, net, open: net - (collected.byServiceLoc[loc] || 0) }
    }).filter((l) => l.net > 0)
    const avg = pct(locs.reduce((s, l) => s + l.open, 0), locs.reduce((s, l) => s + l.net, 0))
    const worst = locs.sort((a, b) => b.open / b.net - a.open / a.net)[0]
    if (worst && pct(worst.open, worst.net) - avg >= 5) problems.push({
      title: `${shortLocation(worst.loc)} collects slowest`, amount: worst.open, tone: 'owed',
      detail: `${fmtPct(pct(worst.open, worst.net))} of its ${periodText} work is still unpaid, against ${fmtPct(avg)} across all offices.`,
      fix: 'Check claim follow-up there, and whether patient portions are collected at the visit.',
    })
  }
  if (agingFacts?.old.expected >= 1) problems.push({
    title: 'Claims older than 120 days', amount: agingFacts.old.expected, tone: 'alert',
    detail: `${agingFacts.old.claims.toLocaleString()} claims across all months, as of ${agingFacts.asOf}. The older a claim, the less likely it is paid.`,
    fix: 'Work the oldest first: appeal, resubmit or bill the patient, then write off what can\u2019t be recovered.',
  })
  const unapplied = collected?.byService?.unknown
  if (unapplied >= 1) problems.push({
    title: 'Money not tied to any procedure', amount: unapplied, tone: 'cash',
    detail: `Received in ${periodText} but not applied to any work \u2014 it sits as credit on patient accounts.`,
    fix: 'Apply the credits to open balances, or refund them.',
  })
  if (officeShare != null && prod.writeoffs > 0) problems.push({
    title: 'Discounts and courtesies given', amount: prod.writeoffs * (officeShare / 100), tone: 'writeoffs',
    detail: `About ${officeShare.toFixed(0)}% of write-offs are the office\u2019s own choice, not insurance contracts (estimated from the Adjustment Summary).`,
    fix: 'Agree who may approve a courtesy or discount, and review the biggest ones each month.',
  })
  for (const [pl, brands] of Object.entries(adResults)) for (const [b, g] of Object.entries(brands)) {
    if (g.spend >= 1000 && !g.patients) problems.push({
      title: `${b}: ${pl} spend, no ${pl} patients`, amount: g.spend, tone: 'alert',
      detail: `${fmtShort(g.spend)} went to ${pl} ads in ${periodText}, but no ${b} new patient is recorded as coming from ${pl}.`,
      fix: 'Check that the front desk records "Referred by" for every new patient, and whether these campaigns bring calls (CallRail can show it). If neither, pause or rework them.',
    })
  }
  const npUnknown = np.filter((x) => x.channel === 'Not recorded').reduce((s, x) => s + x.patients, 0)
  if (npTotal && npUnknown / npTotal >= 0.05) problems.push({
    title: 'New patients with no source', amount: null, tone: 'net',
    detail: `${npUnknown} of ${npTotal} new patients (${fmtPct(pct(npUnknown, npTotal))}) have no "Referred by" — marketing can't be judged without it.`,
    fix: 'Make "How did you hear about us?" a required question at check-in.',
  })
  if (supplies && !supplies.spend.length) problems.push({
    title: 'Supplies not recorded', amount: null, tone: 'cost',
    detail: `Supply Budget has no entries for ${periodText}, so supplies aren’t in the costs yet.`,
    fix: 'Enter the month\u2019s supply invoices in Supply Budget.',
  })

  // When this month's payments sit under net production, the cash story lives
  // there; otherwise collections keep their own tree.
  const cashInWork = collected?.forThis != null && owedNode.kind === 'money' && !owedNode.dashed
  // Patient retention (retentionTree) is kept for its own module later; it
  // isn't part of the money story.
  return { roots: [work, ...(cashInWork ? [] : [collectedNode]), spendNode], bottom, problems }
}

// ── Aging helpers ──────────────────────────────────────────────────────────

// ── Patients: who came in, and who is coming back (schedule report) ──
// Counts come from readSchedule: patients seen in the month (credited to the
// location and provider of their visit), whether a next visit is booked, new
// patients, and patients drifting away (last visit 6+ months ago, nothing
// booked). Retention is shown per provider first.
function retentionTree(schedule, periods, periodText, roleOf, problems) {
  const have = periods.filter((p) => schedule?.months?.[p])
  if (!have.length) return null
  const ms = have.map((p) => schedule.months[p])
  const latest = schedule.months[[...have].sort().pop()]
  const blank = () => ({ seen: 0, seenNext: 0, newPts: 0, newNext: 0, lapsed: { '6-12': 0, '12-18': 0, '18+': 0 } })
  const merge = (where) => {
    const out = {}
    for (const m of ms) for (const [k, v] of Object.entries(m[where])) {
      const o = (out[k] ||= blank())
      for (const f of ['seen', 'seenNext', 'newPts', 'newNext']) o[f] += v[f]
    }
    for (const [k, v] of Object.entries(latest[where])) (out[k] ||= blank()).lapsed = v.lapsed
    return out
  }
  const byLoc = merge('byLoc'), byProv = merge('byProv')
  const T = { ...blank(), lapsed: latest.total.lapsed }
  for (const m of ms) for (const f of ['seen', 'seenNext', 'newPts', 'newNext']) T[f] += m.total[f]
  const lapsedOf = (v) => LAPSE_BUCKETS.reduce((s, b) => s + (v.lapsed?.[b] || 0), 0)
  const asOf = fmtDate(schedule.asOf) || 'the report date'
  const appts = { total: 0, broken: 0, noShow: 0, cancelled: 0 }
  for (const m of ms) for (const [k, v] of Object.entries(m.appts)) if (k.startsWith('l|')) for (const f in appts) appts[f] += v[f]
  const missed = appts.broken + appts.noShow + appts.cancelled
  const rate = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '\u2014')
  const people = (n) => `${n.toLocaleString()} patient${n === 1 ? '' : 's'}`
  const cnt = (id, label, value, extra = {}) => ({ id, kind: 'money', tone: 'net', label, value, count: true, ...extra })

  // One person's (or one office's, or everyone's) retention, as branches.
  const retention = (id, v, who) => () => [
    cnt(`${id}|next`, 'Next visit booked', v.seenNext, { group: 'After the visit', sub: `${rate(v.seenNext, v.seen)} of patients seen` }),
    cnt(`${id}|none`, 'Nothing booked', v.seen - v.seenNext, { tone: 'alert', group: 'After the visit', sub: `${rate(v.seen - v.seenNext, v.seen)} left without a next appointment` }),
    ...(v.newPts ? [cnt(`${id}|new`, 'New patients', v.newPts, { group: 'New patients', noShare: true,
      sub: `${rate(v.newNext, v.newPts)} booked a second visit` })] : []),
    ...(lapsedOf(v) ? [cnt(`${id}|lapsed`, 'Drifting away', lapsedOf(v), { tone: 'alert', group: 'Not coming back', noShare: true,
      sub: `${who} last seen 6+ months ago, nothing booked`,
      children: () => LAPSE_BUCKETS.filter((b) => v.lapsed[b] > 0).map((b) => cnt(`${id}|lapsed|${b}`, `${b} months`, v.lapsed[b], { tone: 'alert' })) })] : []),
  ]
  const providerCards = ranked(Object.entries(byProv).filter(([k, v]) => v.seen > 0 && roleOf(k) !== 'office').map(([k, v]) =>
    cnt(`pts|prov|${k}`, k, v.seen, { group: 'By provider', tone: v.seen >= 20 && v.seenNext / v.seen < 0.5 ? 'alert' : 'net',
      sub: `${rate(v.seenNext, v.seen)} have a next visit booked${lapsedOf(v) ? ` · ${lapsedOf(v).toLocaleString()} drifting away` : ''}`,
      children: retention(`pts|prov|${k}`, v, 'Their patients') })))

  if (T.seen - T.seenNext >= 1) problems.push({
    title: 'Patients leaving without a next visit', amount: T.seen - T.seenNext, tone: 'alert', count: true,
    detail: `${people(T.seen - T.seenNext)} seen in ${periodText} had nothing booked as of ${asOf}. Book the next visit before they leave the chair.`,
  })
  if (T.lapsed['6-12'] >= 1) problems.push({
    title: 'Patients drifting away', amount: T.lapsed['6-12'], tone: 'alert', count: true,
    detail: `${people(T.lapsed['6-12'])} were last seen 6\u201312 months ago and have nothing booked: the easiest ones to win back with a call.`,
  })

  return {
    id: 'pts', kind: 'root', tone: 'net', group: 'Patients', label: 'Patients seen', value: T.seen, count: true, source: 'Schedule',
    sub: `Came in during ${periodText} · ${rate(T.seenNext, T.seen)} have a next visit booked (as of ${asOf})`,
    children: () => [
      ...providerCards.slice(0, 12),
      pill('pts|prov|all', 'Every provider', 'By provider', () => providerCards),
      pill('pts|all', 'Everyone together', 'Other views', retention('pts|all', T, 'Patients')),
      pill('pts|loc', 'By location', 'Other views', () => ranked(Object.entries(byLoc).filter(([, v]) => v.seen > 0).map(([k, v]) =>
        cnt(`pts|loc|${k}`, shortLocation(k), v.seen, { sub: `${rate(v.seenNext, v.seen)} have a next visit booked`, children: retention(`pts|loc|${k}`, v, 'Patients') })))),
      ...(appts.total ? [cnt('pts|missed', 'Missed appointments', missed, {
        tone: 'alert', unit: 'appointment', group: 'Other views', noShare: true,
        sub: `${rate(missed, appts.total)} of ${appts.total.toLocaleString()} appointments in ${periodText}`,
        children: () => [['Broken', appts.broken], ['No show', appts.noShow], ['Cancelled by the office', appts.cancelled]]
          .filter(([, v]) => v > 0).map(([l, v]) => cnt(`pts|missed|${l}`, l, v, { tone: 'alert', unit: 'appointment' })),
      })] : []),
    ],
  }
}

// ── Claims follow-up (RCM app), joined to the aging report by insurer ──
// The follow-up rows carry no claim ID, so the join is by insurer name: the
// reasons describe each insurer's worked claims overall, not these exact
// open claims.

// Reasons the office can act on, vs the plan's own rules.
// The RCM insurer matching an aging insurer name: exact, or the same name
// once punctuation, "(FEP)"-style notes and "Insurance Company" are dropped.
function followUpFor(name, followUp) {
  if (followUp?.status !== 'ready') return null
  const cs = followUp.carriers || {}
  if (cs[name]) return cs[name]
  const k = carrierKey(name)
  const hit = Object.keys(cs).find((n) => carrierKey(n) === k)
  return hit ? cs[hit] : null
}

function topReasons(f, n = 3) {
  return Object.entries(f.reasons).sort((a, b) => b[1] - a[1]).slice(0, n)
}

// The worked claims that were NOT denied (paid, in process, pending…): the
// rest of an insurer's open dollars, so its reasons always add back up.
function notDeniedText(f) {
  const others = Object.entries(f.other || {}).sort((a, b) => b[1] - a[1]).slice(0, 3)
  const n = f.classified - f.denied
  return `${n.toLocaleString()} worked claims with no denial${others.length ? ` \u00b7 mostly ${others.map(([r]) => r).join(', ')}` : ''}`
}

function insurerCard(id, name, v, followUp) {
  const f = followUpFor(name, followUp)
  const base = { id, kind: 'money', tone: 'owed', label: name, value: v.expected, sub: `${v.claims.toLocaleString()} open claims` }
  if (!f) return followUp?.status === 'ready' ? { ...base, sub: `${base.sub} \u00b7 not in the follow-up sheet` } : base
  // Shares of this insurer's denial reasons, as on RCM's claims page.
  const occurrences = Object.values(f.reasons).reduce((a, b) => a + b, 0)
  const share = (x) => (occurrences ? Math.round((x / occurrences) * 100) : 0)
  const top = topReasons(f)
  return {
    ...base,
    sub: [base.sub,
      top.length ? `denied mostly for ${top.map(([r, c]) => `${r} ${share(c)}%`).join(', ')}` : null,
      f.avgFollowUpsToClose != null ? `${f.avgFollowUpsToClose.toFixed(1)} follow-ups to close one` : null,
    ].filter(Boolean).join(' \u00b7 '),
    children: top.length ? () => [
      ...Object.entries(f.reasons).sort((a, b) => b[1] - a[1]).map(([r, c]) => ({
        id: `${id}|r|${r}`, kind: 'money', tone: OFFICE_CAN_FIX.has(r) ? 'alert' : 'owed', noShare: true,
        group: OFFICE_CAN_FIX.has(r) ? 'The office can fix' : 'The plan\u2019s rules',
        // ≈ this insurer's open dollars × how often its worked claims were denied for this reason (as in “Why claims are stuck”).
        label: r, value: f.classified ? v.expected * (c / f.classified) : 0, sub: `≈ of the open dollars · ${c.toLocaleString()} denials in follow-up · ${share(c)}% of ${name}’s denials`,
      })),
      // The rest of the open dollars: claims that weren't denied.
      ...(f.classified > f.denied ? [{
        id: `${id}|r|__notdenied`, kind: 'money', tone: 'net', noShare: true, group: 'Not denied',
        label: 'Not denied \u2014 still being worked', value: v.expected * ((f.classified - f.denied) / f.classified),
        sub: `\u2248 of the open dollars \u00b7 ${notDeniedText(f)}`,
      }] : []),
    ] : undefined,
  }
}

// What the billing team can do about each reason — one plain line each.
const REASON_FIX = {
  'Timely Filing': 'Send claims within days of the visit; for these, appeal with the clearinghouse proof of the first submission date.',
  'Provider Not Credentialed/Listed': 'Check the provider’s credentialing with this plan and get them added; then resubmit or bill as in-network once approved.',
  'Duplicate Claim': 'Look up the first claim’s status before resending; void the duplicate and follow up on the original.',
  'Missing Documentation': 'Attach the x-rays, perio charting or narrative the plan asked for and resubmit.',
  'Missing Primary EOB': 'Get the primary insurer’s EOB and send it with the secondary claim.',
  'Missing/Incorrect Subscriber Info': 'Re-verify the subscriber ID, name and date of birth with the patient and plan, correct the claim and resubmit.',
  'Missing Provider Questionnaire': 'Fill in the plan’s provider questionnaire and send it in.',
  'Requires Medical EOB/Info': 'Bill the medical plan first, or send the medical EOB / information the plan asked for.',
  'COB Issue': 'Have the patient update coordination of benefits with the plan, then resubmit.',
  'Unprocessable / Rejected Claim': 'Read the rejection, fix the claim data (codes, tooth/surface, IDs) and resubmit.',
  'Missing Authorization': 'Get the pre-authorization (backdated if the plan allows) and resubmit.',
  'Benefit Maximum Reached': 'Not payable by the plan — bill the patient, and check maximums at verification before treatment.',
  'Not a Covered Service/Benefit': 'Not payable by the plan — bill the patient; check coverage at verification and get consent for out-of-pocket costs.',
  'Frequency Limitation': 'Check the last date of service with the plan; bill the patient if it’s truly too soon, or appeal if the dates are wrong.',
  'Eligibility / Plan Terminated': 'Ask the patient for their current insurance and rebill it, or bill the patient; verify eligibility before every visit.',
  'Provider Out of Network': 'Bill the patient the out-of-network balance, or check whether the provider should be in network with this plan.',
  'Appeal Denied': 'Decide whether a second-level appeal is worth it; otherwise bill the patient or write it off.',
  'Not Dentally Necessary': 'Appeal with x-rays and a narrative showing the need, or bill the patient if they agreed to pay.',
  'Primary Already Paid Allowable': 'Nothing more from the secondary — adjust off or bill the patient per the plan rules.',
}

// Every insurer's reasons, weighted by the open dollars with that insurer:
// "about $X of what's open sits with insurers that deny for this reason".
// Reasons the office can fix come first; each opens to the insurers behind
// it and what to do.
function stuckReasons(id, carriers, followUp) {
  const by = {}
  let matched = 0, open = 0, notDenied = 0
  const missing = []      // insurers not in the follow-up sheet
  const fine = []         // { name, dollars, f } — the not-denied part per insurer
  for (const [name, v] of Object.entries(carriers)) {
    open += v.expected
    const f = followUpFor(name, followUp)
    if (!f || !f.classified) { if (v.expected >= 1) missing.push({ name, dollars: v.expected, claims: v.claims }); continue }
    matched += v.expected
    const nd = v.expected * ((f.classified - f.denied) / f.classified)
    notDenied += nd
    if (nd >= 1) fine.push({ name, dollars: nd, f })
    for (const [r, c] of Object.entries(f.reasons)) {
      const o = (by[r] ||= { dollars: 0, claims: 0, insurers: [] })
      const d = v.expected * (c / f.classified)
      o.dollars += d; o.claims += c; o.insurers.push({ name, denials: c, dollars: d })
    }
  }
  const reasons = Object.entries(by).sort((a, b) => b[1].dollars - a[1].dollars)
  if (!reasons.length) return [placeholder(`${id}|none`, 'No reasons yet', 'The follow-up sheet has no AI-classified denials for these insurers yet.', 'Why')]
  const fixable = reasons.filter(([r]) => OFFICE_CAN_FIX.has(r))
  const fixDollars = fixable.reduce((s, [, o]) => s + o.dollars, 0)
  const allDollars = reasons.reduce((s, [, o]) => s + o.dollars, 0)
  const row = ([r, o]) => {
    const can = OFFICE_CAN_FIX.has(r)
    const ins = o.insurers.sort((a, b) => b.dollars - a.dollars)
    return {
      id: `${id}|${r}`, kind: 'money', tone: can ? 'alert' : 'owed', noShare: true,
      group: can ? 'The office can fix — start here' : 'The plan’s rules',
      label: r, value: o.dollars,
      sub: `${o.claims.toLocaleString()} denials · ${ins.length} insurer${ins.length === 1 ? '' : 's'} · top: ${ins[0].name}`,
      children: () => [
        ...(REASON_FIX[r] ? [{ ...placeholder(`${id}|${r}|fix`, 'What to do', REASON_FIX[r], 'What to do'), callout: true }] : []),
        ...ins.map((x) => ({
          id: `${id}|${r}|${x.name}`, kind: 'money', tone: can ? 'alert' : 'owed', group: 'Which insurers',
          label: x.name, value: x.dollars, sub: `${x.denials.toLocaleString()} denial${x.denials === 1 ? '' : 's'} for this reason in follow-up`,
        })),
      ],
    }
  }
  const missingDollars = missing.reduce((s, x) => s + x.dollars, 0)
  return [
    { callout: true, ...placeholder(`${id}|short`, `Of ${fmtShort(open)} open, about ${fmtShort(allDollars)} sits in denials \u2014 ${fmtShort(fixDollars)} of it for reasons the office can fix.`,
      `${fixable.length ? `Biggest fixable: ${fixable.slice(0, 3).map(([r]) => r).join(', ')}. ` : ''}${fmtShort(notDenied)} isn\u2019t denied (still being worked)${missingDollars >= 1 ? ` and ${fmtShort(missingDollars)} is with insurers not in the follow-up sheet` : ''} \u2014 so the lists add up to the ${fmtShort(open)}.`, 'In short') },
    ...fixable.map(row),
    ...reasons.filter(([r]) => !OFFICE_CAN_FIX.has(r)).map(row),
    ...(notDenied >= 1 ? [{
      id: `${id}|__notdenied`, kind: 'money', tone: 'net', noShare: true, group: 'Not denied',
      label: 'Not denied \u2014 still being worked', value: notDenied,
      sub: `${fine.length} insurer${fine.length === 1 ? '' : 's'} \u00b7 paid, in process or pending in follow-up`,
      children: () => ranked(fine.map((x) => ({
        id: `${id}|__notdenied|${x.name}`, kind: 'money', tone: 'net', label: x.name, value: x.dollars, sub: notDeniedText(x.f),
      }))),
    }] : []),
    ...(missingDollars >= 1 ? [{
      id: `${id}|__missing`, kind: 'money', tone: 'owed', noShare: true, group: 'Not denied',
      label: 'Insurer not in the follow-up sheet', value: missingDollars,
      sub: `${missing.length} insurer${missing.length === 1 ? '' : 's'} \u00b7 no follow-up recorded yet`,
      children: () => ranked(missing.map((x) => ({
        id: `${id}|__missing|${x.name}`, kind: 'money', tone: 'owed', label: x.name, value: x.dollars, sub: `${x.claims.toLocaleString()} open claims`,
      }))),
    }] : []),
    placeholder(`${id}|note`, 'How this is worked out',
      `Each insurer’s open dollars are split by how often its worked claims were denied for each reason (RCM follow-up, AR Master). ${Math.round((matched / (open || 1)) * 100)}% of the open dollars are with insurers found in the follow-up sheet. An estimate by insurer — not claim by claim.`,
      'How this is worked out'),
  ]
}

function mergeAging(list) {
  const out = { billed: 0, expected: 0, claims: 0, buckets: {}, carriers: {}, statuses: {} }
  for (const T of list) {
    out.billed += T.billed; out.expected += T.expected; out.claims += T.claims
    for (const key of ['buckets', 'carriers', 'statuses']) {
      for (const [k, v] of Object.entries(T[key] || {})) {
        const o = out[key][k] ||= { billed: 0, expected: 0, claims: 0 }
        o.billed += v.billed || 0; o.expected += v.expected; o.claims += v.claims
        if (key === 'buckets') for (const sub of ['statuses', 'carriers']) for (const [st, sv] of Object.entries(v[sub] || {})) {
          const os = (o[sub] ||= {})[st] ||= { expected: 0, claims: 0 }
          os.expected += sv.expected; os.claims += sv.claims
        }
      }
    }
  }
  return out
}

function owedTotals(locs) {
  const all = mergeAging(locs.map(([, l]) => l))
  return { expected: all.expected, billed: all.billed, claims: all.claims }
}

// Age buckets, claims waiting on the office, and by location / insurer — for
// any set of claims ([location, totals] pairs).
function owedBreakdown(prefix, locs, followUp) {
  const all = mergeAging(locs.map(([, l]) => l))
  // Each age splits into what the office has to fix and what is with the insurer.
  const whoHasIt = (id, statuses) => {
    const attention = ATTENTION.filter((s) => statuses[s]?.expected >= 1)
    const office = attention.reduce((s, k) => s + statuses[k].expected, 0)
    const officeClaims = attention.reduce((s, k) => s + statuses[k].claims, 0)
    const rest = Object.entries(statuses).filter(([s]) => !ATTENTION.includes(s))
    const insurer = rest.reduce((s, [, v]) => s + v.expected, 0)
    const insurerClaims = rest.reduce((s, [, v]) => s + v.claims, 0)
    return [
      ...(office >= 1 ? [{
        id: `${id}|attn`, kind: 'money', tone: 'alert', group: 'Who has it', label: 'Needs the office', value: office,
        sub: `${officeClaims.toLocaleString()} claims · unsent, rejected or missing information`,
        children: () => ranked(attention.map((st) => ({
          id: `${id}|attn|${st}`, kind: 'money', tone: 'alert', label: st, value: statuses[st].expected, sub: `${statuses[st].claims.toLocaleString()} claims`,
        }))),
      }] : []),
      ...(insurer >= 1 ? [{
        id: `${id}|ins`, kind: 'money', tone: 'owed', group: 'Who has it', label: 'With the insurance company', value: insurer,
        sub: `${insurerClaims.toLocaleString()} claims · sent and waiting to be paid`,
      }] : []),
    ]
  }
  return [
    ...AGE_BUCKETS.filter((b) => all.buckets[b]?.expected >= 1).map((b) => {
      const id = `${prefix}|age|${b}`
      const carriers = all.buckets[b].carriers
      // Within this age: who has it, which insurers, and why they're stuck.
      const kids = [
        ...whoHasIt(id, all.buckets[b].statuses || {}),
        ...(carriers ? [
          pill(`${id}|ins`, 'By insurance company', 'Break down', () => ranked(Object.entries(carriers).map(([c, v]) =>
            insurerCard(`${id}|ins|${c}`, c, v, followUp))).slice(0, TOP_INSURERS)),
          ...(followUp?.status === 'ready' ? [pill(`${id}|why`, 'Why claims are stuck', 'Break down', () => stuckReasons(`${id}|why`, carriers, followUp))] : []),
        ] : []),
      ]
      return {
        id: `${prefix}|age|${b}`, kind: 'money', tone: b === '120+' ? 'alert' : 'owed', group: 'How long it has waited',
        label: `${b} days`, value: all.buckets[b].expected,
        sub: b === '120+' ? `${all.buckets[b].claims.toLocaleString()} claims · the oldest, least likely to be paid` : `${all.buckets[b].claims.toLocaleString()} claims`,
        children: kids.length ? () => [...ranked(kids.filter((n) => n.kind !== 'pill')), ...kids.filter((n) => n.kind === 'pill')] : undefined,
      }
    }),
    // Aging read before statuses were kept per age: show the split once, beside the ages.
    ...(AGE_BUCKETS.some((b) => all.buckets[b]?.statuses) ? [] : whoHasIt(prefix, all.statuses).map((n) => ({ ...n, group: 'Break down' }))),
    pill(`${prefix}|loc`, 'By location', 'Break down', () => ranked(locs.map(([loc, l]) => ({
      id: `${prefix}|loc|${loc}`, kind: 'money', tone: 'owed', label: shortLocation(loc), value: l.expected,
      sub: `${l.claims} claims · ${fmtPct(pct(l.buckets['120+']?.expected || 0, l.expected))} older than 120 days`,
    })))),
    pill(`${prefix}|ins`, 'By insurance company', 'Break down', () => ranked(Object.entries(all.carriers).map(([c, v]) =>
      insurerCard(`${prefix}|ins|${c}`, c, v, followUp))).slice(0, TOP_INSURERS)),
    // Why claims are stuck, from the RCM follow-up data, for the insurers
    // these open claims are with — weighted by the dollars open with each.
    ...(followUp?.status === 'ready' ? [pill(`${prefix}|why`, 'Why claims are stuck', 'Break down', () => stuckReasons(`${prefix}|why`, all.carriers, followUp))] : []),
  ]
}

// ── Component ──────────────────────────────────────────────────────────────

export default function MoneyStory(props) {
  const { rows, periodText, roleOf, onRoleChange } = props
  // The pick per row, starting with the root: a card's id, or
  // "id::breakdownId" when one of the card's breakdowns (By location…) is open.
  const [path, setPath] = useState([])
  const [lines, setLines] = useState({ d: [] })
  const box = useRef(null)

  const retention = props.mode === 'retention'
  const model = useMemo(() => (retention
    ? { roots: [retentionTree(props.schedule, props.periods, props.periodText, props.roleOf, [])].filter(Boolean), bottom: null, problems: [] }
    : buildTree(props)), [retention, props.location, props.rows, props.roleOf, props.periods, props.periodText, props.officeShare, props.budget, props.collections, props.aging, props.newPatients, props.marketing, props.adSpend, props.schedule, props.followUp])

  const roots = model.roots

  useEffect(() => { setPath([]) }, [rows, props.location])

  // Row 0 holds the two top cards (work done, cash received); each further
  // row is what the row above's pick opens into: its own parts, or — when a
  // breakdown on the card was clicked — that card's number split by
  // location, provider, insurer…
  const levels = useMemo(() => {
    const out = [{ parent: null, nodes: roots }]
    for (let i = 0; i < path.length; i++) {
      const [id, mode] = splitPick(path[i])
      const sel = out[i].nodes.find((n) => n.id === id)
      if (!sel) break
      if (mode) {
        const brk = breakdownsOf(sel).find((x) => x.id === mode)
        const kids = brk?.children ? brk.children() : []
        if (!kids.length) break
        const caption = `${sel.label} \u00b7 ${brk.label.replace(/^By /, 'by ')}`
        out.push({ parent: sel, breakdown: brk, nodes: kids.map((k) => (k.group ? k : { ...k, group: caption })) })
      } else {
        const kids = partsOf(sel)
        if (!kids.length) break
        out.push({ parent: sel, nodes: kids })
      }
    }
    return out
  }, [roots, path])

  const lastPick = levels[path.length - 1]?.nodes.find((n) => n.id === splitPick(path[path.length - 1])[0])
  const leaf = lastPick?.kind === 'provider' && !splitPick(path[path.length - 1])[1] ? lastPick : null

  // Curves from the bottom-centre of each chosen card to the top-centre of every
  // card beneath it. offsetLeft/Top are relative to `box`, the only positioned
  // ancestor — rows fade rather than slide so no transform shifts them.
  function measure() {
    const c = box.current
    if (!c) return
    const at = (id) => c.querySelector(`[data-node="${CSS.escape(id)}"]`)
    const curve = (a, b) => {
      const my = (a.y + b.y) / 2
      return `M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`
    }
    const bottom = (el) => ({ x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight })
    const top = (el) => ({ x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop })
    const d = []
    // Fewer lines read better: once a card in a row is picked, only the line
    // to it is drawn, so the open path is a single chain. Until then each
    // captioned group gets one line to its caption, not one per card.
    for (let i = 1; i < levels.length; i++) {
      const from = at(splitPick(path[i - 1])[0])
      if (!from) continue
      const lineFor = (n) => ({ tone: n.tone || levels[i].parent.tone || 'gross', dashed: !!n.dashed || n.kind === 'placeholder' })
      const column = c.querySelector(`[data-group="${CSS.escape(`${i}|__column`)}"]`)
      if (column) {
        d.push({ d: curve(bottom(from), top(column)), tone: levels[i].parent?.tone || 'gross', dashed: false })
        continue
      }
      const picked = path[i] && levels[i].nodes.find((n) => n.id === splitPick(path[i])[0])
      if (picked) {
        const to = at(picked.id)
        if (to) d.push({ d: curve(bottom(from), top(to)), ...lineFor(picked) })
        continue
      }
      for (const [name, nodes] of groupBy(levels[i].nodes, (n) => n.group || '')) {
        if (name) {
          const g = c.querySelector(`[data-group="${CSS.escape(`${i}|${name}`)}"]`)
          if (g) d.push({ d: curve(bottom(from), top(g)), ...lineFor(nodes[0]), dashed: nodes.every((n) => n.dashed || n.kind === 'placeholder') })
        } else {
          for (const n of nodes) { const to = at(n.id); if (to) d.push({ d: curve(bottom(from), top(to)), ...lineFor(n) }) }
        }
      }
    }
    if (leaf) {
      const from = at(leaf.id), card = c.querySelector('[data-leaf]')
      if (from && card) d.push({ d: curve(bottom(from), top(card)), tone: leaf.tone, dashed: false })
    }
    const next = { d }
    const sig = (x) => x.d.map((p) => p.d + p.tone + p.dashed).join()
    setLines((prev) => (sig(prev) === sig(next) ? prev : next))
  }

  useLayoutEffect(measure, [levels, leaf])
  useEffect(() => {
    const c = box.current
    if (!c || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(c)
    return () => ro.disconnect()
  })

  // A card opens into its parts; a breakdown button on it (mode) opens the
  // card's number split that way. Clicking what is already open folds it.
  function select(row, node, mode) {
    const parts = partsOf(node)
    const brks = breakdownsOf(node)
    // A card with only breakdowns opens its first one.
    if (!mode && !parts.length && brks.length && node.kind !== 'provider') mode = brks[0].id
    if (!mode && !parts.length && node.kind !== 'provider') return
    const pick = mode ? `${node.id}::${mode}` : node.id
    const closing = path[row] === pick
    setPath((p) => (closing ? p.slice(0, row) : [...p.slice(0, row), pick]))
  }

  return (
    <StoryCtx.Provider value={{ roleOf, onRoleChange }}>
    <div className="glass-card rounded-2xl px-5 py-6">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{periodText} · {retention ? 'patients and who comes back' : 'follow the money'}</p>
        {path.length > 0 && <button onClick={() => setPath([])} className="text-xs text-slate-500 hover:text-slate-800">Fold everything</button>}
      </div>

      {model.bottom && <BottomLine {...model.bottom} periodText={periodText} />}

      {/* No overflow box: rows wrap, so the tree only grows downward with the
          page. The SVG fills the container instead of being sized to it —
          sizing it to scrollHeight kept the box from ever shrinking back. */}
      <div ref={box} className="relative">
        <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible" aria-hidden="true">
          {lines.d.map((p, i) => (
            <path key={i} d={p.d} fill="none" stroke={TONE[p.tone]?.stroke || '#cbd5e1'} strokeWidth="1.5"
              strokeDasharray={p.dashed ? '5 5' : undefined} className="story-line" />
          ))}
        </svg>

        {levels.map((lvl, i) => (
          <Row key={`${i}|${path[i - 1] || ''}`} index={i} level={lvl} picked={splitPick(path[i])[0]} mode={splitPick(path[i])[1]} onPick={(n, mode) => select(i, n, mode)} />
        ))}

        {leaf && (
          <div className="story-fade flex justify-center pt-12 pb-2">
            <ProviderCard node={leaf} role={roleOf(leaf.label)} onRoleChange={onRoleChange} />
          </div>
        )}

        {path.length === 0 && (
          <p className="text-center text-xs text-slate-400 mt-3">{retention
            ? 'Click the card to see each provider: patients seen, who booked a next visit, and who is drifting away.'
            : 'Click a card to follow it: the work done and the cash it brought in, or what was spent.'}</p>
        )}
      </div>

    </div>
    </StoryCtx.Provider>
  )
}

// One row of the tree. Cards that answer different questions ("where it came
// from", "what it covered") sit in captioned groups side by side.
//
// The tree tells the story while each step has a handful of parts. When a step
// opens into many similar things (insurers, providers, reasons, campaigns),
// cards stop being readable or comparable, so that step becomes a ranked list:
// one line each, a bar to compare, and a click opens the next step as before.
const LIST_OVER = 6

// A card's children are its parts (cards) and its breakdowns (By location,
// By provider…, kind 'pill'). Parts open beneath it; breakdowns are buttons
// on the card itself, so it is always clear whose number they split.
const kidsCache = new WeakMap()
function kidsOf(n) {
  if (!n?.children) return []
  if (!kidsCache.has(n)) kidsCache.set(n, n.children() || [])
  return kidsCache.get(n)
}
const partsOf = (n) => kidsOf(n).filter((k) => k.kind !== 'pill')
const breakdownsOf = (n) => kidsOf(n).filter((k) => k.kind === 'pill')
const splitPick = (pick) => { if (!pick) return [undefined, undefined]; const i = pick.indexOf('::'); return i < 0 ? [pick, undefined] : [pick.slice(0, i), pick.slice(i + 2)] }
const listable = (n) => n.kind === 'money' || n.kind === 'provider'
const isListLevel = (nodes) => nodes.filter(listable).length > LIST_OVER

function Row({ index, level, picked, mode, onPick }) {
  const groups = [...groupBy(level.nodes, (n) => n.group || '')]
  const asList = level.nodes.filter(listable).length > LIST_OVER
  // A long step: the summary across the top, then the groups' ranked lists
  // side by side (two at most per line — e.g. what the office can fix on the
  // left, the plans' rules on the right), then the small print.
  if (asList) {
    const callouts = level.nodes.filter((n) => n.kind === 'placeholder' && n.callout)
    const notes = level.nodes.filter((n) => n.kind === 'placeholder' && !n.callout)
    const lists = groups.map(([name, nodes]) => [name, nodes.filter((n) => n.kind !== 'placeholder')]).filter(([, ns]) => ns.length)
    const t = TONE[level.parent?.tone] || TONE.gross
    return (
      <div className={`story-fade flex justify-center ${index > 0 ? 'pt-12' : 'pt-2'}`}>
        <div data-group={`${index}|__column`} className={`w-full ${lists.length > 1 ? 'max-w-6xl' : 'max-w-3xl'} flex flex-col gap-4`}>
          {callouts.map((n) => (
            <div key={n.id} className="rounded-xl border border-slate-200 border-l-4 bg-white px-4 py-3 shadow-sm" style={{ borderLeftColor: t.stroke }}>
              <p className="text-sm font-semibold text-slate-900 leading-snug">{n.label}</p>
              {n.text && <p className="text-xs text-slate-500 mt-0.5 leading-snug">{n.text}</p>}
            </div>
          ))}
          <div className={`grid gap-4 items-start ${lists.length > 1 ? 'lg:grid-cols-2' : ''}`}>
          {lists.map(([name, nodes]) => {
            const rows = nodes.filter(listable)
            const rest = nodes.filter((n) => !listable(n))
            return (
              <div key={name}>
                {name ? <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 px-1">{name}</p> : null}
                {rows.length > 0 && <RankList nodes={rows} parent={level.parent} inline />}
                {rest.length > 0 && (
                  <div className={`flex flex-wrap gap-3 ${rows.length ? 'mt-3' : ''}`}>
                    {rest.map((n) => (
                      <Card key={n.id} node={n} parent={level.parent} selected={picked === n.id} mode={picked === n.id ? mode : undefined}
                        dimmed={picked != null && picked !== n.id} onClick={() => onPick(n)} onBreakdown={(m) => onPick(n, m)} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          </div>
          {notes.map((n) => (
            <p key={n.id} className="text-[11px] text-slate-400 leading-snug px-1"><b className="font-semibold text-slate-500">{n.label}.</b> {n.text}</p>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className={`story-fade flex flex-wrap justify-center ${asList ? 'items-start' : 'items-stretch'} gap-x-8 gap-y-4 ${index > 0 ? 'pt-12' : 'pt-2'}`}>
      {groups.map(([name, nodes]) => {
        const rows = asList ? nodes.filter(listable) : []
        const rest = asList ? nodes.filter((n) => !listable(n)) : nodes
        return (
          <div key={name} data-group={name ? `${index}|${name}` : undefined}
            className={`flex flex-col items-center ${asList && rows.length ? 'w-full max-w-3xl' : ''}`}>
            {name ? <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{name}</p> : null}
            {rows.length > 0 && <RankList nodes={rows} parent={level.parent} picked={picked} mode={mode} onPick={onPick} />}
            {rest.length > 0 && (
              <div className={`flex-1 flex flex-wrap justify-center items-stretch gap-3 ${rows.length ? 'mt-3' : ''}`}>
                {rest.map((n) => (
                  <Card key={n.id} node={n} parent={level.parent} selected={picked === n.id} mode={picked === n.id ? mode : undefined}
                    dimmed={picked != null && picked !== n.id} onClick={() => onPick(n)} onBreakdown={(m) => onPick(n, m)} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// A step with many similar parts: ranked rows with a bar for comparing.
function RankList({ nodes, parent, picked, mode, onPick, inline }) {
  const max = Math.max(...nodes.map((n) => Math.abs(n.value) || 0), 1)
  // Inline: a row opens beneath itself, inside this list (any number at once).
  const [openRows, setOpenRows] = useState(() => new Set())
  const toggle = (id) => setOpenRows((st) => { const nx = new Set(st); nx.has(id) ? nx.delete(id) : nx.add(id); return nx })
  if (inline) { picked = null; mode = undefined }
  return (
    <div className="w-full rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden text-left">
      {nodes.map((n) => {
        const t = TONE[n.tone] || TONE.gross
        const opens = partsOf(n).length > 0 || breakdownsOf(n).length > 0 || n.kind === 'provider'
        const on = inline ? openRows.has(n.id) : picked === n.id
        const brks = on && !inline ? breakdownsOf(n) : []
        const share = parent && !n.noShare && parent.value > 0 ? (n.value / parent.value) * 100 : null
        const value = n.count
          ? `${Math.round(n.value).toLocaleString('en-US')} ${n.unit || 'patient'}${Math.round(n.value) === 1 ? '' : 's'}`
          : fmtFull(n.value)
        return (
          <div key={n.id}>
          <button data-node={n.id} onClick={() => (inline ? opens && toggle(n.id) : onPick(n))} title={n.sub || undefined}
            className={`w-full text-left grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto_16px] items-center gap-x-4 px-4 py-2.5 transition-colors ${
              on ? `bg-slate-50 ring-2 ring-inset ${t.ring}` : opens ? 'hover:bg-slate-50' : 'cursor-default'
            } ${!inline && picked != null && !on ? 'opacity-60 hover:opacity-100' : ''}`}>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-slate-800 truncate">{n.label}</span>
              {(n.outcome || n.sub) && (
                <span className="block text-[11px] text-slate-500 truncate">
                  {n.outcome && <b className={n.outcome.patients ? 'text-emerald-700' : 'text-red-600'}>{'\u2192'} {n.outcome.patients} new patient{n.outcome.patients === 1 ? '' : 's'}{n.outcome.each != null ? ` \u00b7 ${fmtShort(n.outcome.each)} each` : ''}{n.sub ? ' \u00b7 ' : ''}</b>}
                  {n.sub}
                </span>
              )}
            </span>
            <span className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <span className={`block h-full rounded-full ${t.bar}`} style={{ width: `${Math.max(2, (Math.abs(n.value) / max) * 100)}%` }} />
            </span>
            <span className="text-right">
              <span className={`block text-sm font-bold tabular-nums ${t.text}`}>{value}</span>
              {share != null && <span className="block text-[10px] text-slate-400 tabular-nums">{share.toFixed(0)}%</span>}
            </span>
            <span className={`text-slate-400 text-xs transition-transform ${on ? 'rotate-180' : ''}`}>{opens ? '\u25BE' : ''}</span>
          </button>
          {inline && on && (
            <div className="pl-5 pr-3 pt-2 pb-3 bg-slate-50/80 border-t border-slate-100">
              <div className="border-l-2 pl-3" style={{ borderLeftColor: t.stroke }}>
                <InlineParts node={n} />
              </div>
            </div>
          )}
          {brks.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2.5 -mt-0.5 bg-slate-50">
              <span className="text-[10px] text-slate-400 mr-0.5">Split {n.label} by</span>
              {brks.map((b) => <BreakdownChip key={b.id} b={b} on={mode === b.id} tone={n.tone} onClick={() => onPick(n, b.id)} />)}
            </div>
          )}
          </div>
        )
      })}
    </div>
  )
}

const StoryCtx = createContext({ roleOf: () => 'dentist', onRoleChange: () => {} })

// What an opened row holds, shown right beneath it: its parts (with any
// "what to do" line first), or one of its breakdowns, as a nested list.
function InlineParts({ node }) {
  const { roleOf, onRoleChange } = useContext(StoryCtx)
  const [mode, setMode] = useState(null)
  if (node.kind === 'provider') return <ProviderCard node={node} role={roleOf(node.label)} onRoleChange={onRoleChange} />
  const brks = breakdownsOf(node)
  const brk = mode ? brks.find((b) => b.id === mode) : null
  const nodes = brk ? (brk.children ? brk.children() : []) : partsOf(node)
  const groups = [...groupBy(nodes, (n) => n.group || '')]
  return (
    <div className="space-y-2.5">
      {brks.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-slate-400 mr-0.5">Split {node.label} by</span>
          {brks.map((b) => <BreakdownChip key={b.id} b={b} on={mode === b.id} tone={node.tone} onClick={() => setMode(mode === b.id ? null : b.id)} />)}
        </div>
      )}
      {groups.map(([name, list]) => {
        const callouts = list.filter((n) => n.kind === 'placeholder' && n.callout)
        const notes = list.filter((n) => n.kind === 'placeholder' && !n.callout)
        const rows = list.filter((n) => n.kind !== 'placeholder' && n.kind !== 'pill')
        return (
          <div key={name}>
            {name && <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">{name}</p>}
            {callouts.map((n) => (
              <div key={n.id} className="rounded-lg bg-white border border-slate-200 px-3 py-2 text-[12.5px] text-slate-700 leading-snug">
                {n.group === 'What to do' ? n.text : <><b className="font-semibold text-slate-900">{n.label}</b>{n.text ? ` — ${n.text}` : ''}</>}
              </div>
            ))}
            {rows.length > 0 && <RankList nodes={rows} parent={brk ? node : node} inline />}
            {notes.map((n) => <p key={n.id} className="text-[11px] text-slate-400 mt-1"><b className="font-semibold">{n.label}.</b> {n.text}</p>)}
          </div>
        )
      })}
      {!nodes.length && <p className="text-[11px] text-slate-400">Nothing further to show.</p>}
    </div>
  )
}

function Card({ node, parent, selected, mode, dimmed, onClick, onBreakdown }) {
  if (node.kind === 'placeholder') {
    return (
      <div data-node={node.id} className="w-52 rounded-xl border-2 border-dashed border-slate-200 px-3.5 py-2.5 text-left bg-white/40">
        <p className="text-[13px] font-semibold text-slate-400">{node.label}</p>
        <p className="text-[10.5px] text-slate-400 mt-1 leading-snug">{node.text}</p>
      </div>
    )
  }

  const t = TONE[node.tone] || TONE.gross
  const brks = breakdownsOf(node)
  const opens = partsOf(node).length > 0 || brks.length > 0 || node.kind === 'provider'
  const showParts = partsOf(node).length > 0 || node.kind === 'provider'

  if (node.kind === 'pill') {
    return (
      <button data-node={node.id} onClick={onClick}
        className={`self-center inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-xs font-semibold transition-all duration-300 ${
          selected ? `bg-white border-transparent ring-2 ${t.ring} ${t.text}` : `bg-white border-slate-200 text-slate-600 hover:border-slate-300 ${dimmed ? 'opacity-50 hover:opacity-100' : ''}`
        }`}>
        {node.label}
        <svg className={`w-3 h-3 transition-transform duration-300 ${selected ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" /></svg>
      </button>
    )
  }

  const isRoot = node.kind === 'root'
  const showShare = parent && !node.noShare && parent.value > 0
  const share = showShare ? Math.max(0, Math.min(100, (node.value / parent.value) * 100)) : null

  return (
    <div data-node={node.id} role="button" tabIndex={0} onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      className={`${isRoot ? 'w-80 px-5 py-4' : 'w-52 px-3.5 py-2.5'} flex flex-col text-left rounded-xl border transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${opens ? 'cursor-pointer' : 'cursor-default'} ${
        selected ? `bg-white border-transparent ring-2 ${t.ring} shadow-md shadow-slate-200/70`
          : `bg-white border-slate-200 ${opens ? 'hover:border-slate-300 hover:-translate-y-px' : ''} ${dimmed ? 'opacity-50 hover:opacity-100' : ''}`
      }`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`${isRoot ? 'text-sm' : 'text-[13px]'} font-semibold text-slate-800 truncate`} title={node.label}>{node.label}</span>
        {share != null && <span className="text-[10px] tabular-nums text-slate-400 shrink-0">{share.toFixed(0)}%</span>}
        {share == null && node.source && <span className="text-[10px] text-slate-400 shrink-0">{node.source}</span>}
      </div>
      <p className={`${isRoot ? 'text-3xl' : 'text-lg'} font-bold tabular-nums ${t.text}`}>
        {node.count ? `${Math.round(node.value).toLocaleString('en-US')} ${node.unit || 'patient'}${Math.round(node.value) === 1 ? '' : 's'}` : fmtFull(node.value)}
      </p>
      {share != null && (
        <div className="h-1 rounded-full bg-slate-100 overflow-hidden mt-1.5">
          <div className={`h-full rounded-full ${t.bar} transition-[width] duration-700 ease-out`} style={{ width: `${share}%` }} />
        </div>
      )}
      {node.outcome && (
        <p className={`text-sm font-bold mt-1.5 ${node.outcome.patients ? 'text-emerald-700' : 'text-red-600'}`}>
          → {node.outcome.patients} new patient{node.outcome.patients === 1 ? '' : 's'}
          {node.outcome.each != null && <span className="font-semibold text-slate-500"> · {fmtShort(node.outcome.each)} each</span>}
        </p>
      )}
      {node.sub && <p className="text-[10.5px] text-slate-500 mt-1 leading-snug">{node.sub}</p>}
      {node.note && <p className={`text-[11px] font-semibold mt-1.5 leading-snug ${t.text}`}>{node.note}</p>}
      <div className="mt-auto pt-1.5 flex flex-wrap items-center gap-1">
        {showParts && node.kind !== 'provider' && !(selected && !mode) && (
          <span className={`text-[10px] font-semibold ${t.text} opacity-70 mr-1`}>Open {'\u25BE'}</span>
        )}
        {brks.map((b) => (
          <BreakdownChip key={b.id} b={b} on={selected && mode === b.id} tone={node.tone}
            onClick={(e) => { e.stopPropagation(); onBreakdown?.(b.id) }} />
        ))}
      </div>
    </div>
  )
}

// A breakdown button on a card ("By location"): opens the card's own number
// split that way, as the next row of the tree.
function BreakdownChip({ b, on, tone, onClick }) {
  const t = TONE[tone] || TONE.gross
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold transition-colors ${
        on ? `bg-white border-transparent ring-2 ${t.ring} ${t.text}` : 'bg-white/80 border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'}`}>
      {b.label}
      <svg className={`w-2.5 h-2.5 transition-transform ${on ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" /></svg>
    </button>
  )
}

// Made vs spent, the line an owner reads first.
function BottomLine({ income, spent, left, margin, periodText }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-2xl bg-white/70 border border-slate-200 px-5 py-4 mb-4">
      <Figure label={`Came in (${periodText})`} value={fmtFull(income)} tone="text-sky-700" />
      <span className="text-xl font-bold text-slate-300">−</span>
      <Figure label="Known costs" value={fmtFull(spent)} tone="text-rose-600" note="marketing + supplies so far" />
      <span className="text-xl font-bold text-slate-300">=</span>
      <Figure label="Left after known costs" value={fmtFull(left)} tone={left >= 0 ? 'text-emerald-700' : 'text-red-600'}
        note="before payroll, rent, lab and other costs" />
    </div>
  )
}

function Figure({ label, value, tone, note }) {
  return (
    <div className="text-center">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
      {note && <p className="text-[10px] text-slate-400">{note}</p>}
    </div>
  )
}

function Problems({ items, periodText }) {
  return (
    <div className="mt-8 pt-6 border-t border-slate-100">
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3">{periodText} · problems & what to do</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((p) => (
          <div key={p.title} className="rounded-xl bg-white border border-slate-200 px-4 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-slate-800">{p.title}</p>
              {p.amount != null && <p className={`text-base font-bold tabular-nums ${TONE[p.tone]?.text || 'text-slate-900'}`}>{p.count ? `${Math.round(p.amount).toLocaleString('en-US')} patients` : fmtShort(p.amount)}</p>}
            </div>
            <p className="text-xs text-slate-500 mt-1 leading-snug">{p.detail}</p>
            <p className="text-xs text-slate-700 mt-2 leading-snug"><span className="font-semibold">What to do: </span>{p.fix}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

const ROLE_LABEL = { doctor: 'Doctor', hygiene: 'Hygienist', office: 'Office' }

function ProviderCard({ node, role, onRoleChange }) {
  const t = node.totals
  const months = [...groupBy(node.rows, (r) => r.period)].sort(([a], [b]) => a.localeCompare(b)).map(([p, rs]) => [p, sum(rs).net])
  const max = Math.max(...months.map(([, v]) => Math.abs(v)), 1)
  return (
    <div data-leaf className="w-80 rounded-2xl bg-white border border-slate-200 shadow-md shadow-slate-200/70 p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-base font-bold text-slate-900">{node.label}</p>
        {/* Ascend doesn't say who is a hygienist; set it here once and it's
            remembered in this browser. */}
        {onRoleChange && (
          <div className="inline-flex shrink-0 rounded-lg border border-slate-200 p-0.5 bg-slate-50">
            {['doctor', 'hygiene', 'office'].map((r) => (
              <button key={r} onClick={() => role !== r && onRoleChange(node.label, r)}
                className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-md ${role === r ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-500">{[...new Set(node.rows.map((r) => r.location))].map(shortLocation).join(', ')}</p>
      <dl className="grid grid-cols-2 gap-3 mt-4">
        <Metric label="Gross" value={fmtFull(t.gross)} />
        <Metric label="Net" value={fmtFull(t.net)} tone="text-emerald-700" />
        <Metric label="Write-offs" value={fmtFull(t.writeoffs)} tone="text-amber-700" />
        <Metric label="Write-off rate" value={fmtPct(t.rate)} />
      </dl>
      {months.length > 1 && (
        <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Net by month</p>
          {months.map(([p, net]) => (
            <div key={p} className="flex items-center gap-2 text-xs">
              <span className="w-16 text-slate-500">{periodLabel(p)}</span>
              <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(0, (net / max) * 100)}%` }} />
              </div>
              <span className="w-16 text-right tabular-nums text-slate-700">{fmtShort(net)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, tone = 'text-slate-900' }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</dt>
      <dd className={`text-sm font-bold tabular-nums mt-0.5 ${tone}`}>{value}</dd>
    </div>
  )
}
