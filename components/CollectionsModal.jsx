'use client'

import { useState, useRef } from 'react'
import { LOCATIONS } from '@/lib/expenditureStorage'

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

function shortName(loc) {
  if (loc === 'Valley View Dental Romeoville') return 'Romeoville'
  if (loc === 'Valley View Dental Naperville') return 'Naperville'
  if (loc === 'Valley View Dental Montgomery') return 'Montgomery'
  return loc
}

const NOW = new Date()
const CURRENT_YEAR = NOW.getFullYear()
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - 2 + i)

function getPrevMonth() {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return {
    key:   `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    year:  d.getFullYear(),
  }
}

function matchLocation(name) {
  const n = name.toLowerCase()
  if (n.includes('romeoville')) return 'Valley View Dental Romeoville'
  if (n.includes('naperville'))  return 'Valley View Dental Naperville'
  if (n.includes('montgomery'))  return 'Valley View Dental Montgomery'
  if (n.includes('alora'))       return 'Alora'
  if (n.includes('dentique'))    return 'Dentique'
  return null
}

function splitCSVRow(line) {
  const cells = []
  let i = 0, cell = ''
  while (i <= line.length) {
    if (i === line.length) { cells.push(cell.trim()); break }
    const ch = line[i]
    if (ch === '"') {
      i++
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { cell += '"'; i += 2 }
        else if (line[i] === '"') { i++; break }
        else { cell += line[i++] }
      }
    } else if (ch === ',') {
      cells.push(cell.trim()); cell = ''; i++
    } else { cell += ch; i++ }
  }
  return cells
}

function parseImportText(text) {
  const rawLines = text.trim().split('\n').filter(l => l.trim())
  if (rawLines.length < 2) return { error: 'Need at least a header row and one data row.' }

  // Auto-detect CSV vs TSV
  const first = rawLines[0]
  const isCSV = (first.match(/,/g) || []).length > (first.match(/\t/g) || []).length
  const lines = rawLines.map(l => isCSV ? splitCSVRow(l) : l.split('\t').map(c => c.trim()))

  // Find header row (first row within 5 lines that mentions "grand total", "amount", or "location")
  let headerIdx = 0
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (lines[i].some(c => {
      const lc = c.toLowerCase()
      return lc.includes('grand total') || lc.includes('amount') || lc === 'location'
    })) { headerIdx = i; break }
  }

  const headers = lines[headerIdx].map(h => h.toLowerCase())

  // Find the amount column — prefer "grand total" + "amount", then "grand total", then "amount", then last
  let amtCol = -1
  for (let i = headers.length - 1; i >= 0; i--) {
    if (headers[i].includes('grand total') && headers[i].includes('amount')) { amtCol = i; break }
  }
  if (amtCol === -1) {
    for (let i = headers.length - 1; i >= 0; i--) {
      if (headers[i].includes('grand total')) { amtCol = i; break }
    }
  }
  if (amtCol === -1) {
    for (let i = headers.length - 1; i >= 0; i--) {
      if (headers[i].includes('amount')) { amtCol = i; break }
    }
  }
  if (amtCol === -1) amtCol = headers.length - 1

  const matched = {}
  const unmatched = []

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const row = lines[i]
    const locName = row[0]?.trim()
    if (!locName) continue

    const lc = locName.toLowerCase()
    if (lc.includes('grand total') || lc === 'total') continue

    const loc = matchLocation(locName)
    const amtStr = (row[amtCol] || '').replace(/[$,\s]/g, '')
    const amt = parseFloat(amtStr)

    if (!loc) {
      if (!isNaN(amt)) unmatched.push(locName)
      continue
    }
    if (isNaN(amt)) continue

    matched[loc] = (matched[loc] || 0) + Math.abs(amt)
  }

  if (Object.keys(matched).length === 0) {
    return {
      error: 'No matching locations found. Make sure the data includes names containing "Alora", "Dentique", "Romeoville", "Naperville", or "Montgomery".',
      unmatched,
    }
  }

  return { results: matched, unmatched }
}

export default function CollectionsModal({ collections, onSave, onClose }) {
  const [activeLocation, setActiveLocation] = useState(LOCATIONS[0])
  const [activeYear, setActiveYear]         = useState(CURRENT_YEAR)
  const [saving, setSaving]                 = useState(false)
  const [error, setError]                   = useState('')
  const [importMode, setImportMode]         = useState(false)
  const [importText, setImportText]         = useState('')
  const [importFileName, setImportFileName] = useState('')
  const [importPreview, setImportPreview]   = useState(null)
  const fileInputRef = useRef(null)

  const [values, setValues] = useState(() => {
    const init = {}
    LOCATIONS.forEach((loc) => {
      init[loc] = {}
      YEARS.forEach((year) => {
        Array.from({ length: 12 }, (_, m) => {
          const key = `${year}-${String(m + 1).padStart(2, '0')}`
          const existing = collections[key]?.[loc]
          init[loc][key] = existing != null ? String(existing) : ''
        })
      })
    })
    return init
  })

  function set(location, monthKey, val) {
    setValues((p) => ({ ...p, [location]: { ...p[location], [monthKey]: val } }))
  }

  async function handleSave() {
    const updatedMap = { ...collections }
    let hasAny = false
    LOCATIONS.forEach((loc) => {
      YEARS.forEach((year) => {
        Array.from({ length: 12 }, (_, m) => {
          const key = `${year}-${String(m + 1).padStart(2, '0')}`
          const n = parseFloat(values[loc]?.[key])
          if (!isNaN(n) && n >= 0) {
            if (!updatedMap[key]) updatedMap[key] = {}
            updatedMap[key][loc] = n
            hasAny = true
          }
        })
      })
    })
    if (!hasAny) { setError('Enter at least one collection amount.'); return }
    setSaving(true)
    setError('')
    try {
      await onSave(updatedMap)
    } catch {
      setError('Failed to save. Check your connection and try again.')
      setSaving(false)
    }
  }

  function handleImportTextChange(text) {
    setImportText(text)
    setImportFileName('')
    setImportPreview(text.trim() ? parseImportText(text) : null)
  }

  function handleFileUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setImportText('')
      setImportFileName(file.name)
      setImportPreview(parseImportText(ev.target.result))
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function applyImport() {
    if (!importPreview?.results) return
    const prev = getPrevMonth()
    setValues(old => {
      const next = { ...old }
      Object.entries(importPreview.results).forEach(([loc, amt]) => {
        next[loc] = { ...next[loc], [prev.key]: String(amt) }
      })
      return next
    })
    setActiveYear(prev.year)
    setImportMode(false)
    setImportText('')
    setImportFileName('')
    setImportPreview(null)
  }

  const monthKeys = Array.from({ length: 12 }, (_, m) =>
    `${activeYear}-${String(m + 1).padStart(2, '0')}`
  )

  const prevMonth = getPrevMonth()
  const hasResults = importPreview?.results && Object.keys(importPreview.results).length > 0

  // ── Import view ──────────────────────────────────────────────────
  if (importMode) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setImportMode(false)} />

        <div className="relative bg-white border border-violet-200/60 rounded-2xl shadow-2xl shadow-indigo-100/40 w-full max-w-lg z-10 max-h-[90vh] flex flex-col overflow-hidden">

          <div className="px-6 pt-6 pb-4 border-b border-slate-200">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <button onClick={() => setImportMode(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"/>
                  </svg>
                </button>
                <h2 className="text-base font-semibold text-slate-900">Import Collections</h2>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <p className="text-xs text-slate-500 ml-8">
              Copy the data rows from your spreadsheet and paste below. Amounts will be applied to{' '}
              <span className="font-semibold text-slate-700">{prevMonth.label}</span>.
            </p>
          </div>

          <div className="p-6 overflow-y-auto flex-1 space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
            />

            <textarea
              value={importText}
              onChange={(e) => handleImportTextChange(e.target.value)}
              placeholder={"Copy your spreadsheet rows (Ctrl+A → Ctrl+C) and paste here…"}
              rows={5}
              className="w-full px-3 py-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl text-slate-700 placeholder:text-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 resize-none transition-all"
            />

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-xs text-slate-400">or</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-600 bg-slate-50 hover:bg-violet-50 hover:text-violet-700 border border-slate-200 hover:border-violet-200 rounded-xl transition-all"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m.75 12 3 3m0 0 3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"/>
              </svg>
              {importFileName ? importFileName : 'Upload CSV file'}
            </button>

            {importPreview?.error && (
              <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-xs text-red-700">{importPreview.error}</p>
              </div>
            )}

            {hasResults && (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">
                  Preview — {prevMonth.label}
                </p>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  {Object.entries(importPreview.results).map(([loc, amt], idx) => (
                    <div key={loc} className={`flex items-center justify-between px-4 py-2.5 ${idx > 0 ? 'border-t border-slate-100' : ''}`}>
                      <span className="text-sm text-slate-700">{shortName(loc)}</span>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-violet-700 tabular-nums">
                          ${amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className="text-xs text-slate-400 ml-2">
                          → ${(amt * 0.06).toLocaleString('en-US', { maximumFractionDigits: 0 })} cap
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {LOCATIONS.filter(l => !importPreview.results[l]).length > 0 && (
                  <p className="text-xs text-amber-600">
                    No data found for: {LOCATIONS.filter(l => !importPreview.results[l]).map(shortName).join(', ')}
                  </p>
                )}

                {importPreview.unmatched?.length > 0 && (
                  <p className="text-xs text-slate-400">
                    Skipped (no location match): {importPreview.unmatched.join(', ')}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
            <button
              onClick={() => setImportMode(false)}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
            >
              Back
            </button>
            <button
              onClick={applyImport}
              disabled={!hasResults}
              className="px-4 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition-all disabled:opacity-40 shadow-lg shadow-violet-900/30"
            >
              Apply to {prevMonth.label}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Normal view ──────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={saving ? undefined : onClose} />

      <div className="relative bg-white border border-violet-200/60 rounded-2xl shadow-2xl shadow-indigo-100/40 w-full max-w-lg z-10 max-h-[90vh] flex flex-col overflow-hidden">

        <div className="px-6 pt-6 pb-4 border-b border-slate-200">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-semibold text-slate-900">Monthly Collections</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setImportMode(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/>
                </svg>
                Import
              </button>
              <button onClick={onClose} disabled={saving} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500">Next month's supply budget = 6% of each value entered.</p>

          <div className="flex gap-1 overflow-x-auto mt-4">
            {LOCATIONS.map((loc) => (
              <button
                key={loc}
                onClick={() => setActiveLocation(loc)}
                className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap rounded-lg transition-all border ${
                  activeLocation === loc
                    ? 'bg-violet-100 text-violet-700 border-violet-300'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-violet-50 border-transparent'
                }`}
              >
                {shortName(loc)}
              </button>
            ))}
          </div>

          <div className="flex gap-1 mt-3">
            {YEARS.map((y) => (
              <button
                key={y}
                onClick={() => setActiveYear(y)}
                className={`flex-1 py-1 text-xs font-semibold rounded-lg transition-all border ${
                  activeYear === y
                    ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50 border-transparent'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-2.5">
          {monthKeys.map((key, i) => {
            const val = values[activeLocation]?.[key] ?? ''
            const cap = parseFloat(val || 0) * 0.06
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="text-sm text-slate-600 w-28 shrink-0">{MONTHS[i]}</span>
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={val}
                    onChange={(e) => set(activeLocation, key, e.target.value)}
                    placeholder="0.00"
                    disabled={saving}
                    className="w-full pl-7 pr-3 py-1.5 text-sm bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-300 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50 transition-all"
                  />
                </div>
                {val ? (
                  <span className="text-xs text-violet-600 w-24 text-right shrink-0 font-medium tabular-nums">
                    → ${cap.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} cap
                  </span>
                ) : (
                  <span className="w-24 shrink-0" />
                )}
              </div>
            )
          })}

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mt-2">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition-all disabled:opacity-60 min-w-[80px] shadow-lg shadow-violet-900/30"
          >
            {saving ? 'Saving…' : 'Save All'}
          </button>
        </div>
      </div>
    </div>
  )
}
