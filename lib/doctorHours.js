// ─────────────────────────────────────────────────────────────────────────────
// Doctor hours — the "Doctor Hours" Google Sheet, read into monthly totals,
// and matched to the doctors in the Dentrix production report.
// Pure functions (no server imports): used by the API route, the Doctors view
// and the chat.
//
// The sheet: one tab per year ("2025", "2026"). Each month is a block:
//   a title row ("JANUARY"), an office row (ROMEOVILLE … NAPERVILLE … — each
//   office spans the columns to its right), a doctor row ("Dr. Singh", …),
//   then one row per day ("Jan 05", "January 5", "Agust 09") with hours in
//   the doctor's column. Columns are read from each block's own header,
//   because doctors move between columns from month to month.
//   Under a block there may be one-off notes for doctors without a column:
//   "05/08/2026 - Dr Serraj - VVD2 - 6 hrs" (VVD1 Romeoville, VVD2
//   Naperville, VVD3 Montgomery). Those are read too when they name a
//   doctor, an office and hours.
// Each day's month comes from the date on the row, not the block title (one
// block is titled "October" but holds November).
// ─────────────────────────────────────────────────────────────────────────────

export const DENTIQUE = 'Dentique'   // the sheet has one Dentique column for Lemont and Downers Grove
const OFFICE_WORD = {
  romeoville: 'Valley View Dental Romeoville', naperville: 'Valley View Dental Naperville',
  montgomery: 'Valley View Dental Montgomery', dentique: DENTIQUE, alora: 'Alora Dental Spa',
}
const VVD = { 1: OFFICE_WORD.romeoville, 2: OFFICE_WORD.naperville, 3: OFFICE_WORD.montgomery }
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n) => String(n).padStart(2, '0')

function monthNum(word) {
  const w = String(word || '').toLowerCase()
  if (w.startsWith('ag')) return 8 // "Agust"
  const i = MONTHS.indexOf(w.slice(0, 3))
  return i < 0 ? null : i + 1
}

// "Jan 05", "January 5", "Agust 09", "June 1st", "1-Dec" → { m, d }; else null.
function dayOf(cell) {
  const s = String(cell || '').trim()
  let m = s.match(/^([A-Za-z]+)\.?\s*(\d{1,2})(?:st|nd|rd|th)?$/)
  if (m && monthNum(m[1]) && +m[2] >= 1 && +m[2] <= 31) return { m: monthNum(m[1]), d: +m[2] }
  m = s.match(/^(\d{1,2})-([A-Za-z]{3,})$/)
  if (m && monthNum(m[2])) return { m: monthNum(m[2]), d: +m[1] }
  return null
}

const officeOf = (cell) => OFFICE_WORD[String(cell || '').trim().toLowerCase()] || null
export const cleanDoctor = (s) => String(s || '').replace(/\(.*?\)/g, ' ').replace(/^\s*dr\.?\s*/i, '').replace(/\s+/g, ' ').trim()
const isTemp = (s) => /\btemp\b/i.test(s)

/**
 * tabs: [{ title, values }] — values as rows of cells. Only tabs titled with a
 * year are read. Returns
 *   { months: { 'YYYY-MM': [{ doctor, office, hours, days, fromNotes }] },
 *     skippedNotes: [text] }   — notes that named hours but no doctor/office
 */
export function parseDoctorHours(tabs) {
  const acc = {}            // ym → key → { doctor, office, hours, dates:Set, fromNotes }
  const skippedNotes = []
  const add = (ym, doctor, office, hours, date, fromNote) => {
    const k = `${doctor}|${office}`
    const o = ((acc[ym] ||= {})[k] ||= { doctor, office, hours: 0, dates: new Set(), fromNotes: 0 })
    o.hours += hours
    o.dates.add(date)
    if (fromNote) o.fromNotes += hours
  }

  for (const tab of tabs) {
    const year = +(String(tab.title).match(/^\s*(20\d\d)\s*$/)?.[1] || 0)
    if (!year) continue
    let colOffice = [], colDoctor = [], expectDoctors = false, lastMonth = null
    for (const row of tab.values || []) {
      const cells = (row || []).map((c) => String(c ?? '').trim())
      if (!cells.some(Boolean)) continue

      // An office row: two or more office names.
      if (cells.filter((c) => officeOf(c)).length >= 2) {
        colOffice = []; let cur = null
        cells.forEach((c, i) => { cur = officeOf(c) || cur; colOffice[i] = i === 0 ? null : cur })
        expectDoctors = true
        continue
      }
      if (expectDoctors) { colDoctor = cells.map((c, i) => (i === 0 ? '' : c)); expectDoctors = false; continue }

      // A day row.
      const day = dayOf(cells[0])
      if (day && colDoctor.length) {
        lastMonth = day.m
        const ym = `${year}-${pad(day.m)}`
        for (let c = 1; c < cells.length; c++) {
          const doctor = colDoctor[c], office = colOffice[c]
          if (!doctor || !office || isTemp(doctor)) continue
          const h = parseFloat((cells[c].match(/^\d+(?:\.\d+)?/) || [])[0])
          if (!(h > 0 && h <= 16)) continue
          add(ym, doctor, office, h, `${ym}-${pad(day.d)}`, false)
        }
        continue
      }

      // A note: "… Dr X … VVD2 … 7 hrs".
      const text = cells.join(' ')
      const hm = text.match(/(\d+(?:\.\d+)?)\s*hrs?\b/i)
      if (!hm || !/\bdr\b/i.test(text)) continue
      const words = (text.match(/\bdr\.?\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)/i)?.[1] || '').split(/\s+/)
      while (words.length && /^(on|hrs?|vvd\d*)$/i.test(words[words.length - 1])) words.pop()
      const doctor = words.join(' ')
      const vvd = text.match(/\bVV[DV]\s*:?\s*([123])\b/i)
      const office = vvd ? VVD[vvd[1]] : officeOf((text.match(/\b(romeoville|naperville|montgomery|dentique|alora)\b/i) || [])[1])
      // The date: the first cell's mm/dd/yyyy, else one in the text, else a
      // month word at the start ("JUNE 7", "SEPT - 13"), else the block's month.
      let y = year, m = null, d = 1
      const dated = (cells[0].match(/^(\d{1,2})\/(\d{1,2})\/(20\d\d)$/) || text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d\d)\b/))
      if (dated) { m = +dated[1]; d = +dated[2]; y = +dated[3] } else {
        const lead = text.match(/^\s*([A-Za-z]+)\s*-?\s*(\d{1,2})(?:st|nd|rd|th)?\b/)
        if (lead && monthNum(lead[1]) && !/^vv/i.test(lead[1])) { m = monthNum(lead[1]); d = +lead[2] } else m = lastMonth
      }
      if (!doctor || !office || !m || isTemp(doctor)) { skippedNotes.push(text.trim()); continue }
      const h = parseFloat(hm[1])
      if (!(h > 0 && h <= 16)) continue
      const ym = `${y}-${pad(m)}`
      add(ym, doctor, office, h, `${ym}-${pad(d)}`, true)
    }
  }

  const months = {}
  for (const [ym, byKey] of Object.entries(acc)) {
    months[ym] = Object.values(byKey).map((o) => ({ doctor: o.doctor, office: o.office, hours: Math.round(o.hours * 100) / 100, days: o.dates.size, dates: [...o.dates].sort(), fromNotes: o.fromNotes }))
      .sort((a, b) => b.hours - a.hours)
  }
  return { months, skippedNotes }
}

// ── Matching to Dentrix ──────────────────────────────────────────────────────

const TEMP = /^(temp\b|hygienist,|rdh |m rdh)|\btemp$|rdh, temp|temp, rdh|temp vvd/i
const OFFICE_ENTITY = /^(valley view dental|dentique|alora|edc of)|^dental spa,/i
/** A Dentrix provider who is a doctor (not a hygienist, temp or the office). */
export const isDoctor = (name, specialty = {}) => !!name && specialty[name] !== 'Hygienist' && !TEMP.test(name) && !OFFICE_ENTITY.test(name) && !/\brdh\b|hygienist/i.test(name)
/** The sheet's office for a Dentrix office (both Dentiques are one column). */
export const sheetOffice = (loc) => (/^dentique/i.test(loc || '') ? DENTIQUE : loc)

const tokens = (s) => String(s || '').toLowerCase().split(/[^a-z]+/).filter(Boolean)

// How well a sheet name ("Krupa Patel", "Harman", "C Parikh") fits a Dentrix
// name ("Patel, Krupa", "Kaur, Harmanmeet", "Parikh, Chirag"): every word must
// fit; full words count 1, an initial ½. 0 = no fit.
function fit(sheetName, dentrix) {
  const want = tokens(cleanDoctor(sheetName)), have = tokens(dentrix)
  const first = tokens(String(dentrix).split(',')[1] || '')[0] || ''
  if (!want.length) return 0
  let score = 0
  for (const w of want) {
    if (have.includes(w)) score += 1
    else if (w.length >= 4 && have.some((h) => h.startsWith(w))) score += 1
    else if (w.length === 1 && first.startsWith(w)) score += 0.5
    else return 0
  }
  return score
}

// ── Names settled by the owner (Nov 2026) ───────────────────────────────────
// Checked before the guess below, so a new doctor with the same surname
// can't change them. Key: the sheet name (without "Dr.", any case) and the
// sheet's office. Value: the Dentrix doctor, IGNORE (not a Dentrix doctor:
// their hours are left out), or [{ to: 'YYYY-MM', name }, …, { name }] when
// the same column meant different doctors over time. Names not listed here
// fall back to the guess by name and office.
export const IGNORE = '__ignore__'
const ROM = 'Valley View Dental Romeoville', NAP = 'Valley View Dental Naperville', MON = 'Valley View Dental Montgomery'
const FIXED = {
  // "Dr. Parikh" at Romeoville was Krupa S Parikh until mid-2025; Chirag Parikh after.
  [`parikh|${ROM}`]: [{ to: '2025-08', name: 'Parikh, Krupa S' }, { name: 'Parikh, Chirag' }],
  // "VVD2 - DR PATEL - 7 HRS", December 2025: Tarik Patel. Later plain "Patel"s aren't fixed.
  [`patel|${NAP}`]: [{ to: '2025-12', from: '2025-12', name: 'Patel, Tarik P' }],
  // Visiting doctors in the notes with no Dentrix production: left out.
  [`brandt|${MON}`]: IGNORE,
  [`desai|${ROM}`]: IGNORE,
}
const keyOf = (sheetName, office) => `${cleanDoctor(sheetName).toLowerCase()}|${office}`

/** The settled Dentrix name for a sheet name in a month, IGNORE, or null. */
export function fixedDoctor(sheetName, office, period) {
  const v = FIXED[keyOf(sheetName, office)]
  if (!v || typeof v === 'string') return v || null
  const hit = v.find((x) => (!x.from || period >= x.from) && (!x.to || period <= x.to))
  return hit?.name || null
}

/** The one Dentrix doctor a sheet name means, preferring `local` (doctors with
 *  production at that office that month); null when none or ambiguous. */
export function matchDoctor(sheetName, local, all) {
  for (const pool of [local, all]) {
    const scored = pool.map((n) => [n, fit(sheetName, n)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1])
    if (scored.length === 1 || (scored.length > 1 && scored[0][1] > scored[1][1])) return scored[0][0]
    if (scored.length > 1) return null // ambiguous here; a wider pool won't help
  }
  return null
}

/**
 * One month's doctors: production from Dentrix, hours from the sheet.
 *   prodRows: production report rows ({ period, location, provider, gross, net })
 *   hoursMonth: parseDoctorHours(...).months[period] (or [])
 * Whatever office the work or the hours were at: per hour = all of the
 * doctor's production ÷ all of their hours; per day = ÷ the dates they worked
 * (a date counts once even if they worked two offices that day). The office
 * only helps tell apart doctors with the same name.
 */
export function doctorMonth(period, prodRows, specialty, hoursMonth = []) {
  const rows = prodRows.filter((r) => r.period === period && isDoctor(r.provider, specialty))
  const allDoctors = [...new Set(prodRows.filter((r) => isDoctor(r.provider, specialty)).map((r) => r.provider))]
  const docs = {}
  const doc = (name) => (docs[name] ||= { name, gross: 0, net: 0, hours: 0, dates: new Set(), offices: {}, sheetNames: new Set() })
  const off = (d, o) => (d.offices[o] ||= { gross: 0, net: 0, hours: 0, days: 0 })
  for (const r of rows) {
    const d = doc(r.provider), o = off(d, sheetOffice(r.location))
    d.gross += r.gross; d.net += r.net; o.gross += r.gross; o.net += r.net
  }
  const unmatched = []
  for (const h of hoursMonth) {
    const local = [...new Set(rows.filter((r) => sheetOffice(r.location) === h.office && Math.abs(r.gross) >= 1).map((r) => r.provider))]
    const fixed = fixedDoctor(h.doctor, h.office, period)
    if (fixed === IGNORE) continue
    const name = fixed || matchDoctor(h.doctor, local, allDoctors)
    if (!name) { unmatched.push(h); continue }
    const d = doc(name), o = off(d, h.office)
    d.hours += h.hours; o.hours += h.hours; o.days += h.days
    for (const dt of h.dates || []) d.dates.add(dt)
    d.sheetNames.add(h.doctor)
  }
  const list = Object.values(docs).map((d) => {
    const days = d.dates.size
    return {
      name: d.name, gross: d.gross, net: d.net, hours: d.hours, days,
      sheetNames: [...d.sheetNames],
      offices: Object.fromEntries(Object.entries(d.offices).filter(([, o]) => Math.abs(o.gross) >= 1 || o.hours > 0)),
      perHour: d.hours >= 1 ? d.gross / d.hours : null,
      netPerHour: d.hours >= 1 ? d.net / d.hours : null,
      perDay: days >= 1 ? d.gross / days : null,
      grossNoHours: d.hours >= 1 ? 0 : d.gross,   // a doctor with no hours in the sheet this month
    }
  }).filter((d) => Math.abs(d.gross) >= 1 || d.hours > 0).sort((a, b) => b.gross - a.gross)
  return { list, unmatched }
}
