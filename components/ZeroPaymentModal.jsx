'use client'

import { useState } from 'react'
import { LOCATIONS, ACH_STATUSES } from '@/lib/constants'

const inp = 'w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 outline-none transition-all duration-150 focus:border-violet-400 focus:ring-2 focus:ring-violet-100'

function shortLoc(loc) {
  return loc.replace('Valley View Dental ', '')
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

export default function ZeroPaymentModal({ onSave, onClose, currentUserInitials = '' }) {
  const [form, setForm]     = useState({
    eobDate: '', location: '', insuranceName: '', match: '', status: 'Not Posted', initials: '', notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const initialsRequired = !!form.status && form.status !== 'Not Posted'

  function set(key, value) {
    setForm((p) => {
      const next = { ...p, [key]: value }
      if (key === 'status' && value && value !== 'Not Posted' && !p.initials?.trim() && currentUserInitials) {
        next.initials = currentUserInitials
      }
      return next
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.eobDate) { setError('EOB date is required.'); return }
    if (initialsRequired && !form.initials.trim()) { setError('Initials are required once a status is set.'); return }
    setSaving(true)
    setError('')
    try {
      await onSave(form)
    } catch {
      setError('Failed to save. Check your connection and try again.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={saving ? undefined : onClose} />

      <div className="relative bg-white border border-violet-200/60 rounded-2xl shadow-2xl shadow-indigo-100/40 w-full max-w-lg z-10 max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Add Zero Payment</h2>
            <p className="text-xs text-slate-500 mt-0.5">An EOB processed with no payment issued.</p>
          </div>
          <button onClick={onClose} disabled={saving} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 space-y-4 overflow-y-auto flex-1">
            <div className="grid grid-cols-2 gap-4">
              <Field label="EOB Date *">
                <input type="date" value={form.eobDate} onChange={(e) => set('eobDate', e.target.value)} className={inp} required />
              </Field>
              <Field label="Location">
                <select value={form.location} onChange={(e) => set('location', e.target.value)} className={`${inp} appearance-none cursor-pointer`}>
                  <option value="">— Select location —</option>
                  {LOCATIONS.map((l) => <option key={l} value={l}>{shortLoc(l)}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Insurance">
              <input type="text" value={form.insuranceName} onChange={(e) => set('insuranceName', e.target.value)} placeholder="e.g. Delta Dental" className={inp} />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Match">
                <select value={form.match} onChange={(e) => set('match', e.target.value)} className={`${inp} appearance-none cursor-pointer`}>
                  <option value="">—</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                  <option value="Partial">Partial</option>
                </select>
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={(e) => set('status', e.target.value)} className={`${inp} appearance-none cursor-pointer`}>
                  <option value="">—</option>
                  {ACH_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>

            <Field label={initialsRequired ? 'Initials *' : 'Initials'}>
              <input
                type="text" value={form.initials} onChange={(e) => set('initials', e.target.value)}
                placeholder={initialsRequired ? 'Required once a status is set' : 'e.g. JD'} maxLength={10}
                className={`${inp} ${initialsRequired && !form.initials.trim() ? 'border-amber-400 ring-2 ring-amber-100' : ''}`}
              />
            </Field>

            <Field label="Notes">
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional notes…" rows={3} className={`${inp} resize-none`} />
            </Field>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
            <button type="button" onClick={onClose} disabled={saving}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition-all disabled:opacity-60 min-w-[80px] shadow-lg shadow-violet-900/30">
              {saving ? 'Saving…' : 'Add Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
