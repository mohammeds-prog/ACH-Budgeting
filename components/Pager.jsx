'use client'

// One pagination bar, rendered both above and below the table so pages can be
// changed without scrolling to the bottom. Kept as a single component so the
// top and bottom copies can never drift apart.
export default function Pager({ page, totalPages, pageSize, total, onChange }) {
  if (totalPages <= 1) return null
  const btn = 'flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed'
  return (
    <div className="flex items-center justify-between px-5 py-3 glass-card rounded-2xl">
      <span className="text-xs text-slate-500">
        {((page - 1) * pageSize + 1).toLocaleString()}–{Math.min(page * pageSize, total).toLocaleString()} of {total.toLocaleString()} entries
      </span>
      <div className="flex items-center gap-1">
        <button onClick={() => onChange(page - 1)} disabled={page === 1} className={btn}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5"/></svg>
          Prev
        </button>
        <span className="px-3 text-xs text-slate-500 tabular-nums">Page {page} of {totalPages}</span>
        <button onClick={() => onChange(page + 1)} disabled={page === totalPages} className={btn}>
          Next
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg>
        </button>
      </div>
    </div>
  )
}
