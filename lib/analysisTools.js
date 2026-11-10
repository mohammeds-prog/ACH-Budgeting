import { loadReportsByKind } from '@/lib/analysisData'
import { scheduleRange, referralChannel } from '@/lib/dentrixReports'
import { rcmMissing, rcmClaimsByCarrier } from '@/lib/rcmClaims'
import { OFFICE_CAN_FIX, matchCarrier } from '@/lib/claimReasons'

// ─────────────────────────────────────────────────────────────────────────────
// Server only. The Analysis assistant's tools: each answers one kind of
// question from the same parsed reports the Analysis page uses, and returns
// totals only — never patient names, chart numbers or birth dates.
// ─────────────────────────────────────────────────────────────────────────────

const OFFICES = ['Valley View Dental Romeoville', 'Valley View Dental Naperville', 'Valley View Dental Montgomery',
  'Dentique Lemont', 'Dentique Downers Grove', 'Alora Dental Spa']
const r0 = (n) => Math.round(n || 0)
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null)
// Months are YYYY-MM; a full date ("2026-10-01") is read as its month.
const ym = (v) => (v ? String(v).slice(0, 7) : v)
const inRange = (p, from, to) => (!from || p >= ym(from)) && (!to || p <= ym(to))
// Says which months an answer covers, so it is never mislabelled.
const covers = (rows, a) => {
  const ps = [...new Set(rows.map((r) => r.period).filter(Boolean))].sort()
  return { months_covered: ps.length ? (ps[0] === ps[ps.length - 1] ? ps[0] : `${ps[0]} to ${ps[ps.length - 1]}`) : 'none — no data for this range', asked_for: a.from || a.to ? `${ym(a.from) || 'start'} to ${ym(a.to) || 'latest'}` : 'all months' }
}
// "Romeoville", "dentique lemont", "alora" → the report's office name.
function office(q) {
  if (!q) return null
  const s = String(q).toLowerCase()
  return OFFICES.find((o) => o.toLowerCase().includes(s) || s.includes(o.toLowerCase().replace('valley view dental ', ''))) || q
}
const matches = (value, q) => !q || String(value || '').toLowerCase().includes(String(q).toLowerCase())

// Every report — the database first, then the reports folder, then the live
// New Patients sheet (lib/analysisData.js). Parsed once and cached.
async function loadReports() {
  return loadReportsByKind()
}

function groupSum(rows, key, fields) {
  const g = {}
  for (const r of rows) {
    const k = key(r)
    const o = (g[k] ||= Object.fromEntries(fields.map((f) => [f, 0])))
    for (const f of fields) o[f] += r[f] || 0
  }
  return Object.entries(g).map(([k, v]) => ({ key: k, ...Object.fromEntries(fields.map((f) => [f, r0(v[f])])) }))
    .sort((a, b) => b[fields[0]] - a[fields[0]])
}

// ── Tools ──────────────────────────────────────────────────────────────────

const period = { type: 'string', description: 'Month as YYYY-MM (e.g. 2026-10). Omit for no limit.' }
const TOOLS = [
  {
    name: 'data_overview',
    description: 'What data is loaded: which months each report covers, the aging report date, the schedule date, and whether claims follow-up (RCM) is connected. Call this first when unsure what period to use.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (_, R) => {
      const months = (rows) => { const ps = [...new Set(rows.map((r) => r.period).filter(Boolean))].sort(); return ps.length ? { from: ps[0], to: ps[ps.length - 1] } : null }
      return {
        today: new Date().toISOString().slice(0, 10),
        production: R.production ? months(R.production.rows) : 'not loaded',
        collections: R.collections ? months(R.collections.rows) : 'not loaded',
        aging: R.aging ? { as_of: R.aging.asOf || 'date of the file', open_claims: Object.values(R.aging.locations).reduce((s, l) => s + l.claims, 0) } : 'not loaded',
        schedule: R.schedule ? { appointments_up_to: R.schedule.asOf, history_from: R.schedule.since } : 'not loaded',
        new_patients: R.newPatients ? months(Object.keys(R.newPatients.months).map((p) => ({ period: p }))) : 'not loaded',
        google_ad_spend_file: R.adSpend ? months(R.adSpend.rows) : 'not loaded',
        claims_follow_up_rcm: rcmMissing().length ? 'not connected' : 'connected',
        not_available: ['payroll', 'doctor pay', 'rent', 'lab costs', 'hygienist timeclock hours'],
      }
    },
  },
  {
    name: 'production',
    description: 'Dentrix production by service month: gross (full fees), write-offs (insurance contracts and discounts) and net (what can be collected). Filter by office and/or provider; group by location, provider or month.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        from: period, to: period,
        location: { type: 'string', description: 'Office name or part of it, e.g. "Romeoville".' },
        provider: { type: 'string', description: 'Provider name or part of it.' },
        group_by: { type: 'string', enum: ['location', 'provider', 'month', 'none'] },
      },
    },
    run: async (a, R) => {
      if (!R.production) return { error: 'No production report loaded.' }
      const loc = office(a.location)
      const rows = R.production.rows.filter((r) => inRange(r.period, a.from, a.to) && (!a.location || r.location === loc) && matches(r.provider, a.provider))
        .map((r) => ({ ...r, writeoffs: r.gross - r.net }))
      const total = groupSum(rows, () => 'total', ['gross', 'writeoffs', 'net'])[0] || { gross: 0, writeoffs: 0, net: 0 }
      const key = { location: (r) => r.location, provider: (r) => r.provider, month: (r) => r.period }[a.group_by]
      return {
        ...covers(rows, a),
        total: { ...total, writeoff_rate_pct: pct(total.writeoffs, total.gross) },
        ...(key ? { groups: groupSum(rows, key, ['gross', 'writeoffs', 'net']).slice(0, 40) } : {}),
      }
    },
  },
  {
    name: 'collections',
    description: 'Money that came in, by the month it was received (transaction month): insurance vs patient payments, payment types, and how much paid for work done that same month vs earlier months. Group by location, payment_type or month.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        from: period, to: period,
        location: { type: 'string' },
        group_by: { type: 'string', enum: ['location', 'payment_type', 'month', 'none'] },
      },
    },
    run: async (a, R) => {
      if (!R.collections) return { error: 'No collections report loaded.' }
      const loc = office(a.location)
      const rows = R.collections.rows.filter((r) => r.period && inRange(r.period, a.from, a.to) && (!a.location || r.location === loc))
        .map((r) => ({ ...r, for_same_month_work: r.service === r.period ? r.total : 0 }))
      const total = groupSum(rows, () => 'total', ['total', 'insurance', 'patients', 'refunds', 'for_same_month_work'])[0] || {}
      const key = { location: (r) => r.location, payment_type: (r) => r.type, month: (r) => r.period }[a.group_by]
      return {
        ...covers(rows, a),
        total,
        note: 'for_same_month_work = paid in the month for work done that same month; the rest paid for earlier months.',
        ...(key ? { groups: groupSum(rows, key, ['total', 'insurance', 'patients', 'for_same_month_work']).slice(0, 40) } : {}),
      }
    },
  },
  {
    name: 'open_claims',
    description: 'Open insurance claims from the aging report: dollars still expected, by age bucket, claim status (e.g. unsent, rejected), insurer and office, optionally only for work in one service month. When claims follow-up (RCM) is connected, each insurer also gets its denial reasons, plus denial_reasons_ranked (every reason across the claims in scope, ranked by estimated open dollars), each marked office_can_fix (true = billing can fix and resubmit; false = the plan\u2019s rules, usually billed to the patient). "Expected" is the full contracted amount, including the patient share.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        location: { type: 'string' },
        carrier: { type: 'string', description: 'Insurer name or part of it.' },
        service_month: { ...period, description: 'Only claims for work done in this month (YYYY-MM).' },
        group_by: { type: 'string', enum: ['age', 'status', 'carrier', 'location'] },
      },
    },
    run: async (a, R) => {
      if (!R.aging) return { error: 'No aging report loaded.' }
      const loc = office(a.location)
      const locs = Object.entries(R.aging.locations).filter(([l]) => !a.location || l === loc)
        .map(([l, v]) => [l, a.service_month ? v.months?.[a.service_month] : v]).filter(([, v]) => v)
      const agg = { expected: 0, billed: 0, claims: 0 }, by = {}
      const add = (k, e, c) => { const o = (by[k] ||= { expected: 0, claims: 0 }); o.expected += e; o.claims += c }
      for (const [l, v] of locs) {
        if (a.carrier) {
          for (const [c, cv] of Object.entries(v.carriers || {})) if (matches(c, a.carrier)) { agg.expected += cv.expected; agg.claims += cv.claims; if (a.group_by === 'location') add(l, cv.expected, cv.claims); if (a.group_by === 'carrier') add(c, cv.expected, cv.claims) }
          if (a.group_by === 'age') for (const [b, bv] of Object.entries(v.buckets || {})) for (const [c, cv] of Object.entries(bv.carriers || {})) if (matches(c, a.carrier)) add(b, cv.expected, cv.claims)
          continue
        }
        agg.expected += v.expected; agg.billed += v.billed; agg.claims += v.claims
        const src = { age: v.buckets, status: v.statuses, carrier: v.carriers, location: { [l]: { expected: v.expected, claims: v.claims } } }[a.group_by] || {}
        for (const [k, kv] of Object.entries(src)) add(k, kv.expected, kv.claims)
      }
      const groups = Object.entries(by).map(([k, v]) => ({ key: k, expected: r0(v.expected), claims: v.claims })).sort((x, y) => y.expected - x.expected).slice(0, 30)
      let followUp = null
      // Every denial reason across the claims in scope, ranked by the open
      // dollars behind it — the same estimate as the Money tree: each
      // insurer's open $ × that reason's share of its worked claims.
      let reasonsRanked = null
      if (!rcmMissing().length) {
        try {
          const rcm = await rcmClaimsByCarrier()
          const open = {}
          for (const [, v] of locs) for (const [c, cv] of Object.entries(v.carriers || {})) if (!a.carrier || matches(c, a.carrier)) open[c] = (open[c] || 0) + cv.expected
          const tot = {}
          let openAll = 0, openMatched = 0, notDenied = 0
          for (const [c, dollars] of Object.entries(open)) {
            openAll += dollars
            const f = matchCarrier(c, rcm.carriers)
            if (!f?.classified) continue
            openMatched += dollars
            notDenied += dollars * ((f.classified - f.denied) / f.classified)
            for (const [r, n] of Object.entries(f.reasons)) {
              const o = (tot[r] ||= { reason: r, office_can_fix: OFFICE_CAN_FIX.has(r), denials: 0, est_open_dollars: 0, insurers: 0 })
              o.denials += n; o.est_open_dollars += dollars * (n / f.classified); o.insurers++
            }
          }
          reasonsRanked = Object.values(tot).map((o) => ({ ...o, est_open_dollars: r0(o.est_open_dollars) })).sort((x, y) => y.est_open_dollars - x.est_open_dollars).slice(0, 20)
          const deniedAll = Object.values(tot).reduce((s2, o) => s2 + o.est_open_dollars, 0)
          const fixable = Object.values(tot).filter((o) => o.office_can_fix).reduce((s2, o) => s2 + o.est_open_dollars, 0)
          reasonsRanked.split = {
            open_dollars: r0(openAll),
            est_in_denials: r0(deniedAll), est_in_denials_pct: pct(deniedAll, openAll),
            est_in_fixable_denials: r0(fixable), est_in_plan_rule_denials: r0(deniedAll - fixable),
            est_not_denied_still_being_worked: r0(notDenied),
            with_insurers_not_in_follow_up: r0(openAll - openMatched),
          }
          // The split in one sentence, worked out here so it's never misread.
          const usd = (n) => '$' + r0(n).toLocaleString('en-US')
          const scopeName = a.carrier ? `with ${a.carrier}` : 'across all insurers'
          reasonsRanked.inPlainWords = `Of ${usd(openAll)} open ${scopeName}, about ${usd(deniedAll)} (${pct(deniedAll, openAll)}%) sits in denials: ${usd(fixable)} for reasons the office can fix and ${usd(deniedAll - fixable)} for the plans' rules. ` +
            `About ${usd(notDenied)} (${pct(notDenied, openAll)}%) is not denied, still being worked or waiting on the insurer` +
            (openAll - openMatched >= 1 ? `, and ${usd(openAll - openMatched)} is with insurers not in the follow-up sheet.` : '.') +
            ' These are estimates by insurer, not claim by claim.'
        } catch { reasonsRanked = null }
      }
      if ((a.group_by === 'carrier' || a.carrier) && !rcmMissing().length) {
        try {
          const rcm = await rcmClaimsByCarrier()
          const names = a.carrier ? Object.keys(rcm.carriers).filter((c) => matches(c, a.carrier)) : groups.slice(0, 10).map((g) => g.key).filter((c) => rcm.carriers[c])
          followUp = Object.fromEntries(names.map((c) => {
            const f = rcm.carriers[c]
            const occ = Object.values(f.reasons).reduce((s, n) => s + n, 0)
            return [c, { denials: f.denied, reasons_recorded: f.classified, follow_ups_to_close: f.avgFollowUpsToClose && Math.round(f.avgFollowUpsToClose * 10) / 10,
              top_denial_reasons: Object.entries(f.reasons).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([r, n]) => ({ reason: r, share_pct: pct(n, occ), office_can_fix: OFFICE_CAN_FIX.has(r) })) }]
          }))
        } catch (e) { followUp = { error: e.message } }
      }
      return {
        as_of: R.aging.asOf, total: { expected: r0(agg.expected), claims: agg.claims }, groups,
        ...(reasonsRanked?.length ? {
          denial_reasons_scope: [a.carrier ? `insurer: ${a.carrier}` : 'all insurers', a.location ? `office: ${loc}` : 'all offices', a.service_month ? `work done in ${a.service_month}` : 'every open claim'].join(', '),
          in_plain_words: reasonsRanked.inPlainWords,
          denial_reasons_ranked: reasonsRanked, open_dollars_split: reasonsRanked.split, denial_reasons_note: 'est_open_dollars is an estimate by insurer (open $ x share of its worked claims denied for that reason), not claim by claim.' } : {}),
        ...(followUp ? { claims_follow_up: followUp } : {}),
      }
    },
  },
  {
    name: 'retention',
    description: 'Patient retention from the schedule report for a date range: patients seen, how many came back or are booked (to the same provider or someone else), new patients and how many came back within 6 months, and patients who missed an appointment and were not rebooked. Group by provider or location.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD.' },
        to: { type: 'string', description: 'End date YYYY-MM-DD.' },
        group_by: { type: 'string', enum: ['provider', 'location', 'none'] },
        name: { type: 'string', description: 'Only providers or offices whose name contains this.' },
      },
      required: ['from', 'to'],
    },
    run: async (a, R) => {
      if (!R.schedule?.index) return { error: 'No schedule report loaded.' }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a.from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(a.to || '')) return { error: 'from and to must be YYYY-MM-DD.' }
      const d = scheduleRange(R.schedule.index, a.from, a.to)
      // new_back_within_6_months is null until 6 months have passed since the first visit.
      const row = (v, total) => ({ seen: v.seen, came_back_or_booked: v.seenNext, ...(total ? {} : { came_back_to_same_provider_or_office: v.seenSame }),
        retention_pct: pct(v.seenNext, v.seen), new_patients: v.newPts, new_came_back_or_booked: v.newNext,
        new_back_within_6_months: v.newJudged ? v.newBack : null })
      const src = a.group_by === 'location' ? d.byLoc : a.group_by === 'provider' ? d.byProv : null
      return {
        schedule_up_to: R.schedule.asOf,
        total: { ...row(d.total, true), missed_appointment_not_rebooked: d.missedOpen.total },
        ...(src ? { groups: Object.entries(src).filter(([k, v]) => v.seen >= 5 && matches(k, a.name)).map(([k, v]) => ({ key: k, ...row(v),
          missed_not_rebooked: (a.group_by === 'location' ? d.missedOpen.byLoc : d.missedOpen.byProv)[k] || 0 })).sort((x, y) => y.seen - x.seen).slice(0, 40) } : {}),
        note: 'For recent months, "booked" counts future appointments; for older ones it means the patient actually came back.',
      }
    },
  },
  {
    name: 'new_patients',
    description: 'New patients by first-visit month, with where they came from ("Referred by": Google, Facebook, word of mouth, insurance…). Group by source, channel or location.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: { from: period, to: period, location: { type: 'string' }, group_by: { type: 'string', enum: ['source', 'channel', 'location', 'month'] } },
    },
    run: async (a, R) => {
      if (!R.newPatients) return { error: 'No new-patients report loaded.' }
      const loc = office(a.location)
      const rows = []
      for (const [p, byLoc] of Object.entries(R.newPatients.months)) {
        if (!inRange(p, a.from, a.to)) continue
        for (const [l, bySrc] of Object.entries(byLoc)) {
          if (a.location && l !== loc) continue
          for (const [src, v] of Object.entries(bySrc)) rows.push({ period: p, location: l, source: src, channel: referralChannel(src), patients: v.patients, production: v.production })
        }
      }
      const key = { source: (r) => r.source, channel: (r) => r.channel, location: (r) => r.location, month: (r) => r.period }[a.group_by] || (() => 'total')
      return { total: groupSum(rows, () => 'total', ['patients', 'production'])[0] || { patients: 0 }, groups: groupSum(rows, key, ['patients', 'production']).slice(0, 30) }
    },
  },
  {
    name: 'google_ad_spend',
    description: 'Google Ads spend typed in from billing (ad-spend.csv), by campaign and brand. Meta (Facebook/Instagram) spend is shown on the Money view but not available here.',
    input_schema: { type: 'object', additionalProperties: false, properties: { from: period, to: period } },
    run: async (a, R) => {
      if (!R.adSpend) return { error: 'No ad-spend file loaded.' }
      const rows = R.adSpend.rows.filter((r) => inRange(r.period, a.from, a.to))
      return { total: r0(rows.reduce((s, r) => s + r.spend, 0)), campaigns: rows.map((r) => ({ month: r.period, platform: r.platform, brand: r.brand, campaign: r.campaign, spend: r0(r.spend) })) }
    },
  },
  {
    name: 'hygiene_production',
    description: 'Production credited to hygienists (and temp hygienists) for a month, by person and office. Hours come only from the schedule report (an estimate); there is no other hours data.',
    input_schema: { type: 'object', additionalProperties: false, properties: { month: { ...period, description: 'YYYY-MM' } }, required: ['month'] },
    run: async (a, R) => {
      if (!R.production) return { error: 'No production report loaded.' }
      const spec = R.schedule?.specialty || {}
      const hyg = (p) => spec[p] === 'Hygienist' || /\brdh\b|hygienist/i.test(p)
      const rows = R.production.rows.filter((r) => r.period === a.month && hyg(r.provider))
      return { total: r0(rows.reduce((s, r) => s + r.gross, 0)), by_person: groupSum(rows, (r) => r.provider, ['gross', 'net']), by_office: groupSum(rows, (r) => r.location, ['gross', 'net']) }
    },
  },
]

export const ASSISTANT_TOOLS = TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }))

/** Run one tool call against the loaded reports. Returns a JSON-safe object. */
export async function runTool(name, input, reports) {
  const t = TOOLS.find((x) => x.name === name)
  if (!t) return { error: `Unknown tool ${name}` }
  try { return await t.run(input || {}, reports) } catch (e) { return { error: e.message || 'failed' } }
}

export { loadReports }

/**
 * A tool result as short text for the model: any list of similar rows becomes
 * a table (column names once, then one array per row) instead of repeating
 * every field name on every row. Roughly halves the tokens, which matters on
 * Groq's per-minute token limit, and the model reads tables just as well.
 */
export function compactResult(out) {
  const pack = (v) => {
    if (Array.isArray(v)) {
      const objs = v.length > 1 && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))
      if (objs) {
        const cols = [...new Set(v.flatMap((x) => Object.keys(x)))]
        if (cols.every((c) => v.every((x) => x[c] == null || typeof x[c] !== 'object'))) {
          return { columns: cols, rows: v.map((x) => cols.map((c) => x[c] ?? null)) }
        }
      }
      return v.map(pack)
    }
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, pack(x)]))
    return v
  }
  return JSON.stringify(pack(out))
}

/** What data is loaded — given to the model up front so it needn't ask. */
export async function dataOverview(reports) {
  return runTool('data_overview', {}, reports)
}

/**
 * Where a tool call's numbers can be seen in the app: a plain label for the
 * answer's source list, and the Analysis view (with office / month / dates)
 * that shows the same figures, for "Open in Analysis".
 */
export function sourceFor(name, input = {}) {
  const loc = input.location ? office(input.location) : null
  const ym = (v) => (v ? String(v).slice(0, 7) : null)
  const month = input.month || input.service_month || (ym(input.from) && ym(input.from) === ym(input.to) ? ym(input.from) : null)
  const span = input.from || input.to ? `${ym(input.from) || 'start'} to ${ym(input.to) || 'latest'}` : null
  const bits = (title) => [title, loc && loc.replace(/^Valley View Dental /, ''), input.provider, input.carrier, month || span, input.group_by && input.group_by !== 'none' ? `by ${input.group_by.replace('_', ' ')}` : null].filter(Boolean).join(' \u00b7 ')
  switch (name) {
    case 'production': return { label: bits('Production'), link: { view: 'money', office: loc, month } }
    case 'collections': return { label: bits('Collections'), link: { view: 'money', office: loc, month } }
    case 'open_claims': return { label: bits('Open claims (aging report)'), link: { view: 'money', office: loc, month: input.service_month || null } }
    case 'retention': return { label: [bits('Patient retention'), input.from && input.to ? `${input.from} to ${input.to}` : null].filter(Boolean).join(' \u00b7 '), link: { view: 'retention', from: input.from || null, to: input.to || null } }
    case 'new_patients': return { label: bits('New patients'), link: { view: 'money', office: loc, month } }
    case 'google_ad_spend': return { label: bits('Google ad spend'), link: { view: 'money', month } }
    case 'hygiene_production': return { label: bits('Hygiene production'), link: { view: 'hygiene', month: input.month || null } }
    default: return { label: 'What data is loaded', link: null }
  }
}
