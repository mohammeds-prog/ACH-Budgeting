'use client'

import { useState } from 'react'
import { HYGIENE_LOCATIONS, DAY_LABELS, shortLocation } from '@/lib/constants'
import Select from './Select'
import DateInput from './DateInput'
import TimeRangeField, { formatTimeRange, DEFAULT_RANGE } from './TimeRangeField'

const EMPTY = { location: '', workDate: '', hours: formatTimeRange(DEFAULT_RANGE), available: '', utilized: '', notes: '' }

// The day of week and the percentage are both derived. Showing them live as the
// form is filled makes that obvious, and lets the user catch a wrong date
// ("that's a Sunday?") before saving rather than after.
function dayFromISO(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null
  const [y, m, d] = iso.split('-').map(Number)
  // Construct in UTC: a local-time Date shifts the day backwards west of GMT.
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()  // 0=Sun
  return dow === 0 ? 7 : dow                                // → ISO 1=Mon…7=Sun
}

export default function HygieneModal({ entry, onSave, onClose }) {
  const [form, setForm] = useState(entry ? { ...EMPTY, ...entry } : EMPTY)
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const available = Number(form.available) || 0
  const utilized  = Number(form.utilized)  || 0
  const pct = available > 0 ? (utilized / available) * 100 : null
  const dayNum = dayFromISO(form.workDate)

  const problems = []
  if (!form.location) problems.push('Location is required')
  if (!form.workDate) problems.push('Date is required')
  if (available <= 0) problems.push('Available hours must be greater than zero')
  if (utilized > available && available > 0) problems.push('Utilized is greater than available')

  async function submit() {
    if (problems.length || saving) return
    setSaving(true)
    try {
      await onSave({ ...form, available, utilized })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white border border-violet-200/60 rounded-2xl shadow-2xl w-full max-w-lg z-10 max-h-[88vh] flex flex-col overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{entry ? 'Edit hygiene day' : 'Add hygiene day'}</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">Day and utilization % fill in automatically</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <Row label="Location" required>
            <Select
              value={form.location}
              onChange={(v) => set('location', v)}
              placeholder="Select a location"
              options={HYGIENE_LOCATIONS.map((l) => ({ value: l, label: shortLocation(l) }))}
            />
          </Row>

          <div className="grid grid-cols-2 gap-3">
            <Row label="Date" required>
              <DateInput value={form.workDate} onChange={(iso) => set('workDate', iso || '')} title="Date" />
            </Row>
            <Row label="Day">
              <div className="px-3 py-1.5 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-500">
                {dayNum ? DAY_LABELS[dayNum] : '—'}
              </div>
            </Row>
          </div>

          <Row label="Hours">
            <TimeRangeField value={form.hours} onChange={(v) => set('hours', v)} title="Shift hours" />
          </Row>

          <div className="grid grid-cols-2 gap-3">
            <Row label="Available" required>
              <input
                type="number" min="0" step="0.25" inputMode="decimal"
                value={form.available}
                onChange={(e) => set('available', e.target.value)}
                placeholder="8"
                className="w-full px-3 py-1.5 text-sm rounded-xl border border-slate-200 bg-white text-slate-900 tabular-nums outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100/50"
              />
            </Row>
            <Row label="Utilized" required>
              <input
                type="number" min="0" step="0.25" inputMode="decimal"
                value={form.utilized}
                onChange={(e) => set('utilized', e.target.value)}
                placeholder="7"
                className="w-full px-3 py-1.5 text-sm rounded-xl border border-slate-200 bg-white text-slate-900 tabular-nums outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100/50"
              />
            </Row>
          </div>

          {/* Live preview of the number this page exists to report. */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Utilization</span>
            <span className={`text-xl font-bold tabular-nums ${
              pct == null ? 'text-slate-300' : pct >= 90 ? 'text-emerald-600' : pct >= 75 ? 'text-amber-600' : 'text-red-600'
            }`}>
              {pct != null ? `${pct.toFixed(1)}%` : '—'}
            </span>
          </div>

          <Row label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
              placeholder="Anything worth recording about this day…"
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white text-slate-900 outline-none resize-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100/50"
            />
          </Row>

          {problems.length > 0 && (
            <ul className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 space-y-0.5">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg">Cancel</button>
          <button
            onClick={submit}
            disabled={problems.length > 0 || saving}
            className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : entry ? 'Save changes' : 'Add entry'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, required, children }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </p>
      {children}
    </div>
  )
}
