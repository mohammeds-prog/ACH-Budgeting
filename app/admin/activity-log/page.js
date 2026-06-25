'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import Select from '@/components/Select'
import { supabase } from '@/lib/supabase'

const darkCard = 'bg-white/[0.04] border border-white/[0.08] rounded-2xl'

const MODULE_COLORS = {
  'ACH':           { bg: 'bg-indigo-500/15', text: 'text-indigo-300',  border: 'border-indigo-500/20' },
  'Supply Budget': { bg: 'bg-violet-500/15', text: 'text-violet-300',  border: 'border-violet-500/20' },
  'Admin':         { bg: 'bg-slate-500/20',  text: 'text-slate-300',   border: 'border-slate-500/20'  },
}
const ACTION_COLORS = {
  'create': { bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-500/20', label: 'Created'  },
  'update': { bg: 'bg-amber-500/15',   text: 'text-amber-300',   border: 'border-amber-500/20',   label: 'Updated'  },
  'delete': { bg: 'bg-red-500/15',     text: 'text-red-300',     border: 'border-red-500/20',     label: 'Deleted'  },
  'import': { bg: 'bg-sky-500/15',     text: 'text-sky-300',     border: 'border-sky-500/20',     label: 'Imported' },
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
    <div className="min-h-screen bg-slate-900 relative">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-800/40 via-slate-900 to-slate-900 pointer-events-none" />

      <div className="relative z-10">
        <AppHeader />

        <div className="border-b border-white/[0.06] bg-gradient-to-br from-slate-800/40 via-slate-900/80 to-slate-900">
          <div className="max-w-screen-lg mx-auto px-6 py-8">
            <p className="text-slate-400/80 text-xs font-semibold uppercase tracking-widest mb-1">Admin</p>
            <h1 className="text-3xl font-bold text-white tracking-tight">Activity Log</h1>
            <p className="text-slate-400 text-sm mt-1.5">Full audit trail of all actions across the platform — Chicago time</p>
          </div>
        </div>

        <div className="max-w-screen-lg mx-auto px-6 py-6 space-y-3">
          {/* Filter bar — separate from overflow-hidden table so dropdowns aren't clipped */}
          <div className={`${darkCard} px-5 py-4`}>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Filter</span>
              <Select value={filterModule} onChange={(v) => { setFilterModule(v); setPage(1) }} placeholder="All modules" options={MODULE_OPTS} />
              <Select value={filterAction} onChange={(v) => { setFilterAction(v); setPage(1) }} placeholder="All actions" options={ACTION_OPTS} />
              <span className="ml-auto text-xs text-slate-600">{filtered.length} {filtered.length === 1 ? 'event' : 'events'}</span>
            </div>
          </div>

          <div className={`${darkCard} overflow-hidden`}>
            {loading ? (
              <div className="flex items-center justify-center py-16 gap-3">
                <div className="w-5 h-5 border-2 border-violet-500/30 border-t-violet-400 rounded-full animate-spin" />
                <span className="text-sm text-slate-400">Loading…</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-sm text-slate-400">No activity yet</p>
                <p className="text-xs text-slate-600 mt-1">Actions across ACH, Supply Budget, and Admin will appear here</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.06]">
                        {['Time (Chicago)', 'User', 'Module', 'Action', 'Description'].map((h) => (
                          <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500 bg-white/[0.02] whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {paged.map((log) => {
                        const mod = MODULE_COLORS[log.module] || MODULE_COLORS['Admin']
                        const act = ACTION_COLORS[log.action] || { bg: 'bg-white/[0.05]', text: 'text-slate-400', border: 'border-white/[0.1]', label: log.action }
                        const meta = log.metadata || {}
                        const canNavigate = log.module === 'ACH' || log.module === 'Supply Budget' || log.module === 'Admin'

                        function handleClick() {
                          if (!canNavigate) return
                          if (log.module === 'ACH') {
                            const ids = meta.ids?.length ? meta.ids.join(',') : meta.id
                            router.push(ids ? `/ach?highlight=${ids}` : '/ach')
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
                            className={`border-b border-white/[0.04] last:border-0 transition-colors ${canNavigate ? 'cursor-pointer hover:bg-white/[0.05]' : 'hover:bg-white/[0.02]'}`}
                          >
                            <td className="px-5 py-3 text-xs text-slate-400 whitespace-nowrap">{formatChicago(log.created_at)}</td>
                            <td className="px-5 py-3">
                              <p className="text-xs font-medium text-slate-200 whitespace-nowrap">{log.user_name || log.user_email}</p>
                              {log.user_name && <p className="text-[11px] text-slate-500">{log.user_email}</p>}
                            </td>
                            <td className="px-5 py-3 whitespace-nowrap">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${mod.bg} ${mod.text} ${mod.border}`}>{log.module}</span>
                            </td>
                            <td className="px-5 py-3 whitespace-nowrap">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${act.bg} ${act.text} ${act.border}`}>{act.label}</span>
                            </td>
                            <td className="px-5 py-3 min-w-[220px]">
                              <p className="text-xs text-slate-200">{log.description.split(' | ')[0]}</p>
                              {canNavigate && (meta.id || meta.ids?.length > 0) && (
                                <p className="text-[11px] text-indigo-400/70 mt-0.5">Click to view →</p>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.06]">
                    <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
                    <div className="flex gap-1">
                      <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg disabled:opacity-30 transition-all">Back</button>
                      <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg disabled:opacity-30 transition-all">Next</button>
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
