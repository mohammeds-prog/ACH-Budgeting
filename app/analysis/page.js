'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import ProductionPage from '@/app/production/page'
import RetentionPage from '@/app/retention/page'
import HygieneView from '@/components/HygieneView'
import AssistantPanel from '@/components/AssistantPanel'
import OwnerSummary from '@/components/OwnerSummary'
import DataUpdate from '@/components/DataUpdate'
import { useAnalysisTab } from '@/lib/analysisNav'

// ─────────────────────────────────────────────────────────────────────────────
// Analysis — the owner's one place for the numbers. A switch at the top moves
// between the views; each keeps its own month picker and reports:
//
//   Summary           — the first screen: the few numbers, what needs
//                       attention, and the offices side by side
//   Money             — provider production: work done, cash, what was spent
//   Patient retention — who comes back, by provider and office
//
// The view is kept in the address (?view=retention) so a link or a refresh
// lands on the same one.
// ─────────────────────────────────────────────────────────────────────────────

const VIEWS = [
  {
    key: 'summary', label: 'Summary', sub: 'Are we on track?',
    icon: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  },
  {
    key: 'money', label: 'Money', sub: 'Production, collections and costs',
    icon: <path d="M3 3v18h18M7 15l4-4 3 3 5-6" />,
  },
  {
    key: 'retention', label: 'Patient retention', sub: 'Who comes back, by provider',
    icon: <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></>,
  },
  {
    key: 'hygiene', label: 'Hygiene', sub: 'Production per hygiene hour',
    icon: <><path d="M12 3c-3 4-6 6.5-6 10a6 6 0 0 0 12 0c0-3.5-3-6-6-10z" /></>,
  },
]
const KEYS = VIEWS.map((v) => v.key)
const viewOf = (v) => (KEYS.includes(v) ? v : 'summary')

// useSearchParams needs a Suspense boundary to build.
export default function AnalysisPage() {
  return <Suspense fallback={null}><Analysis /></Suspense>
}

function Analysis() {
  const router = useRouter()
  const params = useSearchParams()
  const [view, setView] = useState(viewOf(params.get('view')))
  // Each view loads its reports only once it's first opened.
  const [seen, setSeen] = useState(() => new Set([viewOf(params.get('view'))]))

  useEffect(() => {
    const v = viewOf(params.get('view'))
    if (v !== view) setView(v)
    setSeen((s) => (s.has(v) ? s : new Set([...s, v])))
  }, [params])

  // "Open in Analysis" from a chat answer switches to that view.
  useAnalysisTab((v) => { if (KEYS.includes(v)) choose(v) })

  function choose(v) {
    setView(v)
    setSeen((s) => (s.has(v) ? s : new Set([...s, v])))
    router.replace(v === 'summary' ? '/analysis' : `/analysis?view=${v}`, { scroll: false })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="min-h-screen futuristic-bg relative">
      <div className="relative z-10">
        <AppHeader />

        <div className="w-full px-6 pt-8 pb-16">
          <div className="max-w-[1600px] mx-auto space-y-6">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Analysis</h1>
                <p className="text-sm text-slate-500 mt-1">The practice in numbers: money, patients, and the hygiene chairs.</p>
              </div>
              <DataUpdate />
            </div>

            {/* The switch between the views stays in reach while a view scrolls. */}
            <div className="sticky top-[57px] z-30 -mx-2 px-2 py-2 bg-[#f3f0ff]/85 backdrop-blur-md rounded-b-2xl">
              <div role="tablist" aria-label="Analysis view" className="inline-flex flex-wrap gap-1 p-1 rounded-2xl bg-white border border-slate-200 shadow-sm">
                {VIEWS.map((v) => {
                  const on = view === v.key
                  return (
                    <button key={v.key} role="tab" aria-selected={on} onClick={() => choose(v.key)}
                      className={`flex items-center gap-2.5 px-4 py-2 rounded-xl text-left transition-all ${
                        on ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:bg-slate-100'
                      }`}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{v.icon}</svg>
                      <span>
                        <span className="block text-sm font-semibold leading-tight">{v.label}</span>
                        <span className={`block text-[11px] leading-tight ${on ? 'text-slate-300' : 'text-slate-400'}`}>{v.sub}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Both stay mounted, so switching back keeps the month picked
                and anything opened; only the one in view is shown. */}
            <div hidden={view !== 'summary'}><OwnerSummary onGo={choose} /></div>
            {seen.has('money') && <div hidden={view !== 'money'}><ProductionPage embedded /></div>}
            {seen.has('retention') && <div hidden={view !== 'retention'}><RetentionPage embedded /></div>}
            {seen.has('hygiene') && <div hidden={view !== 'hygiene'}><HygieneView /></div>}
            <AssistantPanel />
          </div>
        </div>
      </div>
    </div>
  )
}
