import * as XLSX from 'xlsx'

function formatDate(val) {
  if (!val) return ''
  const [y, m, d] = val.split('-')
  return `${m}/${d}/${y}`
}

function describeFilters(f) {
  const parts = []
  if (f.q?.trim())    parts.push(`Search: "${f.q.trim()}"`)
  if (f.amount)       parts.push(`Amount: ${f.amount}`)
  if (f.from)         parts.push(`From: ${formatDate(f.from)}`)
  if (f.to)           parts.push(`To: ${formatDate(f.to)}`)
  if (f.insurance)    parts.push(`Insurance: ${f.insurance}`)
  if (f.bankAccount)  parts.push(`Bank Account: ${f.bankAccount}`)
  if (f.details)      parts.push(`Type: ${f.details}`)
  return parts
}

/** Export archive search results — every match, not just the visible page. */
export function exportArchiveToExcel({ rows, filters }) {
  const headers = ['Date', 'Details', 'Bank Account', 'Insurance', 'Amount', 'Description']
  const tableRows = rows.map((r) => [
    formatDate(r.postingDate),
    r.details || '',
    r.bankAccount || '',
    r.insuranceName || '',
    r.amount != null ? Number(r.amount) : '',
    r.description || '',
  ])
  const total = tableRows.reduce((s, r) => s + (typeof r[4] === 'number' ? r[4] : 0), 0)
  const filterParts = describeFilters(filters)

  const meta = [
    ['ACH Archive Export'],
    ['Generated', new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })],
    ['Payments',  rows.length],
    ['Total Amount', total],
    ['Filters',   filterParts.length ? filterParts.join('  ·  ') : 'None (entire archive)'],
    [],
  ]

  const aoa = [...meta, headers, ...tableRows]
  const ws  = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 12 }, { wch: 9 }, { wch: 14 }, { wch: 22 }, { wch: 13 }, { wch: 90 }]

  const headerRowIdx = meta.length
  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 4 })]
    if (cell && cell.t === 'n') cell.z = '$#,##0.00'
  }
  const totalCell = ws[XLSX.utils.encode_cell({ r: 3, c: 1 })]
  if (totalCell && totalCell.t === 'n') totalCell.z = '$#,##0.00'

  ws['!freeze'] = { xSplit: 0, ySplit: headerRowIdx + 1 }
  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range({ r: headerRowIdx, c: 0 }, { r: aoa.length - 1, c: headers.length - 1 }),
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Archive')

  const buf  = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `ACH-Archive-${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
