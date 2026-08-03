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
  if (!m) return ''
  const n = Number(m)
  return !isNaN(n) && n >= 1 && n <= 12 ? MONTH_NAMES[n - 1] : String(m)
}

// Human-readable list of every filter currently narrowing the view.
function describeFilters(filters) {
  const parts = []
  if (filters.month)      parts.push(`Month: ${monthLabel(filters.month)}`)
  if (filters.year)       parts.push(`Year: ${filters.year}`)
  if (filters.from)       parts.push(`From: ${formatDate(filters.from)}`)
  if (filters.to)         parts.push(`To: ${formatDate(filters.to)}`)
  if (filters.match)      parts.push(`Match: ${filters.match}`)
  if (filters.status)     parts.push(`Status: ${filters.status}`)
  if (filters.insurance)  parts.push(`Insurance: ${filters.insurance}`)
  if (filters.search)     parts.push(`Search: "${filters.search}"`)
  if (filters.receivedBy?.length) parts.push(`Received By: ${filters.receivedBy.map(shortLoc).join(', ')}`)
  if (filters.belongsTo?.length)  parts.push(`Belongs To: ${filters.belongsTo.map(shortLoc).join(', ')}`)
  return parts
}

/**
 * Export the currently visible ACH entries to an .xlsx file.
 *
 * @param {object}   opts
 * @param {Array}    opts.entries          the filtered entry set (all pages, not just the current one)
 * @param {string}   opts.locationLabel    e.g. "All Locations" or "Romeoville"
 * @param {boolean}  opts.isSpecificLocation  true when a single location tab is active
 * @param {string}   opts.currentLocation  the full location name when a tab is active
 * @param {object}   opts.filters          the filters state object
 * @param {boolean}  opts.showTCView       true when viewing Transfer Complete entries
 */
export function buildAchWorkbook({
  entries,
  locationLabel,
  isSpecificLocation,
  currentLocation,
  filters,
  showTCView,
}) {
  const headers = [
    'Date', 'Details', 'Bank Account', 'Description', 'Insurance Name',
    'Amount', 'Received By', 'Belongs To', 'Match', 'Status', 'Initials', 'Notes',
  ]
  if (showTCView) headers.push('Transfer Complete', 'Transfer Initials')

  const rows = entries.map((e) => {
    const hasSplits = e.splits?.length > 0

    // Mirror what the table shows: on a location tab a split entry shows only that
    // location's share, everywhere else it shows the full amount.
    const amount = isSpecificLocation && hasSplits
      ? (e.splits.find((s) => s.location === currentLocation)?.amount ?? e.amount)
      : e.amount

    const match = isSpecificLocation && hasSplits
      ? (e.splits.find((s) => s.location === currentLocation)?.match || 'No')
      : (e.match || '')

    let belongsTo
    if (hasSplits) {
      belongsTo = e.splits
        .map((s) => `${shortLoc(s.location) || '—'}: ${Number(s.amount || 0).toFixed(2)}`)
        .join(' | ')
    } else if (e.splits) {
      belongsTo = 'Split · pending'
    } else {
      belongsTo = shortLoc(e.location)
    }

    const row = [
      formatDate(e.postingDate),
      e.details || '',
      e.bankAccount || '',
      e.description || '',
      e.insuranceName || '',
      amount != null && amount !== '' ? Number(amount) : '',
      shortLoc(e.fromLocation),
      belongsTo,
      match,
      e.status || '',
      e.initials || '',
      e.notes || '',
    ]
    if (showTCView) row.push(e.transferComplete ? 'Yes' : 'No', e.transferInitials || '')
    return row
  })

  const totalAmount = rows.reduce((sum, r) => sum + (typeof r[5] === 'number' ? r[5] : 0), 0)
  const filterParts = describeFilters(filters)

  // Metadata block, then a blank spacer, then the table itself.
  const meta = [
    ['ACH Export'],
    ['Generated',  new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })],
    ['Location',   locationLabel],
    ['View',       showTCView ? 'Transfer Complete' : 'Active Entries'],
    ['Entries',    entries.length],
    ['Total Amount', totalAmount],
    ['Filters',    filterParts.length ? filterParts.join('  ·  ') : 'None'],
    [],
  ]

  const aoa = [...meta, headers, ...rows]
  const ws  = XLSX.utils.aoa_to_sheet(aoa)

  ws['!cols'] = [
    { wch: 12 }, { wch: 9 },  { wch: 16 }, { wch: 46 }, { wch: 20 },
    { wch: 13 }, { wch: 14 }, { wch: 26 }, { wch: 9 },  { wch: 14 },
    { wch: 9 },  { wch: 30 },
    ...(showTCView ? [{ wch: 16 }, { wch: 15 }] : []),
  ]

  // Currency format on the Amount column and on the Total Amount meta cell
  const headerRowIdx = meta.length // 0-based row index of the header row
  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 5 })]
    if (cell && cell.t === 'n') cell.z = '$#,##0.00'
  }
  const totalCell = ws[XLSX.utils.encode_cell({ r: 5, c: 1 })]
  if (totalCell && totalCell.t === 'n') totalCell.z = '$#,##0.00'

  // Freeze everything above and including the header row
  ws['!freeze'] = { xSplit: 0, ySplit: headerRowIdx + 1 }
  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range(
      { r: headerRowIdx, c: 0 },
      { r: aoa.length - 1, c: headers.length - 1 }
    ),
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'ACH')

  const stamp    = new Date().toISOString().slice(0, 10)
  const locPart  = locationLabel.replace(/[^a-zA-Z0-9]+/g, '-')
  const viewPart = showTCView ? '-TransferComplete' : ''

  return { wb, filename: `ACH-${locPart}${viewPart}-${stamp}.xlsx` }
}

export function exportAchToExcel(opts) {
  const { wb, filename } = buildAchWorkbook(opts)
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
