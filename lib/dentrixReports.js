import * as XLSX from 'xlsx'

// ─────────────────────────────────────────────────────────────────────────────
// Dentrix Ascend Power Reporting exports → plain rows for the Production page.
//
// Files are read entirely in the browser and never saved anywhere. Two report
// shapes are recognised by their headers:
//
//   production  — Provider, Location, [Year], Month, Procedures, Credit
//                 Adjustments, Charge Adjustments, Grand Total
//                 ("ALL Provider Production Report", "Hygiene vs. Dentist
//                 Production")
//   adjustments — Production or Collection, Category, Subcategory, Amount,
//                 Count ("Adjustment Summary")
//   collections — Location, Insurance Payments, Guarantor Payments, Charge
//                 Adjustments, Collection Total ("Previous Month Collection By
//                 Location"). It has no month column; the page asks which month.
//   aging       — Excel workbook, one sheet per location, one row per open
//                 insurance claim ("Aging data"). Only totals are kept — patient
//                 names, birth dates and claim IDs are read past and dropped.
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Whole-file CSV parser: quoted fields may contain commas ("Valley View Dental
// - Naperville, P.C.,") and, in principle, line breaks.
function parseCsv(text) {
  const rows = []
  let row = [], cur = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') inQ = false
      else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { row.push(cur); cur = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cur); rows.push(row); row = []; cur = ''
    } else cur += ch
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim()))
}

function sheetGrid(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
    .map((r) => r.map((c) => String(c ?? '')))
    .filter((r) => r.some((c) => c.trim()))
}

// Every sheet of a workbook, or the one "sheet" of a CSV.
async function readSheets(file) {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    const wb = XLSX.read(await file.arrayBuffer())
    return wb.SheetNames.map((n) => ({ name: n, grid: sheetGrid(wb.Sheets[n]) }))
  }
  return [{ name: file.name, grid: parseCsv(await file.text()) }]
}

// "$1,234.00" → 1234, "-$7.00" / "$ -7.00" / "($7.00)" → -7, "-" or blank → 0.
// Some exports put the sign after the dollar sign, so look for it anywhere.
function money(v) {
  const s = String(v ?? '').trim()
  if (!s || s === '-') return 0
  const neg = s.includes('-') || s.startsWith('(')
  const n = Number(s.replace(/[$,\s()\-]/g, ''))
  return Number.isFinite(n) ? (neg ? -n : n) : 0
}

function monthNum(v) {
  const s = String(v ?? '').trim().toLowerCase()
  if (/^\d{1,2}$/.test(s)) return Number(s) >= 1 && Number(s) <= 12 ? Number(s) : null
  const i = MONTHS.indexOf(s.slice(0, 3))
  return i >= 0 ? i + 1 : null
}

// Reports filtered to "previous Month" have no Year column. The month meant is
// its most recent occurrence that isn't in the future.
function inferYear(month, today = new Date()) {
  const y = today.getFullYear()
  return month > today.getMonth() + 1 ? y - 1 : y
}

export function periodKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function periodLabel(key) {
  const [y, m] = key.split('-')
  return `${MONTH_SHORT[Number(m) - 1]} ${y}`
}

export function currentPeriod(today = new Date()) {
  return periodKey(today.getFullYear(), today.getMonth() + 1)
}

// Header text → canonical key. Pivot exports suffix measures with "~Amount".
function headerKey(h) {
  const s = h.toLowerCase().replace(/~.*$/, '').replace(/\(.*?\)/g, '').trim()
  if (s === 'provider') return 'provider'
  if (s === 'location') return 'location'
  if (s === 'year') return 'year'
  if (s === 'month') return 'month'
  if (s === 'procedures') return 'procedures'
  if (s === 'credit adjustments') return 'credit'
  if (s === 'charge adjustments') return 'charge'
  if (s === 'grand total') return 'total'
  if (s === 'production or collection') return 'side'
  if (s === 'category') return 'category'
  if (s === 'subcategory') return 'subcategory'
  if (s === 'amount') return 'amount'
  if (s === 'count') return 'count'
  return null
}

function isTotalRow(cells) {
  return cells.some((c) => /^grand total$/i.test(c.trim()) || / total$/i.test(c.trim()))
}

/**
 * Read one export. Returns
 *   { kind: 'production', rows: [{ provider, location, period, gross, credit, charge, net }] }
 *   { kind: 'adjustments', rows: [{ side, category, subcategory, amount, count }] }
 * or throws with a message saying what the file looked like instead.
 */
export async function readDentrixFile(file) {
  const sheets = await readSheets(file)

  const aging = readAging(sheets, file.name)
  if (aging) return aging

  const adSpend = readAdSpend(sheets[0].grid)
  if (adSpend) return adSpend

  const schedule = readSchedule(sheets[0].grid)
  if (schedule) return schedule

  const newPatients = readNewPatients(sheets[0].grid)
  if (newPatients) return newPatients

  const grid = sheets[0].grid
  const collections = readCollectionsByType(grid) || readCollections(grid)
  if (collections) return collections

  const headerAt = grid.findIndex((r) => r.some((c) => ['provider', 'subcategory'].includes(headerKey(c))))
  if (headerAt < 0) throw new Error('Not a recognised Dentrix report (no Provider or Subcategory column).')

  const cols = {}
  grid[headerAt].forEach((h, i) => { const k = headerKey(h); if (k && cols[k] == null) cols[k] = i })
  const body = grid.slice(headerAt + 1)
  const get = (r, k) => (cols[k] == null ? '' : (r[cols[k]] ?? '').trim())

  if (cols.provider != null && cols.procedures != null) {
    if (cols.month == null) throw new Error('Production report has no Month column — add Month to the rows in Power Reporting.')
    const rows = []
    // Excel exports of a pivot leave repeated labels blank; carry them down.
    const last = {}
    for (const r of body) {
      if (isTotalRow(r)) continue
      const dim = {}
      for (const k of ['provider', 'location', 'year', 'month']) {
        dim[k] = get(r, k) || last[k] || ''
        last[k] = dim[k]
      }
      const month = monthNum(dim.month)
      if (!dim.provider || !month) continue
      const year = Number(dim.year) || inferYear(month)
      const gross = money(get(r, 'procedures'))
      const credit = money(get(r, 'credit'))
      const charge = money(get(r, 'charge'))
      const totalCell = get(r, 'total')
      rows.push({
        provider: dim.provider.replace(/,\s*$/, ''),
        location: dim.location || 'Unknown',
        period: periodKey(year, month),
        gross, credit, charge,
        net: totalCell ? money(totalCell) : gross + credit + charge,
      })
    }
    if (!rows.length) throw new Error('Production report has no provider rows.')
    return { kind: 'production', rows }
  }

  if (cols.subcategory != null && cols.amount != null) {
    const rows = []
    const last = {}
    for (const r of body) {
      if (isTotalRow(r)) continue
      const dim = {}
      for (const k of ['side', 'category']) {
        dim[k] = get(r, k) || last[k] || ''
        last[k] = dim[k]
      }
      const subcategory = get(r, 'subcategory')
      if (!subcategory) continue
      rows.push({
        side: dim.side, category: dim.category, subcategory,
        amount: money(get(r, 'amount')),
        count: Number(get(r, 'count').replace(/,/g, '')) || 0,
      })
    }
    if (!rows.length) throw new Error('Adjustment report has no rows.')
    return { kind: 'adjustments', rows }
  }

  throw new Error('Not a recognised Dentrix report — expected a Provider Production or Adjustment Summary export.')
}

// ── Collections by location ────────────────────────────────────────────────
// Dentrix shows payments as negative credits; they're returned as positive
// dollars received. Charge adjustments here are refunds, which reduce it.
function readCollections(grid) {
  const headerAt = grid.findIndex((r) => r.some((c) => /insurance payments/i.test(c)) && r.some((c) => /guarantor payments/i.test(c)))
  if (headerAt < 0) return null
  const h = grid[headerAt]
  const col = (re) => h.findIndex((c) => re.test(c))
  const iLoc = col(/^location$/i), iIns = col(/insurance payments/i), iPat = col(/guarantor payments/i)
  const iAdj = col(/charge adjustments/i), iTot = col(/collection total/i)
  // Optional: the month of the work each payment was applied to.
  const iYear = col(/^year \(service\)$/i), iMonth = col(/^month \(service\)$/i)
  const rows = []
  let lastLoc = '', lastYear = ''
  for (const r of grid.slice(headerAt + 1)) {
    const raw = (r[iLoc] || '').trim()
    if (/total$/i.test(raw)) continue
    const location = raw || lastLoc
    if (!location) continue
    if (location !== lastLoc) lastYear = ''
    lastLoc = location
    const insurance = -money(r[iIns]), patients = -money(r[iPat])
    const refunds = iAdj >= 0 ? money(r[iAdj]) : 0
    const row = { location, insurance, patients, refunds, total: iTot >= 0 ? -money(r[iTot]) : insurance + patients - refunds }
    if (iMonth >= 0) {
      const year = (r[iYear] || '').trim() || lastYear
      lastYear = year
      const month = monthNum(r[iMonth])
      row.service = Number(year) && month ? periodKey(Number(year), month) : 'unknown'
    }
    rows.push(row)
  }
  if (!rows.length) throw new Error('Collection report has no location rows.')
  return { kind: 'collections', rows }
}

// ── Collections, one row per payment type ──────────────────────────────────
// Ledger export with rows Location → Category → Subcategory [→ Year/Month
// (Service)] and an Amount measure. Category says who paid (Insurance /
// Guarantor Payments, Charge Adjustments = refunds); Subcategory says how
// (Credit Card Payment, Patient Financing Payment, Insurance Payment - Check…).
// Recognised by having a location column next to Category and Subcategory —
// the Adjustment Summary has those two but no location.
function readCollectionsByType(grid) {
  const headerAt = grid.findIndex((r) => {
    const h = r.map((c) => c.trim().toLowerCase())
    return h.includes('category') && h.includes('subcategory') && h.some((c) => /location$/.test(c))
  })
  if (headerAt < 0) return null
  const h = grid[headerAt].map((c) => c.trim().toLowerCase())
  const iLoc = h.findIndex((c) => /location$/.test(c)), iCat = h.indexOf('category'), iSub = h.indexOf('subcategory')
  const iYear = h.indexOf('year (service)'), iMonth = h.indexOf('month (service)')
  // Optional: the month the money arrived, so one export can cover many months.
  // Ascend labels these "Year (Trans)" / "Month (Trans)"; either spelling is read.
  const iTYear = h.findIndex((c) => /^year \(trans(action)?\)$/.test(c)), iTMonth = h.findIndex((c) => /^month \(trans(action)?\)$/.test(c))
  const iAmt = h.indexOf('amount') >= 0 ? h.indexOf('amount') : h.indexOf('collection')
  if (iAmt < 0) return null
  // Label columns in the order the export lists them. Pivot exports leave a
  // repeated label blank, so each is carried down from the row above — until
  // a column to its left changes, which starts a new group.
  const dims = [iLoc, iCat, iSub, iYear, iMonth, iTYear, iTMonth].filter((i) => i >= 0).sort((x, y) => x - y)

  const rows = []
  const last = {}
  for (const r of grid.slice(headerAt + 1)) {
    if (isTotalRow(r)) continue
    const v = {}
    let changed = false
    for (const i of dims) {
      const raw = (r[i] || '').trim()
      v[i] = raw || (changed ? '' : last[i] || '')
      if (raw && raw !== last[i]) changed = true
    }
    Object.assign(last, v)
    const loc = v[iLoc], cat = v[iCat], sub = iSub >= 0 ? v[iSub] : ''
    if (!loc || !cat) continue

    const amount = money(r[iAmt])
    const who = /insurance/i.test(cat) ? 'insurance' : /guarantor|patient/i.test(cat) ? 'patients' : 'refunds'
    const row = {
      location: loc, type: sub || cat,
      insurance: who === 'insurance' ? -amount : 0,
      patients: who === 'patients' ? -amount : 0,
      refunds: who === 'refunds' ? amount : 0,
      total: -amount,
    }
    if (iMonth >= 0) {
      const month = monthNum(v[iMonth])
      row.service = Number(v[iYear]) && month ? periodKey(Number(v[iYear]), month) : 'unknown'
    }
    if (iTMonth >= 0) {
      const month = monthNum(v[iTMonth])
      if (Number(v[iTYear]) && month) row.period = periodKey(Number(v[iTYear]), month)
    }
    rows.push(row)
  }
  if (!rows.length) return null
  return { kind: 'collections', rows }
}

// ── Ad spend, typed in from each platform's billing page ───────────────────
// reports/ad-spend.csv — Month (YYYY-MM), Platform, Brand, Spend [, Campaign].
// For platforms without an API connection (Google Ads, while there is no
// manager account): the billed amount per account per month.
function readAdSpend(grid) {
  const h = (grid[0] || []).map((c) => c.trim().toLowerCase())
  const iMonth = h.indexOf('month'), iPlat = h.indexOf('platform'), iBrand = h.indexOf('brand'), iSpend = h.indexOf('spend')
  if (iMonth < 0 || iPlat < 0 || iBrand < 0 || iSpend < 0) return null
  const iCamp = h.indexOf('campaign')
  const rows = []
  for (const r of grid.slice(1)) {
    const m = /^(\d{4})-(\d{1,2})$/.exec((r[iMonth] || '').trim())
    const spend = money(r[iSpend])
    if (!m || !spend) continue
    rows.push({
      period: periodKey(Number(m[1]), Number(m[2])),
      platform: (r[iPlat] || '').trim() || 'Other',
      brand: (r[iBrand] || '').trim(),
      campaign: (iCamp >= 0 && (r[iCamp] || '').trim()) || `${(r[iPlat] || '').trim()} (billed)`,
      spend, leads: 0,
    })
  }
  return rows.length ? { kind: 'adSpend', rows } : null
}

// ── New patients (Looker "New Patients – Marketing") ───────────────────────
// One row per new patient: Location, Patient, Service Year, Service Month,
// Revision History, Referred By, Production. Reduced straight away to counts
// per month, location and referral source — patient names are only used to
// count each patient once and are never kept.
export const NP_CHANNELS = ['Word of mouth', 'Online', 'Walk-by / signage', 'Insurance directory', 'Mail', 'Professional referral', 'Not recorded', 'Other']

// Dentrix's own referral sources are written in capitals ("GOOGLE SEARCH");
// a referring patient appears as "Last, First" in mixed case, sometimes with
// "Jr." or a title. Any comma plus lowercase is treated as a person.
function looksLikePerson(src) {
  return /,/.test(src || '') && /[a-z]/.test(src || '')
}

export function referralChannel(src) {
  const s = (src || '').trim()
  if (!s || /^not (available|recorded)/i.test(s)) return 'Not recorded'
  if (s === 'Referred by a person') return 'Word of mouth'
  if (looksLikePerson(s) || /family|friend|patient|word/i.test(s)) return 'Word of mouth'
  if (/google|website|web|online|facebook|instagram|yelp|social|internet|zocdoc|tiktok/i.test(s)) return 'Online'
  if (/^location$|drive|walk|sign/i.test(s)) return 'Walk-by / signage'
  if (/insurance|delta|metlife|cigna|aetna|humana|guardian|united|blue cross|bcbs|principal|ameritas|careington/i.test(s)) return 'Insurance directory'
  if (/postcard|mail|flyer/i.test(s)) return 'Mail'
  if (/doctor|professional|dentist|referral/i.test(s)) return 'Professional referral'
  return 'Other'
}

function readNewPatients(grid) {
  const headerAt = grid.findIndex((r) => r.some((c) => /^patient$/i.test(c.trim())) && r.some((c) => /^referred by$/i.test(c.trim())))
  if (headerAt < 0) return null
  const h = grid[headerAt].map((c) => c.trim().toLowerCase())
  const iLoc = h.indexOf('location'), iPat = h.indexOf('patient'), iRef = h.indexOf('referred by')
  const iYear = h.findIndex((c) => /year/.test(c)), iMonth = h.findIndex((c) => /month/.test(c)), iProd = h.indexOf('production')
  const iRev = h.findIndex((c) => /revision/.test(c))

  const seen = new Map()   // period|location|source → Set of patients (local only)
  const out = {}           // period → location → source → { patients, production }
  for (const r of grid.slice(headerAt + 1)) {
    if (isTotalRow(r)) continue
    if (iRev >= 0 && r[iRev] && !/current/i.test(r[iRev])) continue
    const month = monthNum(r[iMonth]), year = Number(r[iYear])
    const loc = (r[iLoc] || '').trim()
    if (!month || !year || !loc) continue
    const period = periodKey(year, month)
    const src = (r[iRef] || '').trim()
    // A person's name as the referrer is grouped, not kept.
    const source = looksLikePerson(src) ? 'Referred by a person' : (src || 'Not recorded')
    const key = `${period}|${loc}|${source}`
    if (!seen.has(key)) seen.set(key, new Set())
    const cell = ((out[period] ||= {})[loc] ||= {})[source] ||= { patients: 0, production: 0 }
    const pat = (r[iPat] || '').trim()
    if (!seen.get(key).has(pat)) { seen.get(key).add(pat); cell.patients++ }
    cell.production += iProd >= 0 ? money(r[iProd]) : 0
  }
  if (!Object.keys(out).length) return null
  return { kind: 'newPatients', months: out }
}

// ── Schedule (appointments) → patient retention ────────────────────────────
// "Schedule Report (TSP) Assign": one row per appointment with Location, Date
// (DD-MM-YYYY), Patient, Chart Number, Provider, Specialty, Appt Time and Appt
// Status. Chart numbers tie each patient's visits together inside this
// function only; what comes out is counts per month, location and provider.
//
// For each of the last 36 months, as of that month's end:
//   seen      patients with a visit that month (each provider and office that
//             saw them gets the patient)
//   seenNext  of those, how many came back later or have something booked
//   newPts    patients whose first visit ever was that month
//   newBack   of those, how many came back within 6 months (newMature says
//             whether 6 months have passed, so the number is final)
//   active    patients seen in the 18 months before (credited to their last visit)
//   lapsed    last seen 6–12 / 12–18 / 18–36 months before, nothing booked
export const LAPSE_BUCKETS = ['6-12', '12-18', '18-36']
const VISIT = /^(complete|checkout|chair|ready|here|late)$/i          // the patient came in
const MISSED = { broken: /^broken$/i, noShow: /^no show$/i, cancelled: /^cancelled/i }
const MONTHS_KEPT = 36

// Exports write the date either day-first (09-11-2026) or year-first
// (2026-11-09), depending on how Ascend was set when it was exported.
function scheduleDate(v) {
  const t = String(v || '').trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(t)
  return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null
}
function apptMinutes(v) {
  // Some exports wrap the time in invisible NUL characters ("\u000009:00 AM\u0000").
  const m = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(String(v || '').replace(/[\u0000-\u001f]/g, '').trim())
  if (!m) return null
  return ((Number(m[1]) % 12) + (/p/i.test(m[3]) ? 12 : 0)) * 60 + Number(m[2])
}
const DAY = 86400000
const MONTH = 30.44 * DAY
const monthEnd = (p) => { const [y, m] = p.split('-').map(Number); return Date.UTC(y, m, 1) - 1 }
const monthStart = (p) => { const [y, m] = p.split('-').map(Number); return Date.UTC(y, m - 1, 1) }
const monthOf = (ts) => { const d = new Date(ts); return periodKey(d.getUTCFullYear(), d.getUTCMonth() + 1) }
// Index of the last visit on or before ts, or -1.
function lastAtOrBefore(visits, ts) {
  let lo = 0, hi = visits.length - 1, ans = -1
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (visits[mid].ts <= ts) { ans = mid; lo = mid + 1 } else hi = mid - 1 }
  return ans
}

// After a patient's last visit in a window (visits[idx]), who did they come
// back to? For each provider seen in the window: is the next visit (or
// booking) with the same kind of provider — dentist or hygienist — with them?
// For each office: is the next visit at that office? Generic office
// "providers" are skipped when looking for the next dentist or hygienist.
function cameBackTo(person, idx, fromTs, specialty) {
  const { visits, booked } = person
  const later = visits.slice(idx + 1).concat(booked)
  const hyg = (p) => specialty[p] === 'Hygienist'
  const generic = (p) => guessRole(p) === 'office' || /^(temp|hygienist|rdh |no provider)/i.test(p)
  const provs = new Map(), locs = new Map()
  for (let i = idx; i >= 0 && visits[i].ts >= fromTs; i--) {
    const { prov, loc } = visits[i]
    if (!provs.has(prov)) {
      const next = later.find((e) => !generic(e.prov) && hyg(e.prov) === hyg(prov))
      provs.set(prov, !!next && next.prov === prov)
    }
    if (!locs.has(loc)) locs.set(loc, !!later.length && later[0].loc === loc)
  }
  return { provs, locs }
}

// Patients whose last broken or no-show appointment in [fromTs, toTs] was
// never followed by a visit or a new booking — the ones at most risk of
// being lost. Credited to the office and provider of that appointment.
function missedNotRebooked(people, fromTs, toTs) {
  const out = { total: 0, byLoc: {}, byProv: {} }
  for (const { visits, booked, missed } of people) {
    let m = null
    for (let i = missed.length - 1; i >= 0; i--) if (missed[i].ts >= fromTs && missed[i].ts <= toTs) { m = missed[i]; break }
    if (!m || booked.length || visits.some((v) => v.ts > m.ts)) continue
    out.total++
    out.byLoc[m.loc] = (out.byLoc[m.loc] || 0) + 1
    out.byProv[m.prov] = (out.byProv[m.prov] || 0) + 1
  }
  return out
}

// What happens to patients after each risk moment, from a year that has had
// a full year since to play out: patients seen 24–12 months before the
// report date, followed for 12 months after their last visit in that year.
//   next: what happened to the next appointment after that visit
//   oneVisit: patients whose only visit ever was that one
function lossEvidence(people, asOf, dataStart) {
  const from = asOf - 730 * DAY, to = asOf - 365 * DAY
  const tally = () => ({ patients: 0, stopped: 0 })
  const ev = { from: new Date(from).toISOString().slice(0, 10), to: new Date(to).toISOString().slice(0, 10),
    all: tally(), kept: tally(), broke: tally(), noShow: tally(), noBooking: tally(), oneVisit: tally(), returning: tally() }
  for (const { visits, booked, missed } of people) {
    const idx = lastAtOrBefore(visits, to)
    if (idx < 0 || visits[idx].ts < from) continue
    const L = visits[idx].ts
    const stopped = !visits.some((v) => v.ts > L && v.ts <= L + 365 * DAY) && !booked.length
    const nextVisit = visits[idx + 1]?.ts ?? Infinity
    const nextMiss = missed.find((x) => x.ts > L)
    const kind = nextMiss && nextMiss.ts < nextVisit ? (nextMiss.kind === 'noShow' ? 'noShow' : 'broke')
      : nextVisit < Infinity || booked.length ? 'kept' : 'noBooking'
    for (const k of ['all', kind, visits[0].ts > dataStart + 365 * DAY && idx === 0 ? 'oneVisit' : 'returning']) {
      ev[k].patients++; if (stopped) ev[k].stopped++
    }
  }
  return ev
}

function readSchedule(grid) {
  const headerAt = grid.findIndex((r) => r.some((c) => /^appt status$/i.test(c.trim())) && r.some((c) => /^chart number$/i.test(c.trim())))
  if (headerAt < 0) return null
  const h = grid[headerAt].map((c) => c.trim().toLowerCase())
  const col = (n) => h.indexOf(n)
  const iLoc = col('location'), iDate = col('date'), iChart = col('chart number'), iProv = col('provider')
  const iSpec = col('specialty'), iTime = col('appt time'), iStatus = col('appt status')

  const patients = new Map()   // chart → [{ ts, loc, prov, kind }]
  const specialty = {}         // provider → specialty
  const appts = {}             // period → l|loc / p|prov → { total, broken, noShow, cancelled }
  const days = {}              // period → prov → day → { first, last, visits }
  const visitsOn = new Map()   // day → visits, to find the export date
  for (let n = headerAt + 1; n < grid.length; n++) {
    const r = grid[n]
    const ts = scheduleDate(r[iDate]); const chart = (r[iChart] || '').trim()
    if (ts == null || !chart) continue
    const status = (r[iStatus] || '').trim()
    const loc = (r[iLoc] || '').trim(), prov = (r[iProv] || '').trim() || 'No provider'
    if (iSpec >= 0 && r[iSpec]) specialty[prov] = r[iSpec].trim()
    const kind = VISIT.test(status) ? 'visit' : Object.keys(MISSED).find((k) => MISSED[k].test(status)) || 'booked'
    if (kind === 'visit') visitsOn.set(ts, (visitsOn.get(ts) || 0) + 1)
    let list = patients.get(chart); if (!list) patients.set(chart, (list = []))
    list.push({ ts, loc, prov, kind })
    const p = monthOf(ts)
    for (const key of [`l|${loc}`, `p|${prov}`]) {
      const a = ((appts[p] ||= {})[key] ||= { total: 0, broken: 0, noShow: 0, cancelled: 0 })
      a.total++; if (kind in MISSED) a[kind]++
    }
    if (kind === 'visit') {
      const min = apptMinutes(r[iTime])
      const d = (((days[p] ||= {})[prov] ||= {})[ts] ||= { first: min, last: min, visits: 0 })
      d.visits++
      if (min != null) { d.first = d.first == null ? min : Math.min(d.first, min); d.last = d.last == null ? min : Math.max(d.last, min) }
    }
  }
  if (!patients.size) return null
  // The export date: the last day with a real clinic's worth of visits (a
  // stray appointment marked complete ahead of time doesn't count).
  const asOf = Math.max(...[...visitsOn].filter(([, n]) => n >= 5).map(([ts]) => ts))

  const people = []
  let dataStart = Infinity
  for (const list of patients.values()) {
    const visits = list.filter((a) => a.kind === 'visit').sort((a, b) => a.ts - b.ts)
    if (!visits.length) continue
    dataStart = Math.min(dataStart, visits[0].ts)
    const booked = list.filter((a) => a.kind === 'booked' && a.ts > asOf).sort((a, b) => a.ts - b.ts)
    const missed = list.filter((a) => a.kind === 'broken' || a.kind === 'noShow').sort((a, b) => a.ts - b.ts)
    people.push({ visits, booked, missed, bookedAhead: booked.length > 0 })
  }
  const lastMonth = monthOf(asOf)
  const periods = Object.keys(appts).filter((p) => p <= lastMonth).sort().slice(-MONTHS_KEPT)

  const blank = () => ({ seen: 0, seenNext: 0, seenSame: 0, newPts: 0, newNext: 0, newBack: 0, active: 0, lapsed: { '6-12': 0, '12-18': 0, '18-36': 0 } })
  const months = {}
  for (const p of periods) {
    const start = monthStart(p), end = monthEnd(p)
    const out = { total: blank(), byLoc: {}, byProv: {}, appts: appts[p] || {}, hygiene: {}, newMature: end + 183 * DAY <= asOf }
    const cell = (where, key) => (out[where][key] ||= blank())
    for (const person of people) {
      const { visits, bookedAhead } = person
      const idx = lastAtOrBefore(visits, end)
      if (idx < 0) continue
      const last = visits[idx]
      const hasNext = idx < visits.length - 1 || bookedAhead
      const gap = (end - last.ts) / MONTH
      if (last.ts >= start) {
        // Everyone who saw them this month gets them.
        const { provs, locs } = cameBackTo(person, idx, start, specialty)
        const fresh = visits[0].ts >= start && visits[0].ts > dataStart + 365 * DAY
        const back = fresh && visits.some((v) => v.ts > visits[0].ts + DAY / 2 && v.ts <= visits[0].ts + 183 * DAY)
        const tally = (t) => {
          t.seen++; if (hasNext) t.seenNext++
          if (fresh) { t.newPts++; if (hasNext) t.newNext++; if (back) t.newBack++ }
        }
        tally(out.total)
        for (const [l, same] of locs) { const c = cell('byLoc', l); tally(c); if (same) c.seenSame++ }
        for (const [v, same] of provs) { const c = cell('byProv', v); tally(c); if (same) c.seenSame++ }
      }
      if (gap < 18) {
        out.total.active++; cell('byLoc', last.loc).active++; cell('byProv', last.prov).active++
      }
      if (!hasNext && gap >= 6 && gap < 36) {
        const b = gap >= 18 ? '18-36' : gap >= 12 ? '12-18' : '6-12'
        out.total.lapsed[b]++; cell('byLoc', last.loc).lapsed[b]++; cell('byProv', last.prov).lapsed[b]++
      }
    }
    // Hours worked, estimated from the first to the last appointment of each
    // day plus one hour, since the schedule has start times but no lengths.
    for (const [prov, byDay] of Object.entries(days[p] || {})) {
      const ds = Object.values(byDay)
      out.hygiene[prov] = {
        specialty: specialty[prov] || '', days: ds.length,
        visits: ds.reduce((s, d) => s + d.visits, 0),
        hours: ds.reduce((s, d) => s + (d.first == null ? 1 : (d.last - d.first) / 60 + 1), 0),
      }
    }
    out.missedOpen = missedNotRebooked(people, start, end)
    months[p] = out
  }
  // All time: every patient each provider (and office) has ever seen. Each is
  // still coming (seen in the last 18 months or something booked) or has
  // stopped; those still coming are either still with this provider — their
  // latest dentist (or hygienist) visit or booking is with them — or now see
  // someone else. A patient counts for every provider who saw them, so rows
  // don't add up to the total. New patients count where their first visit
  // was, and whether they came back within 6 months.
  const allBlank = () => ({ patients: 0, still: 0, stillSame: 0, stopped: 0, newPts: 0, newJudged: 0, newBack: 0 })
  const all = { total: allBlank(), byLoc: {}, byProv: {} }
  const allCell = (where, key) => (all[where][key] ||= allBlank())
  const hyg = (pv) => specialty[pv] === 'Hygienist'
  const generic = (pv) => guessRole(pv) === 'office' || /^(temp|hygienist|rdh |no provider)/i.test(pv)
  for (const { visits, booked } of people) {
    const last = visits[visits.length - 1], first = visits[0]
    const still = booked.length > 0 || (asOf - last.ts) / MONTH < 18
    all.total.patients++; if (still) all.total.still++; else all.total.stopped++
    // Latest event first: bookings (soonest first), then visits newest first.
    const latestFirst = [...booked, ...[...visits].reverse()]
    const provs = new Set(visits.map((v) => v.prov)), locs = new Set(visits.map((v) => v.loc))
    for (const pv of provs) {
      const t = allCell('byProv', pv); t.patients++
      if (!still) { t.stopped++; continue }
      t.still++
      const cur = latestFirst.find((e) => !generic(e.prov) && hyg(e.prov) === hyg(pv))
      if (!cur || cur.prov === pv) t.stillSame++
    }
    for (const l of locs) {
      const t = allCell('byLoc', l); t.patients++
      if (!still) { t.stopped++; continue }
      t.still++
      if (latestFirst[0].loc === l) t.stillSame++
    }
    if (first.ts > dataStart + 365 * DAY) {
      const judged = first.ts + 183 * DAY <= asOf
      const back = judged && visits.some((v) => v.ts > first.ts + DAY / 2 && v.ts <= first.ts + 183 * DAY)
      for (const t of [all.total, allCell('byLoc', first.loc), allCell('byProv', first.prov)]) {
        t.newPts++; if (judged) t.newJudged++; if (back) t.newBack++
      }
    }
  }
  all.missedOpen = missedNotRebooked(people, asOf - 365 * DAY, asOf)
  // The all-time view's "where patients are lost" reads the last 12 months.
  const iso = (ts) => new Date(ts).toISOString().slice(0, 10)
  const y = scheduleRange({ people, asOf, dataStart, specialty }, iso(asOf - 364 * DAY), iso(asOf))
  const slim = (v) => ({ seen: v.seen, seenNext: v.seenNext, newPts: v.newPts, newNext: v.newNext })
  all.last12 = { from: y.from, to: y.to, total: slim(y.total), byLoc: Object.fromEntries(Object.entries(y.byLoc).map(([k, v]) => [k, slim(v)])) }
  const result = { kind: 'schedule', asOf: new Date(asOf).toISOString().slice(0, 10), since: monthOf(dataStart), specialty, months, all,
    evidence: lossEvidence(people, asOf, dataStart) }
  // Visit dates per patient (no names or chart numbers) for custom date
  // ranges. Not enumerable, so it never goes into JSON or localStorage.
  Object.defineProperty(result, 'index', { value: { people, asOf, dataStart, specialty }, enumerable: false })
  return result
}

/**
 * Retention for any date range, from readSchedule's index: the patients seen
 * between `from` and `to` (ISO dates, inclusive), and how many came back after
 * their last visit in the range or have something booked. Same shape as one
 * month of readSchedule's `months`.
 */
export function scheduleRange(index, from, to) {
  const { people, asOf, dataStart, specialty = {} } = index
  const fromTs = Date.parse(from + 'T00:00:00Z'), toTs = Date.parse(to + 'T00:00:00Z') + DAY - 1
  const blank = () => ({ seen: 0, seenNext: 0, seenSame: 0, newPts: 0, newNext: 0, newBack: 0, newJudged: 0 })
  const out = { total: blank(), byLoc: {}, byProv: {}, newMature: true, from, to, missedOpen: missedNotRebooked(people, fromTs, toTs) }
  const cell = (where, key) => (out[where][key] ||= blank())
  for (const person of people) {
    const { visits, bookedAhead } = person
    const idx = lastAtOrBefore(visits, toTs)
    if (idx < 0 || visits[idx].ts < fromTs) continue
    const hasNext = idx < visits.length - 1 || bookedAhead
    const { provs, locs } = cameBackTo(person, idx, fromTs, specialty)
    const first = visits[0]
    const fresh = first.ts >= fromTs && first.ts > dataStart + 365 * DAY
    const judged = fresh && first.ts + 183 * DAY <= asOf
    const back = judged && visits.some((v) => v.ts > first.ts + DAY / 2 && v.ts <= first.ts + 183 * DAY)
    const tally = (t) => {
      t.seen++; if (hasNext) t.seenNext++
      if (fresh) { t.newPts++; if (hasNext) t.newNext++; if (judged) t.newJudged++; if (back) t.newBack++ }
    }
    tally(out.total)
    for (const [l, same] of locs) { const c = cell('byLoc', l); tally(c); if (same) c.seenSame++ }
    for (const [v, same] of provs) { const c = cell('byProv', v); tally(c); if (same) c.seenSame++ }
  }
  return out
}

// ── Insurance aging (open claims) ──────────────────────────────────────────
export const AGE_BUCKETS = ['0-30', '31-60', '61-90', '91-120', '120+']

function bucketOf(header) {
  const k = header.split('~')[0].trim().replace(/^>\s*120$/, '120+')
  return AGE_BUCKETS.includes(k) ? k : /grand total/i.test(k) ? 'total' : null
}

function emptyAging() {
  return { billed: 0, expected: 0, claims: 0, buckets: {}, carriers: {}, statuses: {} }
}

function addClaim(T, claim) {
  T.billed += claim.billed; T.expected += claim.expected; T.claims++
  for (const [k, v] of Object.entries(claim.buckets)) {
    const b = T.buckets[k] ||= { billed: 0, expected: 0, claims: 0 }
    b.billed += v.billed; b.expected += v.expected
    if (v.expected) b.claims++
    // Status within each age, so "needs the office" can sit under the age it has reached.
    const bs = (b.statuses ||= {})[claim.status] ||= { expected: 0, claims: 0 }
    bs.expected += v.expected
    if (v.expected) bs.claims++
    // And insurer within each age, so "who is it with, and why" can sit under it too.
    const bc = (b.carriers ||= {})[claim.carrier] ||= { expected: 0, claims: 0 }
    bc.expected += v.expected
    if (v.expected) bc.claims++
  }
  const c = T.carriers[claim.carrier] ||= { expected: 0, claims: 0 }
  c.expected += claim.expected; c.claims++
  const s = T.statuses[claim.status] ||= { expected: 0, claims: 0 }
  s.expected += claim.expected; s.claims++
}

// "10/31/26" → "2026-10". Unreadable dates group as "unknown".
function servicePeriod(v) {
  // The CSV export writes year-first (2026-10-31); the Excel one 10/31/26.
  const iso = /^(\d{4})-(\d{1,2})-\d{1,2}$/.exec(String(v || '').trim())
  if (iso) return periodKey(Number(iso[1]), Number(iso[2]))
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(v || '').trim())
  if (!m) return 'unknown'
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  return periodKey(y, Number(m[1]))
}

function readAging(sheets, fileName) {
  const locations = {}
  for (const { name, grid } of sheets) {
    const headerAt = grid.findIndex((r) => r.some((c) => /^claim carrier$/i.test(c.trim())))
    if (headerAt < 0) continue
    const h = grid[headerAt]
    const iLoc = h.findIndex((c) => /^location$/i.test(c.trim()))
    const iCarrier = h.findIndex((c) => /^claim carrier$/i.test(c.trim()))
    const iStatus = h.findIndex((c) => /^claim status$/i.test(c.trim()))
    // Each age bucket has a "Billed to Insurance" and an expected "Amount" column.
    const measures = h.map((c, i) => {
      const bucket = bucketOf(c)
      if (!bucket) return null
      return { i, bucket, field: /billed/i.test(c) ? 'billed' : 'expected' }
    }).filter(Boolean)

    const iService = h.findIndex((c) => /^date \(service\)$/i.test(c.trim()))

    for (const r of grid.slice(headerAt + 1)) {
      const loc = (r[iLoc] || '').trim() || name
      const carrier = (r[iCarrier] || '').trim()
      // Total lines: blank carrier (the Excel export) or "Grand Total" (the CSV one).
      if (!carrier || isTotalRow(r)) continue
      const claim = { carrier, status: (r[iStatus] || 'Unknown').trim(), billed: 0, expected: 0, buckets: {} }
      for (const m of measures) {
        const v = money(r[m.i])
        if (m.bucket === 'total') claim[m.field] = v
        else (claim.buckets[m.bucket] ||= { billed: 0, expected: 0 })[m.field] += v
      }
      const L = locations[loc] ||= { ...emptyAging(), months: {} }
      addClaim(L, claim)
      // Also by month of service, so a month's own unpaid claims can be told
      // apart from the whole backlog.
      addClaim(L.months[servicePeriod(r[iService])] ||= emptyAging(), claim)
    }
  }
  if (!Object.keys(locations).length) return null
  const m = /(\d{1,2})-(\d{1,2})-(\d{4})/.exec(fileName || '')
  const asOf = m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null
  return { kind: 'aging', asOf, locations }
}

// ── Classification ─────────────────────────────────────────────────────────

// Ascend lists the practice entities ("Valley View Dental, Romeoville",
// "EDC of Lemont PLLC", "n/a") as providers. They aren't people.
export function guessRole(provider) {
  const p = provider.toLowerCase()
  if (p === 'n/a' || /dental|dentique|pllc|p\.c\./.test(p)) return 'office'
  if (/\brdh\b|hygienist/.test(p)) return 'hygiene'
  return 'doctor'
}

// Adjustment subcategories by who decides them.
export function adjustmentBucket(row) {
  if (/collection/i.test(row.side)) return 'refunds'
  if (/balance forward|transfer/i.test(row.subcategory)) return 'housekeeping'
  if (/^insurance adjustment$/i.test(row.subcategory)) return 'insurance'
  return 'office'
}
