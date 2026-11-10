'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { readDentrixFile } from '@/lib/dentrixReports'

// ─────────────────────────────────────────────────────────────────────────────
// "Update data" — puts the day's Dentrix exports into the database so the
// Analysis pages and the chat (live site included) use them.
//
// The files are read here, in the browser. Only the totals are saved (the
// same ones the pages show); patient names, chart numbers and birth dates
// never leave this computer. The schedule also saves a compact visit index
// (anonymous patients) to private storage, for custom retention dates.
// ─────────────────────────────────────────────────────────────────────────────

const LABEL = {
  production: 'Production', collections: 'Collections', aging: 'Aging (open claims)', schedule: 'Schedule',
  adjustments: 'Adjustment summary', adSpend: 'Google ad spend', newPatients: 'New patients',
}
const INDEX_PATH = 'schedule/visit-index.json.gz'

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return await new Response(stream).blob()
}
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')
async function authed(path, init = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, { ...init, headers: { ...(init.headers || {}), 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

export default function DataUpdate() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState(null)        // { reports, folder }
  const [items, setItems] = useState([])            // { file, kind?, state, note }
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const input = useRef(null)

  const refresh = (hard) => authed(`/api/analysis-data${hard ? '?refresh=1' : ''}`).then(setStatus).catch((e) => setStatus({ error: e.message }))
  useEffect(() => { if (open) refresh() }, [open])
  useEffect(() => {
    if (!open) return
    const esc = (e) => { if (e.key === 'Escape' && !busy) setOpen(false) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open, busy])

  const update = (i, patch) => setItems((list) => list.map((x, k) => (k === i ? { ...x, ...patch } : x)))

  async function uploadFiles(fileList) {
    const files = [...(fileList || [])]
    if (!files.length) return
    setBusy(true); setDone(false)
    setItems(files.map((f) => ({ file: f.name, state: 'waiting' })))
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      try {
        update(i, { state: 'reading' })
        const parsed = await readDentrixFile(f)
        if (!parsed?.kind || !LABEL[parsed.kind]) { update(i, { state: 'skipped', note: 'not a report Analysis uses' }); continue }
        update(i, { kind: parsed.kind, state: 'saving' })
        let index_path = null
        if (parsed.kind === 'schedule' && parsed.index) {
          const blob = await gzip(JSON.stringify(parsed.index))
          const { error } = await supabase.storage.from('analysis').upload(INDEX_PATH, blob, { upsert: true, contentType: 'application/gzip' })
          if (error) throw new Error(`visit index: ${error.message}`)
          index_path = INDEX_PATH
        }
        const { error } = await supabase.from('analysis_snapshots').insert({
          kind: parsed.kind, as_of: parsed.asOf ? String(parsed.asOf).slice(0, 10) : null, file_name: f.name, data: parsed, index_path,
        })
        if (error) throw new Error(error.message)
        update(i, { state: 'saved' })
      } catch (e) {
        update(i, { state: 'error', note: e.message })
      }
    }
    await refresh(true)
    setBusy(false); setDone(true)
  }

  async function syncFolder() {
    setBusy(true); setDone(false)
    setItems([{ file: 'reports folder on this computer', state: 'saving' }])
    try {
      const { results } = await authed('/api/analysis-data', { method: 'POST', body: JSON.stringify({ action: 'sync' }) })
      setItems(results.map((r) => ({ file: r.file, kind: r.kind, state: r.saved ? 'saved' : r.kind ? 'error' : 'skipped', note: r.error })))
    } catch (e) {
      setItems([{ file: 'reports folder', state: 'error', note: e.message }])
    }
    await refresh(true)
    setBusy(false); setDone(true)
  }

  const STATE = {
    waiting: ['text-slate-400', 'Waiting'], reading: ['text-indigo-600', 'Reading…'], saving: ['text-indigo-600', 'Saving…'],
    saved: ['text-emerald-600', 'Saved'], skipped: ['text-slate-400', 'Skipped'], error: ['text-red-600', 'Failed'],
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-sm font-medium text-slate-700 hover:border-indigo-300 hover:text-slate-900 shadow-sm transition-colors">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
        Update data
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 sm:p-10 bg-slate-900/40 backdrop-blur-[2px]" onMouseDown={() => !busy && setOpen(false)}>
          <div role="dialog" aria-label="Update Analysis data" onMouseDown={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-full overflow-y-auto rounded-3xl bg-white shadow-2xl border border-slate-200">
            <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-slate-100">
              <div>
                <p className="text-lg font-semibold text-slate-900">Update Analysis data</p>
                <p className="text-[12px] text-slate-500 mt-0.5">Pick today{'’'}s Dentrix exports. They{'’'}re read here in the browser; only the totals are saved {'—'} no patient names, chart numbers or birth dates.</p>
              </div>
              <button onClick={() => !busy && setOpen(false)} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">{'✕'}</button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* What's in the database now */}
              <div>
                <p className="text-[11px] font-semibold text-slate-500 mb-2">In the database now</p>
                {status?.error ? (
                  <p className="text-[12.5px] text-red-600">{/analysis_snapshots/.test(status.error) ? 'The Analysis tables aren’t set up yet — run supabase/analysis_store.sql first.' : status.error}</p>
                ) : (
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {(status?.reports || Object.keys(LABEL).map((kind) => ({ kind }))).map((r) => (
                      <div key={r.kind} className="flex items-center justify-between gap-3 px-3.5 py-2 text-[12.5px]">
                        <span className="font-medium text-slate-800">{LABEL[r.kind]}</span>
                        <span className={r.uploadedAt ? 'text-slate-500' : 'text-amber-600'}>
                          {r.uploadedAt ? <>uploaded {fmtWhen(r.uploadedAt)}{r.asOf ? ` · report date ${r.asOf}` : ''}</> : r.kind === 'newPatients' ? 'read live from the Google Sheet' : 'not uploaded yet'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Upload */}
              <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!busy) uploadFiles(e.dataTransfer.files) }}
                className="rounded-2xl border-2 border-dashed border-slate-200 hover:border-indigo-300 bg-slate-50/60 px-5 py-6 text-center transition-colors">
                <p className="text-sm font-semibold text-slate-800">Drop the export files here</p>
                <p className="text-[12px] text-slate-500 mt-1">Production, Collections, Aging, Schedule, Adjustment summary, ad-spend.csv {'—'} any or all, CSV or Excel</p>
                <button disabled={busy} onClick={() => input.current?.click()}
                  className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold disabled:opacity-40">Choose files</button>
                <input ref={input} type="file" multiple accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { uploadFiles(e.target.files); e.target.value = '' }} />
                {status?.folder && (
                  <p className="mt-3 text-[12px] text-slate-500">
                    or <button disabled={busy} onClick={syncFolder} className="font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-40">save this computer{'’'}s reports folder</button> ({status.folder.length} files)
                  </p>
                )}
              </div>

              {items.length > 0 && (
                <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {items.map((x, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 px-3.5 py-2 text-[12.5px]">
                      <span className="min-w-0 truncate text-slate-700">{x.file}{x.kind ? <span className="text-slate-400"> {'→'} {LABEL[x.kind] || x.kind}</span> : null}</span>
                      <span className={`shrink-0 font-semibold ${STATE[x.state]?.[0]}`} title={x.note || ''}>{STATE[x.state]?.[1]}{x.note && x.state !== 'saved' ? ` · ${x.note.slice(0, 60)}` : ''}</span>
                    </div>
                  ))}
                </div>
              )}

              {done && items.some((x) => x.state === 'saved') && (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
                  <p className="text-[12.5px] text-emerald-800">Saved. The pages and the chat use the new data now.</p>
                  <button onClick={() => window.location.reload()} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold">Reload the page</button>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
