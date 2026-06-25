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
        className={`flex items-center gap-2 px-2.5 py-1.5 text-sm rounded-xl border transition-all duration-150 outline-none bg-slate-800/80 text-left text-white
          ${open ? 'border-indigo-500/60 ring-2 ring-indigo-500/20' : 'border-white/[0.08] hover:border-white/20'}
          ${wide ? 'min-w-[200px]' : 'min-w-[130px]'}`}
      >
        <span className="flex-1 truncate">{selected?.label ?? placeholder}</span>
        <svg
          className={`w-3.5 h-3.5 text-white/30 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7"/>
        </svg>
      </button>

      {open && rect && (
        <div
          ref={dropRef}
          className="z-[9999] bg-slate-900 border border-white/[0.12] rounded-xl overflow-hidden"
          style={{
            position: 'fixed',
            top: rect.bottom + 6,
            left: rect.left,
            minWidth: rect.width,
            boxShadow: '0 24px 48px rgba(0,0,0,0.6)',
          }}
        >
          <div className="py-1 max-h-52 overflow-y-auto">
            {placeholder && (
              <div
                onMouseDown={(e) => { e.preventDefault(); onChange(''); setOpen(false) }}
                className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                  !value ? 'text-indigo-400 bg-indigo-500/10' : 'text-white/40 hover:bg-white/[0.05] hover:text-white'
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
                  value === opt.value ? 'text-indigo-400 bg-indigo-500/10' : 'text-white hover:bg-white/[0.05]'
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
