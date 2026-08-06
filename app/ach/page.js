'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AppHeader from '@/components/AppHeader'
import FilterBar from '@/components/FilterBar'
import ACHTable from '@/components/ACHTable'
import EntryModal from '@/components/EntryModal'
import { getEntries, saveEntry, deleteEntry, bulkInsertEntries, getUniqueInsurers, saveNotes, markTransferComplete, getAttachmentCounts } from '@/lib/storage'
import AttachmentsPanel from '@/components/AttachmentsPanel'
import { LOCATIONS, ACH_STATUSES } from '@/lib/constants'
import ImportModal, { parseFlexDate, fuzzyLocation, parseAmount } from '@/components/ImportModal'
import { logActivity } from '@/lib/activityLog'
import { exportAchToExcel } from '@/lib/exportAch'
import { extractInsuranceName } from '@/lib/achParser'
import { useProfile } from '@/lib/profileContext'
import { can } from '@/lib/permissions'

const ALL = 'all'
const CUSTOM = 'custom'

const SHORT_LOCS = LOCATIONS.map((l) => ({ full: l, short: l.replace('Valley View Dental ', '') }))

function shortLoc(loc) {
  if (loc === 'Valley View Dental Romeoville') return 'Romeoville'
  if (loc === 'Valley View Dental Naperville') return 'Naperville'
  if (loc === 'Valley View Dental Montgomery') return 'Montgomery'
  return loc
}

// Parses combined "Posted | le" style initials field into { status, initials }
function parseInitialsField(val, statuses) {
  if (!val) return { status: null, initials: null }
  const statusLower = statuses.map((s) => s.toLowerCase())

  if (val.includes('|')) {
    const parts = val.split('|').map((p) => p.trim())
    let foundStatus = null
    let foundInitials = null
    for (const part of parts) {
      const idx = statusLower.indexOf(part.toLowerCase())
      if (idx !== -1 && !foundStatus) foundStatus = statuses[idx]
      else if (!foundInitials && part) foundInitials = part
    }
    return { status: foundStatus, initials: foundInitials }
  }

  // Whole value is just a status word
  const idx = statusLower.indexOf(val.toLowerCase())
  if (idx !== -1) return { status: statuses[idx], initials: null }

  return { status: null, initials: val }
}

export default function ACHPage() {
  const profile = useProfile()
  const searchParams  = useSearchParams()
  const highlightParam = searchParams.get('highlight')
  const highlightIds   = highlightParam ? new Set(highlightParam.split(',')) : null
  const highlightId    = highlightParam ? highlightParam.split(',')[0] : null
  const highlightDone  = useRef(false)

  const [entries, setEntries] = useState([])
  const [allInsurers, setAllInsurers] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedLocation, setSelectedLocation] = useState(ALL)
  const [filters, setFilters] = useState({ month: '', year: '', from: '', to: '', match: '', status: '', search: '', insurance: '', initials: '', receivedBy: [], belongsTo: [] })
  const [showTCView, setShowTCView] = useState(false)
  const [tcPage, setTcPage] = useState(1)
  const [sortConfig, setSortConfig] = useState({ key: 'postingDate', dir: 'desc' })

  const [modal, setModal] = useState(false)
  const [modalEntry, setModalEntry] = useState(null)
  const [importModal, setImportModal] = useState(false)
  const [attachmentsEntry, setAttachmentsEntry] = useState(null)
  const [attachmentCounts, setAttachmentCounts] = useState({})
  const [page, setPage] = useState(1)

  useEffect(() => { setPage(1); setTcPage(1) }, [filters, sortConfig, selectedLocation])

  useEffect(() => {
    getEntries()
      .then(setEntries)
      .catch((e) => console.error('Failed to load ACH entries:', e))
      .finally(() => setLoading(false))
    getUniqueInsurers()
      .then(setAllInsurers)
      .catch((e) => console.error('Failed to load insurers:', e))
    getAttachmentCounts()
      .then(setAttachmentCounts)
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!highlightId || entries.length === 0 || highlightDone.current) return
    highlightDone.current = true
    setFilters({ month: '', year: '', from: '', to: '', match: '', status: '', search: '', insurance: '', initials: '', receivedBy: [], belongsTo: [] })
    setSelectedLocation(ALL)
    const sorted = [...entries].sort((a, b) => b.postingDate.localeCompare(a.postingDate))
    const idx = sorted.findIndex((e) => e.id === highlightId)
    if (idx !== -1) setPage(Math.floor(idx / 20) + 1)
    setTimeout(() => {
      const el = document.getElementById(`ach-row-${highlightId}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 300)
  }, [entries, highlightId])

  const filtered = useMemo(() => {
    return entries
      .filter((e) => {
        if (selectedLocation !== ALL && selectedLocation !== CUSTOM) {
          const matchesDirect = e.location === selectedLocation
          const matchesSplit  = e.splits?.some((s) => s.location === selectedLocation)
          const matchesFrom   = e.fromLocation === selectedLocation
          if (!matchesDirect && !matchesSplit && !matchesFrom) return false
        }
        const date = new Date(e.postingDate)
        if (filters.month && date.getMonth() + 1 !== Number(filters.month)) return false
        if (filters.year && date.getFullYear() !== Number(filters.year)) return false
        if (filters.from && e.postingDate < filters.from) return false
        if (filters.to && e.postingDate > filters.to) return false
        if (filters.match) {
          const effectiveMatch = (selectedLocation !== ALL && e.splits?.length > 0)
            ? (e.splits.find((s) => s.location === selectedLocation)?.match || 'No')
            : (e.match || 'No')
          if (effectiveMatch !== filters.match) return false
        }
        if (e.transferComplete) return false
        if (filters.status && e.status !== filters.status) return false
        if (filters.initials) {
          // Split entries keep initials per location, so match the parent or any split.
          const own = (e.initials || '').trim()
          const inSplits = e.splits?.some((sp) => (sp.initials || '').trim() === filters.initials)
          if (own !== filters.initials && !inSplits) return false
        }
        if (filters.insurance && e.insuranceName !== filters.insurance) return false
        if (selectedLocation === CUSTOM && filters.receivedBy?.length > 0 && !filters.receivedBy.includes(e.fromLocation)) return false
        if (selectedLocation === CUSTOM && filters.belongsTo?.length > 0) {
          const directMatch = filters.belongsTo.includes(e.location)
          const splitMatch  = e.splits?.some((s) => filters.belongsTo.includes(s.location))
          if (!directMatch && !splitMatch) return false
        }
        if (filters.search) {
          const q = filters.search.toLowerCase()
          const hay = `${e.details} ${e.description} ${e.location} ${e.initials} ${e.status}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => {
        const { key, dir } = sortConfig
        let va = a[key] ?? '', vb = b[key] ?? ''
        if (key === 'amount') { va = Number(va); vb = Number(vb) }
        if (va < vb) return dir === 'asc' ? -1 : 1
        if (va > vb) return dir === 'asc' ? 1 : -1
        return 0
      })
  }, [entries, filters, sortConfig, selectedLocation])

  const tcFiltered = useMemo(() => {
    return entries
      .filter((e) => {
        if (!e.transferComplete) return false
        if (selectedLocation !== ALL && selectedLocation !== CUSTOM) {
          const matchesDirect = e.location === selectedLocation
          const matchesSplit  = e.splits?.some((s) => s.location === selectedLocation)
          const matchesFrom   = e.fromLocation === selectedLocation
          if (!matchesDirect && !matchesSplit && !matchesFrom) return false
        }
        if (selectedLocation === CUSTOM && filters.receivedBy?.length > 0 && !filters.receivedBy.includes(e.fromLocation)) return false
        if (selectedLocation === CUSTOM && filters.belongsTo?.length > 0) {
          const directMatch = filters.belongsTo.includes(e.location)
          const splitMatch  = e.splits?.some((s) => filters.belongsTo.includes(s.location))
          if (!directMatch && !splitMatch) return false
        }
        const date = new Date(e.postingDate)
        if (filters.month && date.getMonth() + 1 !== Number(filters.month)) return false
        if (filters.year && date.getFullYear() !== Number(filters.year)) return false
        if (filters.from && e.postingDate < filters.from) return false
        if (filters.to && e.postingDate > filters.to) return false
        if (filters.status && e.status !== filters.status) return false
        if (filters.initials) {
          // Split entries keep initials per location, so match the parent or any split.
          const own = (e.initials || '').trim()
          const inSplits = e.splits?.some((sp) => (sp.initials || '').trim() === filters.initials)
          if (own !== filters.initials && !inSplits) return false
        }
        if (filters.insurance && e.insuranceName !== filters.insurance) return false
        if (filters.search) {
          const q = filters.search.toLowerCase()
          const hay = `${e.details} ${e.description} ${e.location} ${e.initials} ${e.status}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => {
        const { key, dir } = sortConfig
        let va = a[key] ?? '', vb = b[key] ?? ''
        if (key === 'amount') { va = Number(va); vb = Number(vb) }
        if (va < vb) return dir === 'asc' ? -1 : 1
        if (va > vb) return dir === 'asc' ? 1 : -1
        return 0
      })
  }, [entries, filters, sortConfig, selectedLocation])

  const PAGE_SIZE = 20
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const tcTotalPages = Math.max(1, Math.ceil(tcFiltered.length / PAGE_SIZE))
  const tcPaged = tcFiltered.slice((tcPage - 1) * PAGE_SIZE, tcPage * PAGE_SIZE)

  function handleExport() {
    const rows = showTCView ? tcFiltered : filtered
    if (rows.length === 0) return
    const isSpecificLocation = selectedLocation !== ALL && selectedLocation !== CUSTOM
    const locationLabel = selectedLocation === ALL
      ? 'All Locations'
      : selectedLocation === CUSTOM
        ? 'Inter Office Transfers'
        : shortLoc(selectedLocation)
    exportAchToExcel({
      entries: rows,
      locationLabel,
      isSpecificLocation,
      currentLocation: selectedLocation,
      filters,
      showTCView,
    })
    logActivity({
      action: 'export',
      module: 'ACH',
      description: `Exported ${rows.length} ACH ${rows.length === 1 ? 'entry' : 'entries'} — ${locationLabel}`,
      metadata: { count: rows.length, location: locationLabel, view: showTCView ? 'transferComplete' : 'active', filters },
    })
  }

  // Stats respond to all filters except match
  const statsEntries = useMemo(() => {
    return entries.filter((e) => {
      if (selectedLocation !== ALL && selectedLocation !== CUSTOM) {
        const matchesDirect = e.location === selectedLocation
        const matchesSplit  = e.splits?.some((s) => s.location === selectedLocation)
        const matchesFrom   = e.fromLocation === selectedLocation
        if (!matchesDirect && !matchesSplit && !matchesFrom) return false
      }
      if (selectedLocation === CUSTOM && filters.receivedBy?.length > 0 && !filters.receivedBy.includes(e.fromLocation)) return false
      if (selectedLocation === CUSTOM && filters.belongsTo?.length > 0) {
        const directMatch = filters.belongsTo.includes(e.location)
        const splitMatch  = e.splits?.some((s) => filters.belongsTo.includes(s.location))
        if (!directMatch && !splitMatch) return false
      }
      const date = new Date(e.postingDate)
      if (filters.month && date.getMonth() + 1 !== Number(filters.month)) return false
      if (filters.year && date.getFullYear() !== Number(filters.year)) return false
      if (filters.from && e.postingDate < filters.from) return false
      if (filters.to && e.postingDate > filters.to) return false
      if (filters.status && e.status !== filters.status) return false
      if (filters.initials) {
        const own = (e.initials || '').trim()
        const inSplits = e.splits?.some((sp) => (sp.initials || '').trim() === filters.initials)
        if (own !== filters.initials && !inSplits) return false
      }
      if (filters.insurance && e.insuranceName !== filters.insurance) return false
      if (filters.search) {
        const q = filters.search.toLowerCase()
        const hay = `${e.details} ${e.description} ${e.location} ${e.initials} ${e.status}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [entries, selectedLocation, filters.month, filters.year, filters.from, filters.to, filters.status, filters.search, filters.insurance, filters.receivedBy, filters.belongsTo])

  // For a specific location tab, only count amounts that *belong to* this location (not just received by it)
  function allocatedAmount(e) {
    if (selectedLocation !== ALL && selectedLocation !== CUSTOM) {
      const matchesDirect = e.location === selectedLocation
      const hasSplits     = e.splits?.length > 0
      // entry only matches via fromLocation — received but not yet allocated
      if (!matchesDirect && !hasSplits) return 0
      if (hasSplits) {
        const split = e.splits.find((s) => s.location === selectedLocation)
        return split ? Number(split.amount) : 0
      }
    }
    if (selectedLocation === CUSTOM && filters.belongsTo?.length > 0) {
      if (e.splits?.length > 0) {
        const relevant = e.splits.filter((s) => filters.belongsTo.includes(s.location))
        return relevant.reduce((sum, s) => sum + Number(s.amount || 0), 0)
      }
      return filters.belongsTo.includes(e.location) ? Number(e.amount || 0) : 0
    }
    // ALL tab or CUSTOM with no Belongs To filter: only count entries that have been allocated
    if (e.splits?.length > 0) return e.splits.reduce((sum, s) => sum + Number(s.amount || 0), 0)
    if (!e.location) return 0
    return Number(e.amount || 0)
  }

  const total           = statsEntries.reduce((sum, e) => sum + allocatedAmount(e), 0)
  function effectiveMatch(e) {
    if (selectedLocation !== ALL && selectedLocation !== CUSTOM && e.splits?.length > 0) {
      return e.splits.find((s) => s.location === selectedLocation)?.match || 'No'
    }
    return e.match || 'No'
  }
  const matchedAmount   = statsEntries.filter((e) => effectiveMatch(e) !== 'No').reduce((sum, e) => sum + allocatedAmount(e), 0)
  const unmatchedAmount = statsEntries.filter((e) => effectiveMatch(e) === 'No').reduce((sum, e) => {
    const alloc = allocatedAmount(e)
    // allocatedAmount returns 0 for entries with no location — those amounts are still unresolved.
    // On All/Custom tabs: entry has no location at all.
    // On a specific tab: entry was received here (fromLocation) but hasn't been assigned anywhere yet.
    const isUnallocated = alloc === 0 && !e.location && !(e.splits?.length > 0)
    if (isUnallocated) {
      const receivedHere = selectedLocation !== ALL && selectedLocation !== CUSTOM
        ? e.fromLocation === selectedLocation
        : true
      if (receivedHere) return sum + Number(e.amount || 0)
    }
    return sum + alloc
  }, 0)
  const unmatched       = statsEntries.filter((e) => effectiveMatch(e) === 'No').length
  // Bank received = full payment amounts where this location's bank account received the money
  const bankReceived    = entries
    .filter((e) => {
      if (selectedLocation !== ALL && selectedLocation !== CUSTOM) return e.fromLocation === selectedLocation
      if (filters.receivedBy?.length > 0) return filters.receivedBy.includes(e.fromLocation)
      if (selectedLocation === CUSTOM) return false
      return true
    })
    .reduce((sum, e) => sum + Number(e.amount || 0), 0)
  const uniqueYears      = [...new Set(entries.map((e) => new Date(e.postingDate).getFullYear()).filter(Boolean))].sort((a, b) => b - a)
  const uniqueInsurers   = [...new Set(entries.map((e) => e.insuranceName).filter(Boolean))].sort()
  // Initials live on the entry and, for split payments, on each split — collect both.
  const uniqueInitials   = [...new Set(
    entries.flatMap((e) => [e.initials, ...(e.splits || []).map((sp) => sp.initials)])
      .map((v) => (v || '').trim())
      .filter(Boolean)
  )].sort()
  const fmt = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2 })

  function handleSort(key) {
    setSortConfig((prev) => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  }

  async function handleNewEntry(formData) {
    try {
      const saved = await saveEntry({ ...formData, id: undefined })
      setEntries((prev) => [saved, ...prev])
      setModal(false)
      logActivity({ action: 'create', module: 'ACH', description: `Added ACH entry — $${Number(formData.amount || 0).toLocaleString()}, ${formData.description || 'No description'}`, metadata: { id: saved.id, amount: formData.amount, location: formData.location } })
    } catch {
      alert('Failed to save. Check your connection.')
    }
  }

  // Persist a partial edit made inline in a table cell. The whole entry is
  // written back (storage.saveEntry sends every column), so we merge the patch
  // onto the current row first. On a location tab, keep the parent `match`
  // consistent with its splits the way the old row editor did.
  async function handleSaveFields(entry, patch) {
    const next = { ...entry, ...patch }
    if (next.splits?.length > 0) {
      const all = next.splits.map((s) => s.match || 'No')
      if (all.every((m) => m === 'Yes')) next.match = 'Yes'
      else if (all.some((m) => m === 'Yes' || m === 'Partial')) next.match = 'Partial'
      else next.match = 'No'
    }
    const saved = await saveEntry(next)
    setEntries((prev) => prev.map((e) => (e.id === saved.id ? saved : e)))
    logActivity({
      action: 'update', module: 'ACH',
      description: `Edited ${Object.keys(patch).join(', ')} — ${entry.description?.slice(0, 40) || 'entry'}`,
      metadata: { id: entry.id, patch },
    })
  }


  function toggleReceivedBy(full) {
    setFilters((prev) => {
      const cur = prev.receivedBy || []
      return { ...prev, receivedBy: cur.includes(full) ? cur.filter((x) => x !== full) : [...cur, full] }
    })
  }

  function toggleBelongsTo(full) {
    setFilters((prev) => {
      const cur = prev.belongsTo || []
      return { ...prev, belongsTo: cur.includes(full) ? cur.filter((x) => x !== full) : [...cur, full] }
    })
  }

  async function handleModalSave(formData) {
    try {
      const saved = await saveEntry({ ...formData, id: formData.id })
      setEntries((prev) => prev.map((e) => e.id === saved.id ? saved : e))
      setModalEntry(null)
      logActivity({ action: 'update', module: 'ACH', description: `Edited ACH entry — $${Number(formData.amount || 0).toLocaleString()}, ${formData.description || 'No description'}`, metadata: { id: formData.id, amount: formData.amount } })
    } catch {
      alert('Failed to save. Check your connection.')
    }
  }

  async function handleDelete(id) {
    try {
      await deleteEntry(id)
      setEntries((prev) => prev.filter((e) => e.id !== id))
      logActivity({ action: 'delete', module: 'ACH', description: 'Deleted ACH entry', metadata: { id } })
    } catch {
      alert('Failed to delete. Check your connection.')
    }
  }

  async function handleEditMany(ids, changes) {
    try {
      const toUpdate = entries.filter((e) => ids.includes(e.id))
      const saved = await Promise.all(toUpdate.map((e) => saveEntry({ ...e, ...changes, id: e.id })))
      setEntries((prev) => prev.map((e) => saved.find((s) => s.id === e.id) || e))
      logActivity({ action: 'update', module: 'ACH', description: `Bulk updated ${ids.length} ACH ${ids.length === 1 ? 'entry' : 'entries'}`, metadata: { count: ids.length, ids, changes } })
    } catch {
      alert('Failed to save. Check your connection.')
    }
  }

  async function handleSaveNotes(id, notes) {
    try {
      await saveNotes(id, notes)
      setEntries((prev) => prev.map((e) => e.id === id ? { ...e, notes } : e))
    } catch {
      alert('Failed to save notes.')
    }
  }

  async function handleTransferComplete(id, initials) {
    try {
      await markTransferComplete(id, initials)
      setEntries((prev) => prev.map((e) => e.id === id ? { ...e, transferComplete: true, transferInitials: initials } : e))
    } catch {
      alert('Failed to mark transfer as complete.')
    }
  }

  async function handleSaveSplit(entryId, splitIdx, changes) {
    try {
      const entry = entries.find((e) => e.id === entryId)
      if (!entry) return
      const updatedSplits = entry.splits.map((s, i) => i === splitIdx ? { ...s, ...changes } : s)
      const allMatches = updatedSplits.map((s) => s.match || 'No')
      let entryMatch = entry.match
      if (allMatches.every((m) => m === 'Yes')) entryMatch = 'Yes'
      else if (allMatches.some((m) => m === 'Yes' || m === 'Partial')) entryMatch = 'Partial'
      else entryMatch = 'No'
      const saved = await saveEntry({ ...entry, splits: updatedSplits, match: entryMatch })
      setEntries((prev) => prev.map((e) => e.id === saved.id ? saved : e))
    } catch {
      alert('Failed to save split. Check your connection.')
    }
  }

  async function handleDeleteMany(ids) {
    try {
      await Promise.all(ids.map(deleteEntry))
      setEntries((prev) => prev.filter((e) => !ids.includes(e.id)))
      logActivity({ action: 'delete', module: 'ACH', description: `Deleted ${ids.length} ACH ${ids.length === 1 ? 'entry' : 'entries'}`, metadata: { count: ids.length } })
    } catch {
      alert('Failed to delete. Check your connection.')
    }
  }

  return (
    <div className="min-h-screen futuristic-bg relative">
      <div className="relative z-10">
        <AppHeader />

        {/* Hero */}
        <div className="futuristic-hero">
          <div className="relative w-full px-6 py-10 z-10">
            <div className="max-w-screen-xl mx-auto">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <p className="text-indigo-500 text-xs font-semibold uppercase tracking-widest mb-2">Documents</p>
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">ACH Tracker</h1>
                <p className="text-slate-500 text-sm mt-1.5">Filter, review and manage ACH transactions</p>
              </div>
              <div className="flex gap-2 shrink-0">
                {can(profile, 'ach_import') && (
                  <button onClick={() => setImportModal(true)} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>
                    Import
                  </button>
                )}
                <button
                  onClick={handleExport}
                  disabled={(showTCView ? tcFiltered : filtered).length === 0}
                  title={(showTCView ? tcFiltered : filtered).length === 0 ? 'Nothing to export' : 'Export the entries currently in view'}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M7.5 7.5 12 3m0 0 4.5 4.5M12 3v13.5"/></svg>
                  Export
                </button>
                <Link
                  href="/zero-payments"
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="9"/><path strokeLinecap="round" d="M8 12h8"/>
                  </svg>
                  Zero Payments
                </Link>
                {can(profile, 'ach_add') && (
                  <button onClick={() => setModal(true)} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/>
                    </svg>
                    Add Entry
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3 mt-8">
              {[
                { label: 'Entries',            value: statsEntries.length.toLocaleString(),             color: 'text-slate-900',    onClick: null,
                  hint: 'Total number of ACH entries matching the current filters.' },
                { label: 'Total Received',     value: loading ? '—' : fmt(bankReceived),                color: 'text-violet-600',      onClick: null,
                  hint: `Full payment amounts received by ${selectedLocation === ALL ? 'each location\'s' : `${selectedLocation.replace('Valley View Dental ', '')}'s`} bank account. Updates only when the location tab changes.` },
                { label: 'Allocated Amount',   value: loading ? '—' : fmt(total),                       color: total < 0 ? 'text-red-600' : 'text-emerald-600', onClick: null,
                  hint: 'Amount allocated to this location. For split payments, only this location\'s share is counted.' },
                { label: 'Matched',            value: `${statsEntries.length - unmatched}`,             color: 'text-emerald-600',  onClick: () => setFilters((f) => ({ ...f, match: f.match === 'Yes' ? '' : 'Yes' })),
                  hint: 'Entries marked as matched/verified. Click to filter.' },
                { label: 'Matched Amount',     value: loading ? '—' : fmt(matchedAmount),               color: 'text-emerald-600',  onClick: () => setFilters((f) => ({ ...f, match: f.match === 'Yes' ? '' : 'Yes' })),
                  hint: 'Total dollar value of matched entries. Click to filter.' },
                { label: 'Unmatched',          value: `${unmatched}`,                                   color: unmatched > 0 ? 'text-red-600' : 'text-emerald-600', onClick: () => setFilters((f) => ({ ...f, match: f.match === 'No' ? '' : 'No' })),
                  hint: 'Entries not yet verified against a claim. Click to filter.' },
                { label: 'Unmatched Amount',   value: loading ? '—' : fmt(unmatchedAmount),             color: unmatchedAmount > 0 ? 'text-red-600' : 'text-emerald-600', onClick: () => setFilters((f) => ({ ...f, match: f.match === 'No' ? '' : 'No' })),
                  hint: 'Total dollar value of unmatched entries. Click to filter.' },
              ].map(({ label, hint, value, color, onClick }) => (
                <div key={label} onClick={onClick} className={`relative glass-card rounded-2xl px-4 py-3.5 ${onClick ? 'cursor-pointer hover:bg-white/90 transition-all' : ''}`}>
                  <div className="flex items-start gap-1 mb-1 min-h-[2rem]">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 leading-tight">{label}</p>
                    {hint && (
                      <div className="relative group/hint ml-auto shrink-0">
                        <svg className="w-3 h-3 text-slate-400 hover:text-slate-600 cursor-help transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="10"/><path strokeLinecap="round" d="M12 16v-4M12 8h.01"/>
                        </svg>
                        <div className="absolute bottom-full right-0 mb-2 w-52 p-2.5 bg-white border border-slate-200 rounded-xl text-[11px] text-slate-700 leading-relaxed opacity-0 group-hover/hint:opacity-100 pointer-events-none transition-opacity duration-150 z-50 shadow-lg">
                          {hint}
                        </div>
                      </div>
                    )}
                  </div>
                  <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
                </div>
              ))}
            </div>
            </div>
          </div>
        </div>

        {/* Tabs + filters — constrained width */}
        <div className="max-w-[1600px] mx-auto px-6 pt-4 space-y-4">
          {/* Location tabs */}
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="flex overflow-x-auto divide-x divide-white/40">
              {/* Custom tab */}
              <button
                onClick={() => setSelectedLocation(CUSTOM)}
                className={`flex-1 min-w-[100px] px-4 py-3 text-sm font-medium whitespace-nowrap transition-all border-b-2 flex items-center justify-center gap-1.5 ${
                  selectedLocation === CUSTOM
                    ? 'border-amber-500 bg-amber-50 text-amber-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-white/50'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75"/>
                </svg>
                Inter Office Transfers
                {(filters.receivedBy?.length > 0 || filters.belongsTo?.length > 0) && (
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
                    {(filters.receivedBy?.length || 0) + (filters.belongsTo?.length || 0)}
                  </span>
                )}
              </button>
              {/* Standard location tabs */}
              {[{ key: ALL, label: 'All Locations' }, ...LOCATIONS.map((l) => ({ key: l, label: shortLoc(l) }))].map(({ key, label }) => (
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

          {/* Custom tab — Received By / Belongs To panel */}
          {selectedLocation === CUSTOM && (
            <div className="bg-amber-50/50 border border-amber-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75"/>
                </svg>
                <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-widest">Inter Office Transfers</span>
              </div>
              <div className="flex flex-wrap gap-6">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Transfer Status</span>
                  <div className="flex gap-1.5">
                    {[{ label: 'Pending', tc: false }, { label: 'Transferred', tc: true }].map(({ label, tc }) => (
                      <button
                        key={label}
                        onClick={() => setShowTCView(tc)}
                        className={`px-2.5 py-1 text-xs rounded-lg border transition-all whitespace-nowrap ${
                          showTCView === tc
                            ? tc
                              ? 'bg-emerald-100 border-emerald-300 text-emerald-700'
                              : 'bg-amber-100 border-amber-300 text-amber-700'
                            : 'bg-white border-slate-200 text-slate-600 hover:text-slate-800 hover:border-slate-300'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Received By</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {SHORT_LOCS.map(({ full, short }) => (
                      <button
                        key={full}
                        onClick={() => toggleReceivedBy(full)}
                        className={`px-2.5 py-1 text-xs rounded-lg border transition-all whitespace-nowrap ${
                          (filters.receivedBy || []).includes(full)
                            ? 'bg-violet-100 border-violet-300 text-violet-700'
                            : 'bg-white border-slate-200 text-slate-600 hover:text-slate-800 hover:border-slate-300'
                        }`}
                      >
                        {short}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Belongs To</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {SHORT_LOCS.map(({ full, short }) => (
                      <button
                        key={full}
                        onClick={() => toggleBelongsTo(full)}
                        className={`px-2.5 py-1 text-xs rounded-lg border transition-all whitespace-nowrap ${
                          (filters.belongsTo || []).includes(full)
                            ? 'bg-violet-100 border-violet-300 text-violet-700'
                            : 'bg-white border-slate-200 text-slate-600 hover:text-slate-800 hover:border-slate-300'
                        }`}
                      >
                        {short}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <FilterBar filters={filters} onChange={setFilters} uniqueYears={uniqueYears} uniqueInsurers={uniqueInsurers} uniqueInitials={uniqueInitials} />
        </div>

        {/* Table — full width */}
        <div className="px-40 pt-4 pb-8 space-y-4">
          {/* View toggle */}
          <div className="flex items-center gap-1 glass-card rounded-xl p-1 self-start w-fit">
            <button
              onClick={() => setShowTCView(false)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                !showTCView
                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              All Entries {!loading && <span className="ml-1 opacity-60">({filtered.length})</span>}
            </button>
            <button
              onClick={() => setShowTCView(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                showTCView
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>
              </svg>
              Transfer Complete {!loading && <span className="ml-0.5 opacity-60">({tcFiltered.length})</span>}
            </button>
          </div>

          {loading ? (
            <div className="glass-card rounded-2xl flex items-center justify-center py-24">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin" />
                <span className="text-sm text-slate-400">Loading entries…</span>
              </div>
            </div>
          ) : !showTCView ? (
            <>
              <ACHTable
                entries={paged}
                sortConfig={sortConfig}
                onSort={handleSort}
                onOpenFull={setModalEntry}
                onSaveFields={handleSaveFields}
                onDelete={handleDelete}
                onDeleteMany={handleDeleteMany}
                onEditMany={handleEditMany}
                highlightIds={highlightIds}
                isAllLocations={selectedLocation === ALL || selectedLocation === CUSTOM}
                currentLocation={selectedLocation !== ALL && selectedLocation !== CUSTOM ? selectedLocation : null}
                uniqueInsurers={allInsurers}
                canEditFull={can(profile, 'ach_edit_full')}
                canEditMatch={can(profile, 'ach_edit_match')}
                canDelete={can(profile, 'ach_delete')}
                onSaveSplit={handleSaveSplit}
                onSaveNotes={handleSaveNotes}
                showTransferComplete={can(profile, 'ach_transfer_complete')}
                onTransferComplete={handleTransferComplete}
                onOpenModal={setModalEntry}
                profile={profile}
                attachmentCounts={attachmentCounts}
                onOpenAttachments={setAttachmentsEntry}
              />
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3 glass-card rounded-2xl">
                  <span className="text-xs text-slate-500">
                    {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(page * PAGE_SIZE, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()} entries
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setPage((p) => p - 1)} disabled={page === 1}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5"/></svg>
                      Prev
                    </button>
                    <span className="px-3 text-xs text-slate-500 tabular-nums">Page {page} of {totalPages}</span>
                    <button onClick={() => setPage((p) => p + 1)} disabled={page === totalPages}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                      Next
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg>
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {tcFiltered.length === 0 ? (
                <div className="glass-card rounded-2xl flex items-center justify-center py-24">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>
                    </svg>
                    <span className="text-sm text-slate-500">No transfer complete entries yet</span>
                    <span className="text-xs text-slate-400">Mark entries as complete from the Inter Office Transfers tab</span>
                  </div>
                </div>
              ) : (
                <ACHTable
                  entries={tcPaged}
                  sortConfig={sortConfig}
                  onSort={handleSort}
                  onOpenFull={setModalEntry}
                  onSaveFields={handleSaveFields}
                  onDelete={handleDelete}
                  onDeleteMany={handleDeleteMany}
                  onEditMany={handleEditMany}
                  highlightIds={highlightIds}
                  isAllLocations={selectedLocation === ALL || selectedLocation === CUSTOM}
                  currentLocation={selectedLocation !== ALL && selectedLocation !== CUSTOM ? selectedLocation : null}
                  uniqueInsurers={allInsurers}
                  canEditFull={can(profile, 'ach_edit_full')}
                  canEditMatch={can(profile, 'ach_edit_match')}
                  canDelete={can(profile, 'ach_delete')}
                  onSaveSplit={handleSaveSplit}
                  onSaveNotes={handleSaveNotes}
                  showTransferComplete={false}
                  onTransferComplete={handleTransferComplete}
                  onOpenModal={setModalEntry}
                  profile={profile}
                  attachmentCounts={attachmentCounts}
                  onOpenAttachments={setAttachmentsEntry}
                />
              )}
              {tcTotalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3 glass-card rounded-2xl">
                  <span className="text-xs text-slate-500">
                    {((tcPage - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(tcPage * PAGE_SIZE, tcFiltered.length).toLocaleString()} of {tcFiltered.length.toLocaleString()} entries
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setTcPage((p) => p - 1)} disabled={tcPage === 1}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5"/></svg>
                      Prev
                    </button>
                    <span className="px-3 text-xs text-slate-500 tabular-nums">Page {tcPage} of {tcTotalPages}</span>
                    <button onClick={() => setTcPage((p) => p + 1)} disabled={tcPage === tcTotalPages}
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
      {modal && <EntryModal entry={null} onSave={handleNewEntry} onClose={() => setModal(false)} />}
      {modalEntry && <EntryModal entry={modalEntry} onSave={handleModalSave} onClose={() => setModalEntry(null)} />}
      {attachmentsEntry && (
        <AttachmentsPanel
          entryId={attachmentsEntry.id}
          entryDescription={attachmentsEntry.description}
          uploaderEmail={profile?.email}
          onClose={() => setAttachmentsEntry(null)}
          onCountChange={(id, count) => setAttachmentCounts((prev) => ({ ...prev, [id]: count }))}
        />
      )}
      {importModal && (
        <ImportModal
          title="Import ACH Entries"
          subtitle={
            selectedLocation !== ALL && selectedLocation !== CUSTOM
              ? `Paste or upload a CSV — "Received By" will auto-fill as "${selectedLocation}" for rows missing that column`
              : 'Paste or upload a CSV — column names must match the header row below'
          }
          locationOptions={LOCATIONS}
          columns={[
            { key: 'postingDate', label: 'postingDate', required: true, example: '01/15/2025',
              aliases: ['postingdate', 'posting_date', 'date', 'transactiondate', 'txndate', 'postdate', 'valuedate', 'settledate', 'settlementdate', 'entrydate', 'effectivedate', 'dateposted', 'tdate'],
              validate: (v) => parseFlexDate(v) ? null : 'Cannot parse date — try MM/DD/YYYY or YYYY-MM-DD',
              transform: (v) => parseFlexDate(v) },
            { key: 'details', label: 'details', required: false, example: 'CREDIT',
              aliases: ['details', 'type', 'transactiontype', 'txntype', 'entrytype', 'kind', 'category', 'dc', 'direction', 'creditdebit', 'debitcredit'],
              validate: (v) => !v || ['CREDIT', 'DEBIT'].includes(v.toUpperCase()) ? null : 'details must be CREDIT or DEBIT',
              transform: (v) => v ? v.toUpperCase() : null },
            { key: 'bankAccount', label: 'bankAccount', required: false, example: 'Chase ****4821',
              aliases: ['bankaccount', 'bank_account', 'bank account', 'bank', 'account', 'accountname', 'account_name', 'accountnumber', 'account_number', 'acct', 'acctno', 'acctnumber', 'bankname', 'bank_name', 'depositaccount', 'accountno'] },
            { key: 'description', label: 'description', required: false, example: 'DELTA DENTAL PMT',
              aliases: ['description', 'desc', 'memo', 'narrative', 'particulars', 'note', 'notes', 'reference', 'ref', 'remarks', 'comment', 'comments', 'transactiondescription', 'paymentdescription', 'detail'] },
            { key: 'insuranceName', label: 'insuranceName', required: false, example: 'Delta Dental',
              aliases: ['insurancename', 'insurance_name', 'insurance', 'payer', 'carrier', 'provider', 'insurer', 'payername', 'insurancecompany', 'insuranceprovider', 'plan', 'paymentfrom'] },
            { key: 'amount', label: 'amount', required: true, example: '1,250.00',
              aliases: ['amount', 'value', 'sum', 'total', 'charge', 'payment', 'transactionamount', 'txnamount', 'dollaramount', 'dollars', 'money', 'debit', 'credit'],
              validate: (v) => isNaN(parseAmount(v)) ? 'amount must be a number' : null,
              transform: (v) => parseAmount(v) },
            { key: 'belongsTo', label: 'belongsTo', required: false, example: 'Romeoville',
              aliases: [
                'belongsto', 'belongs_to', 'belongstolocation', 'belongs to',
                'tolocation', 'to_location', 'to location',
                'location', 'clinic', 'site', 'branch', 'office', 'store',
                'department', 'dept', 'facility', 'unit', 'place',
                'assignedto', 'assigned_to', 'forlocation', 'destination',
              ],
              validate: (v, locs) => !v || fuzzyLocation(v, locs) ? null : `Location not recognized: "${v}"`,
              transform: (v, locs) => v ? (fuzzyLocation(v, locs) || v) : null },
            { key: 'fromLocation', label: 'fromLocation', required: false, example: 'Naperville',
              aliases: ['fromlocation', 'from_location', 'receivedby', 'received_by', 'receivedat', 'receivedlocation', 'fromloc'],
              validate: (v, locs) => !v || fuzzyLocation(v, locs) ? null : `Location not recognized: "${v}"`,
              transform: (v, locs) => v ? (fuzzyLocation(v, locs) || v) : null,
              defaultValue: selectedLocation !== ALL && selectedLocation !== CUSTOM ? selectedLocation : undefined },
            { key: 'match', label: 'match', required: false, example: 'Yes',
              aliases: ['match', 'matched', 'reconciled', 'reconcile', 'cleared', 'verified', 'confirmed'],
              validate: (v) => !v || ['Yes', 'No', 'Partial'].includes(v) ? null : 'match must be Yes, No, or Partial' },
            { key: 'status', label: 'status', required: false, example: 'Not Posted',
              aliases: ['status', 'state', 'statuscode', 'condition'],
              validate: (v) => !v || ACH_STATUSES.includes(v) ? null : `status must be one of: ${ACH_STATUSES.join(', ')}`,
              defaultValue: 'Not Posted' },
            { key: 'initials', label: 'initials', required: false, example: 'JD',
              aliases: ['initials', 'by', 'staff', 'processedby', 'handledby', 'agent', 'user', 'employee', 'emp', 'reviewer', 'operator', 'rep', 'who', 'donebyemp'] },
          ]}
          postProcess={(entry, rawRow, colMap) => {
            const initialsKey = colMap['initials']
            if (initialsKey) {
              const raw = (rawRow[initialsKey] || '').trim()
              if (raw) {
                const { status, initials } = parseInitialsField(raw, ACH_STATUSES)
                if (status && !entry.status) entry.status = status
                entry.initials = initials || null
              }
            }
            if (!entry.insuranceName && entry.description) {
              const detected = extractInsuranceName(entry.description)
              if (detected) entry.insuranceName = detected
            }
            // belongsTo in UI maps to location field in storage
            entry.location = entry.belongsTo ?? null
            delete entry.belongsTo
          }}
          onImport={async (rows) => {
            const saved = await bulkInsertEntries(rows)
            setEntries((prev) => [...saved, ...prev])
            logActivity({ action: 'import', module: 'ACH', description: `Imported ${saved.length} ACH ${saved.length === 1 ? 'entry' : 'entries'} from CSV`, metadata: { count: saved.length, ids: saved.map((e) => e.id) } })
            return saved
          }}
          onClose={() => setImportModal(false)}
        />
      )}
    </div>
  )
}
