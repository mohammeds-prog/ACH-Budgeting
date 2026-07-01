'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import { supabase } from '@/lib/supabase'
import { useProfile } from '@/lib/profileContext'
import { logActivity } from '@/lib/activityLog'
import { ROLES, getRoleInfo } from '@/lib/permissions'

function RoleSelect({ value, onChange, disabled = false, filterAdmin = false }) {
  const [open, setOpen] = useState(false)
  const [dropPos, setDropPos] = useState(null)
  const wrapRef = useRef(null)
  const btnRef = useRef(null)
  const options = filterAdmin ? ROLES.filter((r) => r.value !== 'admin') : ROLES
  const current = getRoleInfo(value)

  useEffect(() => {
    if (!open) return
    function handleClick(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function handleToggle() {
    if (disabled) return
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setDropPos({ top: r.bottom + 4, left: r.left, minWidth: r.width })
    }
    setOpen((v) => !v)
  }

  return (
    <div ref={wrapRef} className="inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all
          ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:border-white/20'}
          bg-slate-800/80 border-white/[0.1] text-slate-200`}
      >
        <span className={current.color}>{current.label}</span>
        {!disabled && (
          <svg className={`w-3 h-3 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7"/>
          </svg>
        )}
      </button>
      {open && dropPos && (
        <div style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, minWidth: dropPos.minWidth, zIndex: 9999 }}
          className="bg-slate-900 border border-white/[0.1] rounded-xl shadow-2xl shadow-black/50 py-1">
          {options.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => { onChange(r.value); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors
                ${value === r.value ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}
                ${r.color}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const darkCard = 'bg-white/[0.04] border border-white/[0.08] rounded-2xl'

const ROLE_CAPS = {
  admin: [
    { label: 'Full Access',         color: 'bg-red-500/10 border-red-500/20 text-red-300' },
    { label: 'Admin Panel',         color: 'bg-red-500/10 border-red-500/20 text-red-300' },
    { label: 'Add · Edit · Delete', color: 'bg-red-500/10 border-red-500/20 text-red-300' },
    { label: 'Import',              color: 'bg-red-500/10 border-red-500/20 text-red-300' },
    { label: 'Transfer Complete',   color: 'bg-red-500/10 border-red-500/20 text-red-300' },
  ],
  management: [
    { label: 'Admin Panel',                 color: 'bg-amber-500/10 border-amber-500/20 text-amber-300' },
    { label: 'ACH + Budget always on',      color: 'bg-amber-500/10 border-amber-500/20 text-amber-300' },
    { label: 'Edit: Notes · Initials',      color: 'bg-amber-500/10 border-amber-500/20 text-amber-300' },
    { label: 'Edit: Status · Match',        color: 'bg-amber-500/10 border-amber-500/20 text-amber-300' },
    { label: 'Edit: Received By · Belongs', color: 'bg-amber-500/10 border-amber-500/20 text-amber-300' },
    { label: 'No Add · Delete · Import',    color: 'bg-slate-500/10 border-slate-500/20 text-slate-400' },
    { label: 'No Transfer Complete',        color: 'bg-slate-500/10 border-slate-500/20 text-slate-400' },
  ],
  user: [
    { label: 'Edit: Notes · Initials',   color: 'bg-violet-500/10 border-violet-500/20 text-violet-300' },
    { label: 'Edit: Status · Match',     color: 'bg-violet-500/10 border-violet-500/20 text-violet-300' },
    { label: 'Edit: Belongs To',         color: 'bg-violet-500/10 border-violet-500/20 text-violet-300' },
    { label: 'No Add · Delete · Import', color: 'bg-slate-500/10 border-slate-500/20 text-slate-400' },
    { label: 'No Transfer Complete',     color: 'bg-slate-500/10 border-slate-500/20 text-slate-400' },
  ],
  viewer: [
    { label: 'Read-only',              color: 'bg-slate-500/10 border-slate-500/20 text-slate-400' },
    { label: 'No Edits',               color: 'bg-slate-500/10 border-slate-500/20 text-slate-400' },
    { label: 'Access via module toggle', color: 'bg-slate-500/10 border-slate-500/20 text-slate-400' },
  ],
}

function Toggle({ checked, onChange, color = 'violet', disabled = false }) {
  const on = color === 'indigo' ? 'bg-indigo-500' : 'bg-violet-500'
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none ${checked ? on : 'bg-white/[0.1]'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-4' : 'translate-x-1'}`} />
    </button>
  )
}

function SetPasswordModal({ user, onClose }) {
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    setSaving(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ userId: user.id, password }),
      })
      const json = await res.json()
      if (res.status === 401) { await supabase.auth.signOut(); window.location.href = '/login'; return }
      if (!res.ok) { setError(json.error); return }
      logActivity({ action: 'update', module: 'Admin', description: `Set password for ${user.full_name || user.email}`, metadata: { userId: user.id } })
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 text-sm bg-slate-800 border border-white/[0.1] rounded-xl text-white placeholder:text-white/25 outline-none focus:border-violet-400/70 focus:ring-1 focus:ring-violet-400/20 transition-all'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-slate-900 border border-white/[0.1] rounded-2xl shadow-2xl w-full max-w-sm z-10">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.07]">
          <div>
            <h2 className="text-base font-semibold text-white">Set Password</h2>
            <p className="text-xs text-slate-500 mt-0.5">{user.full_name || user.email}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="p-6">
          {done ? (
            <div className="text-center py-4">
              <div className="w-10 h-10 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
              </div>
              <p className="text-sm font-semibold text-emerald-300">Password updated</p>
              <button onClick={onClose} className="mt-4 px-4 py-1.5 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition-all">Done</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">New Password</label>
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 6 characters"
                  className={inputCls}
                  autoFocus
                />
              </div>
              {error && <p className="text-xs text-red-400 bg-red-500/[0.08] border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white border border-white/[0.08] hover:border-white/20 rounded-xl transition-all">Cancel</button>
                <button type="submit" disabled={saving || !password} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition-all disabled:opacity-50">
                  {saving ? <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</> : 'Set Password'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

function AddUserModal({ onClose, onCreated, isManagement = false }) {
  const [form, setForm] = useState({ email: '', full_name: '', password: '', role: 'viewer' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [showPw, setShowPw] = useState(false)

  function set(key, val) { setForm((f) => ({ ...f, [key]: val })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.email || !form.password) { setError('Email and password are required'); return }
    setSaving(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ email: form.email, full_name: form.full_name, password: form.password, role: form.role }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error); return }
      logActivity({ action: 'create', module: 'Admin', description: `Created user ${form.full_name || form.email} (${form.role})`, metadata: { email: form.email, role: form.role } })
      onCreated()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 text-sm bg-slate-800 border border-white/[0.1] rounded-xl text-white placeholder:text-white/25 outline-none focus:border-violet-400/70 focus:ring-1 focus:ring-violet-400/20 transition-all'
  const labelCls = 'block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-slate-900 border border-white/[0.1] rounded-2xl shadow-2xl w-full max-w-md z-10">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.07]">
          <h2 className="text-base font-semibold text-white">Add User</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Full Name</label>
              <input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} placeholder="" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Role</label>
              <RoleSelect
                value={form.role}
                onChange={(role) => set('role', role)}
                filterAdmin={isManagement}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Email <span className="text-red-400">*</span></label>
            <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="example@example.com" className={inputCls} required />
          </div>

          <div>
            <label className={labelCls}>Password <span className="text-red-400">*</span></label>
            <div className="relative">
              <input type={showPw ? 'text' : 'password'} value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="Min. 6 characters" className={inputCls + ' pr-10'} required />
              <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                {showPw ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"/></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>
                )}
              </button>
            </div>
          </div>

          <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-3">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-1.5">Role permissions</p>
            {(() => {
              const perms = {
                admin:      'Full access · Admin panel · All modules',
                management: 'ACH + Budget full edit · Import · No admin panel',
                user:       'ACH match/from/to edits + delete · Budget view only',
                viewer:     'Read-only access to ACH and Budget',
              }
              const { color } = getRoleInfo(form.role)
              return <p className={`text-xs ${color}`}>{perms[form.role]}</p>
            })()}
          </div>

          {error && <p className="text-xs text-red-400 bg-red-500/[0.08] border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}

          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white border border-white/[0.08] hover:border-white/20 rounded-xl transition-all">Cancel</button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition-all disabled:opacity-50">
              {saving ? <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Creating…</> : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function AdminPage() {
  const router  = useRouter()
  const profile = useProfile()
  const isAdmin      = profile?.role === 'admin'
  const isManagement = profile?.role === 'management'
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [addModal, setAddModal] = useState(false)
  const [setPwUser, setSetPwUser] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: true })
    setProfiles(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function updateProfile(id, updates) {
    const target = profiles.find((p) => p.id === id)
    const name = target?.full_name || target?.email || id
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ userId: id, ...updates }),
      })
      const json = await res.json()
      if (res.status === 401) { await supabase.auth.signOut(); router.replace('/login'); return }
      if (!res.ok) { console.error('updateProfile failed:', res.status, json); return }
    } catch (err) { console.error('updateProfile error:', err); return }
    setProfiles((prev) => prev.map((p) => p.id === id ? { ...p, ...updates } : p))
    if ('role' in updates) logActivity({ action: 'update', module: 'Admin', description: `Changed ${name}'s role to ${updates.role}`, metadata: { userId: id, role: updates.role } })
    if ('can_view_ach' in updates) logActivity({ action: 'update', module: 'Admin', description: `${updates.can_view_ach ? 'Enabled' : 'Disabled'} ACH access for ${name}`, metadata: { userId: id, can_view_ach: updates.can_view_ach } })
    if ('can_view_budgeting' in updates) logActivity({ action: 'update', module: 'Admin', description: `${updates.can_view_budgeting ? 'Enabled' : 'Disabled'} Budget access for ${name}`, metadata: { userId: id, can_view_budgeting: updates.can_view_budgeting } })
  }

  async function handleDelete(userId) {
    setDeleting(true)
    try {
      const target = profiles.find((p) => p.id === userId)
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ userId }),
      })
      if (res.status === 401) { await supabase.auth.signOut(); window.location.href = '/login'; return }
      if (res.ok) {
        setProfiles((prev) => prev.filter((p) => p.id !== userId))
        setConfirmDeleteId(null)
        logActivity({ action: 'delete', module: 'Admin', description: `Deleted user ${target?.full_name || target?.email || userId}`, metadata: { userId, email: target?.email } })
      }
    } finally {
      setDeleting(false)
    }
  }


  return (
    <div className="min-h-screen bg-slate-900 relative">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-800/40 via-slate-900 to-slate-900 pointer-events-none" />

      <div className="relative z-10">
        <AppHeader />

        {/* Hero */}
        <div className="border-b border-white/[0.06] bg-gradient-to-br from-slate-800/40 via-slate-900/80 to-slate-900">
          <div className="max-w-screen-lg mx-auto px-6 py-8 flex items-end justify-between gap-4 flex-wrap">
            <div>
              <p className="text-slate-400/80 text-xs font-semibold uppercase tracking-widest mb-1">Admin</p>
              <h1 className="text-3xl font-bold text-white tracking-tight">User Management</h1>
              <p className="text-slate-400 text-sm mt-1.5">Manage accounts and module access for your team</p>
            </div>
            <button onClick={() => setAddModal(true)} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition-all shadow-lg shadow-violet-900/30 active:scale-[0.98]">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
              Add User
            </button>
          </div>
        </div>

        <div className="max-w-screen-lg mx-auto px-6 py-6">
          <div className={`${darkCard} overflow-hidden`}>
            {loading ? (
              <div className="flex items-center justify-center py-16 gap-3">
                <div className="w-6 h-6 border-2 border-violet-500/30 border-t-violet-400 rounded-full animate-spin" />
                <span className="text-sm text-slate-400">Loading…</span>
              </div>
            ) : profiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-sm text-slate-400">No users yet</p>
                <p className="text-xs text-slate-600 mt-1">Click "Add User" to create the first account</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      {['User', 'Role', 'Permissions', 'Module Access', ''].map((h) => (
                        <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500 bg-white/[0.02]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {profiles.map((p) => {
                      const isSelf = p.id === profile?.id
                      return (
                        <tr key={p.id} className="group border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center text-xs font-bold text-white shrink-0">
                                {(p.full_name || p.email).charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-semibold text-slate-200 text-sm">{p.full_name || <span className="text-slate-500 italic">No name</span>}</p>
                                <p className="text-xs text-slate-500">{p.email}</p>
                              </div>
                              {isSelf && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.07] text-slate-500 font-medium">You</span>}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <RoleSelect
                              value={p.role || 'viewer'}
                              onChange={(role) => updateProfile(p.id, { role })}
                              disabled={isSelf || (isManagement && p.role === 'admin')}
                              filterAdmin={isManagement}
                            />
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap gap-1 max-w-[260px]">
                              {ROLE_CAPS[p.role || 'viewer'].map(({ label, color }) => (
                                <span key={label} className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border ${color}`}>{label}</span>
                              ))}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-col gap-2">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <Toggle
                                  checked={p.role === 'admin' || p.role === 'management' || !!p.can_view_ach}
                                  onChange={(v) => updateProfile(p.id, { can_view_ach: v })}
                                  color="indigo"
                                  disabled={(!isAdmin && !isManagement) || p.role === 'admin' || p.role === 'management'}
                                />
                                <span className={`text-xs ${p.role === 'admin' || p.role === 'management' || p.can_view_ach ? 'text-indigo-300' : 'text-slate-500'}`}>ACH</span>
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer">
                                <Toggle
                                  checked={p.role === 'admin' || p.role === 'management' || !!p.can_view_budgeting}
                                  onChange={(v) => updateProfile(p.id, { can_view_budgeting: v })}
                                  color="violet"
                                  disabled={(!isAdmin && !isManagement) || p.role === 'admin' || p.role === 'management'}
                                />
                                <span className={`text-xs ${p.role === 'admin' || p.role === 'management' || p.can_view_budgeting ? 'text-violet-300' : 'text-slate-500'}`}>Supply Budget</span>
                              </label>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {!(isManagement && p.role === 'admin') && (
                                <button
                                  onClick={() => setSetPwUser(p)}
                                  className="px-2.5 py-1 text-xs text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg transition-all whitespace-nowrap"
                                >
                                  Set Password
                                </button>
                              )}
                              {!isSelf && !(isManagement && p.role === 'admin') && (
                                <button
                                  onClick={() => setConfirmDeleteId(p.id)}
                                  className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-600 hover:text-red-400 transition-colors"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {addModal && <AddUserModal onClose={() => setAddModal(false)} onCreated={load} isManagement={isManagement} />}
      {setPwUser && <SetPasswordModal user={setPwUser} onClose={() => setSetPwUser(null)} />}

      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDeleteId(null)} />
          <div className="relative bg-slate-900 border border-white/[0.1] rounded-2xl shadow-2xl p-6 w-80 z-10">
            <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/20 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>
            </div>
            <h3 className="font-semibold text-white mb-1">Delete this user?</h3>
            <p className="text-sm text-slate-400 mb-5">Their account and profile will be permanently removed.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDeleteId(null)} className="px-3 py-1.5 text-sm font-medium text-slate-400 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] rounded-lg transition-all">Cancel</button>
              <button onClick={() => handleDelete(confirmDeleteId)} disabled={deleting} className="px-3 py-1.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-all disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
