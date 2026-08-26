'use client'

import { useState, useEffect } from 'react'
import { getEntryActivity, describeChange } from '@/lib/entryActivity'

const ACTION_STYLE = {
  create: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Created' },
  update: { dot: 'bg-indigo-500',  chip: 'bg-indigo-50 text-indigo-700 border-indigo-200',    label: 'Edited'  },
  delete: { dot: 'bg-red-500',     chip: 'bg-red-50 text-red-700 border-red-200',             label: 'Deleted' },
  import: { dot: 'bg-violet-500',  chip: 'bg-violet-50 text-violet-700 border-violet-200',    label: 'Imported'},
  attach: { dot: 'bg-amber-500',   chip: 'bg-amber-50 text-amber-700 border-amber-200',       label: 'File'    },
}

// Times are shown in the practice's timezone, not the viewer's, so two people
// discussing the same event see the same clock.
function when(ts) {
  return new Date(ts).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function who(row) {
  return row.user_name || row.user_email || 'Unknown user'
}

export default function ActivityPanel({ entryId, entryLabel, onClose }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getEntryActivity(entryId)
      .then((r) => { if (!cancelled) setRows(r) })
      .catch(() => { if (!cancelled) setError('Could not load the history for this entry.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [entryId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white border border-violet-200/60 rounded-2xl shadow-2xl shadow-indigo-100/40 w-full max-w-lg z-10 max-h-[85vh] flex flex-col overflow-hidden">

        <div className="px-6 pt-5 pb-4 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-violet-50 border border-violet-200 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-violet-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
                </svg>
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-900 leading-tight">Activity</h2>
                {rows.length > 0 && (
                  <p className="text-[11px] text-slate-400">{rows.length} change{rows.length === 1 ? '' : 's'}</p>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
          {entryLabel && (
            <p className="text-[11px] text-slate-400 mt-2 truncate" title={entryLabel}>{entryLabel}</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2">
              <div className="w-4 h-4 border-2 border-violet-400/40 border-t-violet-500 rounded-full animate-spin" />
              <span className="text-xs text-slate-400">Loading…</span>
            </div>
          ) : error ? (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
          ) : rows.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm text-slate-500 font-medium">No recorded changes</p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">
                Either nothing has been edited since this entry was created, or it predates activity logging.
              </p>
            </div>
          ) : (
            <ol className="relative border-l border-slate-200 ml-1.5 space-y-5">
              {rows.map((row) => {
                const style = ACTION_STYLE[row.action] || ACTION_STYLE.update
                const lines = describeChange(row)
                return (
                  <li key={row.id} className="pl-5 relative">
                    <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-white ${style.dot}`} />
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-slate-800">{who(row)}</span>
                      <span className={`badge text-[10px] border ${style.chip}`}>{style.label}</span>
                      <span className="text-[11px] text-slate-400 tabular-nums">{when(row.created_at)}</span>
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {lines.map((l, i) => (
                        <li key={i} className="text-xs text-slate-600 leading-relaxed">{l}</li>
                      ))}
                    </ul>
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-100">
          <p className="text-[10px] text-slate-400 leading-relaxed">
            This log is append-only — entries cannot be edited or removed, including by admins.
          </p>
        </div>
      </div>
    </div>
  )
}
