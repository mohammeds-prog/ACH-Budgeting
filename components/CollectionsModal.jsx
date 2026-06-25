'use client'

import { useState } from 'react'
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
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - 2 + i) // -2 to +2

export default function CollectionsModal({ collections, onSave, onClose }) {
  const [activeLocation, setActiveLocation] = useState(LOCATIONS[0])
  const [activeYear, setActiveYear] = useState(CURRENT_YEAR)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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

  const monthKeys = Array.from({ length: 12 }, (_, m) =>
    `${activeYear}-${String(m + 1).padStart(2, '0')}`
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={saving ? undefined : onClose} />

      <div className="relative bg-slate-900 border border-white/[0.1] rounded-2xl shadow-2xl w-full max-w-lg z-10 max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-white/[0.07]">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-semibold text-white">Monthly Collections</h2>
            <button onClick={onClose} disabled={saving} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
          <p className="text-xs text-slate-500">Next month's supply budget = 6% of each value entered.</p>

          {/* Location tabs */}
          <div className="flex gap-1 overflow-x-auto mt-4">
            {LOCATIONS.map((loc) => (
              <button
                key={loc}
                onClick={() => setActiveLocation(loc)}
                className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap rounded-lg transition-all ${
                  activeLocation === loc
                    ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.05] border border-transparent'
                }`}
              >
                {shortName(loc)}
              </button>
            ))}
          </div>

          {/* Year selector */}
          <div className="flex gap-1 mt-3">
            {YEARS.map((y) => (
              <button
                key={y}
                onClick={() => setActiveYear(y)}
                className={`flex-1 py-1 text-xs font-semibold rounded-lg transition-all ${
                  activeYear === y
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                    : 'text-slate-600 hover:text-slate-300 hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
        </div>

        {/* Month rows */}
        <div className="p-6 overflow-y-auto flex-1 space-y-2.5">
          {monthKeys.map((key, i) => {
            const val = values[activeLocation]?.[key] ?? ''
            const cap = parseFloat(val || 0) * 0.06
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="text-sm text-slate-400 w-28 shrink-0">{MONTHS[i]}</span>
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm pointer-events-none">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={val}
                    onChange={(e) => set(activeLocation, key, e.target.value)}
                    placeholder="0.00"
                    disabled={saving}
                    className="w-full pl-7 pr-3 py-1.5 text-sm bg-slate-800/80 border border-white/[0.08] rounded-xl text-white placeholder:text-slate-600 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 transition-all"
                  />
                </div>
                {val ? (
                  <span className="text-xs text-violet-400 w-24 text-right shrink-0 font-medium tabular-nums">
                    → ${cap.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} cap
                  </span>
                ) : (
                  <span className="w-24 shrink-0" />
                )}
              </div>
            )
          })}

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mt-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/[0.07]">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-slate-400 hover:text-white border border-white/[0.08] hover:border-white/20 rounded-xl transition-all disabled:opacity-50"
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
