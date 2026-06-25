// US state abbreviations — used to detect and preserve state suffixes
const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
])

// Maps ORIG CO NAME values (and free-text fragments) to clean insurance names.
// stateAware: true → append trailing state abbreviation if found (e.g. "Delta Dental IL")
// Order matters — more specific entries first.
const INSURER_MAP = [
  { match: /delta\s*dent/i,                       name: 'Delta Dental',           stateAware: true },
  { match: /united\s*conc/i,                       name: 'United Concordia' },
  { match: /cigna/i,                               name: 'Cigna' },
  { match: /aetna/i,                               name: 'Aetna' },
  { match: /anthem/i,                              name: 'Anthem',                 stateAware: true },
  { match: /bcbs|blue\s*cross|bluecross/i,         name: 'Blue Cross Blue Shield', stateAware: true },
  { match: /humana/i,                              name: 'Humana' },
  { match: /guardian/i,                            name: 'Guardian' },
  { match: /metlife/i,                             name: 'MetLife' },
  { match: /principal/i,                           name: 'Principal' },
  { match: /lincoln/i,                             name: 'Lincoln Financial' },
  { match: /sun\s*life/i,                          name: 'Sun Life' },
  { match: /ameritas/i,                            name: 'Ameritas' },
  { match: /assurant/i,                            name: 'Assurant' },
  { match: /united\s*hlth|unitedhealthcare|uhc/i,  name: 'UnitedHealthcare' },
  { match: /carefirst/i,                           name: 'CareFirst BCBS' },
  { match: /molina/i,                              name: 'Molina Healthcare' },
  { match: /tricare/i,                             name: 'TRICARE' },
  { match: /medicaid/i,                            name: 'Medicaid' },
  { match: /medicare/i,                            name: 'Medicare' },
  { match: /beam/i,                                name: 'Beam Dental' },
  { match: /spirit\s*dent/i,                       name: 'Spirit Dental' },
  { match: /magellan/i,                            name: 'Magellan Health' },
  { match: /unum/i,                                name: 'Unum' },
  { match: /aflac/i,                               name: 'Aflac' },
  { match: /mutual\s*of\s*omaha/i,                 name: 'Mutual of Omaha' },
]

// Extracts a trailing 2-letter US state abbreviation from a raw ORIG CO NAME string.
// e.g. "DELTA DENTAL IL" → "IL", "DELTA DENTAL OF MI" → "MI", "AETNA AS01" → null
function extractStateCode(raw) {
  const words = raw.trim().toUpperCase().split(/\s+/)
  const last = words[words.length - 1]
  if (US_STATES.has(last)) return last
  // Handle "OF XX" pattern: "DELTA DENTAL OF IL"
  if (words.length >= 2 && words[words.length - 2] === 'OF' && US_STATES.has(last)) return last
  return null
}

function matchInsurer(text) {
  if (!text) return null
  for (const { match, name, stateAware } of INSURER_MAP) {
    if (match.test(text)) {
      if (stateAware) {
        const state = extractStateCode(text)
        return state ? `${name} ${state}` : name
      }
      return name
    }
  }
  return null
}

/**
 * Extracts a clean insurance name from an ACH description string.
 * Returns empty string if nothing can be determined.
 */
export function extractInsuranceName(description) {
  if (!description || !description.trim()) return ''

  // 1. Pull ORIG CO NAME field (most reliable)
  const origCoMatch = description.match(
    /ORIG\s+CO\s+NAME[:\s]+([A-Z0-9&.'"\-\s]+?)(?:\s{2,}|\s+ORIG\s+ID|\s+DESC\s+DATE|\s+CO\s+ENTRY|$)/i
  )
  if (origCoMatch) {
    const raw = origCoMatch[1].trim()
    const known = matchInsurer(raw)
    if (known) return known
    // No known match — return the cleaned raw value
    const cleaned = raw
      .replace(/\b(AS\d+|INC|LLC|CORP|HLTH|HEALTHCARE|GRP|GROUP|SVCS|SERV)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
    if (cleaned) return cleaned
  }

  // 2. Fall back to scanning the full string
  const known = matchInsurer(description)
  if (known) return known

  return ''
}
