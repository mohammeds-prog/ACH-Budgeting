'use client'

import { useState, useRef, useEffect } from 'react'

export default function Select({ value, onChange, options, placeholder = 'Select…', wide }) {
  const [open, setOpen]   = useState(false)
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
    setOpen((v) => !v)
  }

  const selected = options.find((o) => o.value === value)

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        className={`flex items-center gap-2 px-2.5 py-1.5 text-sm rounded-xl border transition-all duration-150 outline-none bg-white text-left text-slate-900
          ${open ? 'border-indigo-400 ring-2 ring-indigo-100/50' : 'border-slate-200 hover:border-slate-300'}
          ${wide ? 'min-w-[200px]' : 'min-w-[130px]'}`}
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
          <div className="py-1 max-h-52 overflow-y-auto">
            {placeholder && (
              <div
                onMouseDown={(e) => { e.preventDefault(); onChange(''); setOpen(false) }}
                className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                  !value ? 'text-indigo-700 bg-indigo-50' : 'text-slate-400 hover:bg-violet-50 hover:text-slate-700'
                }`}
              >
                {placeholder}
              </div>
            )}
            {options.map((opt) => (
              <div
                key={opt.value}
                onMouseDown={(e) => { e.preventDefault(); onChange(opt.value); setOpen(false) }}
                className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                  value === opt.value ? 'text-indigo-700 bg-indigo-50' : 'text-slate-700 hover:bg-violet-50'
                }`}
              >
                {opt.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
