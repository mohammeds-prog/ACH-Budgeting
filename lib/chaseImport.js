// ─────────────────────────────────────────────────────────────────────────────
// Chase statement import rules — shared by the ACH tracker and the ACH Archive,
// so the two can never disagree about what counts as an insurance payment.
// Encodes the clean-up that used to be done by hand in Excel before importing.
// ─────────────────────────────────────────────────────────────────────────────

// Payers whose deposits are not insurance payments.
// Matched against the DESCRIPTION only: a posting date like 05/30/2026 contains
// the literal "5/3", so matching the whole row would drop real payments.
// "5/3" is anchored on word boundaries for the same reason.
export const CHASE_EXCLUDE_RULES = [
  { label: '5/3 Bankcard', re: /\b5\/3\b/ },
  { label: 'Synchrony',    re: /synchrony/i },
  { label: 'Cherry',       re: /cherry/i },
]

export function excludeNonInsurance(entry) {
  const desc = entry?.description || ''
  const hit = CHASE_EXCLUDE_RULES.find((r) => r.re.test(desc))
  return hit ? `${hit.label} — not an insurance payment` : null
}

// Chase names its exports "Chase8209_Activity_20260901.csv" — the digits after
// "Chase" are the account the statement belongs to, and the export itself has
// no bank-account column.
export function bankAccountFromFileName(fileName) {
  const m = /chase[^0-9]*(\d{4,})/i.exec(fileName || '')
  return m ? { bankAccount: m[1] } : {}
}
