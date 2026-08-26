'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import Select from '@/components/Select'
import { supabase } from '@/lib/supabase'
import { describeChange } from '@/lib/entryActivity'

const MODULE_COLORS = {
  'ACH':           { bg: 'bg-indigo-50',  text: 'text-indigo-700',  border: 'border-indigo-200' },
  'Supply Budget': { bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200' },
  'Zero Payments': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  'Admin':         { bg: 'bg-slate-100',  text: 'text-slate-600',   border: 'border-slate-200'  },
}
const ACTION_COLORS = {
  'create': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'Created'  },
  'update': { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   label: 'Updated'  },
  'delete': { bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200',     label: 'Deleted'  },
  'import': { bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200',  label: 'Imported' },
  'export': { bg: 'bg-slate-50',   text: 'text-slate-600',   border: 'border-slate-200',   label: 'Exported' },
}

function formatChicago(ts) {
  return new Date(ts).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

export default function ActivityLogPage() {
  const router = useRouter()
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterModule, setFilterModule] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [page, setPage] = useState(1)
  const PAGE = 20

  useEffect(() => {
    supabase
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000)
      .then(({ data }) => { setLogs(data || []); setLoading(false) })
  }, [])

  const filtered = logs.filter((l) =>
    (!filterModule || l.module === filterModule) &&
    (!filterAction || l.action === filterAction)
  )
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const paged = filtered.slice((page - 1) * PAGE, page * PAGE)

  const MODULE_OPTS = [
    { value: 'ACH', label: 'ACH' },
    { value: 'Supply Budget', label: 'Supply Budget' },
    { value: 'Admin', label: 'Admin' },
  ]
  const ACTION_OPTS = [
    { value: 'create', label: 'Created' },
    { value: 'update', label: 'Updated' },
    { value: 'delete', label: 'Deleted' },
    { value: 'import', label: 'Imported' },
  ]

  return (
    <div className="min-h-screen futuristic-bg relative">
      <div className="relative z-10">
        <AppHeader />

        <div className="futuristic-hero">
          <div className="relative max-w-screen-lg mx-auto px-6 py-8 z-10">
            <p className="text-violet-600 text-xs font-semibold uppercase tracking-widest mb-1">Admin</p>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Activity Log</h1>
            <p className="text-slate-500 text-sm mt-1.5">Full audit trail of all actions across the platform — Chicago time</p>
          </div>
        </div>

        <div className="max-w-screen-lg mx-auto px-6 py-6 space-y-3">
          <div className="glass-card rounded-2xl px-5 py-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Filter</span>
              <Select value={filterModule} onChange={(v) => { setFilterModule(v); setPage(1) }} placeholder="All modules" options={MODULE_OPTS} />
              <Select value={filterAction} onChange={(v) => { setFilterAction(v); setPage(1) }} placeholder="All actions" options={ACTION_OPTS} />
              <span className="ml-auto text-xs text-slate-400">{filtered.length} {filtered.length === 1 ? 'event' : 'events'}</span>
            </div>
          </div>

          <div className="glass-card rounded-2xl overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-16 gap-3">
                <div className="w-5 h-5 border-2 border-violet-400/40 border-t-violet-500 rounded-full animate-spin" />
                <span className="text-sm text-slate-500">Loading…</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-sm text-slate-500">No activity yet</p>
                <p className="text-xs text-slate-400 mt-1">Actions across ACH, Supply Budget, and Admin will appear here</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] border-collapse text-sm">
                    <thead>
                      <tr>
                        {['Time (Chicago)', 'User', 'Module', 'Action', 'Description'].map((h) => (
                          <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {paged.map((log) => {
                        const mod = MODULE_COLORS[log.module] || MODULE_COLORS['Admin']
                        const act = ACTION_COLORS[log.action] || { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', label: log.action }
                        const meta = log.metadata || {}
                        const canNavigate = log.module === 'ACH' || log.module === 'Supply Budget' || log.module === 'Zero Payments' || log.module === 'Admin'

                        function handleClick() {
                          if (!canNavigate) return
                          if (log.module === 'ACH') {
                            const ids = meta.ids?.length ? meta.ids.join(',') : meta.id
                            router.push(ids ? `/ach?highlight=${ids}` : '/ach')
                          } else if (log.module === 'Zero Payments') {
                            router.push('/zero-payments')
                          } else if (log.module === 'Supply Budget') {
                            router.push(meta.id ? `/expenditure?highlight=${meta.id}` : '/expenditure')
                          } else {
                            router.push('/admin')
                          }
                        }

                        return (
                          <tr
                            key={log.id}
                            onClick={handleClick}
                            className={`border-b border-slate-100 last:border-0 transition-colors ${canNavigate ? 'cursor-pointer hover:bg-violet-50/40' : 'hover:bg-slate-50/60'}`}
                          >
                            <td className="px-5 py-3.5 text-xs text-slate-500 whitespace-nowrap">{formatChicago(log.created_at)}</td>
                            <td className="px-5 py-3.5">
                              <p className="text-xs font-semibold text-slate-800 whitespace-nowrap">{log.user_name || log.user_email}</p>
                              {log.user_name && <p className="text-[11px] text-slate-500">{log.user_email}</p>}
                            </td>
                            <td className="px-5 py-3.5 whitespace-nowrap">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${mod.bg} ${mod.text} ${mod.border}`}>{log.module}</span>
                            </td>
                            <td className="px-5 py-3.5 whitespace-nowrap">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${act.bg} ${act.text} ${act.border}`}>{act.label}</span>
                            </td>
                            <td className="px-5 py-3.5 min-w-[260px]">
                              {/* Same renderer the per-row Activity panel uses, so a
                                  change reads "Status: Not Posted → Posted" here too
                                  rather than just naming the fields that moved. */}
                              {(() => {
                                const lines = describeChange(log)
                                const detailed = !!meta.patch
                                return detailed ? (
                                  <ul className="space-y-0.5">
                                    {lines.map((l, i) => (
                                      <li key={i} className="text-xs text-slate-700 leading-relaxed">{l}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-xs text-slate-700">{lines[0]}</p>
                                )
                              })()}
                              {canNavigate && (meta.id || meta.ids?.length > 0) && (
                                <p className="text-[11px] text-indigo-500 mt-0.5">Click to view →</p>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
                    <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
                    <div className="flex gap-1">
                      <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg disabled:opacity-30 transition-all">Back</button>
                      <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg disabled:opacity-30 transition-all">Next</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
