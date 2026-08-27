'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import AppHeader from '@/components/AppHeader'
import FilterBar, { EMPTY_FILTERS } from '@/components/FilterBar'
import ZeroPaymentsTable from '@/components/ZeroPaymentsTable'
import ZeroPaymentModal from '@/components/ZeroPaymentModal'
import { LOCATIONS, ACH_STATUSES } from '@/lib/constants'
import {
  getZeroPayments, saveZeroPayment, deleteZeroPayment, bulkInsertZeroPayments,
} from '@/lib/zeroPaymentStorage'
import ImportModal, { parseFlexDate, fuzzyLocation } from '@/components/ImportModal'
import AttachmentsPanel from '@/components/AttachmentsPanel'
import EobImportModal from '@/components/EobImportModal'
import ActivityPanel from '@/components/ActivityPanel'
import { getAttachmentCounts, uploadAttachment } from '@/lib/storage'
import { logActivity } from '@/lib/activityLog'
import { useProfile } from '@/lib/profileContext'
import { can } from '@/lib/permissions'
import { exportZeroPaymentsToExcel } from '@/lib/exportZeroPayments'
import { deriveInitials } from '@/lib/initials'

const ALL = 'all'
const PAGE_SIZE = 20

function shortLoc(loc) {
  if (!loc) return loc
  return loc.replace('Valley View Dental ', '')
}

export default function ZeroPaymentsPage() {
  const profile = useProfile()

  const [entries, setEntries]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selectedLocation, setSelectedLocation] = useState(ALL)
  const [filters, setFilters]   = useState(EMPTY_FILTERS)
  const [sortConfig, setSortConfig] = useState({ key: 'eobDate', dir: 'desc' })
  const [page, setPage]         = useState(1)
  const [modal, setModal]       = useState(false)
  const [importModal, setImportModal] = useState(false)
  const [eobModal, setEobModal] = useState(false)
  const [attachmentsEntry, setAttachmentsEntry] = useState(null)
  const [activityEntry, setActivityEntry] = useState(null)
  const [attachmentCounts, setAttachmentCounts] = useState({})

  const currentUserInitials = useMemo(() => deriveInitials(profile), [profile])

  useEffect(() => {
    getZeroPayments()
      .then(setEntries)
      .catch(() => setLoadError('Could not load zero payments. Check your connection and refresh.'))
      .finally(() => setLoading(false))
    getAttachmentCounts('zero').then(setAttachmentCounts).catch(() => {})
  }, [])

  useEffect(() => { setPage(1) }, [filters, sortConfig, selectedLocation])

  const uniqueYears = useMemo(() => {
    const years = new Set()
    entries.forEach((e) => { if (e.eobDate) years.add(Number(e.eobDate.slice(0, 4))) })
    return [...years].sort((a, b) => b - a)
  }, [entries])

  const uniqueInsurers = useMemo(
    () => [...new Set(entries.map((e) => e.insuranceName).filter(Boolean))].sort(),
    [entries]
  )

  const uniqueInitials = useMemo(
    () => [...new Set(entries.map((e) => (e.initials || '').trim()).filter(Boolean))].sort(),
    [entries]
  )

  const filtered = useMemo(() => {
    return entries
      .filter((e) => {
        if (selectedLocation !== ALL && e.location !== selectedLocation) return false
        if (e.eobDate) {
          const d = new Date(e.eobDate)
          if (filters.month && d.getUTCMonth() + 1 !== Number(filters.month)) return false
          if (filters.year  && d.getUTCFullYear() !== Number(filters.year))   return false
        } else if (filters.month || filters.year) {
          return false
        }
        if (filters.from && (!e.eobDate || e.eobDate < filters.from)) return false
        if (filters.to   && (!e.eobDate || e.eobDate > filters.to))   return false
        if (filters.match) {
          const m = e.match || 'No'
          if (filters.match === 'unmatched' ? m !== 'No' : m !== filters.match) return false
        }
        if (filters.status && e.status !== filters.status) return false
        if (filters.insurance && e.insuranceName !== filters.insurance) return false
        if (filters.initials && (e.initials || '').trim() !== filters.initials) return false
        if (filters.search) {
          const q = filters.search.toLowerCase()
          const hay = `${e.insuranceName || ''} ${e.notes || ''} ${e.initials || ''} ${e.status || ''} ${shortLoc(e.location) || ''}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => {
        const { key, dir } = sortConfig
        const av = a[key] ?? ''
        const bv = b[key] ?? ''
        const cmp = String(av).localeCompare(String(bv))
        return dir === 'asc' ? cmp : -cmp
      })
  }, [entries, selectedLocation, filters, sortConfig])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged      = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const unmatched = filtered.filter((e) => !e.match || e.match === 'No').length
  const matched   = filtered.length - unmatched

  function onSort(key) {
    setSortConfig((p) => p.key === key ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  }

  // Persist a partial edit made inline in a cell. saveZeroPayment writes every
  // column, so merge the patch onto the current row first.
  async function handleSaveFields(entry, patch) {
    const saved = await saveZeroPayment({ ...entry, ...patch })
    setEntries((prev) => prev.map((e) => (e.id === saved.id ? saved : e)))
    logActivity({
      action: 'update', module: 'Zero Payments',
      description: `Edited ${Object.keys(patch).join(', ')} — ${entry.insuranceName || 'entry'}`,
      // `before` lets the activity panel show "Status: Not Posted → Posted"
      // rather than just "set Status to Posted".
      metadata: { id: entry.id, patch, before: Object.fromEntries(Object.keys(patch).map((k) => [k, entry[k] ?? null])) },
    })
  }


  async function handleAdd(form) {
    const saved = await saveZeroPayment(form)
    setEntries((prev) => [saved, ...prev])
    setModal(false)
    logActivity({ action: 'create', module: 'Zero Payments', description: `Added zero payment — ${saved.insuranceName || 'no insurance'}, ${saved.eobDate}`, metadata: { id: saved.id } })
  }

  async function handleDelete(id) {
    try {
      await deleteZeroPayment(id)
      setEntries((prev) => prev.filter((e) => e.id !== id))
      logActivity({ action: 'delete', module: 'Zero Payments', description: 'Deleted zero payment', metadata: { id } })
    } catch {
      alert('Failed to delete. Check your connection.')
    }
  }

  // Each EOB PDF becomes one zero-payment row with the file attached to it.
  // Uploads run one at a time so a single bad file can't take the batch down —
  // whatever succeeded is kept and the failures are reported back.
  async function handleEobImport(items, onProgress) {
    const created = []
    const failed = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      try {
        const saved = await saveZeroPayment({
          eobDate:       it.date,
          location:      it.location || '',
          insuranceName: it.insuranceName || '',
          // An imported row arrives with its EOB attached, so it is matched to
          // its source document by definition. Status still starts unposted —
          // that's the part a human has to work.
          match:         'Yes',
          status:        'Not Posted',
          initials:      '',
          notes:         '',
        })
        try {
          await uploadAttachment(saved.id, it.file, profile?.email, 'zero')
          setAttachmentCounts((prev) => ({ ...prev, [saved.id]: 1 }))
        } catch {
          // The row is real even if the file didn't land — say so rather than
          // rolling back work the user can see.
          failed.push({ name: it.file.name, reason: 'row created, file upload failed' })
        }
        created.push(saved)
      } catch {
        failed.push({ name: it.file.name, reason: 'could not save' })
      }
      onProgress?.(i + 1)
    }
    if (created.length) {
      setEntries((prev) => [...created, ...prev])
      logActivity({
        action: 'import', module: 'Zero Payments',
        description: `Imported ${created.length} EOB${created.length === 1 ? '' : 's'}`,
        // ids so each imported row can show its own "Created by import" line.
        metadata: { count: created.length, failed: failed.length, ids: created.map((e) => e.id) },
      })
    }
    return { imported: created.length, failed }
  }

  function handleExport() {
    if (filtered.length === 0) return
    const locationLabel = selectedLocation === ALL ? 'All Locations' : shortLoc(selectedLocation)
    exportZeroPaymentsToExcel({ entries: filtered, locationLabel, filters })
    logActivity({
      action: 'export', module: 'Zero Payments',
      description: `Exported ${filtered.length} zero payment${filtered.length === 1 ? '' : 's'} — ${locationLabel}`,
      metadata: { count: filtered.length, location: locationLabel },
    })
  }

  // Zero payments are entered by hand — there's no bank feed behind them the way
  // there is for ACH. So adding and importing here are ordinary reconciliation
  // work, gated on the edit permission rather than the admin-only 'ach_add'.
  // Delete stays admin-only because it's destructive and unrecoverable.
  const canEdit   = can(profile, 'ach_edit_full') || can(profile, 'ach_edit_match')
  const canDelete = can(profile, 'ach_delete')
  const canAdd    = canEdit

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
                  <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Zero Payments</h1>
                  <p className="text-slate-500 text-sm mt-1.5">EOBs processed with no payment issued</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Link
                    href="/ach"
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"/>
                    </svg>
                    ACH Tracker
                  </Link>
                  {canAdd && (
                    <button
                      onClick={() => setEobModal(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m.75 12 3 3m0 0 3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"/>
                      </svg>
                      Import EOBs
                    </button>
                  )}
                  {canAdd && (
                    <button
                      onClick={() => setImportModal(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>
                      Import
                    </button>
                  )}
                  <button
                    onClick={handleExport}
                    disabled={filtered.length === 0}
                    title={filtered.length === 0 ? 'Nothing to export' : 'Export the entries currently in view'}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M7.5 7.5 12 3m0 0 4.5 4.5M12 3v13.5"/>
                    </svg>
                    Export
                  </button>
                  {canAdd && (
                    <button onClick={() => setModal(true)} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/>
                      </svg>
                      Add Entry
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mt-8 max-w-xl">
                {[
                  { label: 'Entries',   value: filtered.length.toLocaleString(), color: 'text-slate-900',
                    hint: 'Zero payments matching the current filters.', onClick: null },
                  { label: 'Matched',   value: matched.toLocaleString(),         color: 'text-emerald-600',
                    hint: 'Entries verified against a claim. Click to filter.',
                    onClick: () => setFilters((f) => ({ ...f, match: f.match === 'Yes' ? '' : 'Yes' })) },
                  { label: 'Unmatched', value: unmatched.toLocaleString(),       color: unmatched > 0 ? 'text-red-600' : 'text-emerald-600',
                    hint: 'Entries not yet verified. Click to filter.',
                    onClick: () => setFilters((f) => ({ ...f, match: f.match === 'No' ? '' : 'No' })) },
                ].map(({ label, value, color, hint, onClick }) => (
                  <div key={label} onClick={onClick} className={`relative glass-card rounded-2xl px-4 py-3.5 ${onClick ? 'cursor-pointer hover:bg-white/90 transition-all' : ''}`}>
                    <div className="flex items-start gap-1 mb-1 min-h-[2rem]">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 leading-tight">{label}</p>
                      <div className="relative group/hint ml-auto shrink-0">
                        <svg className="w-3 h-3 text-slate-400 hover:text-slate-600 cursor-help transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="10"/><path strokeLinecap="round" d="M12 16v-4M12 8h.01"/>
                        </svg>
                        <div className="absolute bottom-full right-0 mb-2 w-52 p-2.5 bg-white border border-slate-200 rounded-xl text-[11px] text-slate-700 leading-relaxed opacity-0 group-hover/hint:opacity-100 pointer-events-none transition-opacity duration-150 z-50 shadow-lg">
                          {hint}
                        </div>
                      </div>
                    </div>
                    <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs + filters */}
        <div className="max-w-[1600px] mx-auto px-6 pt-4 space-y-4">
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="flex overflow-x-auto divide-x divide-white/40">
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

          <FilterBar
            filters={filters}
            onChange={setFilters}
            uniqueYears={uniqueYears}
            uniqueInsurers={uniqueInsurers}
            uniqueInitials={uniqueInitials}
          />

          {loadError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{loadError}</p>
          )}

          <ZeroPaymentsTable
            entries={paged}
            loading={loading}
            sortConfig={sortConfig}
            onSort={onSort}
            onSaveFields={handleSaveFields}
            onDelete={handleDelete}
            canEdit={canEdit}
            canDelete={canDelete}
            currentUserInitials={currentUserInitials}
            attachmentCounts={attachmentCounts}
            onOpenAttachments={setAttachmentsEntry}
            onOpenActivity={setActivityEntry}
          />

          {totalPages > 1 && (
            <div className="flex items-center justify-between glass-card rounded-2xl px-5 py-3">
              <span className="text-xs text-slate-500 tabular-nums">
                {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(page * PAGE_SIZE, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()} entries
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Prev
                </button>
                <span className="px-3 text-xs text-slate-500 tabular-nums">Page {page} of {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          <div className="h-8" />
        </div>
      </div>

      {eobModal && (
        <EobImportModal
          uniqueInsurers={uniqueInsurers}
          onClose={() => setEobModal(false)}
          onImport={handleEobImport}
        />
      )}

      {activityEntry && (
        <ActivityPanel
          entryId={activityEntry.id}
          entryLabel={[activityEntry.insuranceName, shortLoc(activityEntry.location)].filter(Boolean).join(' · ')}
          onClose={() => setActivityEntry(null)}
        />
      )}

      {attachmentsEntry && (
        <AttachmentsPanel
          kind="zero"
          label="EOB Files"
          entryId={attachmentsEntry.id}
          entryDescription={[attachmentsEntry.insuranceName, shortLoc(attachmentsEntry.location)].filter(Boolean).join(' · ')}
          uploaderEmail={profile?.email}
          onClose={() => setAttachmentsEntry(null)}
          onCountChange={(id, n) => setAttachmentCounts((prev) => ({ ...prev, [id]: n }))}
        />
      )}

      {importModal && (
        <ImportModal
          title="Import Zero Payments"
          subtitle="Paste or upload a CSV — column names must match the header row below"
          locationOptions={LOCATIONS}
          columns={[
            { key: 'eobDate', label: 'eobDate', required: true, example: '01/15/2025',
              aliases: ['eobdate', 'eob_date', 'eob date', 'date', 'eob', 'processdate', 'processeddate', 'postingdate', 'posting_date', 'checkdate', 'remitdate'],
              validate: (v) => parseFlexDate(v) ? null : 'Cannot parse date — try MM/DD/YYYY or YYYY-MM-DD',
              transform: (v) => parseFlexDate(v) },
            { key: 'location', label: 'location', required: false, example: 'Romeoville',
              aliases: ['location', 'clinic', 'site', 'branch', 'office', 'belongsto', 'belongs_to', 'practice', 'facility'],
              validate: (v, locs) => !v || fuzzyLocation(v, locs) ? null : `Location not recognized: "${v}"`,
              transform: (v, locs) => v ? (fuzzyLocation(v, locs) || v) : null },
            { key: 'insuranceName', label: 'insuranceName', required: false, example: 'Delta Dental',
              aliases: ['insurancename', 'insurance_name', 'insurance', 'payer', 'carrier', 'insurer', 'payername', 'insurancecompany', 'plan'] },
            { key: 'match', label: 'match', required: false, example: 'No',
              aliases: ['match', 'matched', 'reconciled', 'cleared', 'verified'],
              validate: (v) => !v || ['Yes', 'No', 'Partial'].includes(v) ? null : 'match must be Yes, No, or Partial' },
            { key: 'status', label: 'status', required: false, example: 'Not Posted',
              aliases: ['status', 'state', 'condition'],
              validate: (v) => !v || ACH_STATUSES.includes(v) ? null : `status must be one of: ${ACH_STATUSES.join(', ')}`,
              defaultValue: 'Not Posted' },
            { key: 'initials', label: 'initials', required: false, example: 'JD',
              aliases: ['initials', 'by', 'staff', 'processedby', 'handledby', 'reviewer', 'user', 'employee'] },
            { key: 'notes', label: 'notes', required: false, example: 'Patient responsibility',
              aliases: ['notes', 'note', 'remarks', 'comment', 'comments', 'memo', 'reason', 'description'] },
          ]}
          onClose={() => setImportModal(false)}
          onImport={async (rows) => {
            const saved = await bulkInsertZeroPayments(rows)
            setEntries((prev) => [...saved, ...prev])
            logActivity({
              action: 'import', module: 'Zero Payments',
              description: `Imported ${saved.length} zero payment${saved.length === 1 ? '' : 's'} from CSV`,
              metadata: { count: saved.length },
            })
            return saved
          }}
        />
      )}

      {modal && (
        <ZeroPaymentModal
          onSave={handleAdd}
          onClose={() => setModal(false)}
          currentUserInitials={currentUserInitials}
        />
      )}
    </div>
  )
}
