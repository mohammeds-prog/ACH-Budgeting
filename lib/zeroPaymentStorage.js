import { supabase } from './supabase'
export { LOCATIONS } from './constants'

function toJS(row) {
  return {
    id:            row.id,
    eobDate:       row.eob_date,
    location:      row.location,
    insuranceName: row.insurance_name,
    match:         row.match,
    status:        row.status,
    initials:      row.initials,
    notes:         row.notes,
  }
}

function toDB(entry) {
  return {
    eob_date:       entry.eobDate       || null,
    location:       entry.location      || null,
    insurance_name: entry.insuranceName || null,
    match:          entry.match         || null,
    status:         entry.status        || null,
    initials:       entry.initials      || null,
    notes:          entry.notes         || null,
  }
}

export async function getZeroPayments() {
  const { data, error } = await supabase
    .from('zero_payments')
    .select('*')
    .order('eob_date', { ascending: false })
  if (error) throw error
  return data.map(toJS)
}

export async function saveZeroPayment(entry) {
  const row = toDB(entry)
  if (entry.id) {
    const { data, error } = await supabase
      .from('zero_payments').update(row).eq('id', entry.id).select().single()
    if (error) throw error
    return toJS(data)
  }
  const { data, error } = await supabase
    .from('zero_payments').insert(row).select().single()
  if (error) throw error
  return toJS(data)
}

export async function bulkInsertZeroPayments(entries) {
  const { data, error } = await supabase
    .from('zero_payments').insert(entries.map(toDB)).select()
  if (error) throw error
  return data.map(toJS)
}

export async function deleteZeroPayment(id) {
  const { error } = await supabase.from('zero_payments').delete().eq('id', id)
  if (error) throw error
}

export async function getZeroPaymentInsurers() {
  const { data, error } = await supabase
    .from('zero_payments').select('insurance_name').not('insurance_name', 'is', null)
  if (error) throw error
  return [...new Set(data.map((r) => r.insurance_name).filter(Boolean))].sort()
}
