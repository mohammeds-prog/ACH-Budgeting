import fs from 'fs/promises'
import path from 'path'
import { readDentrixFile } from '@/lib/dentrixReports'

// ─────────────────────────────────────────────────────────────────────────────
// Server only. Reads the Dentrix exports in the project's /reports folder,
// parsing each file once and reusing the result until the file changes — the
// full schedule export is ~80 MB. Shared by /api/reports and /api/retention.
// ─────────────────────────────────────────────────────────────────────────────

export const REPORTS_DIR = path.join(process.cwd(), 'reports')

// name → { mtimeMs, size, reader, result }. On globalThis so every API route
// (each is its own bundle) and the start-up warm-up share one cache.
const cache = globalThis.__reportsCache ||= new Map()
// name → the read in progress, so two requests at once parse a file once.
const pending = globalThis.__reportsPending ||= new Map()
// Which parser made a cached result: its source text, the same in every
// bundle (a function's identity differs per bundle, which made each route
// re-read the 90 MB schedule). A parser edit in development changes it.
const READER = String(readDentrixFile)

// readDentrixFile expects a browser File; this gives it the same shape.
function fileLike(name, buf) {
  return {
    name,
    text: async () => buf.toString('utf8'),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  }
}

// Report file names in the folder, or null when there is no folder (the
// deployed site).
export async function reportNames() {
  try {
    return (await fs.readdir(REPORTS_DIR))
      .filter((n) => /\.(csv|xlsx|xls)$/i.test(n) && !n.startsWith('~$'))   // ~$ = Excel lock files
      .sort()
  } catch {
    return null
  }
}

// { name, parsed } or { name, error }. `parsed` keeps any non-enumerable
// extras (the schedule's visit index), which never reach JSON.
export async function readReport(name) {
  try {
    const full = path.join(REPORTS_DIR, name)
    const st = await fs.stat(full)
    const hit = cache.get(name)
    // Same file, same parser: reuse. Otherwise wait for a read already running, or read it.
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size && hit.reader === READER) return hit.result
    const key = `${name}|${st.mtimeMs}|${st.size}`
    if (pending.has(key)) return await pending.get(key)
    const job = parse(name, full, st)
    pending.set(key, job)
    try { return await job } finally { pending.delete(key) }
  } catch (e) {
    return { name, error: e.message || 'could not be read' }
  }
}

async function parse(name, full, st) {
  try {
    const result = { name, parsed: await readDentrixFile(fileLike(name, await fs.readFile(full))) }
    // A fixed daily file name ("aging.xlsx") carries no date: the report is
    // as of the day the file was saved.
    if (result.parsed?.kind === 'aging' && !result.parsed.asOf) result.parsed.asOf = new Date(st.mtimeMs).toISOString().slice(0, 10)
    cache.set(name, { mtimeMs: st.mtimeMs, size: st.size, reader: READER, result })
    return result
  } catch (e) {
    return { name, error: e.message || 'could not be read' }
  }
}

// Read every report once in the background (server start-up), so the first
// person to open Analysis doesn't wait for the schedule to be parsed.
export async function warmReports() {
  const names = (await reportNames()) || []
  for (const n of names) await readReport(n)
}
