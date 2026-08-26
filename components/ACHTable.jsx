'use client'

import { useState, useRef, useEffect, Fragment } from 'react'
import { LOCATIONS, ACH_STATUSES } from '@/lib/constants'
import { CellSelect, CellInput, MatchBadge, StatusBadge, matchTone, statusTone, locationTone, toCents, RowMenu } from './cells'

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT CONTRACT — read this before changing any width.
//
// The table is `table-layout: fixed` with a <colgroup> built from these
// numbers. Cell content never influences column width, so the grid is
// identical for every row in every state.
//
// There is no row-wide edit mode. Editing happens per cell, in place, using
// controls the same size as the badges they replace — so nothing here has to
// leave slack for a wider "edit" variant. That is what keeps the total small.
//
// The total (~1535) must stay under the page container's usable width, set by
// max-w-[1600px] minus px-6 in app/ach/page.js = 1552px. If the total exceeds
// that, the table scrolls horizontally — which is survivable, but only because
// Actions is NOT sticky. Do not make Actions sticky again: over an overflowing
// table a sticky column pins itself on top of Notes and the two headers
// visually merge. That was a real bug.
// ─────────────────────────────────────────────────────────────────────────────
const COLS = [
  { key: 'postingDate',   label: 'Date',           width: 95  },
  { key: 'details',       label: 'Details',        width: 80  },
  { key: 'bankAccount',   label: 'Bank Account',   width: 100 },
  { key: 'description',   label: 'Description',    width: 182 },
  { key: 'insuranceName', label: 'Insurance Name', width: 138 },
  { key: 'amount',        label: 'Amount',         width: 95  },
  { key: 'fromLocation',  label: 'Received By',    width: 110 },
  { key: 'location',      label: 'Belongs To',     width: 172 },
  { key: 'match',         label: 'Match',          width: 95  },
  { key: 'status',        label: 'Status',         width: 120 },
  { key: 'initials',      label: 'Initials',       width: 80  },
  { key: 'notes',         label: 'Notes',          width: 145 },
]
// Fits four icon buttons (~116px incl. gaps) plus px-3 padding: attachment,
// edit, delete, and either the transfer-complete button or — in the Transfer
// Complete view — its badge, which is icon-only for exactly this reason.
// Activity is NOT here: it lives on the Date cell, which was inert and free.
const ACTIONS_WIDTH = 130
const SELECT_WIDTH  = 36
const COLS_WIDTH    = COLS.reduce((sum, c) => sum + c.width, 0) + ACTIONS_WIDTH

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


const LOC_OPTIONS   = [{ value: '', label: '—' }, ...LOCATIONS.map((l) => ({ value: l, label: shortLocation(l) }))]

const MATCH_OPTIONS = [{ value: '', label: '—' }, { value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }, { value: 'Partial', label: 'Partial' }]
const STATUS_OPTIONS = (statuses) => [{ value: '', label: 'Status…' }, ...statuses.map((s) => ({ value: s, label: s }))]

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

export default function ACHTable({ entries, sortConfig, onSort, onOpenFull, onSaveFields, onDelete, onDeleteMany, onEditMany, highlightIds, isAllLocations, currentLocation, canEditFull = true, canEditMatch = true, canDelete = true, onSaveNotes, onSaveSplit, showTransferComplete = false, onTransferComplete, profile, attachmentCounts = {}, onOpenAttachments, onOpenActivity }) {
  const currentUserInitials = deriveInitials(profile)
  const [confirmId,           setConfirmId]           = useState(null)
  const [confirmBulk,         setConfirmBulk]         = useState(false)
  const [bulkEditOpen,        setBulkEditOpen]        = useState(false)
  const [selectionMode,       setSelectionMode]       = useState(false)
  const [selectedIds,         setSelectedIds]         = useState(new Set())
  const [collapsedIds,        setCollapsedIds]        = useState(new Set())
  const [expandedSplits,      setExpandedSplits]      = useState(new Set())
  const [transferCompleteId,  setTransferCompleteId]  = useState(null)

  // Commit one or more fields on an entry. Setting a status with no initials
  // yet fills them in from the current user, matching the old modal behaviour.
  async function commitEntry(entry, field, value) {
    const patch = { [field]: value }
    if (field === 'status' && value && value !== 'Not Posted' && !entry.initials?.trim() && currentUserInitials) {
      patch.initials = currentUserInitials
    }
    if (String(entry[field] ?? '') === String(value ?? '') && !patch.initials) return
    try { await onSaveFields?.(entry, patch) }
    catch { alert('Failed to save. Check your connection.') }
  }

  // Same, for one split inside an entry.
  async function commitSplit(entry, idx, field, value) {
    const split = entry.splits?.[idx]
    if (!split) return
    const patch = {
      match:    split.match    || '',
      status:   split.status   || '',
      initials: split.initials || '',
      notes:    split.notes    || '',
      [field]:  value,
    }
    if (field === 'status' && value && value !== 'Not Posted' && !split.initials?.trim() && currentUserInitials) {
      patch.initials = currentUserInitials
    }
    if (String(split[field] ?? '') === String(value ?? '') && patch.initials === (split.initials || '')) return
    try { await onSaveSplit?.(entry.id, idx, patch) }
    catch { alert('Failed to save. Check your connection.') }
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

  const selectableIds = entries.map((e) => e.id)
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
            <table
              className="w-full border-collapse text-sm table-fixed"
              style={{ minWidth: COLS_WIDTH + (selectionMode ? SELECT_WIDTH : 0) }}
            >
              {/* Fixed geometry — see the COLS comment at the top of this file.
                  Without this, an edit row reflows every column. */}
              <colgroup>
                {selectionMode && <col style={{ width: SELECT_WIDTH }} />}
                {COLS.map((c) => <col key={c.key} style={{ width: c.width }} />)}
                <col style={{ width: ACTIONS_WIDTH }} />
              </colgroup>
              <thead className="sticky top-0 z-20">
                <tr className="border-b border-slate-200">
                  {selectionMode && (
                    <th className="px-3 py-3 bg-slate-50">
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
                  <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500 bg-slate-50">Actions</th>
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

                  // On a location tab, a split entry's match/status/initials/notes belong
                  // to THAT location's split, not the parent. Route cell edits accordingly.
                  const activeSplitIdx = (!isAllLocations && hasSplits)
                    ? entry.splits.findIndex((s) => s.location === currentLocation)
                    : -1
                  const splitTarget = activeSplitIdx !== -1
                  // On All Locations a split entry has one value per split, so a single
                  // dropdown on the parent row would be lying. Show a chip that expands
                  // the sub-rows instead — each of those is individually editable.
                  const splitsAmbiguous = isAllLocations && hasSplits
                  const commit = (field, value) => splitTarget
                    ? commitSplit(entry, activeSplitIdx, field, value)
                    : commitEntry(entry, field, value)

                  // On a specific location tab where entry matches via split (not received here),
                  // show inline edit directly on the parent row instead of expanding sub-rows

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
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-slate-700 font-medium tabular-nums text-xs">{formatDate(entry.postingDate)}</span>
                        </td>
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
                        {/* Belongs To — single location, or a split allocation.
                            The Split toggle lives here; see SplitCell.

                            Gated on canEditMatch, NOT canEditFull. Assigning revenue
                            to a location is reconciliation work, same as Match and
                            Status, and management/user roles do it daily. canEditFull
                            is admin-only and gates the payment facts — date, amount,
                            description — which live behind the pencil. */}
                        <td className="px-4 py-3">
                          <SplitCell
                            entry={entry}
                            canEdit={canEditMatch}
                            display={toCell}
                            onSaveLocation={(v) => commitEntry(entry, 'location', v)}
                            onSaveSplits={(splits) => onSaveFields?.(entry, {
                              splits,
                              // A split entry has no single Belongs To; clearing it keeps
                              // the two representations from contradicting each other.
                              location: splits ? '' : (entry.location || ''),
                            })}
                          />
                        </td>
                        <td className="px-4 py-3">
                          {splitsAmbiguous
                            ? <button
                                onClick={() => toggleSplitExpand(entry.id)}
                                title="Values differ per split — expand to edit each one"
                                className="badge text-[10px] bg-slate-100 text-slate-500 border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
                              >
                                per split ▾
                              </button>
                            : <CellSelect
                                value={displayMatch}
                                options={MATCH_OPTIONS}
                                onChange={(v) => commit('match', v)}
                                tone={matchTone(displayMatch)}
                                disabled={!canEditMatch}
                                title="Match"
                              />}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {splitsAmbiguous
                            ? <button
                                onClick={() => toggleSplitExpand(entry.id)}
                                title="Values differ per split — expand to edit each one"
                                className="badge text-[10px] bg-slate-100 text-slate-500 border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
                              >
                                per split ▾
                              </button>
                            : <CellSelect
                                value={displayStatus === '__mixed__' ? '' : displayStatus}
                                options={STATUS_OPTIONS(ACH_STATUSES)}
                                onChange={(v) => commit('status', v)}
                                tone={statusTone(displayStatus)}
                                disabled={!canEditMatch}
                                title="Status"
                              />}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {/* Initials are per-split, same as Match and Status. On All
                              Locations the parent value would be misleading, so send the
                              user to the sub-rows rather than showing a dead field. */}
                          {splitsAmbiguous
                            ? <button
                                onClick={() => toggleSplitExpand(entry.id)}
                                title="Initials are set per split — expand to edit each one"
                                className="badge text-[10px] bg-slate-100 text-slate-500 border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
                              >
                                per split ▾
                              </button>
                            : <CellInput
                                value={displayInitials}
                                onCommit={(v) => commit('initials', v)}
                                placeholder="—"
                                maxLength={10}
                                disabled={!canEditMatch}
                                title="Initials"
                              />}
                        </td>
                        <td className="px-4 py-3">
                          <CellInput
                            value={splitTarget ? (entry.splits[activeSplitIdx].notes || '') : (entry.notes || '')}
                            onCommit={(v) => splitTarget
                              ? commitSplit(entry, activeSplitIdx, 'notes', v)
                              : onSaveNotes?.(entry.id, v)}
                            placeholder="Add notes…"
                            multiline
                            disabled={!canEditMatch}
                            title="Notes"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1">
                            {/* Transfer-complete marker. Icon-only by design — the initials
                                live in the tooltip so this fits ACTIONS_WIDTH. */}
                            {entry.transferComplete && (
                              <span
                                className="flex items-center justify-center w-[26px] h-[26px] shrink-0 bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg"
                                title={`Transfer complete${entry.transferInitials ? ` · ${entry.transferInitials}` : ''}`}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
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
                              {canEditFull && (
                                <button
                                  onClick={() => onOpenFull?.(entry)}
                                  className="p-1.5 rounded-lg hover:bg-indigo-500/20 text-slate-600 hover:text-indigo-400 transition-colors"
                                  title="Edit full record — date, amount, description, splits"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931zm0 0L19.5 7.125"/></svg>
                                </button>
                              )}
                              {/* Everything occasional or destructive lives behind the
                                  menu. Five flat icons gave a paperclip you click hourly
                                  the same weight as a delete you click monthly. */}
                              <RowMenu
                                items={[
                                  onOpenActivity && {
                                    label: 'View activity',
                                    onClick: () => onOpenActivity(entry),
                                    icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>,
                                  },
                                  !entry.transferComplete && showTransferComplete && {
                                    label: 'Mark transfer complete',
                                    onClick: () => setTransferCompleteId(entry.id),
                                    icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>,
                                  },
                                  canDelete && {
                                    label: 'Delete entry',
                                    danger: true,
                                    onClick: () => setConfirmId(entry.id),
                                    icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>,
                                  },
                                ]}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>

                      {/* Split sub-rows — only on All Locations or when this tab received the payment */}
                      {splitOpen && (isAllLocations || entry.fromLocation === currentLocation) && entry.splits.map((split, i) => {
                        const sid = `${entry.id}:${i}`
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
                            <td className="px-4 py-2">
                              <CellSelect
                                value={split.match}
                                options={MATCH_OPTIONS}
                                onChange={(v) => commitSplit(entry, i, 'match', v)}
                                tone={matchTone(split.match)}
                                disabled={!canEditMatch}
                                title="Match for this split"
                              />
                            </td>
                            <td className="px-4 py-2 whitespace-nowrap">
                              <CellSelect
                                value={split.status}
                                options={STATUS_OPTIONS(ACH_STATUSES)}
                                onChange={(v) => commitSplit(entry, i, 'status', v)}
                                tone={statusTone(split.status)}
                                disabled={!canEditMatch}
                                title="Status for this split"
                              />
                            </td>
                            <td className="px-4 py-2 whitespace-nowrap">
                              <CellInput
                                value={split.initials}
                                onCommit={(v) => commitSplit(entry, i, 'initials', v)}
                                placeholder="—"
                                maxLength={10}
                                disabled={!canEditMatch}
                                title="Initials for this split"
                              />
                            </td>
                            <td className="px-4 py-2">
                              <CellInput
                                value={split.notes}
                                onCommit={(v) => commitSplit(entry, i, 'notes', v)}
                                placeholder="Add notes…"
                                multiline
                                disabled={!canEditMatch}
                                title="Notes for this split"
                              />
                            </td>
                            <td className="px-3 py-2 bg-white group-hover/split-row:bg-slate-50" />
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

// A dropdown that looks like a badge. Saves on selection — no confirm step.
// A text input that stays quiet until hovered or focused. Commits on Enter or
// blur; Escape reverts. Used for Initials and Notes.

// A mini on/off switch, matching the one the old row editor used.
function SplitToggle({ on, onClick, disabled, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center gap-1.5 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed group/tog"
    >
      <span className={`relative w-6 h-3.5 rounded-full transition-colors ${on ? 'bg-indigo-500' : 'bg-slate-300 group-hover/tog:bg-slate-400'}`}>
        <span className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform duration-150 ${on ? 'translate-x-2.5' : ''}`} />
      </span>
      <span className={`text-[10px] font-medium ${on ? 'text-indigo-600' : 'text-slate-400 group-hover/tog:text-slate-600'}`}>Split</span>
    </button>
  )
}

// Belongs To cell. Off: a single location dropdown. On: one row per location
// with its own amount, edited in place.
//
// Unlike the other cells this one does NOT auto-save on every keystroke — a
// split is only valid as a complete set (2+ locations summing to the payment),
// so there's a ✓/✕ pair and the checks run on commit. Column widths can't move
// (table-layout: fixed), so opening this only makes the row taller.
function SplitCell({ entry, canEdit, display, onSaveSplits, onSaveLocation }) {
  const hasSplits = entry.splits?.length > 0
  const isPending = entry.splits !== null && entry.splits !== undefined && entry.splits.length === 0
  const splitOn   = hasSplits || isPending

  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState([])
  const [err, setErr]   = useState('')
  const [busy, setBusy] = useState(false)

  function begin() {
    setRows(hasSplits
      ? entry.splits.map((s) => ({ location: s.location || '', amount: String(s.amount ?? '') }))
      : [{ location: '', amount: '' }, { location: '', amount: '' }])
    setErr('')
    setOpen(true)
  }

  function setRow(i, field, value) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
    setErr('')
  }

  const filled   = rows.filter((r) => r.location && r.amount !== '')
  const totalC   = filled.reduce((s, r) => s + toCents(r.amount), 0)
  const targetC  = toCents(entry.amount)
  const balanced = filled.length > 1 && totalC === targetC

  async function commit() {
    if (filled.length === 1) { setErr('Needs 2+ locations'); return }
    const locs = filled.map((r) => r.location)
    if (new Set(locs).size !== locs.length) { setErr('Location repeated'); return }
    if (filled.length > 1 && totalC !== targetC) {
      const d = (targetC - totalC) / 100
      setErr(d > 0 ? `$${d.toFixed(2)} unallocated` : `$${Math.abs(d).toFixed(2)} over`)
      return
    }
    // Preserve each split's existing match/status/initials/notes when only the
    // amounts are being adjusted.
    const prev = entry.splits || []
    const next = filled.map((r) => {
      const old = prev.find((s) => s.location === r.location)
      return { ...(old || {}), location: r.location, amount: Number(r.amount) }
    })
    setBusy(true)
    try { await onSaveSplits(next); setOpen(false) }
    catch { setErr('Save failed') }
    finally { setBusy(false) }
  }

  async function turnOff() {
    setBusy(true)
    try { await onSaveSplits(null); setOpen(false) }
    catch { setErr('Save failed') }
    finally { setBusy(false) }
  }

  if (!canEdit) return display

  if (!open) {
    // Toggle sits inline, not stacked — stacking pushed the dropdown below the
    // baseline shared by Match and Status and the row looked misaligned.
    return (
      <div className="flex items-center gap-1.5">
        <SplitToggle on={splitOn} onClick={begin} title={splitOn ? 'Edit split allocation' : 'Split this payment across locations'} />
        <div className="flex-1 min-w-0">
          {splitOn
            ? display
            : <CellSelect
                value={entry.location}
                options={LOC_OPTIONS}
                onChange={onSaveLocation}
                tone={locationTone(entry.location)}
                title="Belongs To"
              />}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <SplitToggle on onClick={turnOff} disabled={busy} title="Turn split off — clears the allocation" />

      {rows.map((r, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-center gap-1">
            <div className="flex-1 min-w-0">
              <CellSelect
                value={r.location}
                options={LOC_OPTIONS}
                onChange={(v) => setRow(i, 'location', v)}
                tone={locationTone(r.location)}
              />
            </div>
            {rows.length > 2 && (
              <button
                type="button"
                onClick={() => { setRows((p) => p.filter((_, idx) => idx !== i)); setErr('') }}
                className="p-0.5 text-slate-400 hover:text-red-500 shrink-0 transition-colors"
                title="Remove location"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>
              </button>
            )}
          </div>
          <input
            type="number"
            step="0.01"
            value={r.amount}
            onChange={(e) => setRow(i, 'amount', e.target.value)}
            onWheel={(e) => e.target.blur()}
            placeholder="0.00"
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] tabular-nums text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
      ))}

      <button
        type="button"
        onClick={() => { setRows((p) => [...p, { location: '', amount: '' }]); setErr('') }}
        className="text-[10px] text-indigo-500 hover:text-indigo-600 transition-colors"
      >
        + Add location
      </button>

      {targetC !== 0 && filled.length > 0 && (
        <p className={`text-[10px] tabular-nums font-medium ${balanced ? 'text-emerald-600' : 'text-red-600'}`}>
          {balanced
            ? `✓ $${(totalC / 100).toFixed(2)} of $${(targetC / 100).toFixed(2)}`
            : `$${(totalC / 100).toFixed(2)} of $${(targetC / 100).toFixed(2)}`}
        </p>
      )}

      {err && <p className="text-[10px] text-red-600 font-medium">{err}</p>}

      <div className="flex gap-1 pt-0.5">
        <button
          type="button"
          onClick={commit}
          disabled={busy}
          className="px-2 py-0.5 text-[10px] font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-md disabled:opacity-40 transition-all"
        >
          {busy ? '…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setErr('') }}
          disabled={busy}
          className="px-2 py-0.5 text-[10px] text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}


