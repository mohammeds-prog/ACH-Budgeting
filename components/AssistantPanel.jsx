'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { goToAnalysis } from '@/lib/analysisNav'
import { NUM_RE } from '@/lib/answerCheck'

// ─────────────────────────────────────────────────────────────────────────────
// "Ask" — the Analysis page's question box. A button at the bottom right opens
// a side panel; questions go to /api/assistant, which answers from the same
// reports as the page. The conversation lives in this panel only (not saved).
// ─────────────────────────────────────────────────────────────────────────────

// Starting points, grouped the way an owner thinks about the practice.
const SUGGESTIONS = [
  { tag: 'Money', tone: 'indigo', q: 'How did October compare with September?' },
  { tag: 'Claims', tone: 'rose', q: 'Which insurer owes us the most, and why are their claims stuck?' },
  { tag: 'Claims', tone: 'rose', q: 'What are the top reasons the offices could still fix?' },
  { tag: 'Offices', tone: 'amber', q: 'Is Romeoville collecting slower than the other offices?' },
  { tag: 'Patients', tone: 'emerald', q: 'Which provider keeps patients best?' },
  { tag: 'Hygiene', tone: 'sky', q: 'Which hygienist produced the most last month?' },
]
const TAG_TONE = {
  indigo: 'bg-indigo-50 text-indigo-700', rose: 'bg-rose-50 text-rose-700', amber: 'bg-amber-50 text-amber-700',
  emerald: 'bg-emerald-50 text-emerald-700', sky: 'bg-sky-50 text-sky-700',
}

const Spark = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l1.8 4.6L18.5 9.5l-4.7 1.9L12 16l-1.8-4.6L5.5 9.5l4.7-1.9L12 3z" /><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" />
  </svg>
)
const Avatar = ({ size = 'w-7 h-7' }) => (
  <span className={`${size} shrink-0 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-sm shadow-indigo-500/30`}>
    <Spark className="w-[55%] h-[55%]" />
  </span>
)

export default function AssistantPanel() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])   // { role, content, used? , error? }
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [setup, setSetup] = useState(false)      // no API key yet
  const [fresh, setFresh] = useState(null)       // how current the data is
  const listRef = useRef(null)
  const inputRef = useRef(null)

  // Warm up: have the server read the reports while the question is typed.
  useEffect(() => {
    if (!open) return
    supabase.auth.getSession().then(({ data: { session } }) =>
      fetch('/api/assistant', { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
        .then((r) => r.json()).then((j) => j?.ready && setFresh(j)).catch(() => {}))
  }, [open])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open])
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }, [messages, busy])
  // The box grows with the question, up to a few lines.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [input, open])

  async function ask(text) {
    const q = (text ?? input).trim()
    if (!q || busy) return
    const next = [...messages, { role: 'user', content: q }]
    setMessages(next); setInput(''); setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ messages: next.filter((m) => !m.error).map(({ role, content }) => ({ role, content })) }),
      })
      const json = await res.json().catch(() => ({}))
      if (json.status === 'not-configured') { setSetup(true); setMessages(messages); setInput(q); return }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setMessages([...next, { role: 'assistant', content: json.reply, used: [...new Set(json.used || [])], sources: json.sources || [] }])
    } catch (e) {
      setMessages([...next, { role: 'assistant', content: `Sorry — that didn’t work: ${e.message}`, error: true }])
    } finally {
      setBusy(false)
    }
  }

  const freshText = fresh?.scheduleTo || fresh?.agingAsOf
    ? `Reports up to ${fmtDay(fresh.scheduleTo || fresh.agingAsOf)}`
    : 'Dentrix reports, claims follow-up and ad spend'

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-[90] group flex items-center gap-2.5 pl-2 pr-5 py-2 rounded-full text-white font-semibold shadow-xl shadow-indigo-600/30 bg-gradient-to-r from-indigo-600 to-violet-600 hover:shadow-indigo-600/40 transition-all hover:-translate-y-0.5">
          <span className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center group-hover:bg-white/25 transition-colors"><Spark className="w-5 h-5" /></span>
          Ask about the numbers
        </button>
      )}

      {open && createPortal(
        <div className="fixed inset-0 z-[100] flex justify-end bg-slate-900/25 backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
          <aside role="dialog" aria-label="Ask about the numbers" onMouseDown={(e) => e.stopPropagation()}
            className="chat-slide w-full max-w-[560px] h-full flex flex-col bg-[#f7f6fd] shadow-2xl sm:rounded-l-3xl overflow-hidden border-l border-white">

            {/* ── Header ── */}
            <div className="relative px-5 pt-4 pb-4 bg-white border-b border-slate-200/70">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-400" />
              <div className="flex items-center gap-3">
                <Avatar size="w-10 h-10" />
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-semibold text-slate-900 leading-tight">Ask about the numbers</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{freshText}
                  </p>
                </div>
                {messages.length > 0 && (
                  <button onClick={() => setMessages([])} title="Start over"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                    New chat
                  </button>
                )}
                <button onClick={() => setOpen(false)} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
            </div>

            {/* ── Conversation ── */}
            <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {setup && (
                <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-[12.5px] text-amber-800">
                  The assistant isn&rsquo;t set up yet: add a Groq or Anthropic key to .env.local (and to Vercel for the live site), then restart the app.
                </div>
              )}

              {messages.length === 0 && !setup && (
                <div className="pt-6">
                  <div className="flex flex-col items-center text-center">
                    <Avatar size="w-14 h-14" />
                    <p className="mt-4 text-lg font-semibold text-slate-900">What would you like to know?</p>
                    <p className="mt-1 text-[13px] text-slate-500 max-w-sm">Ask in plain words. Every answer shows the data it used, and links to where you can see it in Analysis.</p>
                  </div>
                  <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {SUGGESTIONS.map((s) => (
                      <button key={s.q} onClick={() => ask(s.q)}
                        className="group text-left rounded-2xl bg-white border border-slate-200/80 px-3.5 py-3 shadow-sm hover:border-indigo-300 hover:shadow-md hover:-translate-y-px transition-all">
                        <span className={`inline-block px-1.5 py-px rounded-md text-[10px] font-semibold ${TAG_TONE[s.tone]}`}>{s.tag}</span>
                        <span className="block mt-1.5 text-[13px] text-slate-700 leading-snug group-hover:text-slate-900">{s.q}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                m.role === 'user' ? (
                  <div key={i} className="flex justify-end">
                    <p className="max-w-[82%] rounded-2xl rounded-br-md bg-gradient-to-br from-indigo-600 to-violet-600 text-white px-4 py-2.5 text-[13.5px] leading-snug shadow-sm shadow-indigo-600/20 whitespace-pre-wrap">{m.content}</p>
                  </div>
                ) : (
                  <div key={i} className="flex items-start gap-2.5">
                    <Avatar />
                    <div className="flex-1 min-w-0">
                      <Answer m={m} onOpen={(link) => { goToAnalysis(link); setOpen(false) }} />
                    </div>
                  </div>
                )
              ))}

              {busy && (
                <div className="flex items-start gap-2.5">
                  <Avatar />
                  <div className="flex-1 rounded-2xl rounded-tl-md bg-white border border-slate-200/80 shadow-sm px-4 py-3.5">
                    <p className="text-[12.5px] text-slate-500 flex items-center gap-2">
                      <span className="flex gap-1">
                        {[0, 1, 2].map((d) => <span key={d} className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: `${d * 120}ms` }} />)}
                      </span>
                      Reading the reports{'…'}
                    </p>
                    <div className="mt-3 space-y-2 animate-pulse">
                      <div className="h-2.5 rounded-full bg-slate-100 w-11/12" />
                      <div className="h-2.5 rounded-full bg-slate-100 w-9/12" />
                      <div className="h-2.5 rounded-full bg-slate-100 w-10/12" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── Ask ── */}
            <form onSubmit={(e) => { e.preventDefault(); ask() }} className="px-4 pt-3 pb-4 bg-white/80 backdrop-blur border-t border-slate-200/70">
              <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100 transition-shadow">
                <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} rows={1}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }}
                  placeholder="Ask about production, claims, patients, hygiene…"
                  className="flex-1 resize-none outline-none text-[13.5px] text-slate-800 placeholder:text-slate-400 bg-transparent py-1 leading-snug" />
                <button type="submit" disabled={busy || !input.trim()} aria-label="Send"
                  className="shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center shadow-sm disabled:opacity-30 disabled:shadow-none hover:brightness-110 transition">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                </button>
              </div>
              <p className="text-[10.5px] text-slate-400 mt-2 px-1 flex flex-wrap gap-x-3">
                <span>Enter to send {'·'} Shift+Enter for a new line</span>
                <span>Numbers link to their data {'—'} check the important ones.</span>
              </p>
            </form>
          </aside>
        </div>,
        document.body,
      )}
    </>
  )
}

const fmtDay = (iso) => {
  if (!iso) return ''
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`)
  return isNaN(d) ? String(iso) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

// One answer, in a card: a note when some numbers aren't from the data, the
// text (each [n] opens source n), and the sources as chips beneath — each
// shows the exact figures the answer used and links to that Analysis view.
function Answer({ m, onOpen }) {
  const [shown, setShown] = useState(null)
  const [copied, setCopied] = useState(false)
  const sources = (m.sources || []).filter((x) => x.tool !== 'data_overview')
  const show = (n) => setShown((cur) => (cur === n ? null : n))
  const open = sources.find((x) => x.n === shown)
  const copy = () => {
    navigator.clipboard?.writeText(String(m.content || '').replace(/\[\d+(?:\s*,\s*\d+)*\]/g, '')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  }
  return (
    <div className="space-y-2">
      <div className={`rounded-2xl rounded-tl-md bg-white border shadow-sm px-4 py-3.5 ${m.error ? 'border-red-200' : 'border-slate-200/80'}`}>
        <div className={`chat-md text-[13.5px] leading-relaxed ${m.error ? 'text-red-600' : 'text-slate-700'}`}>
          <Markdown text={m.content} onRef={sources.length ? show : null} known={new Set(sources.map((x) => x.n))} active={shown} pool={null} />
        </div>
      </div>

      {!m.error && (
        <div className="flex flex-wrap items-center gap-1.5 pl-1">
          {sources.length > 0 && <span className="text-[10.5px] font-semibold text-slate-400 mr-0.5">Sources</span>}
          {sources.map((x) => (
            <button key={x.n} onClick={() => show(x.n)} title={x.label}
              className={`inline-flex items-center gap-1.5 max-w-[240px] pl-1 pr-2 py-1 rounded-lg border text-[11px] transition-colors ${shown === x.n ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-slate-900'}`}>
              <span className={`w-4 h-4 rounded text-[9.5px] font-bold flex items-center justify-center ${shown === x.n ? 'bg-white/20' : 'bg-indigo-50 text-indigo-700'}`}>{x.n}</span>
              <span className="truncate">{x.label}</span>
            </button>
          ))}
          <button onClick={copy} className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-slate-400 hover:text-slate-700 hover:bg-white">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}

      {open && (
        <div className="rounded-2xl bg-white border border-indigo-100 shadow-sm px-4 py-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="text-[12px] font-semibold text-slate-800"><span className="text-indigo-600">[{open.n}]</span> {open.label}</p>
            <button onClick={() => setShown(null)} aria-label="Close source" className="text-slate-400 hover:text-slate-700 text-xs">{'✕'}</button>
          </div>
          <SourceData data={open.data} />
          {open.link && (
            <button onClick={() => onOpen(open.link)}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-semibold hover:bg-slate-700">
              Open in Analysis {'→'}
              <span className="font-normal text-slate-300">{[open.link.view === 'summary' ? 'Summary' : open.link.view === 'money' ? 'Money' : open.link.view === 'retention' ? 'Patient retention' : open.link.view === 'doctors' ? 'Doctor production' : 'Hygiene', open.link.provider, open.link.office?.replace(/^Valley View Dental /, ''), open.link.from && open.link.to ? null : open.link.month, open.link.from && `${open.link.from} – ${open.link.to}`].filter(Boolean).join(' · ')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// The figures a tool returned, as plain tables: single values as a short
// list, lists of rows as a table (first 40 rows).
function SourceData({ data }) {
  if (!data || typeof data !== 'object') return <p className="text-[11px] text-slate-500">No data.</p>
  if (data.error) return <p className="text-[11px] text-red-600">{data.error}</p>
  const label = (k) => String(k).replace(/_/g, ' ')
  const fmt = (k, v) => {
    if (v == null) return '\u2014'
    if (typeof v === 'number') {
      if (/pct|rate|percent/i.test(k)) return `${v}%`
      if (/(gross|net|writeoffs|total|insurance|patients_paid|expected|billed|production|spend|refunds|for_same_month_work|dollars|amount)$/i.test(k) && Math.abs(v) >= 100) return `$${Math.round(v).toLocaleString('en-US')}`
      return v.toLocaleString('en-US')
    }
    if (typeof v === 'object') return Array.isArray(v) ? v.join(', ') : Object.entries(v).map(([a, b]) => `${label(a)} ${typeof b === 'number' ? b.toLocaleString('en-US') : b}`).join(' \u00b7 ')
    return String(v)
  }
  const scalars = Object.entries(data).filter(([, v]) => v == null || typeof v !== 'object')
  const blocks = Object.entries(data).filter(([, v]) => v && typeof v === 'object')
  return (
    <div className="space-y-2 text-[11px]">
      {scalars.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          {scalars.map(([k, v]) => <Fragment key={k}><dt className="text-slate-400">{label(k)}</dt><dd className="text-slate-700 tabular-nums">{fmt(k, v)}</dd></Fragment>)}
        </dl>
      )}
      {blocks.map(([k, v]) => {
        const rows = Array.isArray(v) ? v.filter((r) => r && typeof r === 'object') : null
        if (rows && rows.length) {
          const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => rows.some((r) => r[c] == null || typeof r[c] !== 'object'))
          return (
            <div key={k}>
              <p className="font-semibold text-slate-500 mb-1">{label(k)}</p>
              <div className="overflow-x-auto rounded-lg border border-slate-100">
                <table className="w-full tabular-nums">
                  <thead><tr className="bg-slate-50">{cols.map((c) => <th key={c} className="text-left font-semibold text-slate-500 px-2 py-1 whitespace-nowrap">{label(c === 'key' ? 'name' : c)}</th>)}</tr></thead>
                  <tbody>{rows.slice(0, 40).map((r, i) => <tr key={i} className="border-t border-slate-100">{cols.map((c) => <td key={c} className="px-2 py-1 whitespace-nowrap text-slate-700">{fmt(c, r[c])}</td>)}</tr>)}</tbody>
                </table>
              </div>
              {rows.length > 40 && <p className="text-slate-400 mt-0.5">{rows.length - 40} more rows not shown</p>}
            </div>
          )
        }
        if (!Array.isArray(v)) {
          return (
            <div key={k}>
              <p className="font-semibold text-slate-500 mb-1">{label(k)}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                {Object.entries(v).map(([a, b]) => <Fragment key={a}><dt className="text-slate-400">{label(a)}</dt><dd className="text-slate-700 tabular-nums">{fmt(a, b)}</dd></Fragment>)}
              </dl>
            </div>
          )
        }
        return null
      })}
    </div>
  )
}

// ── Checking an answer's numbers against its data ─────────────────────────
// lib/answerCheck.js decides (the same rules as the server's self-check);
// here the numbers it flags are underlined.
const poolRef = { current: null }      // the flagged numbers of the answer being drawn
function splitNumbers(s) {
  const bad = poolRef.current
  const out = []
  let last = 0
  for (const m of s.matchAll(NUM_RE)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) })
    if (m[1]) out.push({ text: m[0] })
    else out.push({ text: m[0], num: true, ok: !(bad && bad.has(m[0].trim())) })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ text: s.slice(last) })
  return out
}

// A small, safe Markdown renderer for the assistant's replies: paragraphs,
// **bold**, bullet and numbered lists, and tables. No HTML is ever injected.
// [n] source markers become small buttons when onRef is given.
function Markdown({ text, onRef, known, active, pool }) {
  if (pool) poolRef.current = pool
  const lines = String(text || '').split('\n')
  const out = []
  let i = 0
  const nums = (s, k) => (pool ? splitNumbers(s).map((t, j) => (t.num && !t.ok
    ? <span key={`${k}-n${j}`} title="Not in the data this answer looked at \u2014 worked out or estimated by the assistant. Check before relying on it."
        className="underline decoration-dotted decoration-amber-500 decoration-2 underline-offset-2">{t.text}</span>
    : t.text)) : [s])
  const refs = (s, k) => (onRef ? s.split(/(\[\d+(?:\s*,\s*\d+)*\])/g).flatMap((part, j) => {
    const m = part.match(/^\[(\d+(?:\s*,\s*\d+)*)\]$/)
    if (!m) return nums(part, `${k}-${j}`)
    return m[1].split(/\s*,\s*/).map(Number).map((n) => (known?.has(n)
      ? <button key={`${k}-r${j}-${n}`} onClick={() => onRef(n)} title="Show the data behind this"
          className={`inline-flex items-center justify-center align-super ml-0.5 min-w-[16px] h-4 px-1 rounded text-[9px] font-bold ${active === n ? 'bg-indigo-600 text-white' : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'}`}>{n}</button>
      : `[${n}]`))
  }) : nums(s, k))
  const inline = (s, k) => s.split(/(\*\*[^*]+\*\*)/g).flatMap((part, j) =>
    /^\*\*[^*]+\*\*$/.test(part) ? [<b key={`${k}-${j}`} className="font-semibold text-slate-900">{refs(part.slice(2, -2), `${k}-${j}b`)}</b>] : refs(part, `${k}-${j}`))
  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++ }
      const cells = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r)).map((r) => r.trim().slice(1, -1).split('|').map((c) => c.trim()))
      const [head, ...body] = cells
      out.push(
        <div key={`t${i}`} className="overflow-x-auto my-3 rounded-xl border border-slate-200">
          <table className="w-full text-[12px] border-collapse">
            <thead><tr className="bg-slate-50">{head.map((c, j) => <th key={j} className={`font-semibold text-slate-500 px-3 py-2 whitespace-nowrap ${j ? 'text-right' : 'text-left'}`}>{inline(c, `h${j}`)}</th>)}</tr></thead>
            <tbody>{body.map((r, ri) => <tr key={ri} className="border-t border-slate-100 even:bg-slate-50/50">{r.map((c, j) => <td key={j} className={`px-3 py-1.5 tabular-nums text-slate-700 ${j ? 'text-right' : 'text-left font-medium text-slate-800'}`}>{inline(c, `c${ri}${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')); i++ }
      const L = ordered ? 'ol' : 'ul'
      out.push(<L key={`l${i}`} className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 my-1.5 space-y-0.5`}>{items.map((it, j) => <li key={j}>{inline(it, `i${i}${j}`)}</li>)}</L>)
      continue
    }
    if (/^#{1,4}\s+/.test(line)) { out.push(<p key={`h${i}`} className="font-semibold text-slate-900 mt-2">{inline(line.replace(/^#{1,4}\s+/, ''), `hh${i}`)}</p>); i++; continue }
    if (line.trim()) out.push(<p key={`p${i}`} className="my-1.5">{inline(line, `p${i}`)}</p>)
    i++
  }
  return <>{out}</>
}
