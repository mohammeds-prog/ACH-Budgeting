import zlib from 'zlib'
import { createClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────────
// Server only. The Analysis data kept in the database (supabase/analysis_
// store.sql): the latest uploaded totals of each report, and the schedule's
// visit index from private Storage. Totals only — no patient names.
//
// Read once, kept in memory, and re-checked at most every CHECK_MS with a
// tiny query (ids and dates only); a report's data is fetched again only
// when a newer upload exists. That keeps database reads — and Disk IO — low.
// ─────────────────────────────────────────────────────────────────────────────

export const KINDS = ['production', 'collections', 'aging', 'schedule', 'adjustments', 'adSpend', 'newPatients']
export const INDEX_PATH = 'schedule/visit-index.json.gz'
const CHECK_MS = 2 * 60 * 1000

let admin = null
function db() {
  if (admin) return admin
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  return admin
}

// kind → { id, uploadedAt, asOf, fileName, parsed } ; plus when last checked.
const mem = globalThis.__analysisStore ||= { checkedAt: 0, byKind: {}, checking: null, missing: false }

// The newest upload of each report (ids and dates only — no data).
async function latestMeta(sb) {
  const { data, error } = await sb.from('analysis_snapshots')
    .select('id, kind, as_of, file_name, index_path, uploaded_at')
    .order('uploaded_at', { ascending: false }).limit(60)
  if (error) throw error
  const out = {}
  for (const r of data || []) if (!out[r.kind]) out[r.kind] = r
  return out
}

async function fetchKind(sb, meta) {
  const { data, error } = await sb.from('analysis_snapshots').select('data').eq('id', meta.id).single()
  if (error) throw error
  const parsed = data.data
  if (meta.kind === 'schedule' && meta.index_path) {
    const { data: file, error: fe } = await sb.storage.from('analysis').download(meta.index_path)
    if (!fe && file) {
      const raw = zlib.gunzipSync(Buffer.from(await file.arrayBuffer())).toString('utf8')
      // Kept out of JSON like the file reader does, so it never reaches a page.
      Object.defineProperty(parsed, 'index', { value: JSON.parse(raw), enumerable: false })
    }
  }
  return { id: meta.id, uploadedAt: meta.uploaded_at, asOf: meta.as_of, fileName: meta.file_name, parsed }
}

/** { kind: { parsed, uploadedAt, asOf, fileName } } from the database ({} when not set up). */
export async function storedReports() {
  const sb = db()
  if (!sb || mem.missing) return {}
  if (Date.now() - mem.checkedAt < CHECK_MS) return mem.byKind
  if (mem.checking) return mem.checking
  mem.checking = (async () => {
    try {
      const meta = await latestMeta(sb)
      for (const kind of Object.keys(meta)) {
        if (mem.byKind[kind]?.id === meta[kind].id) continue
        try { mem.byKind[kind] = await fetchKind(sb, meta[kind]) } catch { /* keep the older copy */ }
      }
      mem.checkedAt = Date.now()
    } catch (e) {
      // The table doesn't exist yet (SQL not run): stop asking until restart.
      if (/analysis_snapshots/.test(e?.message || '') || e?.code === '42P01' || e?.code === 'PGRST205') mem.missing = true
      mem.checkedAt = Date.now()
    } finally {
      mem.checking = null
    }
    return mem.byKind
  })()
  return mem.checking
}

/** Forget what's in memory, so the next read fetches fresh (after an upload). */
export function forgetStored() { mem.checkedAt = 0; mem.missing = false }

/** Save one report's totals (server side, with the service key). */
export async function saveReport(kind, parsed, fileName) {
  const sb = db()
  if (!sb) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.')
  if (!KINDS.includes(kind)) throw new Error(`Unknown report kind ${kind}`)
  let index_path = null
  if (kind === 'schedule' && parsed.index) {
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(parsed.index)))
    const { error } = await sb.storage.from('analysis').upload(INDEX_PATH, gz, { upsert: true, contentType: 'application/gzip' })
    if (error) throw new Error(`Visit index upload failed: ${error.message}`)
    index_path = INDEX_PATH
  }
  const asOf = parsed.asOf ? String(parsed.asOf).slice(0, 10) : null
  const { error } = await sb.from('analysis_snapshots').insert({ kind, as_of: asOf, file_name: fileName || null, data: parsed, index_path })
  if (error) throw new Error(`Saving ${kind} failed: ${error.message}`)
  forgetStored()
}
