'use client'

import { useState, useRef } from 'react'
import { LOCATIONS, ACH_STATUSES } from '@/lib/constants'
import { parseEobFilename } from '@/lib/parseEobFilename'
import DateInput from './DateInput'

const MAX_MB = 10
const MAX_SIZE = MAX_MB * 1024 * 1024

function shortLoc(loc) {
  return loc ? loc.replace('Valley View Dental ', '') : ''
}

const LOC_OPTIONS = [{ value: '', label: '— select —' }, ...LOCATIONS.map((l) => ({ value: l, label: shortLoc(l) }))]

const sel = 'w-full rounded-lg border bg-white px-2 py-1 text-xs text-slate-700 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100'
const inp = sel

export default function EobImportModal({ onClose, onImport, uniqueInsurers = [] }) {
  const [rows, setRows]         = useState([])   // { file, date, insuranceName, location, warnings }
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(null) // { done, total }
  const [result, setResult]     = useState(null) // { imported, failed[] }
  const [error, setError]       = useState('')
  const inputRef = useRef(null)

  function addFiles(fileList) {
    setError('')
    const incoming = Array.from(fileList || [])
    const accepted = []
    for (const f of incoming) {
      if (!/\.pdf$/i.test(f.name)) { setError(`"${f.name}" is not a PDF.`); continue }
      if (f.size > MAX_SIZE)       { setError(`"${f.name}" exceeds ${MAX_MB} MB.`); continue }
      accepted.push({ file: f, ...parseEobFilename(f.name) })
    }
    // Skip files already staged (same name + size), then put the ones needing a
    // human at the top.
    //
    // The sort happens HERE, once, rather than in a derived view on every
    // render. If the order were recomputed as you type, the row you're fixing
    // would re-rank and jump down the table the moment you filled in the date.
    setRows((prev) => {
      const seen = new Set(prev.map((r) => `${r.file.name}:${r.file.size}`))
      const fresh = accepted.filter((r) => !seen.has(`${r.file.name}:${r.file.size}`))
      const rank = (r) => (!r.date ? 0 : (!r.insuranceName || !r.location) ? 1 : 2)
      return [...prev, ...fresh.sort((a, b) => rank(a) - rank(b))]
    })
  }

  function setField(i, key, value) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)))
  }
  function removeRow(i) {
    setRows((prev) => prev.filter((_, idx) => idx !== i))
  }

  // A row is importable once it has the one genuinely required field: the date.
  // Insurance and location are worth prompting for, but can be filled in later
  // from the table, so they warn rather than block.
  const ready       = rows.filter((r) => r.date)
  const blocked     = rows.length - ready.length
  const needsReview = rows.filter((r) => !r.date || !r.insuranceName || !r.location).length


  async function handleImport() {
    if (ready.length === 0) return
    setImporting(true)
    setError('')
    setProgress({ done: 0, total: ready.length })
    try {
      const res = await onImport(ready, (done) => setProgress({ done, total: ready.length }))
      setResult(res)
    } catch {
      setError('Import failed. Check your connection and try again.')
    } finally {
      setImporting(false)
      setProgress(null)
    }
  }

  // ── Done ────────────────────────────────────────────────────────────────
  if (result) {
    return (
      <Shell onClose={onClose} title="Import complete">
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <svg className="w-5 h-5 text-emerald-600 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5"/>
            </svg>
            <p className="text-sm text-emerald-800">
              <span className="font-semibold">{result.imported}</span> zero payment{result.imported === 1 ? '' : 's'} created, each with its EOB attached.
            </p>
          </div>
          {result.failed?.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs font-semibold text-amber-800 mb-1">{result.failed.length} could not be saved:</p>
              <ul className="text-[11px] text-amber-700 space-y-0.5">
                {result.failed.map((f, i) => <li key={i}>• {f.name} — {f.reason}</li>)}
              </ul>
            </div>
          )}
        </div>
        <Footer>
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition-all">Done</button>
        </Footer>
      </Shell>
    )
  }

  // ── Picking / reviewing ─────────────────────────────────────────────────
  return (
    <Shell onClose={importing ? undefined : onClose} title="Import EOBs" wide>
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 pt-5">
          <p className="text-xs text-slate-500 mb-4">
            Drop the PDFs in. Date, insurance and location are read from each filename —
            review below and correct anything before importing. The PDF is attached to the row it creates.
          </p>

          <input ref={inputRef} type="file" accept=".pdf" multiple hidden
            onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />

          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
            onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
            onClick={() => !importing && inputRef.current?.click()}
            className={`rounded-xl border-2 border-dashed px-5 py-6 flex flex-col items-center justify-center cursor-pointer transition-all select-none ${
              dragging ? 'border-violet-400 bg-violet-50' : 'border-slate-200 hover:border-violet-300 hover:bg-violet-50/40'
            }`}
          >
            <svg className="w-6 h-6 text-slate-400 mb-2" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"/>
            </svg>
            <p className="text-xs text-slate-500">Drop EOB PDFs here or <span className="text-violet-600 font-medium">browse</span></p>
            <p className="text-[11px] text-slate-400 mt-1">Max {MAX_MB} MB each · you can add more after</p>
          </div>

          {error && <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
        </div>

        {rows.length > 0 && (
          <div className="px-6 py-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                {rows.length} file{rows.length === 1 ? '' : 's'}
                {needsReview > 0
                  ? <span className="ml-2 text-amber-600 normal-case tracking-normal font-medium">
                      {needsReview} need{needsReview === 1 ? 's' : ''} a look — shown first
                    </span>
                  : <span className="ml-2 text-emerald-600 normal-case tracking-normal font-medium">all parsed</span>}
              </p>
              <button onClick={() => setRows([])} disabled={importing} className="text-[11px] text-slate-500 hover:text-red-500 transition-colors">Clear all</button>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {['File', 'EOB Date', 'Insurance', 'Location', ''].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.file.name}-${i}`} className={`border-b border-slate-100 last:border-0 ${
                      !r.date ? 'bg-amber-50' : (!r.insuranceName || !r.location) ? 'bg-amber-50/40' : ''
                    }`}>
                      <td className="px-3 py-2 max-w-[240px]">
                        <p className="text-slate-700 truncate" title={r.file.name}>{r.file.name}</p>
                        {r.warnings.length > 0 && (
                          <p className="text-[10px] text-amber-700 mt-0.5">{r.warnings.join(' · ')}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 w-[140px]">
                        <DateInput value={r.date || ''} onChange={(iso) => setField(i, 'date', iso)}
                          className={r.date ? '' : '[&_input[type=text]]:border-amber-400 [&_input[type=text]]:bg-amber-50'} />
                      </td>
                      <td className="px-3 py-2 w-[170px]">
                        <input type="text" list="eob-insurers" value={r.insuranceName || ''} placeholder="Type or pick…"
                          onChange={(e) => setField(i, 'insuranceName', e.target.value)}
                          className={`${inp} ${r.insuranceName ? 'border-slate-200' : 'border-amber-400 bg-amber-50'}`} />
                      </td>
                      <td className="px-3 py-2 w-[150px]">
                        <select value={r.location || ''} onChange={(e) => setField(i, 'location', e.target.value)}
                          className={`${sel} cursor-pointer ${r.location ? 'border-slate-200' : 'border-amber-400 bg-amber-50'}`}>
                          {LOC_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 w-[34px]">
                        <button onClick={() => removeRow(i)} disabled={importing}
                          className="p-1 rounded text-slate-400 hover:text-red-500 transition-colors" title="Remove">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/>
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <datalist id="eob-insurers">
              {uniqueInsurers.map((n) => <option key={n} value={n} />)}
            </datalist>

            {blocked > 0 && (
              <p className="mt-2 text-[11px] text-amber-700">
                {blocked} file{blocked === 1 ? '' : 's'} still {blocked === 1 ? 'needs' : 'need'} a date and will be skipped.
                Insurance and location can be left blank and filled in later.
              </p>
            )}
          </div>
        )}
      </div>

      <Footer>
        {progress && (
          <span className="mr-auto text-xs text-slate-500 tabular-nums">
            Uploading {progress.done} of {progress.total}…
          </span>
        )}
        <button onClick={onClose} disabled={importing}
          className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all disabled:opacity-50">
          Cancel
        </button>
        <button onClick={handleImport} disabled={importing || ready.length === 0}
          className="px-4 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition-all disabled:opacity-40 shadow-lg shadow-violet-900/30">
          {importing ? 'Importing…' : `Import ${ready.length || ''}`.trim()}
        </button>
      </Footer>
    </Shell>
  )
}

function Shell({ children, onClose, title, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white border border-violet-200/60 rounded-2xl shadow-2xl shadow-indigo-100/40 w-full ${wide ? 'max-w-3xl' : 'max-w-md'} z-10 max-h-[90vh] flex flex-col overflow-hidden`}>
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {onClose && (
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/>
              </svg>
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

function Footer({ children }) {
  return <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-200">{children}</div>
}
