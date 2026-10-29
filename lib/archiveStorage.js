import { supabase } from './supabase'
import { fetchAllRows } from './fetchAll'

// ─────────────────────────────────────────────────────────────────────────────
// ACH Archive — search runs IN THE DATABASE, never in the browser.
//
// The other pages load every row and filter locally, which is fine at a couple
// of thousand rows. 24 months of bank activity is 15,000+ and growing, so here
// the browser only ever receives the one page of results it is showing. A
// trigram index (supabase/ach_archive.sql) keeps fragment search instant.
// ─────────────────────────────────────────────────────────────────────────────

export const ARCHIVE_PAGE_SIZE = 50

function toJS(row) {
  return {
    id:            row.id,
    postingDate:   row.posting_date,
    details:       row.details,
    bankAccount:   row.bank_account,
    description:   row.description,
    insuranceName: row.insurance_name,
    amount:        row.amount != null ? Number(row.amount) : null,
  }
}

// ── Search terms ───────────────────────────────────────────────────────────
// Every word must appear somewhere in the description, in any order, so
// "metlife 953620820" narrows to that one payment. `%` and `*` are wildcard
// characters in the query syntax, so they are stripped rather than passed on.
export function searchTerms(q) {
  return (q || '')
    .split(/\s+/)
    .map((t) => t.replace(/[%*]/g, '').trim())
    .filter(Boolean)
    .slice(0, 8)
}

// "253.20" is that exact amount; "253" is any amount from $253.00 to $253.99.
// Insurance references give an exact figure, so exact-or-whole-dollar keeps
// results tight instead of the tracker's "starts with" matching.
export function parseAmountFilter(raw) {
  const s = (raw || '').replace(/[$,\s]/g, '')
  if (!s) return null
  if (/^\d+\.\d{1,2}$/.test(s)) return { eq: Number(s) }
  if (/^\d+$/.test(s))          return { min: Number(s), max: Number(s) + 1 }
  return { invalid: true }
}

// One filter builder shared by search, export and delete, so "what you see"
// is always exactly what gets exported or deleted.
function applyFilters(query, f = {}) {
  for (const term of searchTerms(f.q)) query = query.ilike('description', `%${term}%`)
  const amt = parseAmountFilter(f.amount)
  if (amt?.eq != null) query = query.eq('amount', amt.eq)
  if (amt?.min != null) query = query.gte('amount', amt.min).lt('amount', amt.max)
  if (f.from)        query = query.gte('posting_date', f.from)
  if (f.to)          query = query.lte('posting_date', f.to)
  if (f.insurance)   query = query.eq('insurance_name', f.insurance)
  if (f.bankAccount) query = query.eq('bank_account', f.bankAccount)
  if (f.details)     query = query.eq('details', f.details)
  return query
}

export function hasAnyFilter(f = {}) {
  const amt = parseAmountFilter(f.amount)
  return searchTerms(f.q).length > 0 || (amt && !amt.invalid) || !!(f.from || f.to || f.insurance || f.bankAccount || f.details)
}

function sorted(query, sort) {
  const key = sort?.key === 'amount' ? 'amount' : 'posting_date'
  const ascending = sort?.dir === 'asc'
  return query.order(key, { ascending, nullsFirst: false }).order('id', { ascending: true })
}

/** One page of results plus the total number of matches. */
export async function searchArchive(filters, { page = 1, sort } = {}) {
  const from = (page - 1) * ARCHIVE_PAGE_SIZE
  const { data, error, count } = await sorted(
    applyFilters(supabase.from('ach_archive').select('*', { count: 'exact' }), filters),
    sort,
  ).range(from, from + ARCHIVE_PAGE_SIZE - 1)
  if (error) throw error
  return { rows: (data || []).map(toJS), total: count ?? 0 }
}

/** Every matching row, for export. Paginated so it can't truncate at 1,000. */
export async function fetchAllMatching(filters, sort) {
  const rows = await fetchAllRows(() =>
    sorted(applyFilters(supabase.from('ach_archive').select('*'), filters), sort)
  )
  return rows.map(toJS)
}

/** Size and span of the whole archive, for the header cards. */
export async function getArchiveSummary() {
  const [countRes, firstRes, lastRes] = await Promise.all([
    supabase.from('ach_archive').select('id', { count: 'exact' }).range(0, 0),
    supabase.from('ach_archive').select('posting_date').order('posting_date', { ascending: true }).limit(1),
    supabase.from('ach_archive').select('posting_date').order('posting_date', { ascending: false }).limit(1),
  ])
  if (countRes.error) throw countRes.error
  return {
    total: countRes.count ?? 0,
    first: firstRes.data?.[0]?.posting_date || null,
    last:  lastRes.data?.[0]?.posting_date || null,
  }
}

export async function getArchiveFilterOptions() {
  const [accounts, insurers] = await Promise.all([
    fetchAllRows(() => supabase.from('ach_archive_accounts').select('bank_account').order('bank_account')),
    fetchAllRows(() => supabase.from('ach_archive_insurers').select('insurance_name').order('insurance_name')),
  ])
  return {
    accounts: accounts.map((r) => r.bank_account),
    insurers: insurers.map((r) => r.insurance_name),
  }
}

// ── Upload ─────────────────────────────────────────────────────────────────

// The bank's own TRACE# identifies a single ACH transaction, so it is the most
// reliable way to recognise a row that has already been uploaded. Rows without
// one fall back to their full contents.
export function dedupeKey(e) {
  const trace = /TRACE#:?\s*(\d{6,})/i.exec(e.description || '')?.[1]
  if (trace) return `T:${e.bankAccount || ''}:${trace}`
  const desc = (e.description || '').replace(/\s+/g, ' ').trim().slice(0, 400)
  return `R:${e.postingDate}|${Number(e.amount ?? 0).toFixed(2)}|${e.bankAccount || ''}|${desc}`
}

const UPLOAD_CHUNK = 500

/**
 * Insert new rows; rows already in the archive are skipped, never changed.
 * Chunked so a 24-month file goes up as many small requests, not one huge one.
 */
export async function uploadArchiveRows(entries, uploaderEmail) {
  const byKey = new Map()
  for (const e of entries) byKey.set(dedupeKey(e), e)
  const unique = [...byKey.entries()]
  const duplicatesInFile = entries.length - unique.length

  let inserted = 0
  for (let i = 0; i < unique.length; i += UPLOAD_CHUNK) {
    const chunk = unique.slice(i, i + UPLOAD_CHUNK).map(([key, e]) => ({
      posting_date:   e.postingDate,
      details:        e.details || null,
      bank_account:   e.bankAccount || null,
      description:    e.description || null,
      insurance_name: e.insuranceName || null,
      amount:         e.amount ?? null,
      dedupe_key:     key,
      created_by:     uploaderEmail || null,
    }))
    const { data, error } = await supabase
      .from('ach_archive')
      .upsert(chunk, { onConflict: 'dedupe_key', ignoreDuplicates: true })
      .select('id')
    if (error) throw new Error(`Upload stopped after ${inserted.toLocaleString()} rows: ${error.message}`)
    inserted += data?.length || 0
  }

  return { inserted, alreadyInArchive: unique.length - inserted, duplicatesInFile }
}

/**
 * Delete every row matching the current filters. Refuses to run with no
 * filters at all — clearing the whole archive is not something a search
 * screen should be able to do.
 */
export async function deleteMatching(filters) {
  if (!hasAnyFilter(filters)) throw new Error('Refusing to delete without a filter.')
  const { error, count } = await applyFilters(
    supabase.from('ach_archive').delete({ count: 'exact' }),
    filters,
  )
  if (error) throw error
  return count ?? 0
}

/**
 * Count, dollar total and date span for the current filters (or the whole
 * archive when there are none), computed in the database — see
 * archive_totals() in supabase/ach_archive.sql.
 *
 * Returns null if that function hasn't been created yet, so the page can fall
 * back to the basic summary instead of breaking.
 */
export async function getArchiveTotals(f = {}) {
  const amt = parseAmountFilter(f.amount)
  let min = null, max = null
  // Same meaning as the search: exact cents, or the whole dollar.
  // Rounded so 253.20 + 0.01 is sent as 253.21, not 253.21000000000001.
  if (amt?.eq != null) { min = amt.eq; max = Math.round((amt.eq + 0.01) * 100) / 100 }
  if (amt?.min != null) { min = amt.min; max = amt.max }

  const { data, error } = await supabase.rpc('archive_totals', {
    p_terms:      searchTerms(f.q),
    p_amount_min: min,
    p_amount_max: max,
    p_from:       f.from || null,
    p_to:         f.to || null,
    p_insurance:  f.insurance || null,
    p_bank:       f.bankAccount || null,
    p_details:    f.details || null,
  })
  if (error) {
    if (error.code === 'PGRST202' || /archive_totals/i.test(error.message || '')) return null
    throw error
  }
  const row = Array.isArray(data) ? data[0] : data
  return {
    payments: Number(row?.payments ?? 0),
    total:    Number(row?.total ?? 0),
    first:    row?.first_date || null,
    last:     row?.last_date || null,
  }
}
