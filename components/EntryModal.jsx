'use client'

import { useState, useEffect } from 'react'
import { LOCATIONS, ACH_STATUSES } from '@/lib/constants'
import { useProfile } from '@/lib/profileContext'
import { extractInsuranceName } from '@/lib/achParser'
import Select from './Select'
import DateInput from './DateInput'

const EMPTY = { postingDate: '', details: '', description: '', insuranceName: '', amount: '', fromLocation: '', location: '', match: '', status: '', initials: '', splits: null }
const EMPTY_SPLIT = { location: '', amount: '' }

const inp    = 'w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 outline-none transition-all duration-150 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100/50'
const inpErr = 'border-red-500/50 focus:border-red-500/60 focus:ring-red-500/20'

const DETAILS_OPTS  = [{ value: 'CREDIT', label: 'CREDIT' }, { value: 'DEBIT', label: 'DEBIT' }]
const MATCH_OPTS    = [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }, { value: 'Partial', label: 'Partial' }]
const LOCATION_OPTS = LOCATIONS.map((l) => ({ value: l, label: l }))
const STATUS_OPTS   = ACH_STATUSES.map((s) => ({ value: s, label: s }))

function deriveInitials(profile) {
  const name = profile?.full_name?.trim()
  if (name) {
    const parts = name.split(/\s+/)
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase()
  }
  const email = profile?.email || ''
  return email.slice(0, 2).toUpperCase()
}

// Money as integer cents, so split totals compare exactly.
function toCents(v) {
  return Math.round((Number(v) || 0) * 100)
}

export default function EntryModal({ entry, onSave, onClose }) {
  const profile = useProfile()
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [isSplit, setIsSplit] = useState(false)
  const [splitRows, setSplitRows] = useState([{ ...EMPTY_SPLIT }])

  useEffect(() => {
    if (entry) {
      setForm({ ...EMPTY, ...entry })
      if (entry.splits !== null && entry.splits !== undefined) {
        setIsSplit(true)
        setSplitRows(entry.splits.length > 0
          ? entry.splits.map((s) => ({ location: s.location || '', amount: String(s.amount ?? '') }))
          : [{ ...EMPTY_SPLIT }])
      } else {
        setIsSplit(false)
        setSplitRows([{ ...EMPTY_SPLIT }])
      }
    } else {
      setForm({ ...EMPTY, initials: deriveInitials(profile) })
      setIsSplit(false)
      setSplitRows([{ ...EMPTY_SPLIT }])
    }
    setErrors({})
  }, [entry, profile])

  function set(key, value) {
    setForm((p) => ({ ...p, [key]: value }))
    if (errors[key]) setErrors((p) => ({ ...p, [key]: '' }))
    // The split total is checked against the payment amount, so editing the
    // amount can resolve a split error too.
    if (key === 'amount') setErrors((p) => (p.splits ? { ...p, splits: '' } : p))
  }

  function toggleSplit(val) {
    setIsSplit(val)
    if (!val) setSplitRows([{ ...EMPTY_SPLIT }])
    setErrors((p) => (p.splits ? { ...p, splits: '' } : p))
  }

  // Any change to the allocation clears the split error so the message doesn't
  // linger after it's been fixed.
  function clearSplitError() {
    setErrors((p) => (p.splits ? { ...p, splits: '' } : p))
  }

  function setSplitRow(i, field, value) {
    setSplitRows((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r))
    clearSplitError()
  }

  function addSplitRow() {
    setSplitRows((prev) => [...prev, { ...EMPTY_SPLIT }])
    clearSplitError()
  }

  function removeSplitRow(i) {
    setSplitRows((prev) => prev.filter((_, idx) => idx !== i))
    clearSplitError()
  }

  function validate() {
    const e = {}
    if (!form.postingDate) e.postingDate = 'Required'
    if (form.amount === '' || form.amount === null) e.amount = 'Required'

    if (isSplit) {
      const filled = splitRows.filter((r) => r.location && r.amount !== '')
      // Compare in whole cents. Comparing floats lets a 1c error through:
      // 253.20 - (100 + 153.19) is 0.00999999999999 in binary floating point,
      // which slips under a 0.01 tolerance.
      const totalC = filled.reduce((s, r) => s + toCents(r.amount), 0)
      const targetC = toCents(form.amount)
      const total  = totalC / 100
      const target = targetC / 100
      const diff   = (targetC - totalC) / 100
      const locs   = filled.map((r) => r.location)

      // 0 filled rows is allowed — that's the "Split · pending" state, meaning
      // "this needs splitting but we haven't worked out the allocation yet".
      if (filled.length === 1) {
        e.splits = 'A split needs two or more locations. For a single location, turn Split off and set Belongs To instead.'
      } else if (new Set(locs).size !== locs.length) {
        e.splits = 'The same location is listed more than once. Combine those rows.'
      } else if (filled.length > 1 && totalC !== targetC) {
        e.splits = diff > 0
          ? `Split amounts total $${total.toFixed(2)} but the payment is $${target.toFixed(2)} — $${diff.toFixed(2)} is unallocated.`
          : `Split amounts total $${total.toFixed(2)}, which is $${Math.abs(diff).toFixed(2)} more than the $${target.toFixed(2)} payment.`
      }
    }

    return e
  }

  function handleSubmit(ev) {
    ev.preventDefault()
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    // Save filled rows only; empty array = split marked but not yet allocated
    const filledRows = splitRows.filter((r) => r.location && r.amount !== '')
    const splits = isSplit ? filledRows.map((r) => ({ location: r.location, amount: Number(r.amount) })) : null
    onSave({ ...form, amount: Number(form.amount), id: entry?.id, location: isSplit ? '' : form.location, splits })
  }

  // Only rows with BOTH a location and an amount count — a half-filled row
  // shouldn't make the running total look wrong while it's being typed.
  const filledSplits     = isSplit ? splitRows.filter((r) => r.location && r.amount !== '') : []
  const filledSplitCount = filledSplits.length
  const splitTotalC = filledSplits.reduce((s, r) => s + toCents(r.amount), 0)
  const entryAmountC = toCents(form.amount)
  const splitTotal  = splitTotalC / 100
  const entryAmount = entryAmountC / 100
  const splitDiff   = (entryAmountC - splitTotalC) / 100
  const splitOk     = filledSplitCount > 1 && splitTotalC === entryAmountC

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white border border-slate-200 rounded-2xl shadow-xl shadow-slate-200/80 w-full max-w-lg z-10 overflow-y-auto max-h-[90vh]">

        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{entry ? 'Edit Entry' : 'Add ACH Entry'}</h2>
            <p className="text-xs text-slate-500 mt-0.5">Fill in the transaction details below</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <F label="Posting Date" required error={errors.postingDate}>
              <DateInput value={form.postingDate} onChange={(iso) => set('postingDate', iso)} className="[&_input[type=text]]:py-2 [&_input[type=text]]:text-sm [&_input[type=text]]:rounded-xl" />
            </F>
            <F label="Amount ($)" required error={errors.amount}>
              <input type="number" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value)} onWheel={(e) => e.target.blur()} placeholder="0.00" className={`${inp} ${errors.amount ? inpErr : ''}`} />
            </F>
          </div>

          <F label="Details">
            <Select value={form.details} onChange={(v) => set('details', v)} placeholder="—" options={DETAILS_OPTS} wide />
          </F>

          <F label="Description">
            <textarea
              value={form.description}
              onChange={(e) => {
                const desc = e.target.value
                set('description', desc)
                if (!form.insuranceName) {
                  const detected = extractInsuranceName(desc)
                  if (detected) set('insuranceName', detected)
                }
              }}
              placeholder="Paste ACH description here…"
              rows={3}
              className={`${inp} resize-none`}
            />
          </F>

          <F label="Insurance Name">
            <div className="flex gap-2">
              <input type="text" value={form.insuranceName} onChange={(e) => set('insuranceName', e.target.value)} placeholder="e.g. Delta Dental, Cigna…" className={`${inp} flex-1`} />
              <button
                type="button"
                onClick={() => {
                  const detected = extractInsuranceName(form.description)
                  if (detected) set('insuranceName', detected)
                }}
                title="Auto-detect from description"
                className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-all shrink-0"
              >
                Detect
              </button>
            </div>
          </F>

          <F label="From Location">
            <Select value={form.fromLocation} onChange={(v) => set('fromLocation', v)} placeholder="Select location…" options={LOCATION_OPTS} wide />
          </F>

          {/* To Location with split toggle */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">To Location</label>
              <button type="button" onClick={() => toggleSplit(!isSplit)} className="flex items-center gap-1.5">
                <div className={`relative w-7 h-4 rounded-full transition-colors ${isSplit ? 'bg-indigo-500' : 'bg-slate-300'}`}>
                  <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform duration-150 ${isSplit ? 'translate-x-3' : 'translate-x-0'}`} />
                </div>
                <span className="text-[11px] font-medium text-slate-500">Split payment</span>
              </button>
            </div>

            {!isSplit ? (
              <Select value={form.location} onChange={(v) => set('location', v)} placeholder="Select location…" options={LOCATION_OPTS} wide />
            ) : (
              <div className="space-y-2">
                {splitRows.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1">
                      <Select value={row.location} onChange={(v) => setSplitRow(i, 'location', v)} placeholder="Location…" options={LOCATION_OPTS} wide />
                    </div>
                    <div className="w-28 shrink-0">
                      <input type="number" step="0.01" value={row.amount} onChange={(e) => setSplitRow(i, 'amount', e.target.value)} onWheel={(e) => e.target.blur()} placeholder="0.00" className={inp} />
                    </div>
                    {splitRows.length > 1 && (
                      <button type="button" onClick={() => removeSplitRow(i)} className="p-1.5 text-slate-600 hover:text-red-400 transition-colors shrink-0">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/>
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
                <div className="flex items-center justify-between pt-0.5">
                  <button type="button" onClick={addSplitRow} className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/>
                    </svg>
                    Add location
                  </button>
                  {entryAmount > 0 && filledSplitCount > 0 && (
                    <span className={`text-xs font-medium tabular-nums ${splitOk ? 'text-emerald-600' : 'text-red-600'}`}>
                      {splitOk
                        ? `✓ $${splitTotal.toFixed(2)} of $${entryAmount.toFixed(2)} allocated`
                        : `⚠ $${splitTotal.toFixed(2)} of $${entryAmount.toFixed(2)} — ${splitDiff > 0 ? `$${splitDiff.toFixed(2)} short` : `$${Math.abs(splitDiff).toFixed(2)} over`}`}
                    </span>
                  )}
                </div>
                {filledSplitCount === 1 && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-1">
                    One location isn't a split. Add another, or turn Split off and set a single Belongs To.
                  </p>
                )}
                {errors.splits && (
                  <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 mt-1 font-medium">{errors.splits}</p>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <F label="Match">
              <Select value={form.match} onChange={(v) => set('match', v)} placeholder="—" options={MATCH_OPTS} wide />
            </F>
            <F label="Status & Initials">
              <div className="flex flex-col gap-2">
                <Select value={form.status} onChange={(v) => set('status', v)} placeholder="Status…" options={STATUS_OPTS} wide />
                <input type="text" value={form.initials} onChange={(e) => set('initials', e.target.value)} placeholder="Initials e.g. JD" maxLength={10} className={inp} />
              </div>
            </F>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 rounded-xl transition-all">Cancel</button>
            <button type="submit" className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all shadow-lg shadow-indigo-200/80 active:scale-[0.98]">
              {entry ? 'Save changes' : 'Add entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function F({ label, required, error, children }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-[11px] text-red-400 font-medium">{error}</p>}
    </div>
  )
}
