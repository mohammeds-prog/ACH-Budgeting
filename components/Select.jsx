'use client'

import { useState, useRef, useEffect } from 'react'

// A search box shows at the top of long lists (over 10 options), or with
// `searchable`. Every word typed must appear in the label, in any order, so
// "krupa patel" finds "Patel, Krupa".
export default function Select({ value, onChange, options, placeholder = 'Select…', wide, full, searchable }) {
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')
  const searchRef         = useRef(null)
  const [rect, setRect]   = useState(null)
  const btnRef            = useRef(null)
  const dropRef           = useRef(null)

  useEffect(() => {
    if (!open) return
    function handle(e) {
      if (
        btnRef.current && !btnRef.current.contains(e.target) &&
        dropRef.current && !dropRef.current.contains(e.target)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  // Recalculate position on scroll/resize while open
  useEffect(() => {
    if (!open) return
    function update() {
      if (btnRef.current) setRect(btnRef.current.getBoundingClientRect())
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open])

  function handleOpen() {
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect())
    setQuery('')
    setOpen((v) => !v)
  }

  const selected = options.find((o) => o.value === value)
  const canSearch = searchable ?? options.length > 10
  const words = query.toLowerCase().split(/[\s,]+/).filter(Boolean)
  const shown = words.length ? options.filter((o) => { const l = String(o.label).toLowerCase(); return words.every((w) => l.includes(w)) }) : options
  useEffect(() => { if (open && canSearch) setTimeout(() => searchRef.current?.focus(), 0) }, [open, canSearch])
  const pick = (v) => { onChange(v); setOpen(false); setQuery('') }

  return (
    <div className={full ? 'relative w-full' : 'relative'}>
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        className={`flex items-center gap-2 px-2.5 py-1.5 text-sm rounded-xl border transition-all duration-150 outline-none bg-white text-left text-slate-900
          ${open ? 'border-indigo-400 ring-2 ring-indigo-100/50' : 'border-slate-200 hover:border-slate-300'}
          ${full ? 'w-full' : wide ? 'min-w-[200px]' : 'min-w-[130px]'}`}
      >
        <span className="flex-1 truncate">{selected?.label ?? placeholder}</span>
        <svg
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7"/>
        </svg>
      </button>

      {open && rect && (
        <div
          ref={dropRef}
          className="z-[9999] bg-white border border-slate-200 rounded-xl overflow-hidden"
          style={{
            position: 'fixed',
            top: rect.bottom + 6,
            left: rect.left,
            minWidth: rect.width,
            boxShadow: '0 8px 24px rgba(148,163,184,0.25)',
          }}
        >
          {canSearch && (
            <div className="p-2 border-b border-slate-100">
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 focus-within:border-indigo-300 focus-within:bg-white">
                <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="m20 20-3.5-3.5" /></svg>
                <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setOpen(false); setQuery('') }
                    if (e.key === 'Enter' && shown[0]) { e.preventDefault(); pick(shown[0].value) }
                  }}
                  className="flex-1 min-w-0 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 outline-none" />
                {query && <button type="button" onMouseDown={(e) => { e.preventDefault(); setQuery(''); searchRef.current?.focus() }} className="text-slate-400 hover:text-slate-600 text-xs" aria-label="Clear search">{'✕'}</button>}
              </div>
            </div>
          )}
          <div className={`py-1 ${canSearch ? 'max-h-64' : 'max-h-52'} overflow-y-auto`}>
            {placeholder && !query && (
              <div
                onMouseDown={(e) => { e.preventDefault(); pick('') }}
                className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                  !value ? 'text-indigo-700 bg-indigo-50' : 'text-slate-400 hover:bg-violet-50 hover:text-slate-700'
                }`}
              >
                {placeholder}
              </div>
            )}
            {shown.map((opt) => (
              <div
                key={opt.value}
                onMouseDown={(e) => { e.preventDefault(); pick(opt.value) }}
                className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                  value === opt.value ? 'text-indigo-700 bg-indigo-50' : 'text-slate-700 hover:bg-violet-50'
                }`}
              >
                {opt.label}
              </div>
            ))}
            {canSearch && !shown.length && <div className="px-3 py-3 text-sm text-slate-400">No matches for {'“'}{query}{'”'}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
