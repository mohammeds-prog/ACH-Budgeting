import { sheetAccessMissing, readSheetTabs } from '@/lib/googleSheet'
import { parseDoctorHours } from '@/lib/doctorHours'

// ─────────────────────────────────────────────────────────────────────────────
// Server only. The "Doctor Hours" Google Sheet, read live with the same
// Google sign-in as the New Patients sheet. Only the year tabs from 2025 on
// are read (the 2024 tab holds older months in a different layout).
// Cached for 10 minutes; a failed read keeps the last good copy.
//   { months, skippedNotes, readAt } | { error } | null when not set up.
// DOCTOR_HOURS_SHEET_ID can point it at another sheet.
// ─────────────────────────────────────────────────────────────────────────────

const SHEET_ID = process.env.DOCTOR_HOURS_SHEET_ID || '10m_5Ctc4S--LVwREy2P8AdBZyyBVwJzKRhGyfKXyswg'
const CACHE_MS = 10 * 60 * 1000
const store = globalThis.__doctorHoursSheet ||= { at: 0, result: null, pending: null }

export function doctorHoursConfigured() {
  return sheetAccessMissing().length === 0
}

export async function doctorHoursSheet({ refresh = false } = {}) {
  if (!doctorHoursConfigured()) return null
  if (!refresh && store.result && Date.now() - store.at < CACHE_MS) return store.result
  if (store.pending) return store.pending
  store.pending = (async () => {
    let result
    try {
      const tabs = await readSheetTabs(SHEET_ID, (t) => /^\s*20\d\d\s*$/.test(t) && +t.trim() >= 2025)
      result = { ...parseDoctorHours(tabs), readAt: new Date().toISOString() }
    } catch (e) {
      console.error('[doctor-hours] sheet read failed:', e.message)
      result = { error: e.message || 'could not be read' }
    }
    if (result.error && store.result?.months) result = { ...store.result, stale: result.error }
    store.result = result
    // A failed read is tried again after 30 seconds, not kept for 10 minutes.
    store.at = result.error || result.stale ? Date.now() - CACHE_MS + 30_000 : Date.now()
    store.pending = null
    return result
  })()
  return store.pending
}
