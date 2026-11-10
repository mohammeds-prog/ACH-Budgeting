// ─────────────────────────────────────────────────────────────────────────────
// Which numbers in an assistant answer are not in the data it used.
//
// Every number the tools returned is collected. A number in the answer passes
// if it matches one of them (allowing for rounding and "$1.28M" / "37.6 %"
// styles), or is a sum or difference of two of them. Small counts (< 10),
// years and dates are not checked. Used on the server (to send an answer
// back for correction) — the same rules as the chat panel's underlines.
// ─────────────────────────────────────────────────────────────────────────────

export function numberPool(sources) {
  const out = []
  const walk = (v) => {
    if (typeof v === 'number' && isFinite(v)) out.push(v)
    else if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) out.push(Number(v))
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  for (const x of sources || []) walk(x.data)
  return out
}

const NUM_RE = /(\d{4}-\d{2}(?:-\d{2})?)|(\$?\s?(?:\d{1,3}(?:[,    ]\d{3})+|\d+)(?:\.\d+)?(?:\s?(?:k|K|M|million|thousand)\b)?\s?%?)/g

function parseNum(t) {
  const pct = /%$/.test(t)
  let v = Number(t.replace(/[$,%\s   ]|million|thousand|k|K|M/g, ''))
  if (/M\b|million/.test(t)) v *= 1e6
  else if (/k\b|K\b|thousand/.test(t)) v *= 1e3
  return { v, pct }
}

function known(t, pool, big) {
  const { v, pct } = parseNum(t)
  if (!isFinite(v)) return true
  if (!pct && (v < 10 || (!t.startsWith('$') && v >= 1990 && v <= 2040 && !t.includes(',')))) return true
  const rounded = /k|K|M|million|thousand/.test(t) || (!t.includes('.') && pct)
  const tol = Math.max(rounded ? Math.abs(v) * 0.006 : 0.6, 0.6)
  if (pool.some((p) => Math.abs(p - v) <= tol || (pct && Math.abs(p * 100 - v) <= 0.6))) return true
  if (!pct && v >= 100) {
    for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) {
      if (Math.abs(big[i] + big[j] - v) <= tol + 1 || Math.abs(Math.abs(big[i] - big[j]) - v) <= tol + 1) return true
    }
  }
  if (pct || (v > 0 && v <= 100 && t.includes('.'))) {
    // A worked-out percentage: a share (a ÷ b), a change (a vs b), or the gap
    // between two percentages in the data.
    const ptol = t.includes('.') ? 0.06 + 0.05 : 0.6
    for (let i = 0; i < big.length; i++) for (let j = 0; j < big.length; j++) {
      if (i === j || !big[j]) continue
      const r = (big[i] / big[j]) * 100
      if (Math.abs(r - v) <= ptol || Math.abs(Math.abs(r - 100) - v) <= ptol) return true
    }
    const small = pool.filter((p) => Math.abs(p) <= 100)
    for (let i = 0; i < small.length && i < 400; i++) for (let j = i + 1; j < small.length && j < 400; j++) {
      if (Math.abs(Math.abs(small[i] - small[j]) - v) <= ptol) return true
    }
  }
  return false
}

/** A checker for one answer's sources: (number as written) => backed? */
export function makeChecker(sources) {
  const pool = numberPool(sources)
  const big = [...new Set(pool.filter((p) => Math.abs(p) >= 100).map((p) => Math.round(p)))].slice(0, 300)
  return (t) => !pool.length || known(String(t).trim(), pool, big)
}
export { NUM_RE }

/** The numbers (as written) in `text` that the data doesn't back. */
export function unverifiedNumbers(text, sources) {
  const pool = numberPool(sources)
  if (!pool.length) return []
  const big = [...new Set(pool.filter((p) => Math.abs(p) >= 100).map((p) => Math.round(p)))].slice(0, 300)
  const plain = String(text || '').replace(/\[\d+(?:\s*,\s*\d+)*\]/g, '')
  const bad = []
  const seen = []          // backed money figures so far, in order (for totals)
  for (const m of plain.matchAll(NUM_RE)) {
    if (m[1]) continue
    const t = m[0].trim()
    const after = plain.slice(m.index + m[0].length, m.index + m[0].length + 8)
    const before = plain.slice(Math.max(0, m.index - 2), m.index)
    // Labels, not figures: "120 days", "6 months", "120+", "91-120".
    if (/^\s?(?:days?\b|months?\b|years?\b|\+|-\s?\d|\u2013\s?\d)/i.test(after) || /\d[-\u2013]\s?$/.test(before)) continue
    const { v, pct } = parseNum(t)
    if (known(t, pool, big)) { if (!pct && v >= 100) seen.push(v); continue }
    // A total of figures listed just before it (a table's Total row).
    let isTotal = false
    if (!pct && v >= 100) {
      const tol = Math.max(Math.abs(v) * 0.006, 2)
      for (let i = 0; i < seen.length && !isTotal; i++) {
        let sum = 0
        for (let j = i; j < seen.length; j++) { sum += seen[j]; if (j > i && Math.abs(sum - v) <= tol) { isTotal = true; break } }
      }
    }
    if (isTotal) { seen.push(v); continue }
    bad.push(t)
  }
  return [...new Set(bad)]
}
