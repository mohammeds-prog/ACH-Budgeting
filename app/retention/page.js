'use client'

import { useAnalysisGoto } from '@/lib/analysisNav'
import { useState, useEffect, useMemo, useRef } from 'react'
import AppHeader from '@/components/AppHeader'
import Select from '@/components/Select'
import RetentionView from '@/components/RetentionView'
import ViewHeader, { LoadingBlocks } from '@/components/ViewHeader'
import { useProfile } from '@/lib/profileContext'
import { supabase } from '@/lib/supabase'
import DateInput from '@/components/DateInput'
import { readDentrixFile, scheduleRange, periodLabel, currentPeriod } from '@/lib/dentrixReports'

// ─────────────────────────────────────────────────────────────────────────────
// Patient Retention — who comes back, by provider and office.
//
// Built from the Dentrix "Schedule Report (TSP) Assign" export (one row per
// appointment). On this computer it comes from the project's /reports folder
// (app/api/reports/route.js); on the live site it can be uploaded. Either way
// readDentrixFile reduces it to counts first — patient names, chart numbers
// and birth dates never leave it. Nothing is written to the database; the
// counts are remembered in this browser's localStorage.
// ─────────────────────────────────────────────────────────────────────────────

const DATA_KEY = 'retention.data.v4'

function loadSaved() {
  try { return JSON.parse(window.localStorage.getItem(DATA_KEY) || 'null') } catch { return null }
}

// `embedded`: shown inside /analysis, which draws the header and background.
export default function RetentionPage({ embedded = false } = {}) {
  const profile = useProfile()
  const inputRef = useRef(null)

  const [schedule, setSchedule] = useState(null)   // { asOf, since, specialty, months }
  const [restored, setRestored] = useState(false)
  const [errors, setErrors]     = useState([])
  const [loadedNote, setLoadedNote] = useState('')
  const [busy, setBusy]         = useState(false)
  const [period, setPeriod]     = useState('')
  // A date range: a preset ("last 12 months") or custom from/to dates.
  const [custom, setCustom]     = useState({ from: '', to: '' })
  const [range, setRange]       = useState(null)   // { from, to, label, data } | { loading } | { error }
  const [focus, setFocus]       = useState(null)   // { provider, office, offices, at } from a chat link
  // An uploaded report's visit index, for ranges without the server. Memory only.
  const uploadedIndex = useRef(null)

  useEffect(() => {
    const saved = loadSaved()
    if (saved) setSchedule(saved)
    setRestored(true)
    loadFolder({ quiet: true })
  }, [])

  useEffect(() => {
    if (!restored) return
    try { window.localStorage.setItem(DATA_KEY, JSON.stringify(schedule)) } catch {}
  }, [restored, schedule])

  // Only the schedule report matters here; other reports in the folder are skipped.
  function take(items) {
    const found = items.find((i) => i.parsed?.kind === 'schedule')
    if (found) {
      const { asOf, since, specialty, months, all, evidence } = found.parsed
      setSchedule({ asOf, since, specialty, months, all, evidence })
    }
    return found
  }

  async function handleFiles(list) {
    const file = list?.[0]
    if (!file) return
    setBusy(true)
    try {
      const parsed = await readDentrixFile(file)
      uploadedIndex.current = parsed?.index || null
      setErrors(take([{ name: file.name, parsed }]) ? [] : ['That file isn’t the Schedule Report. Export "Schedule Report (TSP) Assign" from Dentrix as CSV.'])
    } catch (e) {
      setErrors([`${file.name} — ${e.message || 'could not be read'}`])
    }
    setBusy(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function loadFolder({ quiet } = {}) {
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/reports?only=schedule', { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setErrors([`Couldn't read the reports folder (${res.status}${json.error ? ': ' + json.error : ''}). Showing the last report this browser remembered.`])
      else if (json.files?.length) {
        uploadedIndex.current = null
        const found = take(json.files)
        setErrors(found ? [] : ['No Schedule Report in the reports folder yet.'])
        const t = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        if (found) setLoadedNote(`Schedule read at ${t}${found.parsed?.asOf ? ` \u00b7 appointments up to ${new Date(found.parsed.asOf + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}` : ''}`)
      } else if (!quiet || window.location.hostname === 'localhost') {
        setErrors([json.noFolder ? 'The server found no reports folder. Showing the last report this browser remembered.' : 'No Schedule Report in the reports folder yet.'])
      }
    } catch (e) {
      setErrors([`Couldn't read the reports folder (${e?.message || 'network error'}). Showing the last report this browser remembered.`])
    } finally {
      setBusy(false)
    }
  }

  // Default to the latest complete month; the current month is only partial.
  const thisMonth = currentPeriod()
  const periods = useMemo(() => Object.keys(schedule?.months || {}).sort(), [schedule])
  // All time by default; the picker narrows it to one month.
  useEffect(() => {
    // A report read by an older version has no all-time counts: show its last month.
    if ((period === 'all' && schedule?.all) || (period && periods.includes(period))) return
    if (periods.length) setPeriod(schedule?.all ? 'all' : periods.filter((p) => p < thisMonth).pop() || periods[periods.length - 1])
  }, [periods, schedule])

  const asOf = schedule?.asOf
  const presets = useMemo(() => {
    if (!asOf) return []
    const end = new Date(asOf + 'T00:00:00Z')
    const back = (months) => { const d = new Date(end); d.setUTCMonth(d.getUTCMonth() - months); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }
    return [
      { value: 'r|3', label: 'Last 3 months', from: back(3), to: asOf },
      { value: 'r|6', label: 'Last 6 months', from: back(6), to: asOf },
      { value: 'r|12', label: 'Last 12 months', from: back(12), to: asOf },
      { value: 'r|ytd', label: `This year (${asOf.slice(0, 4)})`, from: `${asOf.slice(0, 4)}-01-01`, to: asOf },
    ]
  }, [asOf])

  async function loadRange(from, to, label) {
    setRange({ loading: true, from, to, label })
    try {
      if (uploadedIndex.current) {
        setRange({ from, to, label, data: scheduleRange(uploadedIndex.current, from, to) })
        return
      }
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/retention?from=${from}&to=${to}`, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
      const json = await res.json().catch(() => ({}))
      setRange(res.ok ? { from, to, label, data: json } : { error: json.error || `HTTP ${res.status}`, from, to, label })
    } catch (e) {
      setRange({ error: e?.message || 'network error', from, to, label })
    }
  }

  function pick(v) {
    if (!v) return
    setPeriod(v)
    const pre = presets.find((x) => x.value === v)
    if (pre) loadRange(pre.from, pre.to, pre.label)
    else if (v === 'custom') {
      const from = custom.from || presets[2]?.from, to = custom.to || asOf
      setCustom({ from, to })
      loadRange(from, to, rangeLabel(from, to))
    } else setRange(null)
  }

  // A jump from a chat answer: the month it asked about, or its dates.
  useAnalysisGoto('retention', (g) => {
    // Which provider or office the answer was about: opened and scrolled to.
    if (g.provider || g.office || g.group_by === 'location') setFocus({ provider: g.provider || null, office: g.office || null, offices: g.group_by === 'location', at: Date.now() })
    if (!g.from || !g.to) return
    const m = g.from.slice(0, 7)
    const whole = g.from.endsWith('-01') && g.to.slice(0, 7) === m && Number(g.to.slice(8, 10)) >= 28
    if (whole && periods.includes(m)) { setPeriod(m); setRange(null); return }
    setCustom({ from: g.from, to: g.to })
    setPeriod('custom')
    loadRange(g.from, g.to, rangeLabel(g.from, g.to))
  }, periods.length > 0)

  if (!profile) return null
  const isRange = period.startsWith('r|') || period === 'custom'

  return (
    <div className={embedded ? 'relative' : 'min-h-screen futuristic-bg relative'}>
      <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={(e) => handleFiles(e.target.files)} />

      <div className="relative z-10">
        {!embedded && <AppHeader />}

        <div className={embedded ? 'w-full' : 'w-full px-6 pt-8 pb-16'}>
          <div className="max-w-[1400px] mx-auto space-y-4">
            <ViewHeader
              title="Patient retention"
              subtitle="Who comes back after a visit, by provider and office, and where patients are lost."
              controls={periods.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <Select value={period} onChange={pick} placeholder={null}
                    options={[
                      ...(schedule?.all ? [{ value: 'all', label: 'All time' }] : []),
                      ...presets.map(({ value, label }) => ({ value, label })),
                      { value: 'custom', label: 'Custom dates\u2026' },
                      ...[...periods].reverse().map((p) => ({ value: p, label: periodLabel(p) + (p === thisMonth ? ' (to date)' : '') })),
                    ]} />
                  {period === 'custom' && (
                    <div className="flex items-center gap-1.5">
                      <DateInput value={custom.from} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} />
                      <span className="text-xs text-slate-400">to</span>
                      <DateInput value={custom.to} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} />
                      <button onClick={() => custom.from && custom.to && custom.from <= custom.to && loadRange(custom.from, custom.to, rangeLabel(custom.from, custom.to))}
                        disabled={!custom.from || !custom.to || custom.from > custom.to}
                        className="px-3 py-1.5 text-sm font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-xl disabled:opacity-40">
                        Show
                      </button>
                    </div>
                  )}
                </div>
              )}
              busy={busy}
              onRefresh={() => loadFolder()}
              onUpload={() => inputRef.current?.click()}
              status={errors.length === 0 ? loadedNote : ''}
              errors={[...errors, ...(isRange && range?.error ? [`Couldn\u2019t work out ${range.label}: ${range.error}`] : [])]}
            />

            {schedule && period && isRange && !range?.data ? (
              range?.loading ? <LoadingBlocks rows={3} /> : (
                <div className="glass-card rounded-2xl px-6 py-16 text-center">
                  <p className="text-sm font-semibold text-slate-800">Pick the dates and click Show</p>
                </div>
              )
            ) : schedule && period ? (
              <RetentionView schedule={schedule} period={isRange ? 'range' : period} range={isRange ? range : null} focus={focus} />
            ) : busy ? <LoadingBlocks rows={4} /> : (
              <div className="glass-card rounded-2xl px-6 py-16 text-center">
                <p className="text-sm font-semibold text-slate-800">No schedule report yet</p>
                <p className="text-xs text-slate-500 mt-2">
                  Export <b>Schedule Report (TSP) Assign</b> from Dentrix as CSV, put it in the project&rsquo;s <b>reports</b> folder and click {'\u21bb'}, or use {'\u22ef'} {'\u203a'} Upload.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// "Mar 1, 2026 – Oct 31, 2026"
function rangeLabel(from, to) {
  const f = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  return `${f(from)} \u2013 ${f(to)}`
}
