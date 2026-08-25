// ─────────────────────────────────────────────────────────────────────────────
// Pull EOB date, insurance and location out of an uploaded file's NAME.
//
// Deliberately does not open the PDF. Filenames already carry all three fields
// by team convention, and parsing them means no text extraction, no failure on
// scanned documents, and no patient health information is ever read.
//
// Two regex traps this code is written around — both silently wrong, neither
// throws, and both were caught only by testing:
//
//   1. Alternation is ORDERED, not longest-match. /(\d{2}|\d{4})/ against
//      "2026" returns "20", turning every date into the year 2020. The wider
//      branch has to come first.
//
//   2. "_" is a word character, so \b never fires between "_" and a letter.
//      /\bPRINCIPAL\b/ does NOT match "EOB_05.29.2026_PRINCIPAL". Names are
//      therefore matched against a copy with separators turned into spaces.
// ─────────────────────────────────────────────────────────────────────────────

// Most specific first. "DDINS"/"DDPAR" must beat a bare "DD", and UnitedHealthcare
// sits last so UMR — whose plan name contains it — is never mistaken for it.
const PAYERS = [
  [/\bDD\s?INS\b|\bDDPAR\b|\bDDPTN\b|\bDELTA\b/i,   'Delta Dental'],
  [/\bUMR\b/i,                                      'UMR'],
  [/\bGEHA\b/i,                                     'GEHA'],
  [/\bFREEDOM\b/i,                                  'Freedom Life'],
  [/\bPRINCIPAL\b/i,                                'Principal'],
  [/\bMET\s?LIFE\b/i,                               'MetLife'],
  [/\bCIGNA\b/i,                                    'Cigna'],
  [/\bAETNA\b/i,                                    'Aetna'],
  [/\bGUARDIAN\b/i,                                 'Guardian'],
  [/\bAMERITAS\b/i,                                 'Ameritas'],
  [/\bHUMANA\b/i,                                   'Humana'],
  [/\bANTHEM\b/i,                                   'Anthem'],
  [/\bBCBS\b|BLUE\s?CROSS/i,                        'BCBS'],
  [/\bDENTAQUEST\b/i,                               'DentaQuest'],
  [/\bSUN\s?LIFE\b/i,                               'Sun Life'],
  [/\bLINCOLN\b/i,                                  'Lincoln'],
  [/\bRENAISSANCE\b/i,                              'Renaissance'],
  [/\bUHC\b|UNITED\s?HEALTH\w*/i,                   'UnitedHealthcare'],
]

// Site codes the team uses in filenames.
// DG = Downers Grove, DL = Lemont — both are Dentique, matching how the
// collections import already combines those two into one location.
const SITE_CODES = [
  [/\bVVD\s?R\b|\bROMEOVILLE\b/i,   'Valley View Dental Romeoville'],
  [/\bVVD\s?N\b|\bNAPERVILLE\b/i,   'Valley View Dental Naperville'],
  [/\bVVD\s?M\b|\bMONTGOMERY\b/i,   'Valley View Dental Montgomery'],
  [/\bD\s?G\b|\bD\s?L\b|\bDENTIQUE\b|DOWNERS|LEMONT/i, 'Dentique'],
  [/\bALORA\b/i,                    'Alora'],
]

// 05.29.2026 · 07-31-2026 · 07/30/2026 · 05.29.26
// The \d{4} branch precedes \d{2}; (?!\d) stops a 4-digit year being clipped.
const DATE_RE = /(\d{1,2})[._\-/](\d{1,2})[._\-/](\d{4}|\d{2})(?!\d)/

function toISO(mm, dd, yy) {
  let y = yy.length === 2 ? '20' + yy : yy
  const mo = Number(mm), d = Number(dd), yr = Number(y)
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || yr < 2000 || yr > 2099) return null
  // Reject dates that don't exist, e.g. 02.31.2026
  const probe = new Date(Date.UTC(yr, mo - 1, d))
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * @param {string} filename e.g. "10. EOB_05.26.2026_GEHA_VVDR.pdf"
 * @returns {{date: string|null, insuranceName: string|null, location: string|null, warnings: string[]}}
 */
export function parseEobFilename(filename) {
  const warnings = []
  const base = String(filename || '').replace(/\.[a-z0-9]+$/i, '')

  // Drop a leading list number ("19. ", "8) ") so it can't be read as part of a date.
  const cleaned = base.replace(/^\s*\d{1,3}\s*[.)]\s*/, '')

  // Separator-normalised copy for name matching — see trap 2 above.
  const words = cleaned.replace(/[_.\-()]+/g, ' ')

  let date = null
  const m = DATE_RE.exec(cleaned)
  if (m) date = toISO(m[1], m[2], m[3])
  if (!date) warnings.push('No date in filename')

  const insuranceName = PAYERS.find(([re]) => re.test(words))?.[1] ?? null
  if (!insuranceName) warnings.push('No insurance in filename')

  const location = SITE_CODES.find(([re]) => re.test(words))?.[1] ?? null
  if (!location) warnings.push('No location in filename')

  return { date, insuranceName, location, warnings }
}
