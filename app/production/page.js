'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import AppHeader from '@/components/AppHeader'
import Select from '@/components/Select'
import { shortLocation } from '@/lib/constants'
import { useAnalysisGoto } from '@/lib/analysisNav'
import MoneyStory from '@/components/MoneyStory'
import ViewHeader, { LoadingBlocks } from '@/components/ViewHeader'
import { getCollections, getExpEntries } from '@/lib/expenditureStorage'
import { useProfile } from '@/lib/profileContext'
import { supabase } from '@/lib/supabase'
import {
  readDentrixFile, guessRole, adjustmentBucket,
  periodLabel, currentPeriod,
} from '@/lib/dentrixReports'

// ─────────────────────────────────────────────────────────────────────────────
// Provider Production — the money story, and nothing else.
//
// Nothing on this page writes to the database. On this computer the reports
// come from the project's /reports folder (see app/api/reports/route.js); on
// the live site they can be uploaded. Either way only the totals worked out
// from them are remembered, in this browser's localStorage — the aging
// report's patient names, birth dates and claim IDs are never kept:
// readDentrixFile reduces it to totals first. Which providers are hygienists
// is remembered the same way, since Ascend's export doesn't say.
// ─────────────────────────────────────────────────────────────────────────────

const ALL = 'all'
const ROLE_KEY = 'production.roles'
const DATA_KEY = 'production.data.v1'

function loadRoles() {
  try { return JSON.parse(window.localStorage.getItem(ROLE_KEY) || '{}') || {} } catch { return {} }
}

function loadSaved() {
  try { return JSON.parse(window.localStorage.getItem(DATA_KEY) || 'null') } catch { return null }
}

// "Previous Month" collection reports carry no month; a "2026-10" in the file
// name says which one, otherwise it's assumed to be last month.
function previousPeriod(today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const EMPTY = { prodRows: [], adjRows: [], collFiles: [], aging: null, newPatients: null, adSpend: [], schedule: null }

// `embedded`: shown inside /analysis, which draws the header and background.
export default function ProductionPage({ embedded = false } = {}) {
  const profile = useProfile()
  const inputRef = useRef(null)

  const [data, setData]         = useState(EMPTY)  // { prodRows, adjRows, collFiles, aging }
  const [restored, setRestored] = useState(false)
  const [errors, setErrors]     = useState([])
  const [loadedNote, setLoadedNote] = useState('')   // what the last folder read found
  const [busy, setBusy]         = useState(false)
  const [roleOverrides, setRoleOverrides] = useState({})
  const [period, setPeriod]     = useState('')
  const [office, setOffice]     = useState('')     // '' = all offices; otherwise the whole tree is for that office
  const [budget, setBudget]     = useState({ status: 'loading' })

  // ── Loading ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setRoleOverrides(loadRoles())
    const saved = loadSaved()
    if (saved) setData({ ...EMPTY, ...saved })
    setRestored(true)
    loadFolder({ quiet: true })

    // Supply Budget's supply spend carries the cash story on. Read only.
    Promise.all([getCollections(), getExpEntries()])
      .then(([collections, entries]) => setBudget({ status: 'ready', collections, entries }))
      .catch(() => setBudget({ status: 'error' }))
  }, [])

  useEffect(() => {
    if (!restored) return
    try { window.localStorage.setItem(DATA_KEY, JSON.stringify(data)) } catch {}
  }, [restored, data])

  // Fold parsed reports into `base`: the current data for an upload, empty for
  // a load from the reports folder (which is then the whole truth).
  function ingest(items, base) {
    let { prodRows, adjRows, collFiles, aging, newPatients, adSpend = [], schedule = null } = base
    const failed = []
    for (const { name, parsed, error } of items) {
      if (error) { failed.push(`${name} — ${error}`); continue }
      if (parsed.kind === 'production') {
        // A newer file replaces whole months it covers, so months never double.
        const months = new Set(parsed.rows.map((r) => r.period))
        prodRows = [...prodRows.filter((r) => !months.has(r.period)), ...parsed.rows]
      } else if (parsed.kind === 'collections') {
        // One export covering many months carries each row's transaction
        // month; otherwise the month comes from the file name.
        const byMonth = parsed.rows.some((r) => r.period)
          ? [...new Set(parsed.rows.map((r) => r.period).filter(Boolean))].map((p) => [p, parsed.rows.filter((r) => r.period === p)])
          : [[(() => { const named = /(\d{4})-(\d{2})/.exec(name); return named ? `${named[1]}-${named[2]}` : previousPeriod() })(), parsed.rows]]
        for (const [p, rs] of byMonth) collFiles = [...collFiles.filter((c) => c.period !== p), { name, period: p, rows: rs }]
      } else if (parsed.kind === 'aging') {
        aging = { name, asOf: parsed.asOf, locations: parsed.locations }
      } else if (parsed.kind === 'newPatients') {
        newPatients = parsed.months
      } else if (parsed.kind === 'schedule') {
        // Patient retention has its own page (/retention).
      } else if (parsed.kind === 'adSpend') {
        adSpend = parsed.rows
      } else {
        adjRows = parsed.rows
      }
    }
    setData({ prodRows, adjRows, collFiles, aging, newPatients, adSpend, schedule })
    setErrors(failed)
  }

  async function handleFiles(list) {
    const picked = [...(list || [])]
    if (!picked.length) return
    setBusy(true)
    const items = []
    for (const file of picked) {
      try {
        const parsed = await readDentrixFile(file)
        // An uploaded aging file without a date in its name is as of the day it was saved.
        if (parsed?.kind === 'aging' && !parsed.asOf && file.lastModified) parsed.asOf = new Date(file.lastModified).toISOString().slice(0, 10)
        items.push({ name: file.name, parsed })
      }
      catch (e) { items.push({ name: file.name, error: e.message || 'could not be read' }) }
    }
    ingest(items, data)
    setBusy(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function loadFolder({ quiet } = {}) {
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/reports?skip=schedule', { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
      const json = await res.json().catch(() => ({}))
      // A failure is always shown — quietly falling back to remembered data is
      // what made stale numbers look current. Only "no folder" stays quiet.
      if (!res.ok) setErrors([`Couldn't read the reports folder (${res.status}${json.error ? ': ' + json.error : ''}). Showing the last reports this browser remembered.`])
      else if (json.files?.length) {
        ingest(json.files, EMPTY)
        const t = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        setLoadedNote(`Reports read at ${t}`)
      } else if (!quiet || window.location.hostname === 'localhost') {
        // On this computer an empty answer means the folder wasn't found — say so.
        setErrors([json.noFolder ? 'The server found no reports folder. Showing the last reports this browser remembered.' : 'The reports folder is empty.'])
      }
    } catch (e) {
      setErrors([`Couldn't read the reports folder (${e?.message || 'network error'}). Showing the last reports this browser remembered.`])
    } finally {
      setBusy(false)
    }
  }

  // ── Roles ────────────────────────────────────────────────────────────────
  const roleOf = useCallback((provider) => roleOverrides[provider] || guessRole(provider), [roleOverrides])

  function setRole(provider, role) {
    setRoleOverrides((prev) => {
      const next = { ...prev, [provider]: role }
      try { window.localStorage.setItem(ROLE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  // ── Month ────────────────────────────────────────────────────────────────
  const periods = useMemo(() => [...new Set(data.prodRows.map((r) => r.period))].sort(), [data.prodRows])
  const thisMonth = currentPeriod()
  // A jump from a chat answer: that office (or all) and that month.
  useAnalysisGoto('money', (g) => {
    setOffice(g.office || '')
    if (g.month && periods.includes(g.month)) setPeriod(g.month)
  }, periods.length > 0)

  // Default to the latest complete month; the current month is only partial.
  useEffect(() => {
    if (period && (periods.includes(period) || (period === ALL && periods.length > 1))) return
    const complete = periods.filter((p) => p < thisMonth)
    setPeriod(complete[complete.length - 1] || periods[periods.length - 1] || '')
  }, [periods])

  const inPeriods = useMemo(() => (period === ALL ? periods : [period]), [period, periods])
  const rows = useMemo(() => data.prodRows.filter((r) => inPeriods.includes(r.period)), [data.prodRows, inPeriods])
  const collections = useMemo(() => data.collFiles.filter((c) => inPeriods.includes(c.period)), [data.collFiles, inPeriods])

  // Real ad spend for the months in view, from /api/marketing (Meta now,
  // Google once connected). Fetched fresh — never stored.
  const [marketing, setMarketing] = useState({ status: 'idle' })
  const monthsKey = inPeriods.filter(Boolean).join(',')
  useEffect(() => {
    if (!monthsKey) return
    let cancelled = false
    setMarketing({ status: 'loading' })
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(`/api/marketing?months=${monthsKey}`, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        setMarketing(res.ok ? { status: 'ready', ...json } : { status: 'error', error: json.error || `HTTP ${res.status}` })
      } catch (e) {
        if (!cancelled) setMarketing({ status: 'error', error: e?.message || 'network error' })
      }
    })()
    return () => { cancelled = true }
  }, [monthsKey])

  // Claims follow-up from the RCM app (insurer-level counts), joined to the
  // aging report's open claims. Fetched fresh, never stored.
  const [followUp, setFollowUp] = useState({ status: 'loading' })
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch('/api/claims-followup', { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
        const json = await res.json().catch(() => ({}))
        if (!cancelled) setFollowUp(json.status ? json : { status: 'error', error: json.error || `HTTP ${res.status}` })
      } catch (e) {
        if (!cancelled) setFollowUp({ status: 'error', error: e?.message || 'network error' })
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Share of write-offs the office chose to give, from the Adjustment Summary.
  const officeShare = useMemo(() => {
    let office = 0, ins = 0
    for (const r of data.adjRows) {
      const b = adjustmentBucket(r)
      if (b === 'office') office += r.amount
      if (b === 'insurance') ins += r.amount
    }
    office = Math.abs(office); ins = Math.abs(ins)
    return office + ins > 0 ? (office / (office + ins)) * 100 : null
  }, [data.adjRows])

  if (!profile) return null

  // Offices in the production report, biggest first.
  const officeList = [...new Set(rows.map((r) => r.location))].filter(Boolean)
    .map((l) => [l, rows.filter((r) => r.location === l).reduce((s, r) => s + r.net, 0)]).sort((a, b) => b[1] - a[1]).map(([l]) => l)
  const partial = period === thisMonth
  const periodText = period === ALL ? 'All months' : period ? periodLabel(period) + (partial ? ' (to date)' : '') : ''

  return (
    <div className={embedded ? 'relative' : 'min-h-screen futuristic-bg relative'}>
      <input ref={inputRef} type="file" multiple accept=".csv,.xlsx,.xls" className="hidden"
        onChange={(e) => handleFiles(e.target.files)} />

      <div className="relative z-10">
        {!embedded && <AppHeader />}

        <div className={embedded ? 'w-full' : 'w-full px-6 pt-8 pb-16'}>
          <div className="max-w-[1600px] mx-auto space-y-4">
            <ViewHeader
              title={office ? `Follow the money · ${shortLocation(office)}` : 'Follow the money'}
              subtitle="What was produced, what came in, what insurance still owes, and what was spent."
              controls={periods.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={office} onChange={(v) => setOffice(v || '')} placeholder={null}
                    options={[{ value: '', label: 'All offices' }, ...officeList.map((l) => ({ value: l, label: shortLocation(l) }))]} />
                  <Select value={period} onChange={(v) => setPeriod(v || ALL)} placeholder={null}
                    options={[
                      ...(periods.length > 1 ? [{ value: ALL, label: 'All months' }] : []),
                      ...[...periods].reverse().map((p) => ({ value: p, label: periodLabel(p) + (p === thisMonth ? ' (to date)' : '') })),
                    ]} />
                </div>
              )}
              busy={busy}
              onRefresh={() => loadFolder()}
              onUpload={() => inputRef.current?.click()}
              status={errors.length === 0 ? loadedNote : ''}
              notes={[
                ...(marketing.status === 'ready' && marketing.skipped > 0 && marketing.months?.length > 0
                  ? [{ text: `Meta keeps ad spend for the last 37 months only, so ad spend here starts in ${periodLabel(marketing.months[0])}.` }] : []),
                ...(followUp.status === 'not-connected' ? [{ text: `Claims follow-up (RCM) isn\u2019t connected: add ${followUp.missing.join(', ')} to .env.local.` }] : []),
                ...(followUp.status === 'error' ? [{ tone: 'warn', text: `Claims follow-up (RCM) couldn\u2019t be read: ${followUp.error}` }] : []),
                ...(marketing.status === 'error' ? [{ tone: 'warn', text: `Ad spend couldn\u2019t be loaded: ${marketing.error}` }] : []),
                ...(marketing.errors || []).map((e) => ({ tone: 'warn', text: `Ad spend: ${e}` })),
              ]}
              errors={errors}
            />

            {rows.length > 0 ? (
              <MoneyStory rows={rows} roleOf={roleOf} onRoleChange={setRole} officeShare={officeShare} budget={budget}
                periods={inPeriods} periodText={periodText} collections={collections} aging={data.aging}
                newPatients={data.newPatients} marketing={marketing} adSpend={data.adSpend} followUp={followUp} location={office || undefined} />
            ) : busy ? <LoadingBlocks rows={4} /> : (
              <div className="glass-card rounded-2xl px-6 py-16 text-center">
                <p className="text-sm font-semibold text-slate-800">No reports yet</p>
                <p className="text-xs text-slate-500 mt-2">
                  Put the Dentrix exports in the project&rsquo;s <b>reports</b> folder and click {'\u21bb'}, or use {'\u22ef'} {'\u203a'} Upload.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
