import { supabase } from './supabase'

// ─────────────────────────────────────────────────────────────────────────────
// History for a single row.
//
// activity_logs stores the affected record in metadata, but in two shapes:
//   - single-row actions  -> { id: "<uuid>", patch, before }
//   - bulk actions        -> { ids: ["<uuid>", ...] }
// so both are queried and merged rather than missing every imported row.
//
// The table is append-only at the database level (no UPDATE or DELETE policy),
// so what comes back cannot have been edited after the fact.
// ─────────────────────────────────────────────────────────────────────────────

export async function getEntryActivity(entryId) {
  if (!entryId) return []

  const [single, bulk] = await Promise.all([
    supabase
      .from('activity_logs')
      .select('*')
      .eq('metadata->>id', entryId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('activity_logs')
      .select('*')
      .contains('metadata', { ids: [entryId] })
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  if (single.error && bulk.error) throw single.error

  const seen = new Set()
  return [...(single.data || []), ...(bulk.data || [])]
    .filter((r) => (seen.has(r.id) ? false : seen.add(r.id)))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

// Field keys -> the labels people actually see in the table.
const FIELD_LABELS = {
  eobDate: 'EOB Date', postingDate: 'Date', insuranceName: 'Insurance',
  location: 'Belongs To', fromLocation: 'Received By', bankAccount: 'Bank Account',
  description: 'Description', amount: 'Amount', match: 'Match', status: 'Status',
  initials: 'Initials', notes: 'Notes', splits: 'Split allocation',
  transferComplete: 'Transfer Complete', transferInitials: 'Transfer Initials',
  details: 'Details', vendor: 'Vendor', person: 'Person', clinic: 'Clinic',
}

function shortLoc(v) {
  return typeof v === 'string' ? v.replace('Valley View Dental ', '') : v
}

function display(key, v) {
  if (v === null || v === undefined || v === '') return null   // rendered as "cleared"
  if (key === 'splits') {
    if (!Array.isArray(v)) return 'none'
    if (v.length === 0) return 'pending'
    return v.map((s) => `${shortLoc(s.location) || '—'} ${Number(s.amount || 0).toFixed(2)}`).join(', ')
  }
  if (key === 'amount') return `$${Number(v).toFixed(2)}`
  if (key === 'transferComplete') return v ? 'Yes' : 'No'
  if (key.toLowerCase().includes('date')) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v))
    return m ? `${m[2]}/${m[3]}/${m[1]}` : String(v)
  }
  return shortLoc(String(v))
}

/**
 * Turn one log row into readable lines.
 * `before` is only present on newer records, so older ones degrade to
 * "set X to Y" rather than showing a wrong previous value.
 */
export function describeChange(row) {
  const md = row.metadata || {}
  const patch = md.patch

  if (row.action === 'create') return ['Created this entry']
  if (row.action === 'delete') return ['Deleted this entry']
  if (row.action === 'import') return ['Created by import']

  if (patch && typeof patch === 'object') {
    const lines = Object.keys(patch).map((k) => {
      const label = FIELD_LABELS[k] || k
      const to = display(k, patch[k])
      const from = md.before ? display(k, md.before[k]) : undefined

      if (to === null && from) return `Cleared ${label} (was ${from})`
      if (to === null)         return `Cleared ${label}`
      if (from === undefined)  return `Set ${label} to ${to}`
      if (from === null)       return `Set ${label} to ${to}`
      if (from === to)         return `${label} unchanged`
      return `${label}: ${from} → ${to}`
    })
    if (lines.length) return lines
  }

  // No patch: an older record from before field-level diffing, or a bulk action
  // that logged prose. Show the description, but strip the entry's own text —
  // an ACH description is 250 characters of bank noise and dumping it tells the
  // reader nothing about what changed.
  const desc = (row.description || 'Updated').split(' — ')[0].trim()
  return [desc.length > 90 ? desc.slice(0, 90) + '…' : desc]
}

/**
 * Diff two versions of the same record into { patch, before } for logActivity.
 *
 * Compare the SAVED row against the previous one — never the raw form values.
 * Both come out of the same storage mapper, so an amount is a number on each
 * side; diffing a form would flag "100" vs 100 as a change every time.
 */
export function diffEntry(prev, next, fields) {
  const patch = {}
  const before = {}
  for (const k of fields) {
    const a = prev?.[k] ?? null
    const b = next?.[k] ?? null
    if (JSON.stringify(a) !== JSON.stringify(b)) { patch[k] = b; before[k] = a }
  }
  return Object.keys(patch).length ? { patch, before } : null
}

export const ACH_FIELDS = [
  'postingDate', 'details', 'bankAccount', 'description', 'insuranceName',
  'amount', 'fromLocation', 'location', 'match', 'status', 'initials', 'notes',
  'splits', 'transferComplete', 'transferInitials',
]

export const EXP_FIELDS = ['date', 'person', 'vendor', 'description', 'clinic', 'amount']
