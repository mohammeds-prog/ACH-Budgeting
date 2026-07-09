import { supabase } from './supabase'

function toJS(row) {
  return {
    id:               row.id,
    postingDate:      row.posting_date,
    details:          row.details,
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

export async function getAttachmentCounts() {
  const { data, error } = await supabase.from('ach_attachments').select('entry_id')
  if (error) return {}
  const counts = {}
  ;(data || []).forEach((r) => { counts[r.entry_id] = (counts[r.entry_id] || 0) + 1 })
  return counts
}

export async function getAttachments(entryId) {
  const { data, error } = await supabase
    .from('ach_attachments')
    .select('*')
    .eq('entry_id', entryId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function uploadAttachment(entryId, file, uploaderEmail) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${entryId}/${Date.now()}-${safeName}`
  const { error: storageErr } = await supabase.storage
    .from('ach-attachments')
    .upload(path, file, { contentType: file.type })
  if (storageErr) throw storageErr
  const { data, error } = await supabase
    .from('ach_attachments')
    .insert({ entry_id: entryId, file_name: file.name, file_path: path, file_size: file.size, mime_type: file.type, uploaded_by: uploaderEmail || null })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteAttachment(id, filePath) {
  await supabase.storage.from('ach-attachments').remove([filePath])
  const { error } = await supabase.from('ach_attachments').delete().eq('id', id)
  if (error) throw error
}

export async function getAttachmentSignedUrl(filePath) {
  const { data, error } = await supabase.storage
    .from('ach-attachments')
    .createSignedUrl(filePath, 3600)
  if (error) throw error
  return data.signedUrl
}
