'use client'

import { useState, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'

// ── Shared helpers (importable by pages) ─────────────────────────

export function parseFlexDate(v) {
  if (!v) return null
  const s = v.trim()

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T00:00:00')
    return isNaN(d) ? null : s
  }
  // MM/DD/YYYY or M/D/YYYY (also accepts - separator)
  const mdy4 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (mdy4) {
    const [, m, d, y] = mdy4
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    return isNaN(new Date(iso + 'T00:00:00')) ? null : iso
  }
  // MM/DD/YY or M/D/YY
  const mdy2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/)
  if (mdy2) {
    const [, m, d, y] = mdy2
    const fullY = Number(y) >= 50 ? `19${y}` : `20${y}`
    const iso = `${fullY}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    return isNaN(new Date(iso + 'T00:00:00')) ? null : iso
  }
  return null
}

export function parseAmount(v) {
  if (!v) return NaN
  // strip $ signs, commas, spaces, parentheses (accounting negatives like "(100.00)")
  const negative = v.trim().startsWith('(') || v.trim().startsWith('-')
  const cleaned = v.replace(/[$,\s()]/g, '')
  const num = Number(cleaned)
  return isNaN(num) ? NaN : (negative ? -Math.abs(num) : num)
}

export function fuzzyLocation(v, locations) {
  if (!v) return null
  const s = v.trim()
  const lower = s.toLowerCase()
  // 1. Exact (case-insensitive)
  const exact = locations.find((l) => l.toLowerCase() === lower)
  if (exact) return exact
  // 2. Input is a substring of a location name ("romeoville" → "Valley View Dental Romeoville")
  const sub = locations.find((l) => l.toLowerCase().includes(lower))
  if (sub) return sub
  // 3. Location name is a substring of the input ("Alora Dental Spa" → "Alora")
  //    Prefer longer/more-specific location names when multiple match
  const locInInput = locations
    .filter((l) => lower.includes(l.toLowerCase()))
    .sort((a, b) => b.length - a.length)[0]
  if (locInInput) return locInInput
  // 4. Word-level scoring — skip generic words shared across many locations
  const SKIP = new Set(['dental', 'view', 'valley', 'medical', 'care', 'health', 'spa', 'center', 'clinic'])
  const scored = locations
    .map((l) => {
      const words = l.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !SKIP.has(w))
      const hits = words.filter((w) => lower.includes(w)).length
      return { l, hits }
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
  return scored[0]?.l || null
}

// ── CSV parser ────────────────────────────────────────────────────
function detectSeparator(line) {
  const tabs = (line.match(/\t/g) || []).length
  const semis = (line.match(/;/g) || []).length
  const commas = (line.match(/,/g) || []).length
  if (tabs >= commas && tabs >= semis) return '\t'
  if (semis > commas) return ';'
  return ','
}

function parseCSVLine(line, sep) {
  const cells = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
      else inQ = !inQ
    } else if (ch === sep && !inQ) {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur.trim())
  return cells
}

function parseCSV(raw) {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return { headers: [], rows: [] }
  const sep = detectSeparator(lines[0])
  const headers = parseCSVLine(lines[0], sep).map((h) => h.replace(/^"|"$/g, '').trim().toLowerCase())
  const rows = lines.slice(1).map((l) => {
    const cells = parseCSVLine(l, sep)
    const obj = {}
    headers.forEach((h, i) => { obj[h] = cells[i] ?? '' })
    return obj
  })
  return { headers, rows }
}

function normalizeHeader(s) {
  return s.toLowerCase().replace(/[\s_\-\.]/g, '')
}

// ── Main component ────────────────────────────────────────────────
export default function ImportModal({ title, subtitle, columns, onImport, onClose, locationOptions, postProcess }) {
  const [raw, setRaw] = useState('')
  const [parsed, setParsed] = useState(null) // { headers, rows, mapped, issues }
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null) // { imported, skipped, errors }
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef()

  const requiredCols = columns.filter((c) => c.required).map((c) => c.key)
  const exampleRow = columns.map((c) => c.example ?? '').join(',')
  const headerRow = columns.map((c) => c.key).join(',')
  const templateText = `${headerRow}\n${exampleRow}`

  function processRaw(text) {
    setRaw(text)
    setResult(null)
    if (!text.trim()) { setParsed(null); return }

    const { headers, rows } = parseCSV(text)

    // map each column config to its detected header index
    const colMap = {}
    // Pass 1: exact normalized match
    columns.forEach((col) => {
      const aliases = [col.key, col.label, ...(col.aliases || [])].map((a) => normalizeHeader(a))
      const found = headers.find((h) => aliases.includes(normalizeHeader(h)))
      colMap[col.key] = found ?? null
    })
    // Pass 2: word-overlap fallback for anything still unmatched
    const claimedHeaders = new Set(Object.values(colMap).filter(Boolean))
    columns.forEach((col) => {
      if (colMap[col.key]) return
      const aliasWords = new Set(
        [col.key, col.label, ...(col.aliases || [])]
          .flatMap((a) => (normalizeHeader(a).match(/[a-z]+/g) || []))
          .filter((w) => w.length >= 3)
      )
      let bestScore = 0, bestHeader = null
      headers.forEach((h) => {
        if (claimedHeaders.has(h)) return
        const hWords = (normalizeHeader(h).match(/[a-z]+/g) || []).filter((w) => w.length >= 3)
        const score = hWords.filter((w) => aliasWords.has(w)).length
        if (score > bestScore) { bestScore = score; bestHeader = h }
      })
      if (bestScore >= 1) { colMap[col.key] = bestHeader; claimedHeaders.add(bestHeader) }
    })

    const missingRequired = requiredCols.filter((k) => !colMap[k])

    const mapped = rows.map((rawRow, idx) => {
      const entry = {}
      const rowErrors = []

      columns.forEach((col) => {
        const headerKey = colMap[col.key]
        const rawVal = headerKey != null ? (rawRow[headerKey] ?? '') : ''
        const val = rawVal.trim()

        // use defaultValue when CSV doesn't have this column and a default is configured
        const effectiveVal = val || (col.defaultValue ?? '')

        if (col.required && !effectiveVal) {
          rowErrors.push(`"${col.key}" is required`)
          entry[col.key] = null
          return
        }

        if (col.validate && effectiveVal) {
          const err = col.validate(effectiveVal, locationOptions)
          if (err) { rowErrors.push(err); entry[col.key] = effectiveVal; return }
        }

        entry[col.key] = col.transform ? col.transform(effectiveVal, locationOptions) : (effectiveVal || null)
      })

      if (postProcess) postProcess(entry, rawRow, colMap)

      return { entry, errors: rowErrors, rowNum: idx + 2 }
    })

    setParsed({ headers, colMap, missingRequired, mapped })
  }

  function handlePaste(e) { processRaw(e.target.value) }

  function handleFile(file) {
    if (!file) return
    const isExcel = /\.(xlsx|xls)$/i.test(file.name)
    const reader = new FileReader()
    if (isExcel) {
      reader.onload = (e) => {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' })
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]])
        processRaw(csv)
      }
      reader.readAsArrayBuffer(file)
    } else {
      reader.onload = (e) => processRaw(e.target.result)
      reader.readAsText(file)
    }
  }

  function handleDrop(e) {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) {
      const ext = file.name.split('.').pop().toLowerCase()
      if (['csv', 'tsv', 'txt', 'xlsx', 'xls'].includes(ext)) handleFile(file)
    }
  }

  const validRows = parsed?.mapped.filter((r) => r.errors.length === 0) ?? []
  const invalidRows = parsed?.mapped.filter((r) => r.errors.length > 0) ?? []

  async function handleImport() {
    if (!validRows.length) return
    setImporting(true)
    try {
      const imported = await onImport(validRows.map((r) => r.entry))
      setResult({ imported: imported.length, skipped: invalidRows.length })
    } catch (err) {
      setResult({ error: err.message || 'Import failed. Check your data and try again.' })
    } finally {
      setImporting(false)
    }
  }

  function copyTemplate() {
    navigator.clipboard.writeText(templateText)
  }

  const previewRows = parsed?.mapped.slice(0, 8) ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={result ? onClose : undefined} />
      <div className="relative bg-slate-900 border border-white/[0.1] rounded-2xl shadow-2xl w-full max-w-4xl z-10 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/[0.07] shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">{title}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-5">

          {/* Success result */}
          {result && !result.error && (
            <div className="bg-emerald-500/[0.08] border border-emerald-500/20 rounded-2xl p-5 text-center">
              <div className="w-10 h-10 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
              </div>
              <p className="text-sm font-semibold text-emerald-300">{result.imported} row{result.imported !== 1 ? 's' : ''} imported successfully</p>
              {result.skipped > 0 && <p className="text-xs text-slate-500 mt-1">{result.skipped} row{result.skipped !== 1 ? 's' : ''} skipped due to errors</p>}
              <button onClick={onClose} className="mt-4 px-4 py-1.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-all">Done</button>
            </div>
          )}

          {/* Error result */}
          {result?.error && (
            <div className="bg-red-500/[0.08] border border-red-500/20 rounded-xl p-4 flex gap-3">
              <svg className="w-4 h-4 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/></svg>
              <p className="text-xs text-red-300">{result.error}</p>
            </div>
          )}

          {!result && (
            <>
              {/* Column reference */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Expected columns</p>
                  <button onClick={copyTemplate} className="inline-flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"/></svg>
                    Copy template
                  </button>
                </div>
                <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-white/[0.07]">
                        {columns.map((c) => (
                          <th key={c.key} className="px-3 py-2 text-left font-mono text-slate-400 whitespace-nowrap">
                              {c.key}
                              {c.required && <span className="text-red-400 ml-0.5">*</span>}
                              {c.defaultValue != null && <span className="ml-1.5 text-[9px] font-sans font-semibold text-indigo-400/60 normal-case tracking-normal">auto</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {columns.map((c) => (
                          <td key={c.key} className="px-3 py-2 text-slate-600 font-mono whitespace-nowrap">{c.example ?? '…'}</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-slate-700 mt-1.5">* required · column order doesn't matter · spaces and underscores in headers are ignored</p>
              </div>

              {/* Paste / upload area */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Paste or upload CSV / Excel</p>
                  <div className="flex gap-2">
                    <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
                    <button onClick={() => fileRef.current.click()} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg px-2.5 py-1.5 transition-all">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"/></svg>
                      Upload file
                    </button>
                    {raw && <button onClick={() => { setRaw(''); setParsed(null) }} className="text-xs text-slate-600 hover:text-red-400 transition-colors">Clear</button>}
                  </div>
                </div>

                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  className={`relative rounded-xl border transition-colors ${dragOver ? 'border-violet-500/50 bg-violet-500/[0.05]' : 'border-white/[0.08] bg-white/[0.03]'}`}
                >
                  <textarea
                    value={raw}
                    onChange={handlePaste}
                    placeholder={`Paste CSV data here…\n\nExample:\n${headerRow}\n${exampleRow}`}
                    rows={6}
                    className="w-full px-4 py-3 text-xs font-mono text-slate-300 placeholder:text-slate-700 bg-transparent outline-none resize-y rounded-xl [color-scheme:dark]"
                    spellCheck={false}
                  />
                  {dragOver && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl pointer-events-none">
                      <p className="text-sm font-semibold text-violet-300">Drop file here</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Parse results + preview */}
              {parsed && (
                <div>
                  {/* Missing required columns warning */}
                  {parsed.missingRequired.length > 0 && (
                    <div className="mb-3 bg-red-500/[0.08] border border-red-500/20 rounded-xl p-3 flex gap-2.5">
                      <svg className="w-4 h-4 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/></svg>
                      <div>
                        <p className="text-xs font-semibold text-red-300">Required columns not found in your CSV</p>
                        <p className="text-xs text-red-400/70 mt-0.5">Missing: <span className="font-mono">{parsed.missingRequired.join(', ')}</span></p>
                      </div>
                    </div>
                  )}

                  {/* Stats row */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex items-center gap-1.5 bg-white/[0.04] border border-white/[0.07] rounded-lg px-2.5 py-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                      <span className="text-xs text-slate-400">{parsed.mapped.length} rows detected</span>
                    </div>
                    {validRows.length > 0 && (
                      <div className="flex items-center gap-1.5 bg-emerald-500/[0.08] border border-emerald-500/20 rounded-lg px-2.5 py-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        <span className="text-xs text-emerald-400">{validRows.length} valid</span>
                      </div>
                    )}
                    {invalidRows.length > 0 && (
                      <div className="flex items-center gap-1.5 bg-red-500/[0.08] border border-red-500/20 rounded-lg px-2.5 py-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                        <span className="text-xs text-red-400">{invalidRows.length} will be skipped</span>
                      </div>
                    )}
                  </div>

                  {/* Preview table */}
                  <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl overflow-x-auto">
                    <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Preview {previewRows.length < parsed.mapped.length ? `(first ${previewRows.length} of ${parsed.mapped.length})` : ''}</p>
                    </div>
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-white/[0.05]">
                          <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-slate-600 w-8">#</th>
                          {columns.map((c) => {
                            const mapped = !!parsed.colMap[c.key]
                            const autoFilled = !mapped && c.defaultValue != null
                            return (
                              <th key={c.key} className={`px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest whitespace-nowrap ${mapped ? 'text-slate-500' : autoFilled ? 'text-indigo-400/70' : 'text-slate-800'}`}>
                                {c.key}
                                {!mapped && c.required ? ' ⚠' : ''}
                                {autoFilled && <span className="ml-1 text-[9px] font-normal text-indigo-400/50 normal-case tracking-normal">auto</span>}
                              </th>
                            )
                          })}
                          <th className="px-3 py-2 w-6" />
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map(({ entry, errors, rowNum }) => (
                          <tr key={rowNum} className={`border-b border-white/[0.04] last:border-0 ${errors.length ? 'bg-red-500/[0.04]' : ''}`}>
                            <td className="px-3 py-2 text-slate-700 tabular-nums">{rowNum}</td>
                            {columns.map((c) => {
                              const isAutoFilled = !parsed.colMap[c.key] && c.defaultValue != null && entry[c.key] != null
                              const display = entry[c.key] != null && entry[c.key] !== '' ? String(entry[c.key]) : null
                              return (
                                <td key={c.key} className="px-3 py-2 max-w-[140px] truncate font-mono" title={display ?? ''}>
                                  {display
                                    ? <span className={isAutoFilled ? 'text-indigo-300/60 italic' : 'text-slate-400'}>{display}</span>
                                    : <span className="text-slate-800">—</span>}
                                </td>
                              )
                            })}
                            <td className="px-3 py-2">
                              {errors.length > 0 && (
                                <div className="group relative">
                                  <svg className="w-3.5 h-3.5 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd"/></svg>
                                  <div className="absolute right-0 bottom-full mb-1 hidden group-hover:block z-10 bg-slate-800 border border-white/[0.1] rounded-lg px-2.5 py-2 w-56 text-[11px] text-red-300 shadow-xl">
                                    {errors.map((e, i) => <p key={i}>{e}</p>)}
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!result && (
          <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-t border-white/[0.07] bg-white/[0.02]">
            <p className="text-xs text-slate-600">
              {parsed ? (
                validRows.length > 0
                  ? `Ready to import ${validRows.length} row${validRows.length !== 1 ? 's' : ''}${invalidRows.length ? ` · ${invalidRows.length} will be skipped` : ''}`
                  : 'No valid rows to import'
              ) : 'Paste CSV data or upload a file above'}
            </p>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-400 hover:text-white border border-white/[0.08] hover:border-white/20 rounded-xl transition-all">Cancel</button>
              <button
                onClick={handleImport}
                disabled={!validRows.length || importing || (parsed?.missingRequired.length > 0)}
                className="inline-flex items-center gap-2 px-4 py-1.5 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition-all shadow-lg shadow-violet-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {importing ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Importing…
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>
                    Import {validRows.length > 0 ? `${validRows.length} rows` : ''}
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
