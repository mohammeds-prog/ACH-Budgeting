'use client'

import { useState, useRef, useEffect, Fragment } from 'react'
import { LOCATIONS, ACH_STATUSES } from '@/lib/constants'

const COLS = [
  { key: 'postingDate',   label: 'Date' },
  { key: 'details',       label: 'Details' },
  { key: 'bankAccount',   label: 'Bank Account' },
  { key: 'description',   label: 'Description' },
  { key: 'insuranceName', label: 'Insurance Name' },
  { key: 'amount',        label: 'Amount' },
  { key: 'fromLocation',  label: 'Received By' },
  { key: 'location',      label: 'Belongs To' },
  { key: 'match',         label: 'Match' },
  { key: 'status',        label: 'Status' },
  { key: 'initials',      label: 'Initials' },
  { key: 'notes',         label: 'Notes' },
]

function shortLocation(val) {
  if (!val) return null
  if (val === 'Valley View Dental Romeoville') return 'Romeoville'
  if (val === 'Valley View Dental Naperville') return 'Naperville'
  if (val === 'Valley View Dental Montgomery') return 'Montgomery'
  return val
}
function formatDate(val) {
  if (!val) return '—'
  const [y, m, d] = val.split('-')
  return `${m}/${d}/${y}`
}
function formatAmount(val) {
  const n = Number(val)
  if (isNaN(n)) return '—'
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2 })
}

const iCell = 'w-full px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100/50 transition-all'
const iSel  = `${iCell} cursor-pointer appearance-none`


function CustomSelect({ value, onChange, options, style, className }) {
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      className={`${iSel} ${className || ''}`}
      style={style}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

const LOC_OPTIONS   = [{ value: '', label: '—' }, ...LOCATIONS.map((l) => ({ value: l, label: shortLocation(l) }))]
const LOC_OPTIONS_P = [{ value: '', label: 'Loc…' }, ...LOCATIONS.map((l) => ({ value: l, label: shortLocation(l) }))]
const MATCH_OPTIONS = [{ value: '', label: '—' }, { value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }, { value: 'Partial', label: 'Partial' }]
const DETAIL_OPTIONS = [{ value: '', label: '—' }, { value: 'CREDIT', label: 'CREDIT' }, { value: 'DEBIT', label: 'DEBIT' }]
const STATUS_OPTIONS = (statuses) => [{ value: '', label: 'Status…' }, ...statuses.map((s) => ({ value: s, label: s }))]

function AutoTextarea({ value, onChange, placeholder, style }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto'
      ref.current.style.height = ref.current.scrollHeight + 'px'
    }
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={1}
      className={`${iCell} resize-none leading-relaxed`}
      style={{ overflowY: style?.maxHeight ? 'auto' : 'hidden', ...style }}
    />
  )
}

function EditRow({ row, onChange, onSave, onCancel, saving, selectionMode, isAllLocations, canEditFull = true, currentUserInitials = '' }) {
  const initialsRequired = !!row.status && row.status !== 'Not Posted'
  function handleStatusChange(v) {
    onChange('status', v)
    if (v && v !== 'Not Posted' && !row.initials?.trim() && currentUserInitials) {
      onChange('initials', currentUserInitials)
    }
  }
  function handleKeyDown(e) {
    if (e.key === 'Escape') { onCancel(); return }
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault()
      onSave()
    }
  }
  return (
    <tr onKeyDown={handleKeyDown} className="border-b border-indigo-200 bg-indigo-50">
      {selectionMode && <td className="px-3 py-2" />}
      <td className="px-2 py-2">
        {canEditFull
          ? <input type="date" value={row.postingDate || ''} onChange={(e) => onChange('postingDate', e.target.value)} className={iCell} />
          : <span className="text-xs text-slate-700 px-1 tabular-nums">{formatDate(row.postingDate) || '—'}</span>}
      </td>
      <td className="px-2 py-2">
        {canEditFull
          ? <CustomSelect value={row.details || ''} onChange={(v) => onChange('details', v)} options={DETAIL_OPTIONS} />
          : (row.details
              ? <span className={`badge text-[10px] ${row.details === 'CREDIT' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-red-100 text-red-700 border border-red-200'}`}>{row.details}</span>
              : <span className="text-slate-300">—</span>)}
      </td>
      <td className="px-2 py-2">
        {canEditFull
          ? <input type="text" value={row.bankAccount || ''} onChange={(e) => onChange('bankAccount', e.target.value)} placeholder="Bank account…" className={iCell} />
          : <span className="text-xs text-slate-700 px-1">{row.bankAccount || <span className="text-slate-300">—</span>}</span>}
      </td>
      <td className="px-2 py-2 max-w-[260px]">
        {canEditFull
          ? <textarea
              value={row.description || ''}
              onChange={(e) => onChange('description', e.target.value)}
              placeholder="Description…"
              rows={2}
              className={`${iCell} resize-none overflow-y-auto`}
              style={{ height: 48 }}
            />
          : <span className="text-slate-800 text-xs leading-relaxed line-clamp-2 block" title={row.description}>{row.description || <span className="text-slate-300">—</span>}</span>}
      </td>
      <td className="px-2 py-2">
        {canEditFull
          ? <input type="text" value={row.insuranceName || ''} onChange={(e) => onChange('insuranceName', e.target.value)} placeholder="Insurance…" className={iCell} />
          : <span className="text-xs text-slate-700 px-1">{row.insuranceName || <span className="text-slate-300">—</span>}</span>}
      </td>
      <td className="px-2 py-2">
        {canEditFull
          ? <input type="number" step="0.01" value={row.amount || ''} onChange={(e) => onChange('amount', e.target.value)} onWheel={(e) => e.target.blur()} placeholder="0.00" className={iCell} />
          : <span className={`text-xs font-semibold tabular-nums px-1 ${Number(row.amount) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{row.amount ? formatAmount(row.amount) : '—'}</span>}
      </td>
      <td className="px-2 py-2">
        {canEditFull
          ? <CustomSelect value={row.fromLocation || ''} onChange={(v) => onChange('fromLocation', v)} options={LOC_OPTIONS} />
          : <span className="text-xs text-slate-500 px-1">{shortLocation(row.fromLocation) || '—'}</span>}
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (row.splits !== null) {
                  onChange('splits', null)
                } else {
                  onChange('splits', row.location ? [{ location: row.location, amount: '' }] : [])
                  onChange('location', '')
                }
              }}
              className="flex items-center gap-1 shrink-0"
            >
              <div className={`relative w-5 h-3 rounded-full transition-colors ${row.splits !== null ? 'bg-indigo-500' : 'bg-slate-300'}`}>
                <div className={`absolute top-0.5 left-0.5 w-2 h-2 rounded-full bg-white shadow transition-transform duration-150 ${row.splits !== null ? 'translate-x-2' : ''}`} />
              </div>
              <span className="text-[10px] text-slate-400">Split</span>
            </button>
            {row.splits === null && (
              <CustomSelect value={row.location || ''} onChange={(v) => onChange('location', v)} options={LOC_OPTIONS} className="flex-1" />
            )}
          </div>
          {row.splits !== null && (
            <div className="space-y-1">
              {(row.splits.length > 0 ? row.splits : [{ location: '', amount: '' }]).map((split, i) => (
                <div key={i} className="flex gap-1 items-center">
                  <CustomSelect
                    value={split.location || ''}
                    onChange={(v) => {
                      const cur = row.splits.length > 0 ? row.splits : [{ location: '', amount: '' }]
                      onChange('splits', cur.map((s, idx) => idx === i ? { ...s, location: v } : s))
                    }}
                    options={LOC_OPTIONS_P}
                    style={{ minWidth: 80 }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={split.amount ?? ''}
                    onChange={(e) => {
                      const cur = row.splits.length > 0 ? row.splits : [{ location: '', amount: '' }]
                      onChange('splits', cur.map((s, idx) => idx === i ? { ...s, amount: e.target.value } : s))
                    }}
                    onWheel={(e) => e.target.blur()}
                    placeholder="0.00"
                    className={iCell}
                    style={{ width: 68 }}
                  />
                  {row.splits.length > 1 && (
                    <button type="button" onClick={() => onChange('splits', row.splits.filter((_, idx) => idx !== i))} className="text-slate-600 hover:text-red-400 transition-colors shrink-0">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => onChange('splits', [...(row.splits || []), { location: '', amount: '' }])} className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors">
                + Add location
              </button>
            </div>
          )}
        </div>
      </td>
      <td className="px-2 py-2">
        {isAllLocations && row.splits?.length > 0 ? (
          <div className="text-[10px] text-amber-600 italic leading-tight">
            Edit match per location
          </div>
        ) : (
          <CustomSelect value={row.match || ''} onChange={(v) => onChange('match', v)} options={MATCH_OPTIONS} />
        )}
      </td>
      <td className="px-2 py-2">
        <CustomSelect value={row.status || ''} onChange={handleStatusChange} options={STATUS_OPTIONS(ACH_STATUSES)} />
      </td>
      <td className="px-2 py-2">
        <input
          type="text"
          value={row.initials || ''}
          onChange={(e) => onChange('initials', e.target.value)}
          placeholder={initialsRequired ? 'Required…' : 'Initials…'}
          maxLength={10}
          className={`${iCell} ${initialsRequired && !row.initials?.trim() ? 'border-amber-500/60 ring-1 ring-amber-500/20 placeholder:text-amber-500/50' : ''}`}
        />
      </td>
      <td className="px-2 py-2 pr-4">
        <AutoTextarea value={row.notes || ''} onChange={(e) => onChange('notes', e.target.value)} placeholder="Notes…" style={{ maxHeight: 72 }} />
      </td>
      <td className="px-2 py-2 sticky right-0 z-10 bg-white">
        <div className="flex gap-1.5">
          <button
            onClick={onSave}
            disabled={saving || !row.postingDate || row.amount === '' || (initialsRequired && !row.initials?.trim())}
            className="px-2.5 py-1 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg disabled:opacity-40 transition-all whitespace-nowrap"
          >
            {saving ? '…' : 'Save'}
          </button>
          <button onClick={onCancel} className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all">✕</button>
        </div>
      </td>
    </tr>
  )
}

function Checkbox({ checked, indeterminate, onChange, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate ?? false
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className={`w-3.5 h-3.5 rounded border-slate-300 bg-white text-indigo-500 cursor-pointer accent-indigo-500 ${className}`}
    />
  )
}

function deriveInitials(profile) {
  const name = (profile?.full_name || '').trim()
  if (name) {
    const parts = name.split(/\s+/)
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase()
  }
  const email = (profile?.email || '').split('@')[0]
  return email.slice(0, 2).toUpperCase() || ''
}

export default function ACHTable({ entries, sortConfig, onSort, onStartEdit, onDelete, onDeleteMany, onEditMany, editingId, editRow, onEditRowChange, onSaveEdit, onCancelEdit, saving, highlightIds, isAllLocations, currentLocation, canEditFull = true, canEditMatch = true, canDelete = true, onSaveNotes, onSaveSplit, showTransferComplete = false, onTransferComplete, profile, attachmentCounts = {}, onOpenAttachments }) {
  const currentUserInitials = deriveInitials(profile)
  const [confirmId,           setConfirmId]           = useState(null)
  const [confirmBulk,         setConfirmBulk]         = useState(false)
  const [bulkEditOpen,        setBulkEditOpen]        = useState(false)
  const [selectionMode,       setSelectionMode]       = useState(false)
  const [selectedIds,         setSelectedIds]         = useState(new Set())
  const [collapsedIds,        setCollapsedIds]        = useState(new Set())
  const [expandedSplits,      setExpandedSplits]      = useState(new Set())
  const [notesEdits,          setNotesEdits]          = useState({})
  const [editingNoteId,       setEditingNoteId]       = useState(null)
  const [expandedNotes,       setExpandedNotes]       = useState(new Set())
  const [transferCompleteId,  setTransferCompleteId]  = useState(null)
  const [editingSplit,        setEditingSplit]        = useState(null) // { entryId, idx }
  const [splitEditRow,        setSplitEditRow]        = useState({})
  const [savingSplit,         setSavingSplit]         = useState(false)

  function startSplitEdit(entry, idx) {
    const split = entry.splits[idx]
    setEditingSplit({ entryId: entry.id, idx })
    setSplitEditRow({ match: split.match || '', status: split.status || '', initials: split.initials || '', notes: split.notes || '' })
  }
  function cancelSplitEdit() { setEditingSplit(null); setSplitEditRow({}) }
  async function saveSplitEdit() {
    if (!editingSplit || !onSaveSplit) return
    setSavingSplit(true)
    try { await onSaveSplit(editingSplit.entryId, editingSplit.idx, splitEditRow); setEditingSplit(null); setSplitEditRow({}) }
    catch { /* keep edit open */ }
    finally { setSavingSplit(false) }
  }

  function exitSelection() {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  useEffect(() => {
    setSelectedIds((prev) => {
      const entryIds = new Set(entries.map((e) => e.id))
      const next = new Set([...prev].filter((id) => entryIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [entries])

  function toggleExpand(id) {
    setCollapsedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function toggleSplitExpand(id) {
    setExpandedSplits((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const selectableIds = entries.filter((e) => e.id !== editingId).map((e) => e.id)
  const allSelected   = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id))
  const someSelected  = selectableIds.some((id) => selectedIds.has(id))

  function toggleAll() {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(selectableIds))
  }

  function handleBulkDelete() {
    const ids = [...selectedIds]
    onDeleteMany(ids)
    setSelectedIds(new Set())
    setConfirmBulk(false)
  }

  return (
    <>
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="flex items-center justify-end px-4 py-2.5 border-b border-slate-100">
          {selectionMode ? (
            <button onClick={exitSelection} className="text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors">
              Cancel selection
            </button>
          ) : (
            <button onClick={() => setSelectionMode(true)} className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="5" width="4" height="4" rx="1"/><rect x="3" y="10" width="4" height="4" rx="1"/><rect x="3" y="15" width="4" height="4" rx="1"/><path d="M10 7h11M10 12h11M10 17h11"/></svg>
              Select
            </button>
          )}
        </div>

        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-12 h-12 rounded-2xl bg-violet-50 border border-violet-200/60 flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7m16 0v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5m16 0H4"/>
              </svg>
            </div>
            <p className="text-sm font-medium text-slate-500">No entries found</p>
            <p className="text-xs text-slate-400 mt-1">Try adjusting your filters or add a new entry</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1400px] border-collapse text-sm">
              <thead className="sticky top-0 z-20">
                <tr className="border-b border-slate-200">
                  {selectionMode && (
                    <th className="px-3 py-3 w-9 bg-slate-50">
                      <Checkbox
                        checked={allSelected}
                        indeterminate={someSelected && !allSelected}
                        onChange={toggleAll}
                      />
                    </th>
                  )}
                  {COLS.map((col) => {
                    const isSorted = sortConfig.key === col.key
                    return (
                      <th key={col.key} onClick={() => onSort(col.key)} className="px-4 py-3 text-left select-none cursor-pointer group bg-slate-50">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[11px] font-semibold uppercase tracking-widest transition-colors ${isSorted ? 'text-indigo-600' : 'text-slate-500 group-hover:text-slate-700'}`}>{col.label}</span>
                          <span className={`text-[10px] transition-opacity ${isSorted ? 'opacity-100 text-indigo-600' : 'opacity-0 group-hover:opacity-40 text-slate-500'}`}>
                            {isSorted ? (sortConfig.dir === 'asc' ? '↑' : '↓') : '↕'}
                          </span>
                        </div>
                      </th>
                    )
                  })}
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500 w-24 sticky right-0 z-30 bg-slate-50">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const isSelected      = selectedIds.has(entry.id)
                  const hasSplits       = entry.splits?.length > 0
                  const splitOpen       = hasSplits && expandedSplits.has(entry.id)
                  const displayMatch    = (() => {
                    if (!isAllLocations && hasSplits)
                      return entry.splits.find((s) => s.location === currentLocation)?.match
                    if (isAllLocations && hasSplits) {
                      const vals = entry.splits.map((s) => s.match || 'No')
                      return vals.every((m) => m === vals[0]) ? vals[0] : null
                    }
                    return entry.match
                  })()
                  const unmatched       = !displayMatch || displayMatch === 'No'
                  // Revenue belongs to this location but was received by a different bank
                  const isCrossLocation = !isAllLocations && !!entry.fromLocation && entry.fromLocation !== currentLocation

                  if (editingId === entry.id) {
                    return <EditRow key={entry.id} row={editRow} onChange={onEditRowChange} onSave={onSaveEdit} onCancel={onCancelEdit} saving={saving} selectionMode={selectionMode} isAllLocations={isAllLocations} canEditFull={canEditFull} currentUserInitials={currentUserInitials} />
                  }

                  const isHighlighted = highlightIds?.has(entry.id)
                  const isPending = entry.splits !== null && entry.splits !== undefined && entry.splits.length === 0

                  // Determine what to show in the "To" column
                  const toCell = (() => {
                    if (isPending) {
                      return <span className="badge bg-slate-100 text-slate-500 border border-slate-200 text-[10px] italic">Split · pending</span>
                    }
                    if (hasSplits) {
                      if (isAllLocations || entry.fromLocation === currentLocation) {
                        return (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleSplitExpand(entry.id) }}
                            className="flex items-center gap-1.5 group/split"
                          >
                            <svg
                              className={`w-3 h-3 text-slate-500 transition-transform duration-150 ${splitOpen ? 'rotate-90' : ''}`}
                              fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/>
                            </svg>
                            <span className="badge bg-indigo-100 text-indigo-700 border border-indigo-200 text-[10px] group-hover/split:bg-indigo-200/80 transition-colors">
                              Split · {entry.splits.length}
                            </span>
                          </button>
                        )
                      }
                      return <span className="badge bg-slate-100 text-slate-700 border border-slate-200 text-[10px]">{shortLocation(currentLocation)}</span>
                    }
                    return entry.location
                      ? <span className="badge bg-slate-100 text-slate-700 border border-slate-200 text-[10px]">{shortLocation(entry.location)}</span>
                      : <span className="text-slate-300">—</span>
                  })()

                  // In a specific location tab, show just that location's split amount
                  const displayAmount = (!isAllLocations && entry.splits?.length > 0)
                    ? (entry.splits.find((s) => s.location === currentLocation)?.amount ?? entry.amount)
                    : entry.amount

                  const displayStatus = (() => {
                    if (!isAllLocations && hasSplits) {
                      const split = entry.splits.find((s) => s.location === currentLocation)
                      return split?.status ?? entry.status
                    }
                    if (isAllLocations && hasSplits) {
                      const vals = entry.splits.map((s) => s.status || '')
                      return vals.every((v) => v === vals[0]) ? vals[0] : '__mixed__'
                    }
                    return entry.status
                  })()

                  const displayInitials = (() => {
                    if (!isAllLocations && hasSplits) {
                      const split = entry.splits.find((s) => s.location === currentLocation)
                      return split?.initials ?? entry.initials
                    }
                    return entry.initials
                  })()

                  // On a specific location tab where entry matches via split (not received here),
                  // show inline edit directly on the parent row instead of expanding sub-rows
                  if (!isAllLocations && hasSplits && entry.fromLocation !== currentLocation && editingSplit?.entryId === entry.id) {
                    const splitInitialsRequired = !!splitEditRow.status && splitEditRow.status !== 'Not Posted'
                    return (
                      <Fragment key={entry.id}>
                        <tr onKeyDown={(e) => { if (e.key === 'Escape') cancelSplitEdit() }} className="border-b border-indigo-200 bg-indigo-50">
                          {selectionMode && <td className="px-3 py-2" />}
                          <td className="px-4 py-3 whitespace-nowrap"><span className="text-slate-700 font-medium tabular-nums text-xs">{formatDate(entry.postingDate)}</span></td>
                          <td className="px-4 py-3">{entry.details ? <span className={`badge text-[10px] ${entry.details === 'CREDIT' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-red-100 text-red-700 border border-red-200'}`}>{entry.details}</span> : <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-3 whitespace-nowrap"><span className="text-slate-700 text-xs">{entry.bankAccount || <span className="text-slate-300">—</span>}</span></td>
                          <td className="px-4 py-3 max-w-[260px]"><span className="text-slate-800 text-xs leading-relaxed line-clamp-3 block">{entry.description || <span className="text-slate-300">—</span>}</span></td>
                          <td className="px-4 py-3"><span className="text-slate-700 text-xs truncate block">{entry.insuranceName || <span className="text-slate-300">—</span>}</span></td>
                          <td className="px-4 py-3 whitespace-nowrap"><span className={`font-semibold tabular-nums ${Number(displayAmount) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatAmount(displayAmount)}</span></td>
                          <td className="px-4 py-3 whitespace-nowrap"><span className="badge text-[10px] bg-violet-100 text-violet-700 border border-violet-200">← {shortLocation(entry.fromLocation)}</span></td>
                          <td className="px-4 py-3 whitespace-nowrap"><span className="badge bg-slate-100 text-slate-700 border border-slate-200 text-[10px]">{shortLocation(currentLocation)}</span></td>
                          <td className="px-2 py-2">
                            <CustomSelect value={splitEditRow.match || ''} onChange={(v) => setSplitEditRow((p) => ({ ...p, match: v }))} options={MATCH_OPTIONS} />
                          </td>
                          <td className="px-2 py-2">
                            <CustomSelect
                              value={splitEditRow.status || ''}
                              onChange={(v) => setSplitEditRow((p) => {
                                const u = { ...p, status: v }
                                if (v && v !== 'Not Posted' && !p.initials?.trim() && currentUserInitials) u.initials = currentUserInitials
                                return u
                              })}
                              options={STATUS_OPTIONS(ACH_STATUSES)}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input type="text" value={splitEditRow.initials || ''} onChange={(e) => setSplitEditRow((p) => ({ ...p, initials: e.target.value }))} placeholder={splitInitialsRequired ? 'Required…' : 'Initials…'} maxLength={10}
                              className={`${iCell} ${splitInitialsRequired && !splitEditRow.initials?.trim() ? 'border-amber-500/60 ring-1 ring-amber-500/20 placeholder:text-amber-500/50' : ''}`} />
                          </td>
                          <td className="px-2 py-2">
                            <AutoTextarea value={splitEditRow.notes || ''} onChange={(e) => setSplitEditRow((p) => ({ ...p, notes: e.target.value }))} placeholder="Notes…" style={{ maxHeight: 72 }} />
                          </td>
                          <td className="px-2 py-2 sticky right-0 z-10 bg-white">
                            <div className="flex gap-1.5">
                              <button onClick={saveSplitEdit} disabled={savingSplit || (splitInitialsRequired && !splitEditRow.initials?.trim())} className="px-2.5 py-1 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg disabled:opacity-40 transition-all whitespace-nowrap">{savingSplit ? '…' : 'Save'}</button>
                              <button onClick={cancelSplitEdit} className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all">✕</button>
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    )
                  }

                  return (
                    <Fragment key={entry.id}>
                      <tr
                        id={`ach-row-${entry.id}`}
                        className={`group/row border-b border-slate-200 transition-colors last:border-0
                          ${isHighlighted
                            ? 'bg-amber-50 ring-1 ring-inset ring-amber-200'
                            : isSelected
                              ? 'bg-indigo-50 hover:bg-indigo-100/70'
                              : entry.transferComplete
                                ? 'bg-emerald-50/60 hover:bg-emerald-50'
                                : unmatched
                                  ? 'bg-red-50/60 hover:bg-red-50'
                                  : isCrossLocation
                                    ? 'bg-violet-50/50 hover:bg-violet-50'
                                    : 'hover:bg-violet-50/50'}`}
                      >
                        {selectionMode && (
                          <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                            <Checkbox checked={isSelected} onChange={() => toggleSelect(entry.id)} />
                          </td>
                        )}
                        <td className="px-4 py-3 whitespace-nowrap"><span className="text-slate-700 font-medium tabular-nums text-xs">{formatDate(entry.postingDate)}</span></td>
                        <td className="px-4 py-3">
                          {entry.details ? (
                            <span className={`badge text-[10px] ${entry.details === 'CREDIT' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-red-100 text-red-700 border border-red-200'}`}>{entry.details}</span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap"><span className="text-slate-700 text-xs">{entry.bankAccount || <span className="text-slate-300">—</span>}</span></td>
                        <td className="px-4 py-3 max-w-[260px]">
                          {(() => {
                            const desc = entry.description
                            const collapsed = collapsedIds.has(entry.id)
                            const LIMIT = 55
                            if (!desc) return <span className="text-slate-300">—</span>
                            return (
                              <>
                                <span className="text-slate-800 text-xs leading-relaxed block">
                                  {collapsed && desc.length > LIMIT ? desc.slice(0, LIMIT) + '…' : desc}
                                </span>
                                {desc.length > LIMIT && (
                                  <button onClick={(e) => { e.stopPropagation(); toggleExpand(entry.id) }} className="text-[10px] text-indigo-400/60 hover:text-indigo-400 mt-0.5 block leading-none">
                                    {collapsed ? '▼ more' : '▲ less'}
                                  </button>
                                )}
                              </>
                            )
                          })()}
                        </td>
                        <td className="px-4 py-3 max-w-[160px]"><span className="text-slate-700 text-xs truncate block" title={entry.insuranceName}>{entry.insuranceName || <span className="text-slate-300">—</span>}</span></td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`font-semibold tabular-nums ${Number(displayAmount) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatAmount(displayAmount)}</span>
                          {hasSplits && displayAmount !== entry.amount && entry.fromLocation === currentLocation && (
                            <span className="block text-[10px] text-slate-500 tabular-nums mt-0.5">{formatAmount(entry.amount)} rcvd</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {entry.fromLocation
                            ? <span className={`badge text-[10px] ${isCrossLocation ? 'bg-violet-100 text-violet-700 border border-violet-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                                {isCrossLocation && '← '}{shortLocation(entry.fromLocation)}
                              </span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{toCell}</td>
                        <td className="px-4 py-3"><MatchBadge value={displayMatch} /></td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {displayStatus === '__mixed__'
                            ? <span className="badge text-[10px] bg-slate-100 text-slate-500 border border-slate-200">Mixed</span>
                            : <StatusBadge value={displayStatus} />}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {displayInitials
                            ? <span className="text-xs font-mono text-slate-500">{displayInitials}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 max-w-[200px]">
                          {editingNoteId === entry.id ? (
                            <textarea
                              autoFocus
                              value={notesEdits[entry.id] !== undefined ? notesEdits[entry.id] : (entry.notes || '')}
                              onChange={(e) => setNotesEdits((p) => ({ ...p, [entry.id]: e.target.value }))}
                              onBlur={() => {
                                const val = notesEdits[entry.id]
                                if (val !== undefined && val !== (entry.notes || '')) onSaveNotes(entry.id, val)
                                setNotesEdits((p) => { const n = { ...p }; delete n[entry.id]; return n })
                                setEditingNoteId(null)
                              }}
                              rows={3}
                              className="w-full px-2 py-1.5 text-xs bg-white border border-indigo-400 ring-1 ring-indigo-100 rounded-lg text-slate-900 outline-none resize-none"
                            />
                          ) : (
                            <div
                              onClick={() => {
                                setEditingNoteId(entry.id)
                                setNotesEdits((p) => ({ ...p, [entry.id]: entry.notes || '' }))
                              }}
                              className="cursor-text"
                            >
                              {(() => {
                                const note = entry.notes
                                const expanded = expandedNotes.has(entry.id)
                                const LIMIT = 60
                                if (!note) return <span className="text-slate-300 text-xs">Add notes…</span>
                                return (
                                  <>
                                    <span className="text-slate-600 text-xs leading-relaxed block break-words">
                                      {!expanded && note.length > LIMIT ? note.slice(0, LIMIT) + '…' : note}
                                    </span>
                                    {note.length > LIMIT && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setExpandedNotes((prev) => { const n = new Set(prev); n.has(entry.id) ? n.delete(entry.id) : n.add(entry.id); return n })
                                        }}
                                        className="text-[10px] text-indigo-400/60 hover:text-indigo-400 mt-0.5 block leading-none"
                                      >
                                        {!expanded ? '▼ more' : '▲ less'}
                                      </button>
                                    )}
                                  </>
                                )
                              })()}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 sticky right-0 z-10 bg-white group-hover/row:bg-slate-50">
                          <div className="flex items-center gap-1">
                            {/* TC badge — always visible when complete */}
                            {entry.transferComplete && (
                              <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg whitespace-nowrap" title={`Transfer complete · ${entry.transferInitials || ''}`}>
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
                                TC{entry.transferInitials ? ` · ${entry.transferInitials}` : ''}
                              </span>
                            )}
                            {/* Attachment button — always visible when files exist, hover otherwise */}
                            {onOpenAttachments && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onOpenAttachments(entry) }}
                                title={attachmentCounts[entry.id] ? `${attachmentCounts[entry.id]} attachment${attachmentCounts[entry.id] !== 1 ? 's' : ''}` : 'Attachments'}
                                className="relative p-1.5 rounded-lg hover:bg-violet-100 text-slate-400 hover:text-violet-600 transition-all"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13"/>
                                </svg>
                                {attachmentCounts[entry.id] > 0 && (
                                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 flex items-center justify-center text-[9px] font-bold bg-violet-500 text-white rounded-full leading-none">
                                    {attachmentCounts[entry.id]}
                                  </span>
                                )}
                              </button>
                            )}
                            {/* Action buttons — visible on hover */}
                            <div className="flex gap-1">
                              {canEditMatch && (
                                <button
                                  onClick={() => {
                                    if (!isAllLocations && hasSplits && entry.fromLocation !== currentLocation) {
                                      const splitIdx = entry.splits.findIndex((s) => s.location === currentLocation)
                                      if (splitIdx !== -1) { startSplitEdit(entry, splitIdx); return }
                                    }
                                    if (isAllLocations && hasSplits) {
                                      setExpandedSplits((prev) => { const n = new Set(prev); n.add(entry.id); return n })
                                    }
                                    onStartEdit(entry)
                                  }}
                                  className="p-1.5 rounded-lg hover:bg-indigo-500/20 text-slate-600 hover:text-indigo-400 transition-colors" title="Edit"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931zm0 0L19.5 7.125"/></svg>
                                </button>
                              )}
                              {canDelete && (
                                <button onClick={() => setConfirmId(entry.id)} className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-600 hover:text-red-400 transition-colors" title="Delete">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>
                                </button>
                              )}
                              {!entry.transferComplete && showTransferComplete && (
                                <button onClick={() => setTransferCompleteId(entry.id)} className="p-1.5 rounded-lg hover:bg-emerald-500/20 text-slate-600 hover:text-emerald-400 transition-colors" title="Mark Transfer Complete">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>

                      {/* Split sub-rows — only on All Locations or when this tab received the payment */}
                      {splitOpen && (isAllLocations || entry.fromLocation === currentLocation) && entry.splits.map((split, i) => {
                        const isEditingSplit = editingSplit?.entryId === entry.id && editingSplit?.idx === i
                        const splitInitialsRequired = !!splitEditRow.status && splitEditRow.status !== 'Not Posted'

                        if (isEditingSplit) {
                          return (
                            <tr key={`${entry.id}-s${i}`} onKeyDown={(e) => { if (e.key === 'Escape') cancelSplitEdit() }} className="border-b border-indigo-200 bg-indigo-50/80">
                              {selectionMode && <td className="px-3 py-2" />}
                              <td colSpan={5} className="px-4 py-2 pl-8">
                                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                  <span className="text-slate-400">└</span>
                                  <span>split {i + 1} of {entry.splits.length}</span>
                                </div>
                              </td>
                              <td className="px-4 py-2 whitespace-nowrap">
                                <span className="text-emerald-600 font-semibold tabular-nums text-xs">{formatAmount(split.amount)}</span>
                              </td>
                              <td className="px-2 py-2" />
                              <td className="px-2 py-2 whitespace-nowrap">
                                {split.location ? <span className="badge bg-indigo-50 text-indigo-600 border border-indigo-200 text-[10px]">{shortLocation(split.location)}</span> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-2 py-2">
                                <CustomSelect value={splitEditRow.match || ''} onChange={(v) => setSplitEditRow((p) => ({ ...p, match: v }))} options={MATCH_OPTIONS} />
                              </td>
                              <td className="px-2 py-2">
                                <CustomSelect
                                  value={splitEditRow.status || ''}
                                  onChange={(v) => setSplitEditRow((p) => {
                                    const u = { ...p, status: v }
                                    if (v && v !== 'Not Posted' && !p.initials?.trim() && currentUserInitials) u.initials = currentUserInitials
                                    return u
                                  })}
                                  options={STATUS_OPTIONS(ACH_STATUSES)}
                                />
                              </td>
                              <td className="px-2 py-2">
                                <input
                                  type="text"
                                  value={splitEditRow.initials || ''}
                                  onChange={(e) => setSplitEditRow((p) => ({ ...p, initials: e.target.value }))}
                                  placeholder={splitInitialsRequired ? 'Required…' : 'Initials…'}
                                  maxLength={10}
                                  className={`${iCell} ${splitInitialsRequired && !splitEditRow.initials?.trim() ? 'border-amber-500/60 ring-1 ring-amber-500/20 placeholder:text-amber-500/50' : ''}`}
                                />
                              </td>
                              <td className="px-2 py-2">
                                <AutoTextarea value={splitEditRow.notes || ''} onChange={(e) => setSplitEditRow((p) => ({ ...p, notes: e.target.value }))} placeholder="Notes…" style={{ maxHeight: 72 }} />
                              </td>
                              <td className="px-2 py-2 sticky right-0 z-10 bg-white">
                                <div className="flex gap-1.5">
                                  <button onClick={saveSplitEdit} disabled={savingSplit || (splitInitialsRequired && !splitEditRow.initials?.trim())} className="px-2.5 py-1 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg disabled:opacity-40 transition-all whitespace-nowrap">
                                    {savingSplit ? '…' : 'Save'}
                                  </button>
                                  <button onClick={cancelSplitEdit} className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all">✕</button>
                                </div>
                              </td>
                            </tr>
                          )
                        }

                        return (
                          <tr key={`${entry.id}-s${i}`} className="border-b border-slate-200 bg-indigo-50/30 group/split-row">
                            {selectionMode && <td className="px-3 py-2" />}
                            <td colSpan={5} className="px-4 py-2 pl-8">
                              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                <span className="text-slate-400">└</span>
                                <span className="text-slate-500">split {i + 1} of {entry.splits.length}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2 whitespace-nowrap">
                              <span className="text-emerald-600 font-semibold tabular-nums text-xs">{formatAmount(split.amount)}</span>
                            </td>
                            <td className="px-4 py-2" />
                            <td className="px-4 py-2 whitespace-nowrap">
                              {split.location ? <span className="badge bg-indigo-50 text-indigo-600 border border-indigo-200 text-[10px]">{shortLocation(split.location)}</span> : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-4 py-2"><MatchBadge value={split.match} /></td>
                            <td className="px-4 py-2 whitespace-nowrap"><StatusBadge value={split.status} /></td>
                            <td className="px-4 py-2 whitespace-nowrap">
                              {split.initials ? <span className="text-xs font-mono text-slate-500">{split.initials}</span> : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-4 py-2 max-w-[200px]">
                              {split.notes ? <span className="text-slate-500 text-xs line-clamp-2">{split.notes}</span> : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-4 py-2 sticky right-0 z-10 bg-white group-hover/split-row:bg-slate-50">
                              {canEditMatch && (
                                <div>
                                  <button onClick={() => startSplitEdit(entry, i)} className="p-1.5 rounded-lg hover:bg-indigo-500/20 text-slate-600 hover:text-indigo-400 transition-colors" title="Edit split">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931zm0 0L19.5 7.125"/></svg>
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Floating bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 bg-white border border-slate-200 rounded-2xl shadow-xl shadow-slate-200/80">
          <span className="text-xs font-medium text-slate-700">
            {selectedIds.size} {selectedIds.size === 1 ? 'row' : 'rows'} selected
          </span>
          <div className="w-px h-4 bg-slate-200" />
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-500 hover:text-slate-700 transition-colors">Clear</button>
          <button
            onClick={() => setBulkEditOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931zm0 0L19.5 7.125"/></svg>
            Edit {selectedIds.size}
          </button>
          <button
            onClick={() => setConfirmBulk(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 rounded-xl transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>
            Delete {selectedIds.size}
          </button>
        </div>
      )}

      {bulkEditOpen && (
        <BulkEditModal
          count={selectedIds.size}
          onSave={(changes) => {
            onEditMany([...selectedIds], changes)
            setBulkEditOpen(false)
            exitSelection()
          }}
          onClose={() => setBulkEditOpen(false)}
        />
      )}

      {confirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setConfirmId(null)} />
          <div className="relative bg-white rounded-2xl shadow-modal p-6 w-80 z-10">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>
            </div>
            <h3 className="font-semibold text-slate-900 mb-1">Delete this entry?</h3>
            <p className="text-sm text-slate-500 mb-5">This action cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmId(null)} className="btn-ghost text-sm py-1.5">Cancel</button>
              <button onClick={() => { onDelete(confirmId); setConfirmId(null) }} className="btn-danger text-sm py-1.5">Delete</button>
            </div>
          </div>
        </div>
      )}

      {confirmBulk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setConfirmBulk(false)} />
          <div className="relative bg-white rounded-2xl shadow-modal p-6 w-80 z-10">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>
            </div>
            <h3 className="font-semibold text-slate-900 mb-1">Delete {selectedIds.size} {selectedIds.size === 1 ? 'entry' : 'entries'}?</h3>
            <p className="text-sm text-slate-500 mb-5">This action cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmBulk(false)} className="btn-ghost text-sm py-1.5">Cancel</button>
              <button onClick={handleBulkDelete} className="btn-danger text-sm py-1.5">Delete {selectedIds.size}</button>
            </div>
          </div>
        </div>
      )}

      {transferCompleteId && (
        <TransferCompleteModal
          onConfirm={(initials) => { onTransferComplete(transferCompleteId, initials); setTransferCompleteId(null) }}
          onClose={() => setTransferCompleteId(null)}
        />
      )}
    </>
  )
}

function TransferCompleteModal({ onConfirm, onClose }) {
  const [initials, setInitials] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white border border-slate-200 rounded-2xl shadow-xl shadow-slate-200/80 w-80 z-10 overflow-hidden">
        <div className="relative px-6 pt-6 pb-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center mb-4">
            <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>
            </svg>
          </div>
          <h3 className="font-semibold text-slate-900 mb-1">Mark Transfer Complete</h3>
          <p className="text-sm text-slate-600 mb-4">Enter your initials to confirm this transfer has been settled.</p>
          <input
            type="text"
            value={initials}
            onChange={(e) => setInitials(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter' && initials.trim()) onConfirm(initials.trim()) }}
            placeholder="e.g. JD"
            maxLength={5}
            autoFocus
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100/50 mb-5 transition-all"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 rounded-xl transition-all">Cancel</button>
            <button
              onClick={() => { if (initials.trim()) onConfirm(initials.trim()) }}
              disabled={!initials.trim()}
              className="px-4 py-1.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-all shadow-lg shadow-emerald-200/80"
            >
              Mark Complete
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function BulkEditModal({ count, onSave, onClose }) {
  const [form, setForm] = useState({ fromLocation: '', match: '', status: '', location: '', initials: '' })
  const s = (k, v) => setForm((p) => ({ ...p, [k]: v }))
  const hasChanges = Object.values(form).some((v) => v !== '')

  function handleSubmit(e) {
    e.preventDefault()
    const changes = {}
    if (form.fromLocation) changes.fromLocation = form.fromLocation
    if (form.match)        changes.match        = form.match
    if (form.status)       changes.status       = form.status
    if (form.location)     changes.location     = form.location
    if (form.initials)     changes.initials     = form.initials
    onSave(changes)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white border border-slate-200 rounded-2xl shadow-xl shadow-slate-200/80 w-full max-w-sm z-10">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Bulk Edit</h2>
            <p className="text-xs text-slate-500 mt-0.5">Editing {count} {count === 1 ? 'row' : 'rows'} — blank fields are left unchanged</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <BF label="From Location">
            <select value={form.fromLocation} onChange={(e) => s('fromLocation', e.target.value)} className={iSel}>
              <option value="">— no change —</option>
              {LOCATIONS.map((l) => <option key={l} value={l}>{shortLocation(l)}</option>)}
            </select>
          </BF>
          <BF label="To Location">
            <select value={form.location} onChange={(e) => s('location', e.target.value)} className={iSel}>
              <option value="">— no change —</option>
              {LOCATIONS.map((l) => <option key={l} value={l}>{shortLocation(l)}</option>)}
            </select>
          </BF>
          <BF label="Match">
            <select value={form.match} onChange={(e) => s('match', e.target.value)} className={iSel}>
              <option value="">— no change —</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
              <option value="Partial">Partial</option>
            </select>
          </BF>
          <BF label="Status">
            <select value={form.status} onChange={(e) => s('status', e.target.value)} className={iSel}>
              <option value="">— no change —</option>
              {ACH_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
            </select>
          </BF>
          <BF label="Initials">
            <input type="text" value={form.initials} onChange={(e) => s('initials', e.target.value)} placeholder="Leave blank to keep existing" maxLength={10} className={iCell} />
          </BF>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 rounded-xl transition-all">Cancel</button>
            <button type="submit" disabled={!hasChanges} className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-all shadow-lg shadow-indigo-200/80">
              Apply to {count} {count === 1 ? 'row' : 'rows'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function BF({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function MatchBadge({ value }) {
  if (!value) return <span className="text-slate-300 text-xs">—</span>
  const map = { Yes: 'bg-emerald-100 text-emerald-700 border-emerald-200', No: 'bg-red-100 text-red-700 border-red-200', Partial: 'bg-amber-100 text-amber-700 border-amber-200' }
  return <span className={`badge text-[10px] border ${map[value] ?? 'bg-slate-100 text-slate-700 border-slate-200'}`}>{value}</span>
}

function StatusBadge({ value }) {
  if (!value) return <span className="text-slate-300 text-xs">—</span>
  const map = { 'Posted': 'bg-indigo-100 text-indigo-700 border-indigo-200', 'In Progress': 'bg-amber-100 text-amber-700 border-amber-200', 'Not Posted': 'bg-slate-100 text-slate-500 border-slate-200' }
  return <span className={`badge text-[10px] border ${map[value] ?? 'bg-slate-100 text-slate-700 border-slate-200'}`}>{value}</span>
}
