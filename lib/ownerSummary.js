import { runTool } from '@/lib/analysisTools'
import { rcmMissing, rcmClaimsByCarrier } from '@/lib/rcmClaims'
import { OFFICE_CAN_FIX, matchCarrier } from '@/lib/claimReasons'

// ─────────────────────────────────────────────────────────────────────────────
// Server only. The owner summary: a few numbers for a month or range of
// months (default: the last complete month), each against the period before
// and the same months last year (and a target where
// the industry has one), the six offices side by side, and what needs
// attention. Built from the same tools as the chat, so the numbers match the
// Analysis views. Totals only.
// ─────────────────────────────────────────────────────────────────────────────

const OVER_90 = ['91-120', '120+']
const pct = (a, b) => (b ? (a / b) * 100 : null)
const prevMonth = (p, n = 1) => { const [y, m] = p.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 - n, 1)); return d.toISOString().slice(0, 7) }
const lastDay = (p) => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }
const byKey = (groups) => Object.fromEntries((groups || []).map((g) => [g.key, g]))

// Industry rules of thumb (vendor and billing-company guides — not ADA).
export const TARGETS = {
  collectionRate: { good: 98, ok: 95, text: '98%+ of net production' },
  over90: { good: 15, ok: 25, text: 'under 15–20% of open insurance AR' },
  retention: { good: 85, ok: 75, text: '85%+ booked or back' },
}
const grade = (v, t, lowerIsBetter = false) => (v == null ? null
  : lowerIsBetter ? (v <= t.good ? 'good' : v <= t.ok ? 'ok' : 'bad')
    : (v >= t.good ? 'good' : v >= t.ok ? 'ok' : 'bad'))

// Months from a to b (YYYY-MM), inclusive.
const monthsBetween = (a, b) => { const out = []; for (let p = a; p <= b; p = prevMonth(p, -1)) out.push(p); return out }
const daysIn = (p) => Number(lastDay(p).slice(8, 10))

/**
 * opts: { from, to } as YYYY-MM (default: the last complete month). The
 * period is compared with the one just before it (same length) and the same
 * months a year earlier. When it reaches into the current month, that month
 * is only partly done: money and counts are then compared on pace (the month
 * so far scaled to a full month), never so-far against a whole month.
 *
 * opts.location (an office) or opts.provider narrows every number that
 * exists that way. Collections, new patients and A/R have no provider in the
 * reports, so with a provider picked those come back marked unavailable.
 * The offices table always shows every office, for comparison.
 */
export async function buildSummary(R, opts = {}) {
  const overview = await runTool('data_overview', {}, R)
  const thisMonth = new Date().toISOString().slice(0, 7)
  const first = overview.production?.from || '2020-01'
  const latest = overview.production?.to || thisMonth
  const lastComplete = latest >= thisMonth ? prevMonth(thisMonth) : latest
  const ok = (p) => typeof p === 'string' && /^\d{4}-\d{2}$/.test(p) && p >= first && p <= latest
  let F = ok(opts.from) ? opts.from : lastComplete
  let T = ok(opts.to) ? opts.to : F
  if (T < F) [F, T] = [T, F]
  const span = monthsBetween(F, T).length
  const PF = prevMonth(F, span), PT = prevMonth(T, span)        // the period before
  const LF = prevMonth(F, 12), LT = prevMonth(T, 12)            // a year earlier
  const M3 = prevMonth(T, 2)

  // How much of the last month is done: the day the reports run to.
  const asOf = R.schedule?.asOf || new Date().toISOString().slice(0, 10)
  const partial = T >= thisMonth || T === asOf.slice(0, 7)
  const done = partial ? Math.min(1, Math.max(1, Number(asOf.slice(8, 10))) / daysIn(T)) : 1

  // The filter: one office, or one provider (never both).
  const LOC = opts.location && !opts.provider ? opts.location : null
  const PROV = opts.provider || null
  const NONE = { total: null, groups: [] }      // "not available for this filter"
  const where = { ...(LOC ? { location: LOC } : {}), ...(PROV ? { provider: PROV } : {}) }
  const dayTo = (to) => (to === asOf.slice(0, 7) ? asOf : lastDay(to))

  // Unfiltered — for the offices table, which always compares every office.
  const prodAll = async (from, to, group_by) => runTool('production', { from, to, ...(group_by ? { group_by } : {}) }, R)
  const collAll = async (from, to, group_by) => runTool('collections', { from, to, ...(group_by ? { group_by } : {}) }, R)
  const newpAll = async (from, to, group_by) => runTool('new_patients', { from, to, ...(group_by ? { group_by } : {}) }, R)
  const keptAll = async (from, to, group_by) => runTool('retention', { from: `${from}-01`, to: dayTo(to), ...(group_by ? { group_by } : {}) }, R)
  // Filtered — for the scorecards.
  const prod = async (from, to, group_by) => runTool('production', { from, to, ...where, ...(group_by ? { group_by } : {}) }, R)
  const coll = async (from, to, group_by) => (PROV ? NONE : runTool('collections', { from, to, ...(LOC ? { location: LOC } : {}), ...(group_by ? { group_by } : {}) }, R))
  const newp = async (from, to, group_by) => (PROV ? NONE : runTool('new_patients', { from, to, ...(LOC ? { location: LOC } : {}), ...(group_by ? { group_by } : {}) }, R))
  const kept = async (from, to, group_by) => {
    if (!LOC && !PROV) return keptAll(from, to, group_by)
    // The retention tool gives per-office / per-provider rows; take ours.
    const r = await runTool('retention', { from: `${from}-01`, to: dayTo(to), group_by: LOC ? 'location' : 'provider' }, R)
    const g = (r.groups || []).find((x) => x.key === (LOC || PROV))
    return { total: g ? { seen: g.seen, came_back_or_booked: g.came_back_or_booked, retention_pct: g.retention_pct, missed_appointment_not_rebooked: g.missed_not_rebooked } : null, groups: r.groups }
  }
  const hygMonth = async (p) => {
    const h = await runTool('hygiene_production', { month: p }, R)
    if (LOC) return (h.by_office || []).find((x) => x.key === LOC)?.gross || 0
    if (PROV) return (h.by_person || []).find((x) => x.key === PROV)?.gross || 0
    return h.total || 0
  }
  const hyg = async (from, to) => {
    let total = 0
    for (const p of monthsBetween(from, to)) total += await hygMonth(p)
    return { total }
  }

  const [pM, pP, pLY, cM, cP, cLY, c3, p3, nM, nP, nLY, kM, kP, hM, hP, hLY, pT, cT, nT, hT] = await Promise.all([
    prod(F, T, 'location'), prod(PF, PT), prod(LF, LT),
    coll(F, T, 'location'), coll(PF, PT), coll(LF, LT),
    coll(M3, T), prod(M3, T),
    newp(F, T, 'location'), newp(PF, PT), newp(LF, LT),
    kept(F, T, 'location'), kept(PF, PT),
    hyg(F, T), hyg(PF, PT), hyg(LF, LT),
    // The last month alone, for the pace of a month still running.
    prod(T, T), coll(T, T), newp(T, T), hyg(T, T),
  ])

  // The 12 months up to the period's end, for each tile's trend line.
  const trendMonths = monthsBetween(prevMonth(T, 11), T).filter((p) => p >= first)
  const [pBy, cBy, nBy] = await Promise.all([
    prod(trendMonths[0], T, 'month'), coll(trendMonths[0], T, 'month'), newp(trendMonths[0], T, 'month'),
  ])
  const at = (res, key, field) => Object.fromEntries((res?.groups || []).map((g) => [g.key, g[field]]))
  const grossBy = at(pBy, 'gross', 'gross'), netBy = at(pBy, 'net', 'net'), colBy = at(cBy, 'total', 'total'), newBy = at(nBy, 'patients', 'patients')
  const hygBy = {}
  for (const p of trendMonths) hygBy[p] = await hygMonth(p)
  const keptBy = Object.fromEntries(trendMonths.map((p) => {
    const m = R.schedule?.months?.[p]
    const t = LOC ? m?.byLoc?.[LOC] : PROV ? m?.byProv?.[PROV] : m?.total
    return [p, t?.seen ? (t.seenNext / t.seen) * 100 : null]
  }))
  const series = (by) => trendMonths.map((p) => ({ p, v: by[p] ?? null }))

  // Open insurance AR over 90 days, from the aging report (as of its date).
  const ar = { total: 0, over90: 0, byLoc: {} }
  for (const [loc, v] of Object.entries(R.aging?.locations || {})) {
    const o90 = OVER_90.reduce((s, b) => s + (v.buckets?.[b]?.expected || 0), 0)
    ar.byLoc[loc] = { total: v.expected, over90: o90, over120: v.buckets?.['120+']?.expected || 0 }
    if (LOC && loc !== LOC) continue
    ar.total += v.expected; ar.over90 += o90
    ar.over120 = (ar.over120 || 0) + (v.buckets?.['120+']?.expected || 0)
  }

  // A/R by age, per office and for the group: billed and expected per bucket.
  const BUCKETS = ['0-30', '31-60', '61-90', '91-120', '120+']
  const blank = () => ({ billed: 0, expected: 0, claims: 0 })
  const arGroup = { name: 'All offices', buckets: Object.fromEntries(BUCKETS.map((b) => [b, blank()])), total: blank() }
  const arOffices = Object.entries(R.aging?.locations || {}).map(([name, v]) => {
    const o = { name, buckets: {}, total: blank() }
    for (const b of BUCKETS) {
      const x = v.buckets?.[b] || {}
      o.buckets[b] = { billed: x.billed || 0, expected: x.expected || 0, claims: x.claims || 0 }
      for (const f of ['billed', 'expected', 'claims']) { o.total[f] += o.buckets[b][f]; arGroup.buckets[b][f] += o.buckets[b][f]; arGroup.total[f] += o.buckets[b][f] }
    }
    return o
  }).filter((o) => o.total.claims > 0).sort((a, b) => b.total.expected - a.total.expected)
  const arAging = R.aging ? { asOf: R.aging.asOf, buckets: BUCKETS, offices: arOffices, group: arGroup } : null

  const net = (x) => x?.total?.net || 0
  const gross = (x) => x?.total?.gross || 0
  const col = (x) => x?.total?.total || 0
  const rate = pct(col(cM), net(pM))
  const rate3 = pct(col(c3), net(p3))
  const over90 = pct(ar.over90, ar.total)
  const keptPct = kM?.total?.retention_pct ?? null
  // On pace: the period as if its last (running) month were complete.
  const pace = (value, lastMonthValue) => (partial && value != null ? value + (lastMonthValue || 0) * (1 / done - 1) : null)

  const kpis0 = [
    { key: 'gross', trend: series(grossBy), label: 'Gross production', view: 'money', money: true, value: gross(pM), pace: pace(gross(pM), gross(pT)), prev: gross(pP), lastYear: gross(pLY) || null, note: 'full fees for all the work done, before write-offs' },
    { key: 'net', trend: series(netBy), label: 'Net production', view: 'money', money: true, value: net(pM), pace: pace(net(pM), net(pT)), prev: net(pP), lastYear: net(pLY) || null, note: 'what can be collected for the work done' },
    { key: 'collections', trend: series(colBy), label: 'Collections', view: 'money', money: true, value: col(cM), pace: pace(col(cM), col(cT)), prev: col(cP), lastYear: col(cLY) || null, note: 'money received' },
    { key: 'rate', target: TARGETS.collectionRate.good, trend: trendMonths.map((p) => ({ p, v: netBy[p] ? (colBy[p] || 0) / netBy[p] * 100 : null })), label: 'Collection rate', view: 'money', percent: true, value: rate, status: partial && span === 1 ? null : grade(rate3, TARGETS.collectionRate),
      note: `${partial ? 'month still running — insurance pays weeks after the work, so this rises · ' : ''}3 months to ${monthName(T)}: ${rate3 != null ? Math.round(rate3) : '—'}% · target ${TARGETS.collectionRate.text}` },
    { key: 'over90', target: TARGETS.over90.good, lowerIsBetter: true, label: 'Insurance AR over 90 days', view: 'money', percent: true, value: over90, status: grade(over90, TARGETS.over90, true), snapshot: true,
      note: `$${Math.round(ar.over90).toLocaleString('en-US')} of $${Math.round(ar.total).toLocaleString('en-US')} · target ${TARGETS.over90.text}`, asOf: R.aging?.asOf },
    { key: 'kept', trend: series(keptBy), target: TARGETS.retention.good, label: 'Patients kept', view: 'retention', percent: true, value: keptPct, prev: kP?.total?.retention_pct ?? null, status: grade(keptPct, TARGETS.retention),
      note: `of ${(kM?.total?.seen || 0).toLocaleString('en-US')} seen, booked again or came back` },
    { key: 'new', trend: series(newBy), label: 'New patients', view: 'retention', count: true, value: nM?.total?.patients ?? null, pace: pace(nM?.total?.patients ?? null, nT?.total?.patients), prev: nP?.total?.patients ?? null, lastYear: nLY?.total?.patients || null, note: 'first visits' },
    { key: 'hygiene', trend: series(hygBy), label: 'Hygiene production', view: 'hygiene', money: true, value: hM.total || null, pace: pace(hM.total || null, hT.total), prev: hP.total || null, lastYear: hLY.total || null, note: 'gross, credited to hygiene' },
  ]
  const NOT_BY_PROVIDER = { collections: 'collections aren\u2019t recorded per provider', rate: 'collections aren\u2019t recorded per provider', new: 'the New Patients sheet has no provider', over90: 'claims aren\u2019t tied to a provider' }
  const provIsHygienist = PROV && (R.schedule?.specialty?.[PROV] === 'Hygienist' || /\brdh\b|hygienist|temp/i.test(PROV))
  const kpis = kpis0.map((k) => (PROV && NOT_BY_PROVIDER[k.key]
    ? { key: k.key, label: k.label, view: k.view, unavailable: `Not by provider \u2014 ${NOT_BY_PROVIDER[k.key]}` }
    : PROV && k.key === 'hygiene' && !provIsHygienist
      ? { key: k.key, label: k.label, view: k.view, unavailable: `${PROV} isn\u2019t a hygienist` }
      : k))

  // ── The six offices side by side (always every office) ──
  const filtered = !!(LOC || PROV)
  const [oP, oC, oN, oK] = filtered
    ? await Promise.all([prodAll(F, T, 'location'), collAll(F, T, 'location'), newpAll(F, T, 'location'), keptAll(F, T, 'location')])
    : [pM, cM, nM, kM]
  const P_ = byKey(oP.groups), C_ = byKey(oC.groups), N_ = byKey(oN.groups), K_ = byKey(oK.groups)
  const names = [...new Set([...Object.keys(P_), ...Object.keys(C_)])].filter((l) => (P_[l]?.net || 0) > 1000)
  const offices = names.map((l) => ({
    name: l,
    selected: l === LOC,
    net: P_[l]?.net || 0,
    collections: C_[l]?.total || 0,
    rate: pct(C_[l]?.total || 0, P_[l]?.net || 0),
    sameMonth: pct(C_[l]?.for_same_month_work || 0, C_[l]?.total || 0),
    over90: pct(ar.byLoc[l]?.over90 || 0, ar.byLoc[l]?.total || 0),
    over120: pct(ar.byLoc[l]?.over120 || 0, ar.byLoc[l]?.total || 0),
    kept: K_[l]?.retention_pct ?? null,
    newPatients: N_[l]?.patients ?? 0,
    missedNotRebooked: K_[l]?.missed_not_rebooked ?? 0,
  })).sort((a, b) => b.net - a.net)
  const arAll = Object.values(ar.byLoc).reduce((x, v) => ({ total: x.total + v.total, over90: x.over90 + v.over90, over120: x.over120 + v.over120 }), { total: 0, over90: 0, over120: 0 })
  const groupAvg = {
    rate: pct(col(oC), net(oP)), over90: pct(arAll.over90, arAll.total), over120: pct(arAll.over120, arAll.total), kept: oK?.total?.retention_pct ?? null,
    sameMonth: pct(oC.total?.for_same_month_work || 0, col(oC)),
  }
  // A cell is flagged when an office is 5+ points worse than the group.
  for (const o of offices) {
    o.flags = {
      rate: o.rate != null && groupAvg.rate != null && o.rate < groupAvg.rate - 5,
      sameMonth: o.sameMonth != null && groupAvg.sameMonth != null && o.sameMonth < groupAvg.sameMonth - 5,
      over90: o.over90 != null && groupAvg.over90 != null && o.over90 > groupAvg.over90 + 5,
      over120: o.over120 != null && groupAvg.over120 != null && o.over120 > groupAvg.over120 + 5,
      kept: o.kept != null && groupAvg.kept != null && o.kept < groupAvg.kept - 5,
    }
  }

  // ── Needs attention ──
  const label = span === 1 ? monthName(F) + ' ' + F.slice(0, 4) : `${monthName(F)} ${F.slice(0, 4)} – ${monthName(T)} ${T.slice(0, 4)}`
  const attention = []
  const who = LOC ? short(LOC) : PROV ? PROV : null
  if (!PROV && over90 != null && grade(over90, TARGETS.over90, true) !== 'good') {
    const worst = LOC ? null : [...offices].sort((a, b) => (b.over90 || 0) - (a.over90 || 0))[0]
    attention.push({ tone: 'bad', view: 'money', text: `${Math.round(over90)}% of ${LOC ? `${who}\u2019s ` : ''}open insurance AR is over 90 days ($${Math.round(ar.over90 / 1000).toLocaleString('en-US')}k).${worst ? ` Highest: ${short(worst.name)} at ${Math.round(worst.over90)}%.` : ''}` })
  }
  // Office-vs-group items: every office unfiltered, only the picked one by office, none by provider.
  const inScope = (o) => !PROV && (!LOC || o.name === LOC)
  const slow = offices.filter((o) => o.flags.sameMonth && inScope(o)).sort((a, b) => a.sameMonth - b.sameMonth)[0]
  if (slow && !(partial && span === 1)) attention.push({ tone: 'ok', view: 'money', text: `${short(slow.name)} collects slowest: ${Math.round(slow.sameMonth)}% of its collections were for same-month work, against ${Math.round(groupAvg.sameMonth)}% for the group.` })
  const lowKept = offices.filter((o) => o.flags.kept && inScope(o)).sort((a, b) => a.kept - b.kept)[0]
  if (PROV && keptPct != null && grade(keptPct, TARGETS.retention) !== 'good') attention.push({ tone: grade(keptPct, TARGETS.retention) === 'bad' ? 'bad' : 'ok', view: 'retention', text: `${PROV} kept ${Math.round(keptPct)}% of patients seen (booked or back), against a target of ${TARGETS.retention.good}% and ${Math.round(groupAvg.kept)}% for the group.` })
  if (lowKept) attention.push({ tone: 'ok', view: 'retention', text: `${short(lowKept.name)} keeps fewer patients: ${Math.round(lowKept.kept)}% booked or back, against ${Math.round(groupAvg.kept)}% for the group.` })
  const missed = kM?.total?.missed_appointment_not_rebooked || 0
  if (missed) attention.push({ tone: 'ok', view: 'retention', text: `${missed.toLocaleString('en-US')} patient${missed === 1 ? '' : 's'} seen ${who ? (LOC ? `at ${who}` : `by ${who}`) + ' ' : ''}in ${label} missed an appointment and ${missed === 1 ? 'hasn\u2019t' : 'haven\u2019t'} been rebooked.` })
  const netNow = partial ? pace(net(pM), net(pT)) : net(pM)
  if (net(pLY) && netNow < net(pLY) * 0.95) attention.push({ tone: 'bad', view: 'money', text: `Net production is ${partial ? 'on pace to be ' : ''}${Math.round(100 - pct(netNow, net(pLY)))}% below the same ${span === 1 ? 'month' : 'months'} last year.` })

  // Fixable denial reasons and the biggest insurer balance over 90 days.
  try {
    if (!PROV && !rcmMissing().length && R.aging) {
      const agingLocs = Object.entries(R.aging.locations).filter(([l]) => !LOC || l === LOC).map(([, v]) => v)
      const fu = await rcmClaimsByCarrier()
      const reasons = {}
      const over90By = {}
      for (const v of agingLocs) {
        for (const b of OVER_90) for (const [c, x] of Object.entries(v.buckets?.[b]?.carriers || {})) over90By[c] = (over90By[c] || 0) + x.expected
      }
      const carriers = {}
      for (const v of agingLocs) for (const [c, x] of Object.entries(v.carriers || {})) carriers[c] = (carriers[c] || 0) + x.expected
      for (const [c, open] of Object.entries(carriers)) {
        const f = matchCarrier(c, fu.carriers)
        if (!f?.classified) continue
        for (const [r, n] of Object.entries(f.reasons)) if (OFFICE_CAN_FIX.has(r)) reasons[r] = (reasons[r] || 0) + open * (n / f.classified)
      }
      const fix = Object.entries(reasons).sort((a, b) => b[1] - a[1])
      const fixTotal = fix.reduce((s, [, d]) => s + d, 0)
      if (fix.length) attention.push({ tone: 'ok', view: 'money', text: `≈ $${Math.round(fixTotal / 1000).toLocaleString('en-US')}k of open claims is stuck for reasons the office can fix — most of it ${fix.slice(0, 2).map(([r]) => r).join(' and ')}.` })
      const [topIns, topAmt] = Object.entries(over90By).sort((a, b) => b[1] - a[1])[0] || []
      if (topIns) attention.push({ tone: 'ok', view: 'money', text: `${topIns} has the most over 90 days: $${Math.round(topAmt).toLocaleString('en-US')}.` })
    }
  } catch { /* follow-up unavailable: the rest of the summary still stands */ }

  const spec = R.schedule?.specialty || {}
  const recentRows = (R.production?.rows || []).filter((r) => r.period >= prevMonth(lastComplete, 11) && r.period <= latest)
  const provGross = {}
  for (const r of recentRows) provGross[r.provider] = (provGross[r.provider] || 0) + r.gross
  const filterOptions = {
    locations: [...new Set(recentRows.map((r) => r.location))].filter(Boolean).sort(),
    providers: Object.entries(provGross).filter(([n, g]) => g > 1000 && !/^(valley view dental|dentique|alora|edc of)/i.test(n))
      .sort((x, y) => y[1] - x[1]).map(([name]) => ({ name, role: spec[name] === 'Hygienist' || /\brdh\b|hygienist|temp/i.test(name) ? 'Hygienist' : 'Dentist' })),
  }

  return {
    location: LOC, provider: PROV, filterOptions,
    from: F, to: T, span, prevFrom: PF, prevTo: PT, lastYearFrom: LF, lastYearTo: LT,
    partial, asOf, done, lastComplete, months: monthsBetween(first, latest),
    kpis, arAging, offices, groupAvg, attention: attention.slice(0, 6), targets: TARGETS }
}

const short = (l) => String(l).replace(/^Valley View Dental /, '').replace(/^Dentique /, 'Dentique ')
const monthName = (p) => new Date(`${p}-15T12:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
