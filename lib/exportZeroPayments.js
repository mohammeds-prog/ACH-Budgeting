import * as XLSX from 'xlsx'

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

function shortLoc(loc) {
  if (!loc) return ''
  return loc.replace('Valley View Dental ', '')
}

function formatDate(val) {
  if (!val) return ''
  const [y, m, d] = val.split('-')
  return `${m}/${d}/${y}`
}

function monthLabel(m) {
  const n = Number(m)
  return !isNaN(n) && n >= 1 && n <= 12 ? MONTH_NAMES[n - 1] : String(m)
}

function describeFilters(filters) {
  const parts = []
  if (filters.month)     parts.push(`Month: ${monthLabel(filters.month)}`)
  if (filters.year)      parts.push(`Year: ${filters.year}`)
  if (filters.from)      parts.push(`From: ${formatDate(filters.from)}`)
  if (filters.to)        parts.push(`To: ${formatDate(filters.to)}`)
  if (filters.match)     parts.push(`Match: ${filters.match === 'unmatched' ? 'Unmatched' : filters.match}`)
  if (filters.status)    parts.push(`Status: ${filters.status}`)
  if (filters.insurance) parts.push(`Insurance: ${filters.insurance}`)
  if (filters.search)    parts.push(`Search: "${filters.search}"`)
  if (filters.initials)   parts.push(`Initials: ${filters.initials}`)
  return parts
}

export function buildZeroPaymentsWorkbook({ entries, locationLabel, filters }) {
  const headers = ['EOB Date', 'Location', 'Insurance', 'Match', 'Status', 'Initials', 'Notes']

  const rows = entries.map((e) => ([
    formatDate(e.eobDate),
    shortLoc(e.location),
    e.insuranceName || '',
    e.match || '',
    e.status || '',
    e.initials || '',
    e.notes || '',
  ]))

  const filterParts = describeFilters(filters)
  const unmatched = entries.filter((e) => !e.match || e.match === 'No').length

  const meta = [
    ['Zero Payments Export'],
    ['Generated', new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })],
    ['Location',  locationLabel],
    ['Entries',   entries.length],
    ['Unmatched', unmatched],
    ['Filters',   filterParts.length ? filterParts.join('  ·  ') : 'None'],
    [],
  ]

  const aoa = [...meta, headers, ...rows]
  const ws  = XLSX.utils.aoa_to_sheet(aoa)

  ws['!cols'] = [
    { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 9 }, { wch: 14 }, { wch: 9 }, { wch: 40 },
  ]

  const headerRowIdx = meta.length
  ws['!freeze'] = { xSplit: 0, ySplit: headerRowIdx + 1 }
  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range(
      { r: headerRowIdx, c: 0 },
      { r: aoa.length - 1, c: headers.length - 1 }
    ),
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Zero Payments')

  const stamp   = new Date().toISOString().slice(0, 10)
  const locPart = locationLabel.replace(/[^a-zA-Z0-9]+/g, '-')

  return { wb, filename: `ZeroPayments-${locPart}-${stamp}.xlsx` }
}

export function exportZeroPaymentsToExcel(opts) {
  const { wb, filename } = buildZeroPaymentsWorkbook(opts)
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
