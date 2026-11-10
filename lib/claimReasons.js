// Shared by the money tree (browser) and the owner summary (server).

// Denial reasons the billing team can fix (the rest are the plans' rules).
export const OFFICE_CAN_FIX = new Set([
  'Missing Documentation', 'Missing Primary EOB', 'Missing/Incorrect Subscriber Info', 'Missing Provider Questionnaire',
  'Requires Medical EOB/Info', 'COB Issue', 'Timely Filing', 'Duplicate Claim', 'Unprocessable / Rejected Claim',
  'Missing Authorization', 'Provider Not Credentialed/Listed',
])

// An insurer name with punctuation, "(FEP)"-style notes and "Insurance
// Company" dropped, so the aging report and the follow-up sheet match.
export const carrierKey = (name) => String(name || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/&/g, ' and ')
  .replace(/\b(insurance|company|co|inc|the)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()

// The follow-up record for an aging insurer name, if any.
export function matchCarrier(name, carriers) {
  const cs = carriers || {}
  if (cs[name]) return cs[name]
  const k = carrierKey(name)
  const hit = Object.keys(cs).find((n) => carrierKey(n) === k)
  return hit ? cs[hit] : null
}
