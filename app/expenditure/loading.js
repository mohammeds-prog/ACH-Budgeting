export default function Loading() {
  return (
    <div className="min-h-screen bg-slate-900 relative flex items-center justify-center">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-violet-950/50 via-slate-900 to-slate-900 pointer-events-none" />
      <div className="fixed inset-0 opacity-[0.025] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #a78bfa 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
      <div className="relative flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-[3px] border-violet-500/20 border-t-violet-400 animate-spin" />
        <p className="text-slate-400 text-sm font-medium tracking-wide">Loading Expenditure…</p>
      </div>
    </div>
  )
}
