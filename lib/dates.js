// ─────────────────────────────────────────────────────────────────────────────
// Month and year of a STORED date ("2026-09-01"), read from the string itself.
//
// Never `new Date("2026-09-01").getMonth()`. A date-only string parses as
// midnight UTC, and getMonth() then reads it in the viewer's local time — in
// the US that's the evening of Aug 31, so Sept 1 payments showed up under an
// August filter for the client while looking correct from India (UTC+5:30).
//
// Stored dates are calendar days, not moments in time; they have no timezone
// to convert. Slicing the string gives the same answer on every machine.
//
// For "today" / "this month", local time IS right — use `new Date()` directly.
// ─────────────────────────────────────────────────────────────────────────────

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/

export function isoYear(iso) {
  const m = ISO_DATE.exec(iso || '')
  return m ? Number(m[1]) : null
}

export function isoMonth(iso) {
  const m = ISO_DATE.exec(iso || '')
  return m ? Number(m[2]) : null
}

// "2026-09" — the same shape as a month key built from a local `Date`.
export function isoMonthKey(iso) {
  const m = ISO_DATE.exec(iso || '')
  return m ? `${m[1]}-${m[2]}` : null
}
