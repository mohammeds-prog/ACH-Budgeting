'use client'

import { useState, useEffect } from 'react'
import { LOCATIONS } from '@/lib/expenditureStorage'

const EMPTY = { date: '', person: '', description: '', vendor: '', clinic: '', amount: '' }

const inp = 'w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 outline-none transition-all duration-150 focus:border-violet-400 focus:ring-2 focus:ring-violet-100'
const inpErr = 'border-red-400 focus:border-red-400 focus:ring-red-100'

export default function ExpEntryModal({ entry, defaultMonth, defaultLocation, vendors = [], onAddVendor, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [addingVendor, setAddingVendor] = useState(false)
  const [newVendorName, setNewVendorName] = useState('')

  useEffect(() => {
    if (entry) {
      setForm({ ...EMPTY, ...entry })
    } else {
      const [y, m] = defaultMonth.split('-')
      const today = new Date()
      const sameMonth = today.getFullYear() === Number(y) && today.getMonth() + 1 === Number(m)
      const dateStr = sameMonth ? today.toISOString().split('T')[0] : `${y}-${m}-01`
      setForm({ ...EMPTY, date: dateStr, clinic: defaultLocation || '' })
    }
    setErrors({})
    setAddingVendor(false)
    setNewVendorName('')
  }, [entry, defaultMonth, defaultLocation])

  function set(key, val) {
    setForm((p) => ({ ...p, [key]: val }))
    if (errors[key]) setErrors((p) => ({ ...p, [key]: '' }))
  }

  function validate() {
    const e = {}
    if (!form.date) e.date = 'Required'
    if (!form.person.trim()) e.person = 'Required'
    if (!form.clinic) e.clinic = 'Required'
    if (form.amount === '' || isNaN(Number(form.amount))) e.amount = 'Required'
    return e
  }

  function handleSubmit(ev) {
    ev.preventDefault()
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    onSave({ ...form, amount: Number(form.amount), id: entry?.id })
  }

  function confirmNewVendor() {
    const name = newVendorName.trim()
    if (!name) return
    onAddVendor?.(name)
    set('vendor', name)
    setNewVendorName('')
    setAddingVendor(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-md z-10 overflow-hidden">

        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{entry ? 'Edit Expense' : 'Log Expense'}</h2>
            <p className="text-xs text-slate-400 mt-0.5">Record a supply purchase</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <F label="Date" required error={errors.date}>
              <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className={`${inp} ${errors.date ? inpErr : ''}`} />
            </F>
            <F label="Amount ($)" required error={errors.amount}>
              <input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => set('amount', e.target.value)} onWheel={(e) => e.target.blur()} placeholder="0.00" className={`${inp} ${errors.amount ? inpErr : ''}`} />
            </F>
          </div>

          <F label="Location" required error={errors.clinic}>
            <select value={form.clinic} onChange={(e) => set('clinic', e.target.value)} className={`${inp} ${errors.clinic ? inpErr : ''} appearance-none cursor-pointer`}>
              <option value="">Select location…</option>
              {LOCATIONS.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
            </select>
          </F>

          <F label="Person" required error={errors.person}>
            <input type="text" value={form.person} onChange={(e) => set('person', e.target.value)} placeholder="Full name or initials" className={`${inp} ${errors.person ? inpErr : ''}`} />
          </F>

          <F label="Vendor">
            <select
              value={form.vendor || ''}
              onChange={(e) => {
                if (e.target.value === '__add__') { setAddingVendor(true); return }
                set('vendor', e.target.value)
              }}
              className={`${inp} appearance-none cursor-pointer`}
            >
              <option value="">— Select vendor —</option>
              {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
              <option value="__add__">+ Add new vendor…</option>
            </select>
            {addingVendor && (
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={newVendorName}
                  onChange={(e) => setNewVendorName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmNewVendor() } if (e.key === 'Escape') { setAddingVendor(false); setNewVendorName('') } }}
                  placeholder="Vendor name…"
                  className={inp}
                  autoFocus
                />
                <button type="button" onClick={confirmNewVendor} className="px-3 py-2 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-xl whitespace-nowrap transition-all">Add</button>
                <button type="button" onClick={() => { setAddingVendor(false); setNewVendorName('') }} className="px-2.5 py-2 text-xs text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all">✕</button>
              </div>
            )}
          </F>

          <F label="Item / Description">
            <input type="text" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. Exam gloves, syringes…" className={inp} />
          </F>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-xl transition-all">Cancel</button>
            <button type="submit" className="px-4 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition-all shadow-lg shadow-violet-200 active:scale-[0.98]">
              {entry ? 'Save changes' : 'Log expense'}
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
      <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-[11px] text-red-500 font-medium">{error}</p>}
    </div>
  )
}
