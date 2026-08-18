import { supabase } from './supabase'

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
  const { data, error } = await supabase
    .from('ach_entries')
    .select('*')
    .order('posting_date', { ascending: false })
  if (error) throw error
  return data.map(toJS)
}

export async function getUniqueInsurers() {
  const { data, error } = await supabase
    .from('ach_entries')
    .select('insurance_name')
    .not('insurance_name', 'is', null)
    .limit(10000)
  if (error) throw error
  return [...new Set(data.map((r) => r.insurance_name).filter(Boolean))].sort()
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
  const { data, error } = await supabase.from(table).select(fk)
  if (error) return {}
  const counts = {}
  ;(data || []).forEach((r) => { counts[r[fk]] = (counts[r[fk]] || 0) + 1 })
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
