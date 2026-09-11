'use client'

import { useState, useEffect, useMemo } from 'react'
import AppHeader from '@/components/AppHeader'
import HygieneTable from '@/components/HygieneTable'
import HygieneModal from '@/components/HygieneModal'
import Pager from '@/components/Pager'
import ImportModal, { parseFlexDate, fuzzyLocation, parseAmount } from '@/components/ImportModal'
import Select from '@/components/Select'
import DateInput from '@/components/DateInput'
import { HYGIENE_LOCATIONS, DAY_LABELS, HYGIENE_DAYS, shortLocation } from '@/lib/constants'
import { getHygieneRows, saveHygieneRow, deleteHygieneRow, bulkUpsertHygieneRows, summarise } from '@/lib/hygieneStorage'
import { exportHygieneToExcel } from '@/lib/exportHygiene'
import { useProfile } from '@/lib/profileContext'
import { can } from '@/lib/permissions'
import { logActivity } from '@/lib/activityLog'

const ALL = 'All Locations'
const PAGE_SIZE = 20

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const EMPTY_FILTERS = { month: '', year: '', from: '', to: '', day: '' }

function fmtHours(n) {
  const v = Number(n) || 0
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

// Percentage colour, shared by the stat card and the table bands.
function tone(pct) {
  if (pct == null) return 'text-slate-400'
  if (pct >= 90)   return 'text-emerald-600'
  if (pct >= 75)   return 'text-amber-600'
  return 'text-red-600'
}

// Import location matching.
//
// fuzzyLocation returns the FIRST substring match, which is fine when names are
// distinct but dangerous now that two locations begin with "Dentique": a CSV
// saying only "Dentique" would land silently in Downers Grove half the time.
// Ambiguous input must fail loudly and name the options instead.
function resolveHygieneLocation(v) {
  const raw = (v || '').trim()
  if (!raw) return { error: 'Location is required' }
  const lower = raw.toLowerCase()

  const exact = HYGIENE_LOCATIONS.find((l) => l.toLowerCase() === lower)
  if (exact) return { value: exact }

  const candidates = HYGIENE_LOCATIONS.filter((l) => l.toLowerCase().includes(lower))
  if (candidates.length > 1) {
    return { error: `"${raw}" is ambiguous — use ${candidates.map(shortLocation).join(' or ')}` }
  }

  const match = fuzzyLocation(raw, HYGIENE_LOCATIONS)
  return match ? { value: match } : { error: `Location not recognized: "${raw}"` }
}

export default function HygienePage() {
  const profile = useProfile()

  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setError]   = useState('')
  const [selectedLocation, setSelectedLocation] = useState(ALL)
  const [filters, setFilters]   = useState(EMPTY_FILTERS)
  const [sortConfig, setSort]   = useState({ key: 'workDate', dir: 'desc' })
  const [addOpen, setAddOpen]   = useState(false)
  const [importOpen, setImport] = useState(false)
  const [page, setPage]         = useState(1)

  const canEdit   = can(profile, 'hygiene_edit')
  const canAdd    = can(profile, 'hygiene_add')
  const canDelete = can(profile, 'hygiene_delete')
  const canImport = can(profile, 'hygiene_add')

  useEffect(() => {
    getHygieneRows()
      .then(setRows)
      .catch(() => setError('Could not load hygiene utilization. Check your connection and refresh.'))
      .finally(() => setLoading(false))
  }, [])

  // Any filter change invalidates the current page number.
  useEffect(() => { setPage(1) }, [filters, sortConfig, selectedLocation])

  const years = useMemo(() => {
    const set = new Set(rows.map((r) => r.workDate?.slice(0, 4)).filter(Boolean))
    return [...set].sort().reverse()
  }, [rows])

  const filtered = useMemo(() => {
    return rows
      .filter((r) => {
        if (selectedLocation !== ALL && r.location !== selectedLocation) return false
        if (filters.year  && r.workDate?.slice(0, 4) !== filters.year) return false
        if (filters.month && r.workDate?.slice(5, 7) !== filters.month) return false
        if (filters.from  && (!r.workDate || r.workDate < filters.from)) return false
        if (filters.to    && (!r.workDate || r.workDate > filters.to)) return false
        if (filters.day   && String(r.dayNum) !== filters.day) return false
        return true
      })
      .sort((a, b) => {
        const { key, dir } = sortConfig
        let va = a[key] ?? '', vb = b[key] ?? ''
        if (['available', 'utilized', 'pct', 'dayNum'].includes(key)) {
          va = Number(va) || 0; vb = Number(vb) || 0
        }
        if (va < vb) return dir === 'asc' ? -1 : 1
        if (va > vb) return dir === 'asc' ? 1 : -1
        return 0
      })
  }, [rows, selectedLocation, filters, sortConfig])

  const stats = useMemo(() => summarise(filtered), [filtered])

  // Per-location breakdown, only meaningful on the combined view.
  const byLocation = useMemo(() => {
    if (selectedLocation !== ALL) return []
    return HYGIENE_LOCATIONS
      .map((loc) => ({ loc, ...summarise(filtered.filter((r) => r.location === loc)) }))
      .filter((x) => x.available > 0)
      .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
  }, [filtered, selectedLocation])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const activeFilterCount = Object.values(filters).filter(Boolean).length

  function setFilter(key, value) { setFilters((f) => ({ ...f, [key]: value })) }

  async function handleSaveFields(row, patch) {
    const saved = await saveHygieneRow({ ...row, ...patch })
    setRows((prev) => prev.map((r) => (r.id === saved.id ? saved : r)))
    logActivity({
      action: 'update', module: 'Hygiene',
      description: `Edited ${Object.keys(patch).join(', ')} — ${row.location} ${row.workDate}`,
      metadata: { id: row.id, patch, before: Object.fromEntries(Object.keys(patch).map((k) => [k, row[k] ?? null])) },
    })
  }

  async function handleAdd(entry) {
    try {
      const saved = await saveHygieneRow(entry)
      setRows((prev) => [saved, ...prev])
      setAddOpen(false)
      logActivity({
        action: 'create', module: 'Hygiene',
        description: `Added hygiene day — ${saved.location} ${saved.workDate}`,
        metadata: { id: saved.id },
      })
    } catch (e) {
      // The unique index on (location, work_date) is the guard against a day
      // being logged twice and silently doubling that location's capacity.
      alert(String(e?.message || '').includes('duplicate')
        ? 'That location already has an entry for this date. Edit the existing row instead.'
        : 'Failed to save. Check your connection.')
    }
  }

  async function handleImport(entries) {
    const { saved, duplicatesCollapsed } = await bulkUpsertHygieneRows(entries)
    // Upsert means a row may be an update, not an insert — merge by id rather
    // than prepending, or a re-import would show every day twice.
    setRows((prev) => {
      const merged = new Map(prev.map((r) => [r.id, r]))
      saved.forEach((r) => merged.set(r.id, r))
      return [...merged.values()].sort((a, b) => (b.workDate || '').localeCompare(a.workDate || ''))
    })
    logActivity({
      action: 'import', module: 'Hygiene',
      description: `Imported ${saved.length} hygiene day${saved.length === 1 ? '' : 's'}`,
      metadata: { count: saved.length, ids: saved.map((r) => r.id), duplicatesCollapsed },
    })
    return saved
  }

  function handleExport() {
    if (filtered.length === 0) return
    const locationLabel = selectedLocation === ALL ? ALL : shortLocation(selectedLocation)
    exportHygieneToExcel({ rows: filtered, locationLabel, filters, stats })
    logActivity({
      action: 'export', module: 'Hygiene',
      description: `Exported ${filtered.length} hygiene day${filtered.length === 1 ? '' : 's'} — ${locationLabel}`,
      metadata: { count: filtered.length, location: locationLabel, filters },
    })
  }

  async function handleDelete(id) {
    const target = rows.find((r) => r.id === id)
    try {
      await deleteHygieneRow(id)
      setRows((prev) => prev.filter((r) => r.id !== id))
      logActivity({
        action: 'delete', module: 'Hygiene',
        description: `Deleted hygiene day — ${target?.location} ${target?.workDate}`,
        metadata: { id },
      })
    } catch { alert('Failed to delete. Check your connection.') }
  }

  function handleSort(key) {
    setSort((c) => ({ key, dir: c.key === key && c.dir === 'asc' ? 'desc' : 'asc' }))
  }

  if (!profile) return null

  return (
    <div className="min-h-screen futuristic-bg relative">
      <div className="relative z-10">
        <AppHeader />

        {/* Hero + headline numbers */}
        <div className="futuristic-hero">
          <div className="relative w-full px-6 py-10 z-10">
            <div className="max-w-[1600px] mx-auto">
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-indigo-500 text-xs font-semibold uppercase tracking-widest mb-2">Operations</p>
                  <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Hygiene Utilization</h1>
                  <p className="text-slate-500 text-sm mt-1.5">Track hygiene hours available against hours actually used</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {canImport && (
                    <button
                      onClick={() => setImport(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                      Import
                    </button>
                  )}
                  {/* Home lives in AppHeader's breadcrumb on every page — a second
                      Home button down here just duplicated it. Export is the
                      counterpart to Import, matching app/ach/page.js. */}
                  <button
                    onClick={handleExport}
                    disabled={filtered.length === 0}
                    title={filtered.length === 0 ? 'Nothing to export' : 'Export the days currently in view'}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M7.5 7.5 12 3m0 0 4.5 4.5M12 3v13.5" /></svg>
                    Export
                  </button>
                  {canAdd && (
                    <button
                      onClick={() => setAddOpen(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                      Add Entry
                    </button>
                  )}
                </div>
              </div>

              {/* The percentage is the point of the page, so it leads.
                  Capped at max-w-3xl: widening the page to 1600px (for the
                  location tabs) stretched these 4 cards across the whole row,
                  leaving each one mostly empty space around a label and a
                  number. ACH avoids this by having 7 cards fill 1600px — with
                  only 4 here, the fix is to keep the row itself narrower
                  rather than let 4 cards masquerade as 7. */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-7 max-w-3xl mx-auto">
                <Stat label="Utilization" value={stats.pct != null ? `${stats.pct.toFixed(1)}%` : '—'} valueClass={tone(stats.pct)} big />
                <Stat label="Available Hours" value={fmtHours(stats.available)} />
                <Stat label="Utilized Hours" value={fmtHours(stats.utilized)} valueClass="text-emerald-600" />
                <Stat label="Days Logged" value={String(filtered.length)} />
              </div>
            </div>
          </div>
        </div>

        {/* pt-4, not -mt-4: a negative margin pulls this section up INTO the
            hero, and the hero's background edge then cuts a visible seam
            straight through the location tabs. Matches app/ach/page.js. */}
        <div className="w-full px-6 pt-4 pb-16">
          <div className="max-w-[1600px] mx-auto">
          {loadError && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{loadError}</div>
          )}

          {/* Location tabs — same segmented bar as app/ach/page.js and
              app/zero-payments. Full-width flex-1 tabs with dividers and a
              bottom-border indicator, not pills: three pages showing the same
              list of clinics should not each invent their own control. */}
          <div className="glass-card rounded-2xl overflow-hidden mb-4">
            <div className="flex overflow-x-auto divide-x divide-white/40">
              {[{ key: ALL, label: 'All Locations' },
                ...HYGIENE_LOCATIONS.map((l) => ({ key: l, label: shortLocation(l) }))
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setSelectedLocation(key)}
                  className={`flex-1 min-w-[100px] px-4 py-3 text-sm font-medium whitespace-nowrap transition-all border-b-2 ${
                    selectedLocation === key
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-white/50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Filters */}
          <div className="glass-card rounded-2xl px-5 py-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h18l-7 8v6l-4 2v-8z" /></svg>
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Filters</span>
                {activeFilterCount > 0 && (
                  <span className="badge text-[10px] bg-indigo-100 text-indigo-700 border border-indigo-200">{activeFilterCount}</span>
                )}
              </div>
              {activeFilterCount > 0 && (
                <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                  Clear all
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-3 items-end">
              <Field label="Month">
                <Select value={filters.month} onChange={(v) => setFilter('month', v)} placeholder="All months"
                  options={MONTHS.map((m, i) => ({ value: String(i + 1).padStart(2, '0'), label: m }))} />
              </Field>
              <Field label="Year">
                <Select value={filters.year} onChange={(v) => setFilter('year', v)} placeholder="All years"
                  options={years.map((y) => ({ value: y, label: y }))} />
              </Field>
              <Field label="Day">
                <Select value={filters.day} onChange={(v) => setFilter('day', v)} placeholder="All days"
                  options={HYGIENE_DAYS.map((d) => ({ value: String(d), label: DAY_LABELS[d] }))} />
              </Field>
              <Field label="Start date">
                <DateInput value={filters.from} onChange={(iso) => setFilter('from', iso || '')} title="Start date" />
              </Field>
              <Field label="End date">
                <DateInput value={filters.to} onChange={(iso) => setFilter('to', iso || '')} title="End date" />
              </Field>
            </div>
          </div>

          {/* Per-location ranking — only useful when several are in view. */}
          {byLocation.length > 1 && (
            <div className="glass-card rounded-2xl px-5 py-4 mb-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3">Utilization by location</p>
              <div className="space-y-2.5">
                {byLocation.map(({ loc, pct, utilized, available }) => (
                  <div key={loc} className="flex items-center gap-3">
                    <span className="text-xs text-slate-600 w-28 shrink-0 truncate" title={loc}>
                      {shortLocation(loc)}
                    </span>
                    <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${pct >= 90 ? 'bg-emerald-500' : pct >= 75 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }}
                      />
                    </div>
                    <span className={`text-xs font-semibold tabular-nums w-14 text-right ${tone(pct)}`}>
                      {pct != null ? `${pct.toFixed(1)}%` : '—'}
                    </span>
                    <span className="text-[11px] text-slate-400 tabular-nums w-24 text-right hidden sm:block">
                      {fmtHours(utilized)} / {fmtHours(available)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <Pager page={page} totalPages={totalPages} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />
            <HygieneTable
              rows={paged}
              loading={loading}
              sortConfig={sortConfig}
              onSort={handleSort}
              onSaveFields={handleSaveFields}
              onDelete={handleDelete}
              canEdit={canEdit}
              canDelete={canDelete}
              onAdd={canAdd ? () => setAddOpen(true) : undefined}
              onImport={canImport ? () => setImport(true) : undefined}
            />
            <Pager page={page} totalPages={totalPages} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />
          </div>
          </div>
        </div>
      </div>

      {addOpen && <HygieneModal onSave={handleAdd} onClose={() => setAddOpen(false)} />}

      {importOpen && (
        <ImportModal
          title="Import Hygiene Utilization"
          subtitle="Paste or upload a CSV. Day and % fill in automatically. A row whose location and date already exist will be updated, not duplicated."
          locationOptions={HYGIENE_LOCATIONS}
          onClose={() => setImport(false)}
          onImport={handleImport}
          columns={[
            { key: 'location', label: 'location', required: true, example: 'Romeoville',
              aliases: ['location', 'clinic', 'office', 'site', 'practice', 'branch'],
              validate: (v) => resolveHygieneLocation(v).error || null,
              transform: (v) => resolveHygieneLocation(v).value || v },
            { key: 'workDate', label: 'date', required: true, example: '09/14/2026',
              aliases: ['date', 'workdate', 'work_date', 'day date', 'shiftdate', 'scheduledate', 'postingdate'],
              validate: (v) => parseFlexDate(v) ? null : 'Cannot parse date — try MM/DD/YYYY',
              transform: (v) => parseFlexDate(v) },
            { key: 'hours', label: 'hours', required: false, example: '8:00 AM - 5:00 PM',
              aliases: ['hours', 'shift', 'shifthours', 'schedule', 'timings', 'time', 'window'] },
            { key: 'available', label: 'available', required: true, example: '8',
              aliases: ['available', 'availablehours', 'available_hours', 'capacity', 'scheduled', 'openhours'],
              validate: (v) => isNaN(parseAmount(v)) ? 'available must be a number' : null,
              transform: (v) => parseAmount(v) },
            { key: 'utilized', label: 'utilized', required: true, example: '7',
              aliases: ['utilized', 'utilised', 'used', 'utilizedhours', 'used_hours', 'booked', 'filled', 'actual'],
              validate: (v) => isNaN(parseAmount(v)) ? 'utilized must be a number' : null,
              transform: (v) => parseAmount(v) },
            { key: 'notes', label: 'notes', required: false, example: 'Hygienist out PM',
              aliases: ['notes', 'note', 'comment', 'comments', 'remarks'] },
          ]}
          // Percentage columns in the source file are ignored on purpose: the
          // database computes it, so an imported value could contradict the data.
          excludeRow={(entry) => {
            const a = Number(entry.available), u = Number(entry.utilized)
            if (Number.isFinite(a) && Number.isFinite(u) && a > 0 && u > a) {
              return 'Utilized is greater than available'
            }
            if (Number.isFinite(a) && a <= 0) return 'Available hours is zero'
            return null
          }}
        />
      )}
    </div>
  )
}

function Stat({ label, value, valueClass = 'text-slate-900', big }) {
  return (
    <div className="glass-card rounded-2xl px-5 py-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`${big ? 'text-3xl' : 'text-2xl'} font-bold mt-1 tabular-nums ${valueClass}`}>{value}</p>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">{label}</p>
      {children}
    </div>
  )
}
