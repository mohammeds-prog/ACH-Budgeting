import { supabase } from './supabase'
import { fetchAllRows } from './fetchAll'

function toJS(row) {
  return {
    id:               row.id,
    postingDate:      row.posting_date,
    details:          row.details,
    bankAccount:      row.bank_account      || null,
    description:      row.description,
    insuranceName:    row.insurance_name,
    amount:           row.amount != null ? Number(row.amount) : null,
    fromLocation:     row.from_location    || null,
    location:         row.location,
    splits:           row.splits           ?? null,
    match:            row.match,
    status:           row.status,
    initials:         row.initials,
    notes:            row.notes            || null,
    transferComplete: row.transfer_complete || false,
    transferInitials: row.transfer_initials || null,
  }
}

function toDB(entry) {
  return {
    posting_date:      entry.postingDate      || null,
    details:           entry.details          || null,
    bank_account:      entry.bankAccount      || null,
    description:       entry.description      || null,
    insurance_name:    entry.insuranceName    || null,
    amount:            entry.amount           ?? null,
    from_location:     entry.fromLocation     || null,
    location:          entry.location         || null,
    splits:            entry.splits           ?? null,
    match:             entry.match            || null,
    status:            entry.status           || null,
    initials:          entry.initials         || null,
    notes:             entry.notes            || null,
    transfer_complete: entry.transferComplete || false,
    transfer_initials: entry.transferInitials || null,
  }
}

export async function getEntries() {
  // Paginated: an unbounded select silently stops at 1000 rows, which would
  // hide entries and under-report every total on the page. `id` breaks ties so
  // paging stays stable across pages.
  const rows = await fetchAllRows(() =>
    supabase
      .from('ach_entries')
      .select('*')
      .order('posting_date', { ascending: false })
      .order('id', { ascending: true })
  )
  return rows.map(toJS)
}

export async function getUniqueInsurers() {
  // .limit(10000) did not help — the server's max-rows cap wins over it.
  const rows = await fetchAllRows(() =>
    supabase
      .from('ach_entries')
      .select('insurance_name')
      .not('insurance_name', 'is', null)
      .order('id', { ascending: true })
  )
  return [...new Set(rows.map((r) => r.insurance_name).filter(Boolean))].sort()
}

export async function saveEntry(entry) {
  const row = toDB(entry)
  if (entry.id) {
    const { data, error } = await supabase.from('ach_entries').update(row).eq('id', entry.id).select().single()
    if (error) throw error
    return toJS(data)
  } else {
    const { data, error } = await supabase.from('ach_entries').insert(row).select().single()
    if (error) throw error
    return toJS(data)
  }
}

export async function deleteEntry(id) {
  const { error } = await supabase.from('ach_entries').delete().eq('id', id)
  if (error) throw error
}

export async function saveNotes(id, notes) {
  const { error } = await supabase.from('ach_entries').update({ notes: notes || null }).eq('id', id)
  if (error) throw error
}

export async function markTransferComplete(id, initials) {
  const { error } = await supabase.from('ach_entries').update({ transfer_complete: true, transfer_initials: initials || null }).eq('id', id)
  if (error) throw error
}

export async function bulkInsertEntries(entries) {
  const rows = entries.map(toDB)
  const { data, error } = await supabase.from('ach_entries').insert(rows).select()
  if (error) throw error
  return data.map(toJS)
}

// ── Attachments ──────────────────────────────────────────────────────────────
//
// Two record types can carry files: ACH entries and zero payments. They share
// one storage bucket (so the existing storage.objects policies cover both) but
// have separate metadata tables, each with its own foreign key.
//
// ACH paths are bare `{entryId}/…` — that is how existing files are already
// stored, so it must not change. Zero payments are namespaced under `zero/`
// to keep the two from ever colliding.
const BUCKET = 'ach-attachments'

const KINDS = {
  ach:  { table: 'ach_attachments',          fk: 'entry_id',         prefix: ''      },
  zero: { table: 'zero_payment_attachments', fk: 'zero_payment_id',  prefix: 'zero/' },
}

function kindCfg(kind) {
  const cfg = KINDS[kind]
  if (!cfg) throw new Error(`Unknown attachment kind: ${kind}`)
  return cfg
}

export async function getAttachmentCounts(kind = 'ach') {
  const { table, fk } = kindCfg(kind)
  // This is the query that broke the badge: it read only the first 1000
  // attachment rows, so anything uploaded after that never got a count.
  const rows = await fetchAllRows(() =>
    supabase.from(table).select(fk).order('id', { ascending: true })
  )
  const counts = {}
  rows.forEach((r) => { counts[r[fk]] = (counts[r[fk]] || 0) + 1 })
  return counts
}

export async function getAttachments(recordId, kind = 'ach') {
  const { table, fk } = kindCfg(kind)
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq(fk, recordId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function uploadAttachment(recordId, file, uploaderEmail, kind = 'ach') {
  const { table, fk, prefix } = kindCfg(kind)
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${prefix}${recordId}/${Date.now()}-${safeName}`
  const { error: storageErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type })
  if (storageErr) throw storageErr
  const { data, error } = await supabase
    .from(table)
    .insert({ [fk]: recordId, file_name: file.name, file_path: path, file_size: file.size, mime_type: file.type, uploaded_by: uploaderEmail || null })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteAttachment(id, filePath, kind = 'ach') {
  const { table } = kindCfg(kind)
  await supabase.storage.from(BUCKET).remove([filePath])
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) throw error
}

export async function getAttachmentSignedUrl(filePath) {
  const { data, error } = await supabase.storage
    .from('ach-attachments')
    .createSignedUrl(filePath, 3600)
  if (error) throw error
  return data.signedUrl
}

// Signed URL with Content-Disposition: attachment so the browser saves the file
// under its original name instead of rendering it.
export async function getAttachmentDownloadUrl(filePath, fileName) {
  const { data, error } = await supabase.storage
    .from('ach-attachments')
    .createSignedUrl(filePath, 3600, { download: fileName || true })
  if (error) throw error
  return data.signedUrl
}

// ── Bulk operations ─────────────────────────────────────────────────────────
//
// Bulk edits send ONE targeted UPDATE per chunk of ids, touching only the
// columns being changed. The previous approach re-saved every selected row in
// full from the browser's copy — one request per row, all at once — which (a)
// fired 1,000+ simultaneous requests once "select all pages" existed, and (b)
// could silently revert another user's recent edit to any field not being
// bulk-changed.
//
// `.in('id', …)` puts the ids in the URL, so chunks stay small enough to fit
// comfortably under URL length limits (100 UUIDs ≈ 3.7KB).
const BULK_CHUNK = 100

// Only fields that make sense to set to ONE value across many entries.
// Date, amount, description and splits are per-entry by nature — bulk-setting
// them would destroy data — so they are deliberately absent.
const BULK_COLUMNS = {
  fromLocation:     'from_location',
  location:         'location',
  match:            'match',
  status:           'status',
  initials:         'initials',
  notes:            'notes',
  bankAccount:      'bank_account',
  insuranceName:    'insurance_name',
  details:          'details',
  transferComplete: 'transfer_complete',
  transferInitials: 'transfer_initials',
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * Apply the same `changes` to every id. Returns the rows actually updated and
 * the ids that were not — RLS rejects a blocked row by silently updating 0 rows
 * rather than erroring, so "requested minus returned" is the only reliable way
 * to know what really changed.
 */
export async function bulkUpdateEntries(ids, changes) {
  const patch = {}
  for (const [k, v] of Object.entries(changes)) {
    const col = BULK_COLUMNS[k]
    if (!col) throw new Error(`Field "${k}" cannot be bulk-edited`)
    patch[col] = k === 'transferComplete' ? !!v : (v === '' ? null : v)
  }

  const saved = []
  const failedIds = []
  for (const part of chunk(ids, BULK_CHUNK)) {
    const { data, error } = await supabase.from('ach_entries').update(patch).in('id', part).select()
    if (error) { failedIds.push(...part); continue }
    const got = new Set((data || []).map((r) => r.id))
    saved.push(...(data || []).map(toJS))
    failedIds.push(...part.filter((id) => !got.has(id)))
  }
  return { saved, failedIds }
}

/**
 * Per-row notes, for "append" mode — each row gets its own resulting text, so
 * it cannot be one UPDATE. A small worker pool keeps it to a handful of
 * requests in flight instead of one per row simultaneously.
 */
export async function updateNotesMany(pairs, concurrency = 6) {
  const saved = []
  const failedIds = []
  let next = 0
  async function worker() {
    while (next < pairs.length) {
      const { id, notes } = pairs[next++]
      const { data, error } = await supabase
        .from('ach_entries').update({ notes: notes || null }).eq('id', id).select()
      if (error || !data?.length) failedIds.push(id)
      else saved.push(toJS(data[0]))
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pairs.length) }, worker))
  return { saved, failedIds }
}

/** Chunked delete. Same rule as updates: trust what came back, not what was asked. */
export async function bulkDeleteEntries(ids) {
  const deletedIds = []
  const failedIds = []
  for (const part of chunk(ids, BULK_CHUNK)) {
    const { data, error } = await supabase.from('ach_entries').delete().in('id', part).select('id')
    if (error) { failedIds.push(...part); continue }
    const got = new Set((data || []).map((r) => r.id))
    deletedIds.push(...part.filter((id) => got.has(id)))
    failedIds.push(...part.filter((id) => !got.has(id)))
  }
  return { deletedIds, failedIds }
}
