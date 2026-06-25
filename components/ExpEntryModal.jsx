'use client'

import { useState, useEffect } from 'react'
import { LOCATIONS } from '@/lib/expenditureStorage'

const EMPTY = { date: '', person: '', description: '', vendor: '', clinic: '', amount: '' }

const inp = 'w-full px-3 py-2 text-sm bg-slate-800/80 border border-white/[0.08] rounded-xl text-white placeholder:text-white/25 outline-none transition-all duration-150 focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20 [color-scheme:dark]'
const inpErr = 'border-red-500/50 focus:border-red-500/60 focus:ring-red-500/20'

export default function ExpEntryModal({ entry, defaultMonth, defaultLocation, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-slate-900 border border-white/[0.1] rounded-2xl shadow-2xl w-full max-w-md z-10 overflow-hidden">

        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/[0.07]">
          <div>
            <h2 className="text-base font-semibold text-white">{entry ? 'Edit Expense' : 'Log Expense'}</h2>
            <p className="text-xs text-white/35 mt-0.5">Record a supply purchase</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors">
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
            <input type="text" value={form.vendor} onChange={(e) => set('vendor', e.target.value)} placeholder="e.g. Henry Schein" className={inp} />
          </F>

          <F label="Item / Description">
            <input type="text" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. Exam gloves, syringes…" className={inp} />
          </F>

          <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.07]">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white border border-white/[0.08] hover:border-white/20 rounded-xl transition-all">Cancel</button>
            <button type="submit" className="px-4 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition-all shadow-lg shadow-violet-900/30 active:scale-[0.98]">
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
      <label className="block text-[11px] font-semibold uppercase tracking-widest text-white/40 mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-[11px] text-red-400 font-medium">{error}</p>}
    </div>
  )
}
