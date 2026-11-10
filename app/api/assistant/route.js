import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { refuseUnlessOwner } from '@/lib/serverAuth'
import { ASSISTANT_TOOLS, runTool, loadReports, compactResult, dataOverview, sourceFor } from '@/lib/analysisTools'
import { unverifiedNumbers } from '@/lib/answerCheck'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/assistant — the Analysis page's question box.
//
// Body: { messages: [{ role: 'user' | 'assistant', content: string }] }
// Reply: { reply, used: [tool names], engine }  ·  { status: 'not-configured' }
//
// Engine: Claude (ANTHROPIC_API_KEY) when set; otherwise Groq (GROQ_API_KEY_0…_3,
// model GROQ_MODEL, default openai/gpt-oss-120b) through its OpenAI-style
// chat endpoint. Same tools and instructions either way.
//
// Claude answers by calling the tools in lib/analysisTools.js, which read the
// same reports as the Analysis page and return totals only — no patient
// names reach the model. Owners and management only, like the page.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MODEL = 'claude-opus-5-5'
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
const MAX_STEPS = 8

// Kept byte-stable (no dates or ids) so the prompt cache can reuse it; today's
// date comes from the data_overview tool instead.
const SYSTEM = `You are the analyst for a dental group's owners. The group has six offices: Valley View Dental Romeoville, Naperville and Montgomery; Dentique Lemont and Downers Grove; and Alora Dental Spa.

Answer questions about the practice using only the tools, which read the group's Dentrix reports, claims follow-up and ad spend. Never guess a number: if a tool doesn't have it, say what's missing and which report would provide it. Payroll, doctor pay, rent, lab costs and hygienist hours are not available.

How the numbers work:
- Production is by service month. Gross = full fees; write-offs = insurance contract adjustments and discounts; net = what can actually be collected.
- Collections are by the month the money arrived. Money received in a month pays for that month's work and for earlier months, so collections can exceed that month's net production.
- Open claims ("expected") are the full contracted amount, including the patient's share — they overlap with what patients already paid, so never add them to collections.
- Retention: of patients seen in a period, how many came back or have something booked. For recent periods bookings count; for older ones actual return visits.
- Denial reasons from claims follow-up are by insurer, not tied to individual claims. Each reason has office_can_fix: only those marked true are things the office can fix and resubmit (e.g. Timely Filing appeal, Missing Documentation, Provider Not Credentialed, Missing Primary EOB, COB Issue, Duplicate Claim, Missing Subscriber Info, Rejected Claim, Missing Authorization). The rest are the plan's rules — Benefit Maximum Reached, Not a Covered Service, Frequency Limitation, Eligibility / Plan Terminated, Out of Network, Not Dentally Necessary, Appeal Denied, Primary Already Paid: insurance won't pay those claims; the office's options are to verify the denial is right, bill a secondary insurance, or bill the patient, and to prevent them next time with benefit and eligibility checks before treatment. Never list a plan's-rules reason as something the office can fix on the existing claim. open_dollars_split says how the open dollars divide: in denials (fixable vs plan rules), not denied (still being worked), and with insurers not in the follow-up sheet — denials are usually a small part, so never say most open dollars are blocked by denials unless the split shows it. When a result has in_plain_words, state that conclusion as given (you may rephrase, not change its numbers). denial_reasons_ranked covers exactly what denial_reasons_scope says: a ranking for all insurers is never one insurer's figures — for one insurer, call open_claims with carrier set to that insurer.

When the period isn't stated, use the most recent complete month (the data loaded is listed at the end of these instructions, so there's no need to call data_overview). Tool results list rows as tables: columns, then one array per row. Name the period and the source in the answer. Each tool result says months_covered: label the numbers with that period, never with the period you asked for — if it says none, say there's no data rather than using another period. Lead with the answer in a sentence or two, then the few numbers that support it; use a short table when comparing several offices, providers or months. Round money to whole dollars. When ranking, sort the table by the thing ranked, and don't crown a provider or office with few patients or little production (under about 100 patients, or a small share) — mention them separately if they stand out. Plain language — the reader is a busy owner, not an analyst.

Don't call the same tool with the same input twice. Do the digging yourself: call as many tools as the question needs (for "why", compare with the other offices, the trend, the insurers or the providers). Never tell the reader to run a report, a query or a tool — if a tool can answer it, call it; only say something is missing when no tool has it. Check units: "claims", "patients" and "denials" are counts, never dollars.

Sources (required): every tool result has a source_id. Put [n] (that id) right after each number or fact you take from it, e.g. "Romeoville's net production was $751,374 [2]". Use only numbers from tool results, or simple arithmetic on them — when you calculate, show it (e.g. "$20,652 − $4,300 = $16,352 [3]"). Never invent estimates, projections, savings, targets, benchmarks or "expected impact" figures. Recommendations are welcome, but without made-up dollar amounts or percentages; if something can be sized from the data, size it and cite it, otherwise say it can't be sized from these reports.`

export async function POST(request) {
  try {
    const refused = await refuseUnlessOwner(request)
    if (refused) return refused
    if (!process.env.ANTHROPIC_API_KEY && !groqConfigured()) return NextResponse.json({ status: 'not-configured' })

    const body = await request.json().catch(() => ({}))
    const history = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
    if (!history.length || history[history.length - 1].role !== 'user') {
      return NextResponse.json({ error: 'Send a question.' }, { status: 400 })
    }

    const reports = await loadReports()
    const overview = await dataOverview(reports)
    // The default period, spelled out: the last complete month.
    const now = new Date().toISOString().slice(0, 7)
    const prev = (p) => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7) }
    const latest = overview.production?.to || now
    const defaultMonth = latest >= now ? prev(now) : latest
    const system = `${SYSTEM}

Default period: when the question names no period, use ${defaultMonth} (the last complete month) — not older months, and not the whole history. Only use a range when asked ("this year", "last 6 months", "trend").

Data loaded right now: ${JSON.stringify(overview)}`
    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json(await askGroq(history, reports, system))

    const client = new Anthropic()
    const messages = [...history]
    const used = []
    const sources = []

    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        // If a safety classifier declines, the API retries on a fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        cache_control: { type: 'ephemeral' },
        system,
        tools: ASSISTANT_TOOLS,
        messages,
      })

      if (response.stop_reason === 'refusal') {
        return NextResponse.json({ reply: 'I can’t help with that one. Try asking about production, collections, claims, retention, new patients or hygiene.', used, sources })
      }
      // The whole turn goes back as-is (tool calls and any thinking blocks).
      messages.push({ role: 'assistant', content: response.content })

      const calls = response.content.filter((b) => b.type === 'tool_use')
      if (response.stop_reason !== 'tool_use' || !calls.length) {
        let reply = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
        const bad = reply ? unverifiedNumbers(reply, sources) : []
        if (bad.length && sources.length) {
          const fix = await client.beta.messages.create({
            model: MODEL, max_tokens: 8000, output_config: { effort: 'low' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
            system, messages: [...messages, { role: 'user', content: correctionNote(bad) }],
          }).catch(() => null)
          const fixed = fix ? fix.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() : ''
          if (fixed && unverifiedNumbers(fixed, sources).length < bad.length) reply = fixed
        }
        return NextResponse.json({ reply: reply || (response.stop_reason === 'max_tokens' ? 'That answer ran too long — try a narrower question.' : 'I couldn’t find an answer to that.'), used, sources, engine: MODEL })
      }

      // Every tool result of this turn goes back in one message.
      const results = []
      for (const c of calls) {
        used.push(c.name)
        const { out, content } = await runSourced(c.name, c.input, reports, sources)
        results.push({ type: 'tool_result', tool_use_id: c.id, content, ...(out?.error ? { is_error: true } : {}) })
      }
      messages.push({ role: 'user', content: results })
    }
    return NextResponse.json({ reply: 'That needed more steps than I can take in one go — try splitting it into smaller questions.', used, sources })
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return NextResponse.json({ error: 'The Anthropic API key was rejected.' }, { status: 502 })
    if (e instanceof Anthropic.RateLimitError) return NextResponse.json({ error: 'Too many questions at once — try again in a minute.' }, { status: 429 })
    if (e instanceof Anthropic.APIError) return NextResponse.json({ error: `Claude API error ${e.status}: ${e.message}` }, { status: 502 })
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 })
  }
}

// One tool call, numbered for the answer's source list. The model sees the
// number as source_id; the panel gets the label, the link and the same
// totals the model saw (totals only — no patient names).
async function runSourced(name, input, reports, sources) {
  // The same call twice: point back to the first instead of fetching again.
  const sig = `${name}|${JSON.stringify(input || {})}`
  const dup = sources.find((x) => x.sig === sig)
  if (dup) return { out: {}, content: compactResult({ note: `You already have this as source ${dup.n}. Use it; don't call the same tool with the same input again.` }) }
  const out = await runTool(name, input, reports)
  const n = sources.length + 1
  const { label, link } = sourceFor(name, input)
  sources.push({ n, tool: name, label, link, data: out, sig })
  return { out, content: compactResult({ source_id: n, ...out }) }
}

// ── Groq (OpenAI-style chat completions with function calling) ──────────────
// The same loop: the model calls tools, results go back, until it answers.
async function askGroq(history, reports, system) {
  const tools = ASSISTANT_TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }))
  const messages = [{ role: 'system', content: system }, ...history]
  const used = []
  const sources = []
  for (let step = 0; step < MAX_STEPS; step++) {
    const { res, json } = await groqCall(messages, tools)
    if (!res.ok) {
      const msg = json.error?.message || `HTTP ${res.status}`
      if (res.status === 429) return { reply: 'Groq’s free limit was reached for now — try again in a minute.', used, sources, engine: GROQ_MODEL }
      throw new Error(`Groq: ${msg}`)
    }
    const msg = json.choices?.[0]?.message
    if (!msg) throw new Error('Groq returned no answer.')
    const calls = msg.tool_calls || []
    if (!calls.length) {
      let reply = (msg.content || '').trim() || 'I couldn’t find an answer to that.'
      // Self-check: numbers that aren't in the data (or simple sums of it) go
      // back to the model once to be corrected or removed.
      const bad = unverifiedNumbers(reply, sources)
      if (bad.length && sources.length) {
        messages.push({ role: 'assistant', content: reply }, { role: 'user', content: correctionNote(bad) })
        const fix = await groqCall(messages, tools, 'none')
        const fixed = fix.res.ok ? (fix.json.choices?.[0]?.message?.content || '').trim() : ''
        if (fixed && unverifiedNumbers(fixed, sources).length < bad.length) reply = fixed
      }
      return { reply, used, sources, engine: GROQ_MODEL }
    }
    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls })
    for (const c of calls) {
      used.push(c.function?.name)
      let input = {}
      try { input = JSON.parse(c.function?.arguments || '{}') } catch { input = null }
      const content = input ? (await runSourced(c.function.name, input, reports, sources)).content : compactResult({ error: 'The tool arguments were not valid JSON.' })
      messages.push({ role: 'tool', tool_call_id: c.id, content })
    }
  }
  return { reply: 'That needed more steps than I can take in one go — try splitting it into smaller questions.', used, sources, engine: GROQ_MODEL }
}

// Groq keys, in the same order as TuskPortal (GROQ_API_KEY_0, GROQ_API_KEY,
// GROQ_API_KEY_2, GROQ_API_KEY_3). When one hits its limit the next is used;
// the one that last worked is tried first next time.
const GROQ_KEYS = [process.env.GROQ_API_KEY_0, process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2, process.env.GROQ_API_KEY_3]
  .filter((k, i, all) => k && all.indexOf(k) === i)
let groqStart = 0
const groqConfigured = () => GROQ_KEYS.length > 0

// One step. On a 429 the next key is tried at once; when every key is at its
// limit, the smaller model (its own allowance) is tried on each key, and only
// then a short wait — so an answer rarely stalls.
const GROQ_FALLBACK = process.env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-20b'
async function groqCall(messages, tools, toolChoice = 'auto') {
  let last = null
  let shortest = Infinity
  for (const model of [GROQ_MODEL, GROQ_FALLBACK]) {
    for (let i = 0; i < GROQ_KEYS.length; i++) {
      const k = (groqStart + i) % GROQ_KEYS.length
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', { cache: 'no-store',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEYS[k]}` },
        // Lookups and comparisons don't need long reasoning; low is much faster.
        body: JSON.stringify({ model, messages, tools, tool_choice: toolChoice, temperature: 0.2, max_tokens: 1500, reasoning_effort: 'low' }),
      })
      const json = await res.json().catch(() => ({}))
      // 401/403: a dead key — skip it like a limit. Anything else is the answer.
      if (res.status !== 429 && res.status !== 401 && res.status !== 403) { groqStart = k; return { res, json } }
      last = { res, json }
      if (res.status === 429) shortest = Math.min(shortest, Number(res.headers.get('retry-after')) || 5)
    }
  }
  // Every key and both models are at their limit: wait once if it's short.
  if (shortest <= 15) {
    await new Promise((r) => setTimeout(r, shortest * 1000))
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', { cache: 'no-store',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEYS[groqStart]}` },
      body: JSON.stringify({ model: GROQ_FALLBACK, messages, tools, tool_choice: toolChoice, temperature: 0.2, max_tokens: 1500, reasoning_effort: 'low' }),
    })
    return { res, json: await res.json().catch(() => ({})) }
  }
  return last
}

// Opening the chat calls this, so the reports are read (and cached) while
// the owner types instead of after they ask.
export async function GET(request) {
  const refused = await refuseUnlessOwner(request)
  if (refused) return refused
  const o = await dataOverview(await loadReports())
  // How current the data is, for the panel's header.
  return NextResponse.json({ ready: true, scheduleTo: o.schedule?.appointments_up_to || null, agingAsOf: o.aging?.as_of || null, productionTo: o.production?.to || null })
}

// The note that sends an answer back when some of its numbers aren't backed
// by the tool results.
function correctionNote(bad) {
  return `Before this goes to the owner: these numbers in your answer are not in any tool result, and are not a simple sum or difference of tool results: ${bad.slice(0, 12).join(', ')}. ` +
    'Rewrite the whole answer so every number comes from a tool result (cite its [n]) or is plain arithmetic on them with the working shown. ' +
    'If a number was an estimate, benchmark, projection or a figure for a different scope (e.g. an all-insurer total used for one insurer), remove it or say it can\u2019t be worked out from these reports. ' +
    'Keep the same structure and plain language. Reply with the corrected answer only.'
}
