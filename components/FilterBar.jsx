'use client'

import { ACH_STATUSES } from '@/lib/constants'
import Select from './Select'
import DateInput from './DateInput'

const MONTHS = [
  { value: '1', label: 'January' }, { value: '2', label: 'February' },
  { value: '3', label: 'March' }, { value: '4', label: 'April' },
  { value: '5', label: 'May' }, { value: '6', label: 'June' },
  { value: '7', label: 'July' }, { value: '8', label: 'August' },
  { value: '9', label: 'September' }, { value: '10', label: 'October' },
  { value: '11', label: 'November' }, { value: '12', label: 'December' },
]

const MATCH_OPTS = [
  { value: 'unmatched', label: 'Unmatched' },
  { value: 'Yes', label: 'Yes' },
  { value: 'No', label: 'No' },
  { value: 'Partial', label: 'Partial' },
]

export const EMPTY_FILTERS = {
  month: '', year: '', from: '', to: '', match: '', status: '', search: '', insurance: '',
  initials: '', receivedBy: [], belongsTo: [],
}

export default function FilterBar({ filters, onChange, uniqueYears, uniqueInsurers = [], uniqueInitials = [] }) {
  function set(key, value) {
    onChange((prev) => ({ ...prev, [key]: value }))
  }

  const activeCount = Object.entries(filters).filter(([k, v]) => {
    if (k === 'receivedBy' || k === 'belongsTo') return false
    return Array.isArray(v) ? v.length > 0 : v === true || (typeof v === 'string' && v !== '')
  }).length

  const yearOpts     = uniqueYears.map((y) => ({ value: String(y), label: String(y) }))
  const statusOpts   = ACH_STATUSES.map((s) => ({ value: s, label: s }))
  const insurerOpts  = uniqueInsurers.map((i) => ({ value: i, label: i }))
  const initialsOpts = uniqueInitials.map((i) => ({ value: i, label: i }))

  return (
    <div className="glass-card rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a1 1 0 0 1-.293.707L13 13.414V19a1 1 0 0 1-.553.894l-4 2A1 1 0 0 1 7 21v-7.586L3.293 6.707A1 1 0 0 1 3 6V4z"/>
          </svg>
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">Filters</span>
          {activeCount > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 text-[10px] font-bold border border-indigo-500/30">
              {activeCount}
            </span>
          )}
        </div>
        {activeCount > 0 && (
          <button onClick={() => onChange(EMPTY_FILTERS)} className="text-xs font-medium text-slate-500 hover:text-red-400 transition-colors flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/>
            </svg>
            Clear all
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2.5">
        <G label="Month"><Select value={filters.month} onChange={(v) => set('month', v)} placeholder="All months" options={MONTHS} /></G>
        <G label="Year"><Select value={filters.year} onChange={(v) => set('year', v)} placeholder="All years" options={yearOpts} /></G>
        <G label="Start Date"><DateIn value={filters.from} onChange={(v) => set('from', v)} /></G>
        <G label="End Date"><DateIn value={filters.to} onChange={(v) => set('to', v)} /></G>
        <G label="Match"><Select value={filters.match} onChange={(v) => set('match', v)} placeholder="All" options={MATCH_OPTS} /></G>
        <G label="Insurance"><Select value={filters.insurance} onChange={(v) => set('insurance', v)} placeholder="All" options={insurerOpts} /></G>
        <G label="Status"><Select value={filters.status} onChange={(v) => set('status', v)} placeholder="All statuses" options={statusOpts} /></G>
        <G label="Initials"><Select value={filters.initials} onChange={(v) => set('initials', v)} placeholder="All" options={initialsOpts} /></G>
        <G label="Search">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8"/><path strokeLinecap="round" d="m21 21-4.35-4.35"/>
            </svg>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => set('search', e.target.value)}
              placeholder="Description, initials…"
              className="pl-8 pr-2.5 py-1.5 min-w-[190px] text-sm rounded-xl border bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 outline-none transition-all duration-150 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100/50"
            />
          </div>
        </G>
      </div>
    </div>
  )
}

function G({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</span>
      {children}
    </div>
  )
}

function DateIn({ value, onChange }) {
  return <DateInput value={value} onChange={onChange} className="min-w-[140px]" />
}
