'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import AppHeader from '@/components/AppHeader'
import Pager from '@/components/Pager'
import Select from '@/components/Select'
import DateInput, { isoToUS } from '@/components/DateInput'
import LoadError from '@/components/LoadError'
import ImportModal, { parseFlexDate, parseAmount } from '@/components/ImportModal'
import { extractInsuranceName } from '@/lib/achParser'
import { excludeNonInsurance, bankAccountFromFileName } from '@/lib/chaseImport'
import {
  ARCHIVE_PAGE_SIZE, searchArchive, fetchAllMatching, getArchiveSummary, getArchiveFilterOptions,
  uploadArchiveRows, deleteMatching, hasAnyFilter, searchTerms, parseAmountFilter,
} from '@/lib/archiveStorage'
import { exportArchiveToExcel } from '@/lib/exportArchive'
import { useProfile } from '@/lib/profileContext'
import { can } from '@/lib/permissions'
import { logActivity } from '@/lib/activityLog'

// A missing table looks exactly like a network failure unless the error says
// otherwise — and the usual cause is that supabase/ach_archive.sql hasn't been
// run yet. Spell that out instead of telling people to check their connection.
function describeArchiveError(err) {
  const msg = String(err?.message || '')
  if (err?.code === 'PGRST205' || /ach_archive|schema cache/i.test(msg)) {
    return 'The archive hasn’t been set up in the database yet. Run supabase/ach_archive.sql in the Supabase SQL Editor, then retry.'
  }
  if (/fetch|network|abort|timeout/i.test(msg)) {
    return 'Couldn’t reach the database. Check your connection and retry.'
  }
  return `Couldn’t search the archive: ${msg || 'unknown error'}`
}

const EMPTY_FILTERS = { q: '', amount: '', from: '', to: '', insurance: '', bankAccount: '', details: '' }
const SEARCH_DEBOUNCE_MS = 300

function fmtMoney(n) {
  if (n == null) return '—'
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Wrap every search term in a <mark>, so the trace or EFT number someone was
// hunting for stands out inside 300 characters of bank text.
function Highlight({ text, terms }) {
  if (!text) return <span className="text-slate-300">—</span>
  if (!terms.length) return text
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'gi'))
  const lower = new Set(terms.map((t) => t.toLowerCase()))
  return parts.map((p, i) =>
    lower.has(p.toLowerCase())
      ? <mark key={i} className="bg-amber-100 text-slate-900 rounded px-0.5">{p}</mark>
      : <span key={i}>{p}</span>
  )
}

export default function ArchivePage() {
  const profile = useProfile()
  const canUpload = can(profile, 'archive_upload')
  const canDelete = can(profile, 'archive_delete')

  const [filters, setFilters]   = useState(EMPTY_FILTERS)
  const [applied, setApplied]   = useState(EMPTY_FILTERS)   // debounced copy that drives queries
  const [sort, setSort]         = useState({ key: 'postingDate', dir: 'desc' })
  const [page, setPage]         = useState(1)

  const [rows, setRows]         = useState([])
  const [total, setTotal]       = useState(0)
  const [searching, setSearching] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [summary, setSummary]   = useState(null)
  const [options, setOptions]   = useState({ accounts: [], insurers: [] })
  const [refreshKey, setRefreshKey] = useState(0)

  const [importOpen, setImportOpen] = useState(false)
  const [notice, setNotice]     = useState('')
  const [exporting, setExporting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Typing updates the box immediately; the query waits for a pause.
  useEffect(() => {
    const t = setTimeout(() => setApplied(filters), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [filters])

  useEffect(() => { setPage(1) }, [applied, sort])

  // Archive size + filter lists. Re-read after an upload or delete.
  useEffect(() => {
    getArchiveSummary().then(setSummary).catch(() => setSummary(null))
    getArchiveFilterOptions().then(setOptions).catch(() => {})
  }, [refreshKey])

  // Only the newest request may update the table — a slow early response must
  // never overwrite the results of what the user typed after it.
  const requestSeq = useRef(0)
  useEffect(() => {
    const seq = ++requestSeq.current
    setSearching(true)
    setLoadError('')
    searchArchive(applied, { page, sort: { key: sort.key === 'amount' ? 'amount' : 'posting_date', dir: sort.dir } })
      .then(({ rows, total }) => {
        if (seq !== requestSeq.current) return
        setRows(rows)
        setTotal(total)
      })
      .catch((err) => {
        if (seq !== requestSeq.current) return
        setLoadError(describeArchiveError(err))
      })
      .finally(() => { if (seq === requestSeq.current) setSearching(false) })
  }, [applied, page, sort, refreshKey])

  const terms       = useMemo(() => searchTerms(applied.q), [applied.q])
  const amountState = parseAmountFilter(filters.amount)
  const filtered    = hasAnyFilter(applied)
  const totalPages  = Math.max(1, Math.ceil(total / ARCHIVE_PAGE_SIZE))
  const archiveEmpty = summary && summary.total === 0
  const activeFilterCount = Object.values(filters).filter(Boolean).length

  function setFilter(key, value) { setFilters((f) => ({ ...f, [key]: value })) }

  function toggleSort(key) {
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))
  }

  async function handleExport() {
    if (!total || exporting) return
    setExporting(true)
    try {
      const all = await fetchAllMatching(applied, { key: sort.key === 'amount' ? 'amount' : 'posting_date', dir: sort.dir })
      exportArchiveToExcel({ rows: all, filters: applied })
      logActivity({ action: 'export', module: 'Archive', description: `Exported ${all.length} archived payments`, metadata: { count: all.length, filters: applied } })
    } catch {
      alert('Export failed. Check your connection and try again.')
    } finally {
      setExporting(false)
    }
  }

  async function handleImport(entries) {
    const { inserted, alreadyInArchive, duplicatesInFile } = await uploadArchiveRows(entries, profile?.email)
    const skipped = alreadyInArchive + duplicatesInFile
    setNotice(
      `Upload finished: ${inserted.toLocaleString()} new ${inserted === 1 ? 'payment' : 'payments'} added` +
      (skipped ? ` · ${skipped.toLocaleString()} skipped because they were already in the archive` : '') + '.'
    )
    logActivity({
      action: 'import', module: 'Archive',
      description: `Uploaded ${inserted} payments to the archive`,
      metadata: { inserted, alreadyInArchive, duplicatesInFile },
    })
    setRefreshKey((k) => k + 1)
    // ImportModal only reads `.length` for its own summary.
    return { length: inserted }
  }

  async function handleDeleteConfirmed() {
    const removed = await deleteMatching(applied)
    logActivity({
      action: 'delete', module: 'Archive',
      description: `Deleted ${removed} archived payments`,
      metadata: { count: removed, filters: applied },
    })
    setDeleteOpen(false)
    setNotice(`Deleted ${removed.toLocaleString()} ${removed === 1 ? 'payment' : 'payments'} from the archive.`)
    setRefreshKey((k) => k + 1)
  }

  if (!profile) return null

  const sortIcon = (key) => sort.key === key ? <span className="text-indigo-500 ml-1">{sort.dir === 'asc' ? '↑' : '↓'}</span> : null

  return (
    <div className="min-h-screen futuristic-bg relative">
      <div className="relative z-10">
        <AppHeader />

        <div className="futuristic-hero">
          <div className="relative w-full px-6 py-10 z-10">
            <div className="max-w-[1600px] mx-auto">
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-indigo-500 text-xs font-semibold uppercase tracking-widest mb-2">Documents</p>
                  <h1 className="text-3xl font-bold text-slate-900 tracking-tight">ACH Archive</h1>
                  <p className="text-slate-500 text-sm mt-1.5">Look up past payments by anything in the bank description — trace, EFT or check numbers, payer, IDs.</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {canUpload && (
                    <button onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                      Upload
                    </button>
                  )}
                  <button onClick={handleExport} disabled={!total || exporting}
                    title={total ? `Export all ${total.toLocaleString()} matching payments` : 'Nothing to export'}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M7.5 7.5 12 3m0 0 4.5 4.5M12 3v13.5" /></svg>
                    {exporting ? 'Exporting…' : 'Export'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-7 max-w-3xl">
                <Stat label="Payments archived" value={summary ? summary.total.toLocaleString() : '—'} />
                <Stat label="Covers" value={summary?.first ? `${isoToUS(summary.first)} – ${isoToUS(summary.last)}` : '—'} small />
                <Stat label="Bank accounts" value={options.accounts.length ? options.accounts.join(', ') : '—'} small />
              </div>
            </div>
          </div>
        </div>

        <div className="w-full px-6 pt-4 pb-16">
          <div className="max-w-[1600px] mx-auto space-y-4">
            {notice && (
              <div className="flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                <p className="text-sm text-emerald-800">{notice}</p>
                <button onClick={() => setNotice('')} className="text-xs font-medium text-emerald-700 hover:text-emerald-900">Dismiss</button>
              </div>
            )}
            {loadError && <LoadError message={loadError} />}

            {/* Search */}
            <div className="glass-card rounded-2xl px-5 py-4 space-y-4">
              <div className="relative">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="m21 21-4.35-4.35" />
                </svg>
                <input
                  autoFocus
                  type="text"
                  value={filters.q}
                  onChange={(e) => setFilter('q', e.target.value)}
                  placeholder="Search the bank description — e.g. 954116767, METLIFE, 1135581829"
                  className="w-full pl-10 pr-4 py-3 text-sm rounded-xl border bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100/50"
                />
              </div>
              <div className="flex flex-wrap gap-3 items-end">
                <Field label="Amount">
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">$</span>
                    <input type="text" inputMode="decimal" value={filters.amount}
                      onChange={(e) => setFilter('amount', e.target.value.replace(/[^0-9.,$]/g, ''))}
                      placeholder="253.20"
                      title="An exact amount (253.20), or whole dollars (253 = $253.00–$253.99)"
                      className={`pl-6 pr-2.5 py-1.5 w-[130px] text-sm rounded-xl border bg-white text-slate-900 placeholder:text-slate-400 outline-none tabular-nums focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100/50 ${amountState?.invalid ? 'border-red-300' : 'border-slate-200'}`} />
                  </div>
                </Field>
                <Field label="From"><DateInput value={filters.from} onChange={(iso) => setFilter('from', iso || '')} title="From date" /></Field>
                <Field label="To"><DateInput value={filters.to} onChange={(iso) => setFilter('to', iso || '')} title="To date" /></Field>
                <Field label="Insurance">
                  <Select value={filters.insurance} onChange={(v) => setFilter('insurance', v)} placeholder="All" wide
                    options={options.insurers.map((v) => ({ value: v, label: v }))} />
                </Field>
                <Field label="Bank account">
                  <Select value={filters.bankAccount} onChange={(v) => setFilter('bankAccount', v)} placeholder="All"
                    options={options.accounts.map((v) => ({ value: v, label: v }))} />
                </Field>
                <Field label="Type">
                  <Select value={filters.details} onChange={(v) => setFilter('details', v)} placeholder="All"
                    options={[{ value: 'CREDIT', label: 'Credit' }, { value: 'DEBIT', label: 'Debit' }]} />
                </Field>
                {activeFilterCount > 0 && (
                  <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-xs text-slate-500 hover:text-slate-800 pb-2">Clear all</button>
                )}
              </div>
            </div>

            {archiveEmpty ? (
              <div className="glass-card rounded-2xl px-6 py-10 text-center">
                <p className="text-sm font-semibold text-slate-800">The archive is empty</p>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
                  {canUpload
                    ? 'Upload Chase activity exports (CSV or Excel). The bank account is read from the file name, and re-uploading overlapping months never creates duplicates.'
                    : 'An admin or manager needs to upload past bank activity before it can be searched.'}
                </p>
                {canUpload && (
                  <button onClick={() => setImportOpen(true)} className="mt-4 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all">
                    Upload bank activity
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-sm text-slate-600">
                    {searching ? 'Searching…' : <><b className="text-slate-900 tabular-nums">{total.toLocaleString()}</b> {total === 1 ? 'payment' : 'payments'}{filtered ? ' match' : ' in the archive'}</>}
                  </p>
                  {canDelete && filtered && total > 0 && !searching && (
                    <button onClick={() => setDeleteOpen(true)} className="text-xs font-medium text-red-600 hover:text-red-800">
                      Delete these {total.toLocaleString()}…
                    </button>
                  )}
                </div>

                <Pager page={page} totalPages={totalPages} pageSize={ARCHIVE_PAGE_SIZE} total={total} onChange={setPage} />

                <div className={`glass-card rounded-2xl overflow-hidden transition-opacity ${searching ? 'opacity-60' : ''}`}>
                  <div className="overflow-x-auto">
                    <table className="w-full" style={{ tableLayout: 'fixed' }}>
                      <colgroup>
                        <col style={{ width: 110 }} /><col style={{ width: 90 }} /><col style={{ width: 110 }} />
                        <col style={{ width: 190 }} /><col style={{ width: 120 }} /><col />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500 bg-slate-50">
                          <th className="px-4 py-3 cursor-pointer select-none hover:text-slate-700" onClick={() => toggleSort('postingDate')}>Date{sortIcon('postingDate')}</th>
                          <th className="px-4 py-3">Details</th>
                          <th className="px-4 py-3">Bank Account</th>
                          <th className="px-4 py-3">Insurance</th>
                          <th className="px-4 py-3 text-right cursor-pointer select-none hover:text-slate-700" onClick={() => toggleSort('amount')}>Amount{sortIcon('amount')}</th>
                          <th className="px-4 py-3">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!searching && rows.length === 0 ? (
                          <tr><td colSpan={6} className="px-4 py-14 text-center text-sm text-slate-500">No payments match. Try fewer words, or a different spelling.</td></tr>
                        ) : rows.map((r) => (
                          <tr key={r.id} className="border-b border-slate-100 last:border-0 align-top hover:bg-indigo-50/30">
                            <td className="px-4 py-3 text-xs font-medium text-slate-700 tabular-nums whitespace-nowrap">{isoToUS(r.postingDate)}</td>
                            <td className="px-4 py-3">
                              {r.details && (
                                <span className={`badge text-[10px] ${r.details === 'CREDIT' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-red-100 text-red-700 border border-red-200'}`}>{r.details}</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-600 tabular-nums">{r.bankAccount || '—'}</td>
                            <td className="px-4 py-3 text-xs text-slate-700 break-words">{r.insuranceName || '—'}</td>
                            <td className="px-4 py-3 text-sm font-semibold text-slate-900 tabular-nums text-right whitespace-nowrap">{fmtMoney(r.amount)}</td>
                            <td className="px-4 py-3 text-xs text-slate-600 break-words leading-relaxed font-mono">
                              <Highlight text={r.description} terms={terms} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <Pager page={page} totalPages={totalPages} pageSize={ARCHIVE_PAGE_SIZE} total={total} onChange={setPage} />
              </>
            )}
          </div>
        </div>
      </div>

      {importOpen && (
        <ImportModal
          title="Upload to the ACH Archive"
          subtitle="Chase activity export (CSV or Excel). Rows already in the archive are skipped, so overlapping months are safe to re-upload."
          deriveFromFileName={bankAccountFromFileName}
          // Same rule as the ACH tracker: 5/3 Bankcard, Synchrony and Cherry
          // deposits are skipped (and listed as skipped, never silently).
          excludeRow={excludeNonInsurance}
          onClose={() => setImportOpen(false)}
          onImport={handleImport}
          postProcess={(entry) => {
            if (!entry.insuranceName && entry.description) {
              const detected = extractInsuranceName(entry.description)
              if (detected) entry.insuranceName = detected
            }
          }}
          columns={[
            { key: 'postingDate', label: 'postingDate', required: true, example: '01/15/2025',
              aliases: ['postingdate', 'posting_date', 'date', 'transactiondate', 'txndate', 'postdate', 'valuedate', 'settledate', 'settlementdate', 'entrydate', 'effectivedate', 'dateposted'],
              validate: (v) => parseFlexDate(v) ? null : 'Cannot parse date — try MM/DD/YYYY or YYYY-MM-DD',
              transform: (v) => parseFlexDate(v) },
            { key: 'details', label: 'details', required: false, example: 'CREDIT',
              aliases: ['details', 'type', 'transactiontype', 'creditdebit', 'debitcredit'],
              validate: (v) => !v || ['CREDIT', 'DEBIT'].includes(v.toUpperCase()) ? null : 'details must be CREDIT or DEBIT',
              transform: (v) => v ? v.toUpperCase() : null },
            { key: 'bankAccount', label: 'bankAccount', required: false, example: '8209',
              aliases: ['bankaccount', 'bank_account', 'bank account', 'account', 'accountnumber', 'account_number', 'acct'] },
            { key: 'description', label: 'description', required: true, example: 'ORIG CO NAME:METLIFE DENTAL …',
              aliases: ['description', 'desc', 'memo', 'narrative', 'particulars', 'transactiondescription'] },
            { key: 'amount', label: 'amount', required: true, example: '1,250.00',
              aliases: ['amount', 'value', 'transactionamount', 'txnamount'],
              validate: (v) => isNaN(parseAmount(v)) ? 'amount must be a number' : null,
              transform: (v) => parseAmount(v) },
          ]}
        />
      )}

      {deleteOpen && (
        <DeleteResultsModal count={total} onCancel={() => setDeleteOpen(false)} onConfirm={handleDeleteConfirmed} />
      )}
    </div>
  )
}

// Deleting from the archive is permanent and works on the whole result set,
// not just the visible page — so the count has to be typed out.
function DeleteResultsModal({ count, onCancel, onConfirm }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')
  const ok = typed.replace(/[,\s]/g, '') === String(count)

  async function go() {
    if (!ok || busy) return
    setBusy(true)
    setError('')
    try { await onConfirm() } catch (e) { setError(e?.message || 'Delete failed.'); setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={busy ? undefined : onCancel} />
      <div className="relative bg-white rounded-2xl shadow-xl border border-slate-200 p-6 w-full max-w-sm z-10">
        <h3 className="font-semibold text-slate-900">Delete {count.toLocaleString()} archived {count === 1 ? 'payment' : 'payments'}?</h3>
        <p className="text-sm text-slate-500 mt-1.5">
          This removes <b>every payment matching your current search and filters</b> — including the ones on other pages. It cannot be undone.
        </p>
        <label className="block text-[11px] font-semibold text-slate-600 mt-4 mb-1.5">Type <b className="tabular-nums">{count}</b> to confirm</label>
        <input autoFocus type="text" inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') go() }}
          className={`w-full px-3 py-2 text-sm rounded-xl border outline-none tabular-nums focus:ring-2 focus:ring-red-100 ${typed && !ok ? 'border-red-300' : 'border-slate-200'}`} />
        {error && <p className="text-xs text-red-700 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} disabled={busy} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-xl disabled:opacity-40">Cancel</button>
          <button onClick={go} disabled={!ok || busy} className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-500 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? 'Deleting…' : `Delete ${count.toLocaleString()}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, small }) {
  return (
    <div className="glass-card rounded-2xl px-5 py-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`${small ? 'text-base' : 'text-2xl'} font-bold mt-1 tabular-nums text-slate-900 truncate`} title={typeof value === 'string' ? value : undefined}>{value}</p>
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
