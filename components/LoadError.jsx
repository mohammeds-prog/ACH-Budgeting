'use client'

// Shown when a page's data fails to load. Without it a failed load looked
// identical to "there is no data" — an empty table, no message — which is how
// a missing-entries report ends with "it showed up after logging back in".
export default function LoadError({ message }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
      <p className="text-sm text-red-700">{message}</p>
      <button
        onClick={() => window.location.reload()}
        className="shrink-0 px-3 py-1.5 text-xs font-semibold text-red-700 bg-white border border-red-200 hover:bg-red-100 rounded-lg transition-colors"
      >
        Retry
      </button>
    </div>
  )
}
