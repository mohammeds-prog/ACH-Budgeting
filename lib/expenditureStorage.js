import { supabase } from './supabase'
export { LOCATIONS } from './constants'

function toExpJS(r) {
  return {
    id:          r.id,
    date:        r.date,
    person:      r.person,
    description: r.description,
    vendor:      r.vendor,
    clinic:      r.clinic,
    amount:      r.amount != null ? Number(r.amount) : null,
  }
}

export async function getExpEntries() {
  const { data, error } = await supabase
    .from('exp_entries')
    .select('*')
    .order('date', { ascending: false })
  if (error) throw error
  return data.map(toExpJS)
}

export async function saveExpEntry(entry) {
  const row = {
    date:        entry.date        || null,
    person:      entry.person      || null,
    description: entry.description || null,
    vendor:      entry.vendor      || null,
    clinic:      entry.clinic      || null,
    amount:      entry.amount      ?? null,
  }
  if (entry.id) {
    const { data, error } = await supabase.from('exp_entries').update(row).eq('id', entry.id).select().single()
    if (error) throw error
    return toExpJS(data)
  } else {
    const { data, error } = await supabase.from('exp_entries').insert(row).select().single()
    if (error) throw error
    return toExpJS(data)
  }
}

export async function deleteExpEntry(id) {
  const { error } = await supabase.from('exp_entries').delete().eq('id', id)
  if (error) throw error
}

export async function bulkInsertExpEntries(entries) {
  const rows = entries.map((e) => ({
    date:        e.date        || null,
    person:      e.person      || null,
    description: e.description || null,
    vendor:      e.vendor      || null,
    clinic:      e.clinic      || null,
    amount:      e.amount      ?? null,
  }))
  const { data, error } = await supabase.from('exp_entries').insert(rows).select()
  if (error) throw error
  return data.map(toExpJS)
}

// ── Vendor list (Supabase) ──────────────────────────────────────

export async function getVendors() {
  const { data, error } = await supabase.from('exp_vendors').select('name').order('name')
  if (error) throw error
  return data.map((r) => r.name)
}

export async function addVendorToDB(name) {
  const { error } = await supabase.from('exp_vendors').insert({ name })
  if (error) throw error
}

export async function deleteVendorFromDB(name) {
  const { error } = await supabase.from('exp_vendors').delete().eq('name', name)
  if (error) throw error
}

// ── Monthly collections (per location) ──────────────────────────

export async function getCollections() {
  const { data, error } = await supabase.from('exp_collections').select('month_key, location, amount')
  if (error) throw error
  const map = {}
  data.forEach((r) => {
    if (!map[r.month_key]) map[r.month_key] = {}
    map[r.month_key][r.location] = Number(r.amount)
  })
  return map
}

export async function setCollections(updatedMap) {
  for (const [month_key, locationAmounts] of Object.entries(updatedMap)) {
    for (const [location, amount] of Object.entries(locationAmounts)) {
      const { data: existing } = await supabase
        .from('exp_collections').select('id').eq('month_key', month_key).eq('location', location).maybeSingle()
      if (existing) {
        const { error } = await supabase.from('exp_collections').update({ amount }).eq('month_key', month_key).eq('location', location)
        if (error) throw error
      } else {
        const { error } = await supabase.from('exp_collections').insert({ month_key, location, amount })
        if (error) throw error
      }
    }
  }
  return updatedMap
}
