'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import {
  LOCATIONS,
  getCollections, setCollections,
  getExpEntries, saveExpEntry, deleteExpEntry,
  bulkInsertExpEntries,
  getVendors, addVendorToDB, deleteVendorFromDB,
} from '@/lib/expenditureStorage'
import CollectionsModal from '@/components/CollectionsModal'
import ExpEntryModal from '@/components/ExpEntryModal'
import ImportModal, { parseFlexDate, fuzzyLocation, parseAmount } from '@/components/ImportModal'
import { logActivity } from '@/lib/activityLog'
import { useProfile } from '@/lib/profileContext'
import { can } from '@/lib/permissions'
import DateInput from '@/components/DateInput'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const VENDOR_COLORS = ['#8b5cf6','#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#f97316','#14b8a6','#e11d48','#84cc16']

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
function monthLabel(key) {
  if (!key) return ''
  const [y, m] = key.split('-')
  return `${MONTHS[Number(m) - 1]} ${y}`
}
function monthLabelShort(key) {
  if (!key) return ''
  const [y, m] = key.split('-')
  return `${MONTHS_SHORT[Number(m) - 1]} '${String(y).slice(2)}`
}
function prevMonth(key) {
  const [y, m] = key.split('-').map(Number)
  if (m === 1) return `${y - 1}-12`
  return `${y}-${String(m - 1).padStart(2, '0')}`
}
function shortName(loc) {
  if (loc === 'Valley View Dental Romeoville') return 'Romeoville'
  if (loc === 'Valley View Dental Naperville') return 'Naperville'
  if (loc === 'Valley View Dental Montgomery') return 'Montgomery'
  return loc
}
function fmt(n) {
  const num = Number(n) || 0
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(val) {
  if (!val) return '—'
  const [y, m, d] = val.split('-')
  return `${m}/${d}/${y}`
}

const darkCard = 'glass-card rounded-2xl'
const iCell = 'w-full px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100/50 transition-all'

const EMPTY_ROW = { date: '', person: '', vendor: '', description: '', amount: '' }

function EditRow({ row, onChange, onSave, onCancel, saving, vendors = [], onAddVendor }) {
  const [addingVendor, setAddingVendor] = useState(false)
  const [newVendorName, setNewVendorName] = useState('')

  function confirmNewVendor() {
    const name = newVendorName.trim()
    if (!name) return
    onAddVendor?.(name)
    onChange('vendor', name)
    setNewVendorName('')
    setAddingVendor(false)
  }

  return (
    <tr className="border-b border-violet-300/50 bg-violet-50/60">
      <td className="px-4 py-2"><DateInput value={row.date || ''} onChange={(iso) => onChange('date', iso)} /></td>
      <td className="px-4 py-2"><input type="text" value={row.person || ''} onChange={(e) => onChange('person', e.target.value)} placeholder="Name…" className={iCell} style={{ minWidth: 110 }} /></td>
      <td className="px-4 py-2">
        {addingVendor ? (
          <div className="flex gap-1">
            <input type="text" value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmNewVendor() } if (e.key === 'Escape') { setAddingVendor(false); setNewVendorName('') } }}
              placeholder="Vendor name…" className={iCell} style={{ minWidth: 110 }} autoFocus />
            <button type="button" onClick={confirmNewVendor} className="px-2 py-1 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition-all">Add</button>
            <button type="button" onClick={() => { setAddingVendor(false); setNewVendorName('') }} className="px-2 py-1 text-xs text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all">✕</button>
          </div>
        ) : (
          <select value={row.vendor || ''} onChange={(e) => { if (e.target.value === '__add__') { setAddingVendor(true); return } onChange('vendor', e.target.value) }}
            className={`${iCell} appearance-none cursor-pointer`} style={{ minWidth: 130 }}>
            <option value="">— Vendor —</option>
            {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
            <option value="__add__">+ Add new vendor…</option>
          </select>
        )}
      </td>
      <td className="px-4 py-2"><input type="text" value={row.description || ''} onChange={(e) => onChange('description', e.target.value)} placeholder="Item / description…" className={iCell} style={{ minWidth: 200 }} /></td>
      <td className="px-4 py-2"><input type="number" step="0.01" min="0" value={row.amount || ''} onChange={(e) => onChange('amount', e.target.value)} onWheel={(e) => e.target.blur()} placeholder="0.00" className={iCell} style={{ minWidth: 90 }} /></td>
      <td className="px-4 py-2">
        <div className="flex gap-1.5">
          <button onClick={onSave} disabled={saving || !row.date || !row.person || row.amount === ''} className="px-2.5 py-1 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-lg disabled:opacity-40 transition-all whitespace-nowrap">{saving ? '…' : 'Save'}</button>
          <button onClick={onCancel} className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all">✕</button>
        </div>
      </td>
    </tr>
  )
}


export default function ExpenditurePage() {
  const profile        = useProfile()
  const searchParams   = useSearchParams()
  const highlightId    = searchParams.get('highlight')
  const highlightDone  = useRef(false)

  const now = new Date()
  const currentKey = monthKey(now)

  const [entries, setEntries] = useState([])
  const [collections, setCollectionsState] = useState({})
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState(currentKey)
  const [pickerYear, setPickerYear] = useState(now.getFullYear())
  const [selectedLocation, setSelectedLocation] = useState(LOCATIONS[0])

  const [vendors, setVendors] = useState([])
  const [manageVendorsModal, setManageVendorsModal] = useState(false)
  const [newVendorInput, setNewVendorInput] = useState('')

  async function addVendor(name) {
    if (vendors.includes(name)) return
    try {
      await addVendorToDB(name)
      setVendors((prev) => [...prev, name].sort((a, b) => a.localeCompare(b)))
    } catch { alert('Failed to add vendor.') }
  }

  async function removeVendor(name) {
    try {
      await deleteVendorFromDB(name)
      setVendors((prev) => prev.filter((v) => v !== name))
    } catch { alert('Failed to remove vendor.') }
  }

  const [modal, setModal] = useState(false)
  const [collModal, setCollModal] = useState(false)
  const [vendorModal, setVendorModal] = useState(false)
  const [vendorModalLocations, setVendorModalLocations] = useState([]) // empty = All Locations
  const [vendorAnalysisFilter, setVendorAnalysisFilter] = useState([])
  const [vendorAnalysisFilterOpen, setVendorAnalysisFilterOpen] = useState(false)
  const vendorAnalysisFilterRef = useRef(null)
  const [vendorDatePreset, setVendorDatePreset] = useState('6m')
  const [vendorCustomFrom, setVendorCustomFrom] = useState('')
  const [vendorCustomTo, setVendorCustomTo] = useState('')
  const [vendorPage, setVendorPage] = useState(1)
  const VENDOR_PAGE_SIZE = 10
  const [importModal, setImportModal] = useState(false)
  const [confirmId, setConfirmId] = useState(null)

  const [editingId, setEditingId] = useState(null)
  const [editRow, setEditRow] = useState(EMPTY_ROW)
  const [saving, setSaving] = useState(false)
  const [expPage, setExpPage] = useState(1)
  useEffect(() => { setExpPage(1) }, [selectedMonth, selectedLocation])

  useEffect(() => {
    if (!vendorAnalysisFilterOpen) return
    function handleClick(e) {
      if (vendorAnalysisFilterRef.current && !vendorAnalysisFilterRef.current.contains(e.target)) setVendorAnalysisFilterOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [vendorAnalysisFilterOpen])

  useEffect(() => {
    Promise.all([getExpEntries(), getCollections(), getVendors()])
      .then(([e, c, v]) => { setEntries(e); setCollectionsState(c); setVendors(v) })
      .catch((e) => console.error('Failed to load data:', e))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!highlightId || entries.length === 0 || highlightDone.current) return
    highlightDone.current = true
    const entry = entries.find((e) => e.id === highlightId)
    if (!entry) return
    if (entry.clinic) setSelectedLocation(entry.clinic)
    if (entry.date) setSelectedMonth(entry.date.slice(0, 7))
    const sorted = [...entries.filter((e) => e.clinic === (entry.clinic || LOCATIONS[0]))]
      .sort((a, b) => b.date.localeCompare(a.date))
    const idx = sorted.findIndex((e) => e.id === highlightId)
    if (idx !== -1) setExpPage(Math.floor(idx / 20) + 1)
    setTimeout(() => {
      const el = document.getElementById(`exp-row-${highlightId}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 400)
  }, [entries, highlightId])

  const prevKey = prevMonth(selectedMonth)

  // Pre-group entries by "month|clinic" for O(1) spend lookups
  const spendMap = useMemo(() => {
    const map = {}
    entries.forEach((e) => {
      const k = `${monthKey(new Date(e.date))}|${e.clinic}`
      map[k] = (map[k] ?? 0) + Number(e.amount || 0)
    })
    return map
  }, [entries])

  // Walk all months with data chronologically and chain carry-over forward
  function computeBudget(loc, targetMonth) {
    const months = [...new Set([
      ...Object.keys(collections),
      ...entries.filter((e) => e.clinic === loc).map((e) => monthKey(new Date(e.date))),
    ])].filter((m) => m < targetMonth).sort()

    let carry = 0
    for (const m of months) {
      const mBase = (collections[prevMonth(m)]?.[loc] ?? 0) * 0.06
      if (mBase === 0) continue
      const mEffective = Math.max(0, mBase + carry)
      const mSpent = spendMap[`${m}|${loc}`] ?? 0
      carry = mEffective - mSpent
    }

    const base = (collections[prevMonth(targetMonth)]?.[loc] ?? 0) * 0.06
    const effective = base > 0 ? Math.max(0, base + carry) : 0
    return { base, effective, carry }
  }

  const { base: baseBudget, effective: budget, carry: carryOver } = computeBudget(selectedLocation, selectedMonth)
  const prevCollections = collections[prevKey]?.[selectedLocation] ?? 0

  const locationEntries = useMemo(() =>
    entries.filter((e) => monthKey(new Date(e.date)) === selectedMonth && e.clinic === selectedLocation),
    [entries, selectedMonth, selectedLocation]
  )

  const totalSpent = locationEntries.reduce((s, e) => s + Number(e.amount || 0), 0)
  const remaining  = budget - totalSpent
  const pct        = budget > 0 ? Math.min((totalSpent / budget) * 100, 100) : 0
  const overBudget = totalSpent > budget && budget > 0

  const pickerYears = Array.from({ length: 6 }, (_, i) => now.getFullYear() - 3 + i)

  const vendorDateRange = useMemo(() => {
    const now = new Date()
    if (vendorDatePreset === '1m') {
      const y = now.getFullYear(), mo = String(now.getMonth() + 1).padStart(2, '0')
      return { from: `${y}-${mo}-01`, to: null }
    }
    if (vendorDatePreset === '3m') {
      const d = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())
      return { from: d.toISOString().slice(0, 10), to: null }
    }
    if (vendorDatePreset === '6m') {
      const d = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate())
      return { from: d.toISOString().slice(0, 10), to: null }
    }
    if (vendorDatePreset === '1y') {
      const d = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
      return { from: d.toISOString().slice(0, 10), to: null }
    }
    if (vendorDatePreset === 'custom') return { from: vendorCustomFrom || null, to: vendorCustomTo || null }
    return { from: null, to: null }
  }, [vendorDatePreset, vendorCustomFrom, vendorCustomTo])

  const vendorTableData = useMemo(() => {
    const filtered = entries.filter((e) => {
      if (vendorModalLocations.length > 0 && !vendorModalLocations.includes(e.clinic)) return false
      if (vendorDateRange.from && e.date < vendorDateRange.from) return false
      if (vendorDateRange.to && e.date > vendorDateRange.to) return false
      return true
    })
    const map = {}
    filtered.forEach((e) => {
      const v = e.vendor || 'Unspecified'
      if (!map[v]) map[v] = { vendor: v, total: 0, count: 0, monthSet: new Set() }
      map[v].total += Number(e.amount || 0)
      map[v].count++
      map[v].monthSet.add(monthKey(new Date(e.date)))
    })
    const rows = Object.values(map)
      .map(({ vendor, total, count, monthSet }) => ({ vendor, total, count, months: monthSet.size, avg: monthSet.size > 0 ? total / monthSet.size : 0 }))
      .sort((a, b) => b.total - a.total)
    const grandTotal = rows.reduce((s, r) => s + r.total, 0)
    return { rows, grandTotal }
  }, [entries, vendorModalLocations, vendorDateRange])

  async function handleNewEntry(formData) {
    try {
      const saved = await saveExpEntry({ ...formData, id: undefined })
      setEntries((prev) => [saved, ...prev])
      setModal(false)
      logActivity({ action: 'create', module: 'Supply Budget', description: `Added expense — $${Number(formData.amount || 0).toLocaleString()}, ${formData.vendor || 'N/A'}, ${formData.clinic || selectedLocation}`, metadata: { id: saved.id, amount: formData.amount, vendor: formData.vendor, clinic: formData.clinic } })
    } catch { alert('Failed to save. Check your connection.') }
  }

  function startEdit(entry) {
    setEditingId(entry.id)
    setEditRow({ date: entry.date, person: entry.person, vendor: entry.vendor || '', description: entry.description, amount: String(entry.amount ?? '') })
  }
  function cancelEdit() { setEditingId(null); setEditRow(EMPTY_ROW) }
  function changeEditRow(key, val) { setEditRow((prev) => ({ ...prev, [key]: val })) }

  async function saveEdit() {
    if (!editRow.date || !editRow.person || editRow.amount === '') return
    setSaving(true)
    try {
      const saved = await saveExpEntry({ id: editingId, date: editRow.date, person: editRow.person, vendor: editRow.vendor, description: editRow.description, amount: Number(editRow.amount), clinic: selectedLocation })
      setEntries((prev) => prev.map((e) => e.id === saved.id ? saved : e))
      cancelEdit()
      logActivity({ action: 'update', module: 'Supply Budget', description: `Edited expense — $${Number(editRow.amount).toLocaleString()}, ${editRow.vendor || 'N/A'}, ${selectedLocation}`, metadata: { id: editingId, amount: editRow.amount, vendor: editRow.vendor } })
    } catch { alert('Failed to save. Check your connection.') } finally { setSaving(false) }
  }

  async function handleDelete(id) {
    try {
      await deleteExpEntry(id)
      setEntries((prev) => prev.filter((e) => e.id !== id))
      setConfirmId(null)
      logActivity({ action: 'delete', module: 'Supply Budget', description: 'Deleted expense entry', metadata: { id } })
    } catch { alert('Failed to delete. Check your connection.') }
  }

  async function handleSaveCollections(data) {
    await setCollections(data); setCollectionsState(data); setCollModal(false)
  }

  const sortedEntries = locationEntries.slice().sort((a, b) => b.date.localeCompare(a.date))
  const EXP_PAGE_SIZE = 20
  const expTotalPages = Math.max(1, Math.ceil(sortedEntries.length / EXP_PAGE_SIZE))
  const pagedEntries = sortedEntries.slice((expPage - 1) * EXP_PAGE_SIZE, expPage * EXP_PAGE_SIZE)

  return (
    <div className="min-h-screen futuristic-bg relative">

      <div className="relative z-10">
        <AppHeader />

        {/* ── Hero ── */}
        <div className="futuristic-hero">
          <div className="max-w-screen-xl mx-auto px-6 py-8">

            {/* Title row */}
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="text-violet-600 text-xs font-semibold uppercase tracking-widest mb-1">Budget</p>
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Supply Budget</h1>
                <p className="text-slate-500 text-sm mt-1">Clinic supply spending · 6% of last month's collections</p>
              </div>
              <div className="flex gap-2 shrink-0 pt-1 flex-wrap justify-end">
                {can(profile, 'set_collections') && (
                  <button onClick={() => setCollModal(true)} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75"/></svg>
                    Set Collections
                  </button>
                )}
                <button onClick={() => setVendorModal(true)} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"/></svg>
                  Vendor Analysis
                </button>
                <button onClick={() => setManageVendorsModal(true)} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>
                  Manage Vendors
                </button>
                {can(profile, 'budget_import') && (
                  <button onClick={() => setImportModal(true)} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>
                    Import
                  </button>
                )}
                {can(profile, 'budget_add') && (
                  <button onClick={() => setModal(true)} disabled={editingId !== null} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-violet-500 hover:bg-violet-400 rounded-xl transition-all shadow-lg shadow-violet-900/30 active:scale-[0.98] disabled:opacity-50">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
                    Log Expense
                  </button>
                )}
              </div>
            </div>

            {/* Viewing picker */}
            <div className="mt-6">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-2">Viewing</p>
              <div className="inline-flex flex-col gap-2 glass-card rounded-2xl p-3">
                <div className="flex gap-1">
                  {pickerYears.map((y) => (
                    <button key={y} onClick={() => setPickerYear(y)} className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${pickerYear === y ? 'bg-violet-100 text-violet-700 border border-violet-300' : 'text-slate-500 hover:text-slate-700 hover:bg-violet-50/60'}`}>{y}</button>
                  ))}
                </div>
                <div className="grid grid-cols-6 gap-1">
                  {MONTHS_SHORT.map((name, i) => {
                    const key = `${pickerYear}-${String(i + 1).padStart(2, '0')}`
                    const isFuture = key > currentKey
                    const isSelected = key === selectedMonth
                    return (
                      <button key={key} disabled={isFuture} onClick={() => { setSelectedMonth(key); cancelEdit() }}
                        className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all ${isSelected ? 'bg-violet-500 text-white shadow-lg shadow-violet-200' : isFuture ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:text-slate-900 hover:bg-violet-50'}`}>
                        {name}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Budget summary */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
              <div className={`${darkCard} p-4`}>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Collections · {monthLabel(prevKey)}</p>
                <p className="text-xl font-bold text-slate-900 tabular-nums">{fmt(prevCollections)}</p>
                <p className="text-xs text-slate-500 mt-0.5">{shortName(selectedLocation)}</p>
              </div>
              <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-600 mb-1">Monthly Budget</p>
                <p className="text-xl font-bold text-violet-700 tabular-nums">{fmt(budget)}</p>
                {budget === 0 && baseBudget === 0
                  ? <p className="text-xs text-violet-400 mt-0.5">Set collections to calculate</p>
                  : <div className="flex flex-col gap-0.5 mt-1">
                      <p className="text-xs text-violet-500">6% base: <span className="tabular-nums">{fmt(baseBudget)}</span></p>
                      {carryOver > 0 && <p className="text-xs text-emerald-600">+ {fmt(carryOver)} surplus carried in</p>}
                      {carryOver < 0 && <p className="text-xs text-red-600">− {fmt(Math.abs(carryOver))} overspend carried in</p>}
                    </div>
                }
              </div>
              <div className={`p-4 rounded-2xl border ${overBudget ? 'bg-red-50 border-red-200' : budget > 0 && remaining / budget < 0.2 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
                <p className={`text-[10px] font-semibold uppercase tracking-widest mb-1 ${overBudget ? 'text-red-600' : budget > 0 && remaining / budget < 0.2 ? 'text-amber-600' : 'text-emerald-600'}`}>{overBudget ? 'Over Budget' : 'Remaining'}</p>
                <p className={`text-xl font-bold tabular-nums ${overBudget ? 'text-red-700' : budget > 0 && remaining / budget < 0.2 ? 'text-amber-700' : 'text-emerald-700'}`}>{overBudget ? '-' : ''}{fmt(Math.abs(remaining))}</p>
                <p className="text-xs mt-0.5 text-slate-500 tabular-nums">{fmt(totalSpent)} spent of {fmt(budget)}</p>
              </div>
            </div>

            {budget > 0 && (
              <div className="mt-3">
                <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                  <span>Budget utilisation — {shortName(selectedLocation)}</span>
                  <span className={`font-semibold tabular-nums ${overBudget ? 'text-red-400' : pct > 80 ? 'text-amber-400' : 'text-slate-400'}`}>{pct.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-700 ${overBudget ? 'bg-red-500' : pct > 80 ? 'bg-amber-400' : 'bg-violet-500'}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}

            {!budget && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2.5">
                <span className="text-base shrink-0">💡</span>
                <p className="text-xs text-amber-700">Click <strong className="text-amber-700 font-semibold">Set Collections</strong> to enter {monthLabel(prevKey)}'s revenue and calculate the 6% budget.</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Main content ── */}
        <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-4">

          {/* Location tabs */}
          <div className={`${darkCard} overflow-hidden`}>
            <div className="flex overflow-x-auto divide-x divide-slate-200/60">
              {LOCATIONS.map((loc) => {
                const isActive = loc === selectedLocation
                const { effective: locBudget } = computeBudget(loc, selectedMonth)
                const locSpent = spendMap[`${selectedMonth}|${loc}`] ?? 0
                const locOver  = locBudget > 0 && locSpent > locBudget
                const locPct   = locBudget > 0 ? Math.min((locSpent / locBudget) * 100, 100) : 0
                return (
                  <button key={loc} onClick={() => { setSelectedLocation(loc); cancelEdit() }}
                    className={`flex-1 min-w-[130px] px-4 py-4 text-sm font-medium transition-all text-center border-b-2 ${isActive ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-transparent text-slate-500 hover:bg-violet-50/50 hover:text-slate-700'}`}>
                    <div className="font-semibold text-sm">{shortName(loc)}</div>
                    {locBudget > 0 ? (
                      <>
                        <div className={`text-[10px] font-medium mt-0.5 ${locOver ? 'text-red-400' : 'text-slate-500'}`}>{locOver ? '⚠ Over budget' : `${fmt(locSpent)} / ${fmt(locBudget)}`}</div>
                        <div className="mt-2 h-1 bg-slate-200 rounded-full overflow-hidden mx-2">
                          <div className={`h-full rounded-full transition-all duration-500 ${locOver ? 'bg-red-400' : locPct > 80 ? 'bg-amber-400' : 'bg-violet-400'}`} style={{ width: `${locPct}%` }} />
                        </div>
                      </>
                    ) : <div className="text-[10px] text-slate-400 mt-0.5">No collections</div>}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Expenses table */}
          <div className={`${darkCard} overflow-hidden`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/40">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">{shortName(selectedLocation)}</span>
                <span className="text-slate-300">·</span>
                <span className="text-sm text-slate-500">{monthLabel(selectedMonth)}</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-semibold ml-1">{locationEntries.length}</span>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16 gap-3">
                <div className="w-6 h-6 border-2 border-violet-500/30 border-t-violet-400 rounded-full animate-spin" />
                <span className="text-sm text-slate-400">Loading…</span>
              </div>
            ) : sortedEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
                  <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75"/></svg>
                </div>
                <p className="text-sm font-medium text-slate-400">No expenses logged</p>
                <p className="text-xs text-slate-400 mt-1">{shortName(selectedLocation)} · {monthLabel(selectedMonth)}</p>
              </div>
            ) : (
              <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      {['Date','Person'].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">{h}</th>
                      ))}
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">Vendor</th>
                      {['Item / Description','Amount',''].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedEntries.map((e) => {
                      if (editingId === e.id) return <EditRow key={e.id} row={editRow} onChange={changeEditRow} onSave={saveEdit} onCancel={cancelEdit} saving={saving} vendors={vendors} onAddVendor={addVendor} />
                      return (
                        <tr key={e.id} id={`exp-row-${e.id}`} className={`group/row border-b border-slate-100 last:border-0 transition-colors ${e.id === highlightId ? 'bg-amber-50 ring-1 ring-inset ring-amber-200' : 'hover:bg-violet-50/40'}`}>
                          <td className="px-5 py-3.5 whitespace-nowrap text-slate-500 tabular-nums text-xs">{fmtDate(e.date)}</td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center text-[10px] font-bold text-white shrink-0">{e.person?.charAt(0).toUpperCase()}</div>
                              <span className="font-semibold text-slate-800 text-sm">{e.person}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 max-w-[140px] truncate text-xs text-slate-600" title={e.vendor}>{e.vendor || <span className="text-slate-300">—</span>}</td>
                          <td className="px-5 py-3.5 text-slate-500 max-w-[220px] truncate text-xs" title={e.description}>{e.description || '—'}</td>
                          <td className="px-5 py-3.5 font-bold text-slate-900 tabular-nums">{fmt(e.amount)}</td>
                          <td className="px-5 py-3.5">
                            <div className="flex gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                              {can(profile, 'budget_edit') && <button onClick={() => startEdit(e)} className="p-1.5 rounded-lg hover:bg-violet-100 text-slate-400 hover:text-violet-600 transition-colors"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931zm0 0L19.5 7.125"/></svg></button>}
                              {can(profile, 'budget_delete') && <button onClick={() => setConfirmId(e.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg></button>}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {expTotalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/40">
                  <span className="text-xs text-slate-500">
                    {((expPage - 1) * EXP_PAGE_SIZE + 1).toLocaleString()}–{Math.min(expPage * EXP_PAGE_SIZE, sortedEntries.length).toLocaleString()} of {sortedEntries.length.toLocaleString()} entries
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setExpPage((p) => p - 1)} disabled={expPage === 1}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5"/></svg>
                      Prev
                    </button>
                    <span className="px-3 text-xs text-slate-500 tabular-nums">Page {expPage} of {expTotalPages}</span>
                    <button onClick={() => setExpPage((p) => p + 1)} disabled={expPage === expTotalPages}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                      Next
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg>
                    </button>
                  </div>
                </div>
              )}
              </>
            )}
          </div>
        </div>

        {/* ── Vendor Analysis Modal ── */}
        {vendorModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { setVendorModal(false); setVendorAnalysisFilter([]); setVendorAnalysisFilterOpen(false) }} />
            <div className="relative bg-white border border-violet-200/60 rounded-2xl shadow-2xl w-full max-w-3xl z-10 overflow-hidden flex flex-col" style={{ maxHeight: '90vh' }}>

              {/* Header */}
              <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 shrink-0">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Vendor Spending Analysis</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Ranked by total spend · {vendorModalLocations.length === 0 ? 'All Locations' : vendorModalLocations.map(shortName).join(', ')}</p>
                </div>
                <button onClick={() => { setVendorModal(false); setVendorAnalysisFilter([]); setVendorAnalysisFilterOpen(false) }} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>
                </button>
              </div>

              {/* Location tabs + Date filters */}
              <div className="px-6 pt-4 pb-3 border-b border-slate-200 space-y-3 shrink-0">
                {/* Location pills — multi-select, empty = All */}
                <div className="flex gap-1 flex-wrap">
                  <button onClick={() => { setVendorModalLocations([]); setVendorPage(1) }}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all border ${vendorModalLocations.length === 0 ? 'bg-violet-100 text-violet-700 border-violet-300' : 'text-slate-500 border-transparent hover:text-slate-700 hover:bg-violet-50'}`}>
                    All Locations
                  </button>
                  {LOCATIONS.map((loc) => (
                    <button key={loc} onClick={() => {
                      setVendorModalLocations((prev) => prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc])
                      setVendorPage(1)
                    }}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all border ${vendorModalLocations.includes(loc) ? 'bg-violet-100 text-violet-700 border-violet-300' : 'text-slate-500 border-transparent hover:text-slate-700 hover:bg-violet-50'}`}>
                      {shortName(loc)}
                    </button>
                  ))}
                </div>

                {/* Date preset pills + custom range */}
                <div className="flex gap-1.5 flex-wrap items-center">
                  {[
                    { id: '1m', label: 'This Month' },
                    { id: '3m', label: 'Last 3 Months' },
                    { id: '6m', label: 'Last 6 Months' },
                    { id: '1y', label: 'Last 12 Months' },
                    { id: 'all', label: 'All Time' },
                    { id: 'custom', label: 'Custom Range' },
                  ].map(({ id, label }) => (
                    <button key={id} onClick={() => { setVendorDatePreset(id); setVendorPage(1) }}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-all border ${vendorDatePreset === id ? 'bg-violet-100 text-violet-700 border-violet-300' : 'text-slate-600 border-slate-200 hover:text-slate-700 hover:bg-violet-50'}`}>
                      {label}
                    </button>
                  ))}
                  {vendorDatePreset === 'custom' && (
                    <div className="flex items-center gap-1.5 ml-1">
                      <DateInput value={vendorCustomFrom} onChange={setVendorCustomFrom} />
                      <span className="text-slate-400 text-xs">→</span>
                      <DateInput value={vendorCustomTo} onChange={setVendorCustomTo} />
                    </div>
                  )}
                </div>
              </div>

              {/* Table */}
              <div className="overflow-y-auto flex-1">
                {vendorTableData.rows.length === 0 ? (
                  <div className="flex items-center justify-center py-16 text-slate-500 text-sm">No data for this period</div>
                ) : (
                  <>
                  <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 bg-white z-10">
                      <tr className="border-b border-slate-100">
                        <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500 w-10">#</th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                          <div className="relative flex items-center gap-1.5" ref={vendorAnalysisFilterRef}>
                            <span>Vendor</span>
                            <button onClick={() => setVendorAnalysisFilterOpen((v) => !v)}
                              className={`p-0.5 rounded transition-colors ${vendorAnalysisFilter.length > 0 ? 'text-violet-600' : 'text-slate-400 hover:text-slate-600'}`}>
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 0 1 .628.74v2.288a2.25 2.25 0 0 1-.659 1.59l-4.682 4.683a2.25 2.25 0 0 0-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 0 1 8 18.25v-5.757a2.25 2.25 0 0 0-.659-1.591L2.659 6.22A2.25 2.25 0 0 1 2 4.629V2.34a.75.75 0 0 1 .628-.74Z" clipRule="evenodd"/></svg>
                            </button>
                            {vendorAnalysisFilter.length > 0 && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-semibold">{vendorAnalysisFilter.length}</span>
                            )}
                            {vendorAnalysisFilterOpen && (
                              <div className="absolute top-full left-0 mt-1 w-52 bg-white border border-slate-200 rounded-xl shadow-xl z-30 overflow-hidden">
                                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
                                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Filter by vendor</span>
                                  {vendorAnalysisFilter.length > 0 && (
                                    <button onClick={() => { setVendorAnalysisFilter([]); setVendorPage(1) }} className="text-[10px] text-violet-600 hover:text-violet-500 font-semibold">Clear</button>
                                  )}
                                </div>
                                <div className="max-h-52 overflow-y-auto py-1">
                                  {vendorTableData.rows.map((r) => (
                                    <label key={r.vendor} className="flex items-center gap-2.5 px-3 py-2 hover:bg-violet-50 cursor-pointer">
                                      <input type="checkbox" checked={vendorAnalysisFilter.includes(r.vendor)}
                                        onChange={() => { setVendorAnalysisFilter((prev) => prev.includes(r.vendor) ? prev.filter((x) => x !== r.vendor) : [...prev, r.vendor]); setVendorPage(1) }}
                                        className="w-3.5 h-3.5 rounded accent-violet-600" />
                                      <span className="text-xs text-slate-700 truncate">{r.vendor}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </th>
                        <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-slate-500">Total Spent</th>
                        <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-slate-500">Entries</th>
                        <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-slate-500">Avg / Month</th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500 min-w-[140px]">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(vendorAnalysisFilter.length > 0 ? vendorTableData.rows.filter((r) => vendorAnalysisFilter.includes(r.vendor)) : vendorTableData.rows).slice((vendorPage - 1) * VENDOR_PAGE_SIZE, vendorPage * VENDOR_PAGE_SIZE).map((row, i) => {
                        const globalIdx = (vendorPage - 1) * VENDOR_PAGE_SIZE + i
                        const pct = vendorTableData.grandTotal > 0 ? (row.total / vendorTableData.grandTotal) * 100 : 0
                        const color = VENDOR_COLORS[globalIdx % VENDOR_COLORS.length]
                        return (
                          <tr key={row.vendor} className="border-b border-slate-100 last:border-0 hover:bg-violet-50/30 transition-colors">
                            <td className="px-5 py-3.5 text-xs font-bold text-slate-600 tabular-nums">{globalIdx + 1}</td>
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2.5">
                                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                                <span className="font-semibold text-slate-800 text-sm">{row.vendor}</span>
                                {globalIdx === 0 && <span className="text-[10px] font-bold text-violet-700 bg-violet-100 border border-violet-300 px-1.5 py-0.5 rounded-md">Top</span>}
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-right font-bold text-slate-900 tabular-nums">{fmt(row.total)}</td>
                            <td className="px-5 py-3.5 text-right text-slate-600 tabular-nums text-xs">{row.count}</td>
                            <td className="px-5 py-3.5 text-right text-slate-600 tabular-nums text-xs">{fmt(row.avg)}</td>
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
                                </div>
                                <span className="text-[11px] text-slate-500 tabular-nums w-10 text-right">{pct.toFixed(1)}%</span>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      {(() => {
                        const visibleRows = vendorAnalysisFilter.length > 0
                          ? vendorTableData.rows.filter((r) => vendorAnalysisFilter.includes(r.vendor))
                          : vendorTableData.rows
                        const filteredTotal = visibleRows.reduce((s, r) => s + r.total, 0)
                        const filteredCount = visibleRows.reduce((s, r) => s + r.count, 0)
                        return (
                          <tr className="border-t border-slate-200 bg-slate-50">
                            <td className="px-5 py-3.5" />
                            <td className="px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-widest">
                              Total{vendorAnalysisFilter.length > 0 && <span className="ml-1 text-violet-500">(filtered)</span>}
                            </td>
                            <td className="px-5 py-3.5 text-right font-bold text-violet-700 tabular-nums">{fmt(filteredTotal)}</td>
                            <td className="px-5 py-3.5 text-right text-slate-600 tabular-nums text-xs">{filteredCount}</td>
                            <td colSpan={2} />
                          </tr>
                        )
                      })()}
                    </tfoot>
                  </table>
                  {vendorTableData.rows.length > VENDOR_PAGE_SIZE && (
                    <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/40 shrink-0">
                      <span className="text-xs text-slate-500 tabular-nums">
                        {((vendorPage - 1) * VENDOR_PAGE_SIZE + 1)}–{Math.min(vendorPage * VENDOR_PAGE_SIZE, vendorTableData.rows.length)} of {vendorTableData.rows.length} vendors
                      </span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setVendorPage((p) => p - 1)} disabled={vendorPage === 1}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5"/></svg>
                          Prev
                        </button>
                        <span className="px-3 text-xs text-slate-500 tabular-nums">Page {vendorPage} of {Math.ceil(vendorTableData.rows.length / VENDOR_PAGE_SIZE)}</span>
                        <button onClick={() => setVendorPage((p) => p + 1)} disabled={vendorPage === Math.ceil(vendorTableData.rows.length / VENDOR_PAGE_SIZE)}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                          Next
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg>
                        </button>
                      </div>
                    </div>
                  )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {modal && <ExpEntryModal entry={null} defaultMonth={selectedMonth} defaultLocation={selectedLocation} vendors={vendors} onAddVendor={addVendor} onSave={handleNewEntry} onClose={() => setModal(false)} />}
        {collModal && <CollectionsModal collections={collections} onSave={handleSaveCollections} onClose={() => setCollModal(false)} />}
        {importModal && (
          <ImportModal
            title="Import Supply Expenses"
            subtitle="Paste or upload a CSV — column names must match the header row below"
            locationOptions={LOCATIONS}
            columns={[
              { key: 'date', label: 'date', required: true, example: '01/15/2025',
                aliases: ['date', 'expense_date', 'expensedate', 'purchasedate', 'orderdate', 'invoicedate', 'transactiondate', 'txndate', 'entrydate', 'spenddate', 'billdate'],
                validate: (v) => parseFlexDate(v) ? null : 'Cannot parse date — try MM/DD/YYYY or YYYY-MM-DD',
                transform: (v) => parseFlexDate(v) },
              { key: 'person', label: 'person', required: true, example: 'Jane Smith',
                aliases: ['person', 'name', 'staff', 'employee', 'emp', 'buyer', 'purchaser', 'user', 'orderedby', 'submittedby', 'requestedby', 'by', 'who', 'staffname', 'employeename'] },
              { key: 'vendor', label: 'vendor', required: false, example: 'Henry Schein',
                aliases: ['vendor', 'supplier', 'company', 'merchant', 'provider', 'seller', 'vendorname', 'suppliername', 'distributor', 'store', 'shop', 'brand'] },
              { key: 'description', label: 'description', required: false, example: 'Exam gloves box 200',
                aliases: ['description', 'item', 'notes', 'desc', 'memo', 'details', 'product', 'goods', 'service', 'material', 'note', 'particulars', 'itemdescription', 'productname', 'what', 'comment'] },
              { key: 'amount', label: 'amount', required: true, example: '45.00',
                aliases: ['amount', 'cost', 'price', 'value', 'sum', 'total', 'charge', 'payment', 'spend', 'expense', 'dollars', 'money', 'transactionamount'],
                validate: (v) => isNaN(parseAmount(v)) ? 'amount must be a number' : null,
                transform: (v) => parseAmount(v) },
              { key: 'clinic', label: 'clinic', required: true, example: 'Romeoville',
                aliases: ['clinic', 'location', 'site', 'branch', 'office', 'department', 'dept', 'facility', 'unit', 'place', 'store', 'practice'],
                validate: (v, locs) => fuzzyLocation(v, locs) ? null : `Location not recognized: "${v}"`,
                transform: (v, locs) => fuzzyLocation(v, locs) || v },
            ]}
            onImport={async (rows) => {
              const saved = await bulkInsertExpEntries(rows)
              setEntries((prev) => [...saved, ...prev])
              logActivity({ action: 'import', module: 'Supply Budget', description: `Imported ${saved.length} expense ${saved.length === 1 ? 'entry' : 'entries'} from CSV — ${selectedLocation}`, metadata: { count: saved.length, clinic: selectedLocation } })
              return saved
            }}
            onClose={() => setImportModal(false)}
          />
        )}

        {manageVendorsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { setManageVendorsModal(false); setNewVendorInput('') }} />
            <div className="relative bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-sm z-10 overflow-hidden">
              <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Manage Vendors</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Add or remove vendors from the dropdown</p>
                </div>
                <button onClick={() => { setManageVendorsModal(false); setNewVendorInput('') }} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>
                </button>
              </div>
              <div className="px-6 py-4 space-y-3">
                {/* Add new */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newVendorInput}
                    onChange={(e) => setNewVendorInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); if (newVendorInput.trim()) { addVendor(newVendorInput.trim()); setNewVendorInput('') } }
                    }}
                    placeholder="New vendor name…"
                    className="flex-1 px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition-all"
                  />
                  <button
                    onClick={() => { if (newVendorInput.trim()) { addVendor(newVendorInput.trim()); setNewVendorInput('') } }}
                    className="px-4 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition-all active:scale-[0.98]"
                  >Add</button>
                </div>
                {/* Vendor list */}
                {vendors.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-6">No vendors added yet.</p>
                ) : (
                  <ul className="space-y-1 max-h-64 overflow-y-auto">
                    {vendors.map((v) => (
                      <li key={v} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 hover:bg-violet-50 group transition-colors">
                        <span className="text-sm text-slate-800">{v}</span>
                        <button onClick={() => removeVendor(v)} className="p-1 rounded text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {confirmId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmId(null)} />
            <div className="relative bg-white border border-slate-200 rounded-2xl shadow-2xl p-6 w-80 z-10">
              <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>
              </div>
              <h3 className="font-semibold text-slate-900 mb-1">Delete this expense?</h3>
              <p className="text-sm text-slate-600 mb-5">This action cannot be undone.</p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setConfirmId(null)} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all">Cancel</button>
                <button onClick={() => handleDelete(confirmId)} className="px-3 py-1.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-all">Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
