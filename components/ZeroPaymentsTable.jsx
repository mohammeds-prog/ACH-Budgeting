'use client'

import { useState } from 'react'
import { LOCATIONS, ACH_STATUSES } from '@/lib/constants'
import { CellSelect, CellInput, matchTone, statusTone, locationTone } from './cells'

// ─────────────────────────────────────────────────────────────────────────────
// Same layout contract as ACHTable: `table-layout: fixed` + a <colgroup> built
// from these widths, so cell content can never change column geometry.
//
// Editing works exactly like the ACH table — every editable field is always a
// visible control that saves itself. There is no row edit mode and no Save
// button. Unlike ACH this table has no splits or amounts to reconcile, so every
// column is directly editable and nothing needs a modal.
//
// Total must stay under the page container's usable width
// (max-w-[1600px] - px-6 = 1552px in app/zero-payments/page.js).
// ─────────────────────────────────────────────────────────────────────────────
const COLS = [
  { key: 'eobDate',       label: 'EOB Date',  width: 130 },
  { key: 'location',      label: 'Location',  width: 155 },
  { key: 'insuranceName', label: 'Insurance', width: 190 },
  { key: 'match',         label: 'Match',     width: 110 },
  { key: 'status',        label: 'Status',    width: 135 },
  { key: 'initials',      label: 'Initials',  width: 105 },
  { key: 'notes',         label: 'Notes',     width: 300 },
]
const ACTIONS_WIDTH = 90
const COLS_WIDTH    = COLS.reduce((sum, c) => sum + c.width, 0) + ACTIONS_WIDTH

function shortLoc(loc) {
  if (!loc) return null
  return loc.replace('Valley View Dental ', '')
}

function formatDate(val) {
  if (!val) return '—'
  const [y, m, d] = val.split('-')
  return `${m}/${d}/${y}`
}

const LOC_OPTIONS    = [{ value: '', label: '—' }, ...LOCATIONS.map((l) => ({ value: l, label: shortLoc(l) }))]
const MATCH_OPTIONS  = [{ value: '', label: '—' }, { value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }, { value: 'Partial', label: 'Partial' }]
const STATUS_OPTIONS = [{ value: '', label: 'Status…' }, ...ACH_STATUSES.map((s) => ({ value: s, label: s }))]

export default function ZeroPaymentsTable({
  entries, loading,
  sortConfig, onSort,
  onSaveFields, onDelete,
  canEdit = true, canDelete = true,
  currentUserInitials = '',
}) {
  const [confirmId, setConfirmId] = useState(null)

  // Setting a status with no initials yet fills them in from the current user —
  // same rule as the ACH table.
  async function commit(entry, field, value) {
    const patch = { [field]: value }
    if (field === 'status' && value && value !== 'Not Posted' && !entry.initials?.trim() && currentUserInitials) {
      patch.initials = currentUserInitials
    }
    if (String(entry[field] ?? '') === String(value ?? '') && !patch.initials) return
    try { await onSaveFields?.(entry, patch) }
    catch { alert('Failed to save. Check your connection.') }
  }

  if (loading) {
    return (
      <div className="glass-card rounded-2xl flex items-center justify-center py-20 gap-2.5">
        <div className="w-5 h-5 border-2 border-violet-400/40 border-t-violet-500 rounded-full animate-spin" />
        <span className="text-sm text-slate-500">Loading…</span>
      </div>
    )
  }

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      {entries.length === 0 ? (
        <div className="text-center py-16 px-6">
          <div className="w-11 h-11 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto mb-3">
            <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-slate-500">No zero payments found</p>
          <p className="text-xs text-slate-400 mt-1">Try adjusting your filters or add an entry</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm table-fixed" style={{ minWidth: COLS_WIDTH }}>
            <colgroup>
              {COLS.map((c) => <col key={c.key} style={{ width: c.width }} />)}
              <col style={{ width: ACTIONS_WIDTH }} />
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr className="border-b border-slate-200">
                {COLS.map((col) => {
                  const isSorted = sortConfig.key === col.key
                  return (
                    <th
                      key={col.key}
                      onClick={() => onSort(col.key)}
                      className="px-4 py-3 text-left select-none cursor-pointer group bg-slate-50"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[11px] font-semibold uppercase tracking-widest transition-colors ${isSorted ? 'text-indigo-600' : 'text-slate-500 group-hover:text-slate-700'}`}>{col.label}</span>
                        <span className={`text-[10px] transition-opacity ${isSorted ? 'opacity-100 text-indigo-600' : 'opacity-0 group-hover:opacity-40 text-slate-500'}`}>
                          {isSorted ? (sortConfig.dir === 'asc' ? '↑' : '↓') : '↕'}
                        </span>
                      </div>
                    </th>
                  )
                })}
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const unmatched = !e.match || e.match === 'No'
                return (
                  <tr
                    key={e.id}
                    className={`group/row border-b border-slate-200 transition-colors last:border-0 ${
                      unmatched ? 'bg-red-50/60 hover:bg-red-50' : 'hover:bg-violet-50/50'
                    }`}
                  >
                    <td className="px-4 py-3">
                      {canEdit ? (
                        <input
                          type="date"
                          value={e.eobDate || ''}
                          onChange={(ev) => commit(e, 'eobDate', ev.target.value)}
                          title="EOB Date"
                          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] tabular-nums text-slate-700 outline-none transition-colors hover:border-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                        />
                      ) : (
                        <span className="text-slate-700 font-medium tabular-nums text-xs">{formatDate(e.eobDate)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <CellSelect
                        value={e.location}
                        options={LOC_OPTIONS}
                        onChange={(v) => commit(e, 'location', v)}
                        tone={locationTone(e.location)}
                        disabled={!canEdit}
                        title="Location"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <CellInput
                        value={e.insuranceName}
                        onCommit={(v) => commit(e, 'insuranceName', v)}
                        placeholder="—"
                        disabled={!canEdit}
                        title="Insurance"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <CellSelect
                        value={e.match}
                        options={MATCH_OPTIONS}
                        onChange={(v) => commit(e, 'match', v)}
                        tone={matchTone(e.match)}
                        disabled={!canEdit}
                        title="Match"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <CellSelect
                        value={e.status}
                        options={STATUS_OPTIONS}
                        onChange={(v) => commit(e, 'status', v)}
                        tone={statusTone(e.status)}
                        disabled={!canEdit}
                        title="Status"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <CellInput
                        value={e.initials}
                        onCommit={(v) => commit(e, 'initials', v)}
                        placeholder="—"
                        maxLength={10}
                        disabled={!canEdit}
                        title="Initials"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <CellInput
                        value={e.notes}
                        onCommit={(v) => commit(e, 'notes', v)}
                        placeholder="Add notes…"
                        multiline
                        disabled={!canEdit}
                        title="Notes"
                      />
                    </td>
                    <td className="px-3 py-3">
                      {confirmId === e.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => { onDelete(e.id); setConfirmId(null) }}
                            className="px-2 py-1 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-all"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="px-2 py-1 text-[11px] text-slate-500 hover:text-slate-700 bg-slate-100 rounded-lg transition-all"
                          >
                            ✕
                          </button>
                        </div>
                      ) : canDelete ? (
                        <button
                          onClick={() => setConfirmId(e.id)}
                          title="Delete"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-100 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/>
                          </svg>
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
