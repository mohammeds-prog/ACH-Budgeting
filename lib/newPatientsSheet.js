import { sheetAccessMissing, readSheetTabCsv } from '@/lib/googleSheet'
import { readDentrixFile } from '@/lib/dentrixReports'

// ─────────────────────────────────────────────────────────────────────────────
// Server only. The New Patients Google Sheet, read live (NEW_PATIENTS_SHEET_ID,
// NEW_PATIENTS_SHEET_GID). Cached for 10 minutes, shared by every route (the
// Money view, the Summary, the chat). When it is set up, it replaces
// reports/new-patients.csv everywhere.
//   { name, parsed } | { name, error } | null when not set up.
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_MS = 10 * 60 * 1000
const store = globalThis.__newPatientsSheet ||= { at: 0, result: null, pending: null }

export function newPatientsSheetConfigured() {
  return !!process.env.NEW_PATIENTS_SHEET_ID && sheetAccessMissing().length === 0
}

export async function newPatientsSheet() {
  if (!newPatientsSheetConfigured()) return null
  if (store.result && Date.now() - store.at < CACHE_MS) return store.result
  if (store.pending) return store.pending
  const name = 'New Patients (Google Sheet)'
  store.pending = (async () => {
    let result
    try {
      const { csv } = await readSheetTabCsv(process.env.NEW_PATIENTS_SHEET_ID, process.env.NEW_PATIENTS_SHEET_GID)
      result = { name, parsed: await readDentrixFile({ name, text: async () => csv }) }
      if (result.parsed?.kind !== 'newPatients') result = { name, error: 'The sheet tab doesn’t look like the New Patients list (needs Patient and Referred By columns).' }
    } catch (e) {
      result = { name, error: e.message || 'could not be read' }
    }
    // A failed read keeps the last good copy, so a blip doesn't blank the page.
    if (result.error && store.result?.parsed) result = { ...store.result, stale: result.error }
    store.result = result
    store.at = Date.now()
    store.pending = null
    return result
  })()
  return store.pending
}
