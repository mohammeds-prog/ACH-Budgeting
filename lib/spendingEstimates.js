// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDER spending — not real numbers.
//
// Until real costs are available (bank debits, QuickBooks P&L or payroll
// exports), /production shows what a typical Chicago-suburb dental office
// would spend, scaled to each office's own collections. Every figure built
// from this file is labelled "Estimate" on the page. Replace it with real data
// rather than tuning these numbers.
//
// Percentages are of the month's collections — the usual way dental overhead
// is benchmarked. Rent is a flat monthly amount per office, sized by how busy
// each office is.
// ─────────────────────────────────────────────────────────────────────────────

export const SPEND_CATEGORIES = [
  { key: 'staff',     label: 'Staff payroll',  pct: 0.27, hint: 'Front desk, assistants and hygienists — typically 25–30%' },
  { key: 'doctors',   label: 'Doctor pay',     pct: 0.28, hint: 'Associate doctors are usually paid about 28–30% of what they collect' },
  { key: 'lab',       label: 'Lab',            pct: 0.08, hint: 'Crowns, dentures, aligners — typically 6–10%' },
  { key: 'supplies',  label: 'Supplies',       pct: 0.05, hint: 'Typically 5–6% (the real Supply Budget figure is used when entered)' },
  { key: 'marketing', label: 'Marketing',      pct: 0.03, hint: 'Typically 2–5%' },
  { key: 'other',     label: 'Utilities, software, insurance & other', pct: 0.06, hint: 'Typically 5–8%' },
]

// Monthly lease, suburban Chicago medical office space.
export const MONTHLY_RENT = {
  'Valley View Dental Romeoville': 24000,
  'Valley View Dental Naperville': 14000,
  'Valley View Dental Montgomery': 10000,
  'Dentique Lemont':               9500,
  'Alora Dental Spa':              9000,
  'Dentique Downers Grove':        8500,
}
export const DEFAULT_RENT = 10000
export const RENT_HINT = 'Typical suburban Chicago medical lease for an office this size'
