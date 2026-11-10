import { createClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────────
// Server only. Claims follow-up from the RCM app's Supabase project
// (mervablxcibsqkljunvf): the AR Master history TuskPortal writes — every
// period, as RCM's Claims page shows it — with the AI-classified reasons.
// Read-only — nothing here ever writes to RCM.
//
// Only insurer-level counts leave this file. The snapshot holds patient names;
// they aren't even selected.
//
// Access, from .env.local (either):
//   RCM_SUPABASE_URL + RCM_SUPABASE_SERVICE_KEY
//   RCM_SUPABASE_URL + RCM_SUPABASE_ANON_KEY + RCM_READER_EMAIL + RCM_READER_PASSWORD
//     (an RCM user with the admin role — RCM's rules only let admins read claims)
// ─────────────────────────────────────────────────────────────────────────────

// Mirrors RCM's lib/claimsAnalysis.ts DENIAL_REASONS exactly, so the numbers
// match the RCM claims page.
export const DENIAL_REASONS = [
  'Timely Filing', 'Duplicate Claim', 'Requires Medical EOB/Info', 'Not a Covered Service/Benefit',
  'Missing Provider Questionnaire', 'Missing/Incorrect Subscriber Info', 'COB Issue', 'Missing Authorization',
  'Not Dentally Necessary', 'Eligibility / Plan Terminated', 'Frequency Limitation', 'Benefit Maximum Reached',
  'Primary Already Paid Allowable', 'Missing Primary EOB', 'Appeal Denied', 'Missing Documentation',
  'Provider Not Credentialed/Listed', 'Provider Out of Network', 'Unprocessable / Rejected Claim',
]
const DENIAL = new Set(DENIAL_REASONS)

const CACHE_MS = 10 * 60 * 1000
let cached = null   // { at, value }

export function rcmMissing() {
  const e = process.env
  if (!e.RCM_SUPABASE_URL) return ['RCM_SUPABASE_URL']
  if (e.RCM_SUPABASE_SERVICE_KEY) return []
  const need = ['RCM_SUPABASE_ANON_KEY', 'RCM_READER_EMAIL', 'RCM_READER_PASSWORD'].filter((k) => !e[k])
  return need.length === 3 ? ['RCM_READER_EMAIL + RCM_READER_PASSWORD (or RCM_SUPABASE_SERVICE_KEY)'] : need
}

async function client() {
  const e = process.env
  // no-store: Next.js would otherwise reuse an old (expired) sign-in reply.
  const opts = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => fetch(url, { ...init, cache: 'no-store' }) } }
  if (e.RCM_SUPABASE_SERVICE_KEY) return createClient(e.RCM_SUPABASE_URL, e.RCM_SUPABASE_SERVICE_KEY, opts)
  const sb = createClient(e.RCM_SUPABASE_URL, e.RCM_SUPABASE_ANON_KEY, opts)
  const { error } = await sb.auth.signInWithPassword({ email: e.RCM_READER_EMAIL, password: e.RCM_READER_PASSWORD })
  if (error) throw new Error(`RCM sign-in failed: ${error.message}`)
  return sb
}

async function allRows(sb, table, columns) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + 999)
    if (error) throw new Error(`RCM ${table}: ${error.message}`)
    out.push(...data)
    if (data.length < 1000) return out
  }
}

/**
 * { syncedAt, periods, carriers: { [name]: { claims, closed, classified, denied,
 *   reasons: { [denial reason]: count }, other: { [other reason]: count }, avgFollowUpsToClose } } }
 *
 * Built exactly as RCM's Claims page builds its denials table
 * (buildDenialsFromCarrierSummary): from claims_carrier_summary_history, every
 * period, using each row's pre-counted ai_reason_breakdown. Counts are
 * OCCURRENCES — a claim with two denial reasons counts under both — so
 * `classified` is every reason occurrence and `denied` the denial ones.
 */
export async function rcmClaimsByCarrier() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value
  const sb = await client()
  const rows = await allRows(sb, 'claims_carrier_summary_history',
    'insurance_carrier, total_claims, closed_claims, avg_follow_ups_to_close, ai_reason_breakdown, synced_at, period_label')
  const carriers = {}
  const closedW = {}
  let syncedAt = null
  const periods = new Set()
  for (const r of rows) {
    const name = (r.insurance_carrier || '').trim() || 'Unknown'
    const c = (carriers[name] ||= { claims: 0, closed: 0, classified: 0, denied: 0, reasons: {}, other: {}, avgFollowUpsToClose: null })
    if (r.period_label) periods.add(r.period_label)
    if (r.synced_at && (!syncedAt || r.synced_at > syncedAt)) syncedAt = r.synced_at
    const closed = Number(r.closed_claims) || 0
    c.claims += Number(r.total_claims) || 0
    c.closed += closed
    // Follow-ups to close one claim, weighted by the claims closed each period.
    const w = (closedW[name] ||= { closed: 0, sum: 0 })
    w.closed += closed; w.sum += (Number(r.avg_follow_ups_to_close) || 0) * closed
    for (const b of Array.isArray(r.ai_reason_breakdown) ? r.ai_reason_breakdown : []) {
      const reason = (b?.reason || '').trim(), n = Number(b?.count) || 0
      c.classified += n
      // Not a denial (paid, in process, pending…): kept so the split adds up.
      if (!DENIAL.has(reason)) { if (reason) c.other[reason] = (c.other[reason] || 0) + n; continue }
      c.denied += n
      c.reasons[reason] = (c.reasons[reason] || 0) + n
    }
  }
  for (const [name, w] of Object.entries(closedW)) carriers[name].avgFollowUpsToClose = w.closed ? w.sum / w.closed : null
  const value = { syncedAt, periods: [...periods].sort(), carriers }
  cached = { at: Date.now(), value }
  return value
}
