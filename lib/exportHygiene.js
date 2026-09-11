import * as XLSX from 'xlsx'
import { shortLocation, DAY_LABELS } from './constants'

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

function formatDate(val) {
  if (!val) return ''
  const [y, m, d] = val.split('-')
  return `${m}/${d}/${y}`
}

function monthLabel(m) {
  if (!m) return ''
  const n = Number(m)
  return !isNaN(n) && n >= 1 && n <= 12 ? MONTH_NAMES[n - 1] : String(m)
}

// Human-readable list of every filter currently narrowing the view — matches
// the pattern in exportAch.js so an exported file always says what it does
// and does not contain, regardless of which module it came from.
function describeFilters(filters) {
  const parts = []
  if (filters.month) parts.push(`Month: ${monthLabel(filters.month)}`)
  if (filters.year)  parts.push(`Year: ${filters.year}`)
  if (filters.day)   parts.push(`Day: ${DAY_LABELS[Number(filters.day)] || filters.day}`)
  if (filters.from)  parts.push(`From: ${formatDate(filters.from)}`)
  if (filters.to)    parts.push(`To: ${formatDate(filters.to)}`)
  return parts
}

/**
 * Export the currently visible hygiene rows to an .xlsx file.
 *
 * @param {object}  opts
 * @param {Array}   opts.rows           the filtered rows (all pages, not just the current one)
 * @param {string}  opts.locationLabel  e.g. "All Locations" or "Romeoville"
 * @param {object}  opts.filters        the filters state object
 * @param {object}  opts.stats          { available, utilized, pct } from summarise()
 */
export function buildHygieneWorkbook({ rows, locationLabel, filters, stats }) {
  const headers = ['Location', 'Date', 'Day', 'Hours', 'Available', 'Utilized', '%', 'Notes']

  const tableRows = rows.map((r) => [
    shortLocation(r.location),
    formatDate(r.workDate),
    DAY_LABELS[r.dayNum] || '',
    r.hours || '',
    Number(r.available) || 0,
    Number(r.utilized) || 0,
    // Written as a fraction with a % cell format below, not as "75.0" — a
    // spreadsheet formula built on this column should see 0.75, not 75.
    r.pct != null ? r.pct / 100 : '',
    r.notes || '',
  ])

  const filterParts = describeFilters(filters)

  const meta = [
    ['Hygiene Utilization Export'],
    ['Generated',   new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })],
    ['Location',    locationLabel],
    ['Days',        rows.length],
    ['Available Hours', stats.available],
    ['Utilized Hours',  stats.utilized],
    ['Utilization',     stats.pct != null ? stats.pct / 100 : ''],
    ['Filters',     filterParts.length ? filterParts.join('  ·  ') : 'None'],
    [],
  ]

  const aoa = [...meta, headers, ...tableRows]
  const ws  = XLSX.utils.aoa_to_sheet(aoa)

  ws['!cols'] = [
    { wch: 24 }, { wch: 12 }, { wch: 11 }, { wch: 20 },
    { wch: 11 }, { wch: 11 }, { wch: 9 },  { wch: 34 },
  ]

  const headerRowIdx = meta.length
  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 6 })]
    if (cell && cell.t === 'n') cell.z = '0.0%'
  }
  const totalPctCell = ws[XLSX.utils.encode_cell({ r: 6, c: 1 })]
  if (totalPctCell && totalPctCell.t === 'n') totalPctCell.z = '0.0%'

  ws['!freeze'] = { xSplit: 0, ySplit: headerRowIdx + 1 }
  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range(
      { r: headerRowIdx, c: 0 },
      { r: aoa.length - 1, c: headers.length - 1 }
    ),
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Hygiene')

  const stamp   = new Date().toISOString().slice(0, 10)
  const locPart = locationLabel.replace(/[^a-zA-Z0-9]+/g, '-')

  return { wb, filename: `Hygiene-${locPart}-${stamp}.xlsx` }
}

export function exportHygieneToExcel(opts) {
  const { wb, filename } = buildHygieneWorkbook(opts)
  const buf  = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
