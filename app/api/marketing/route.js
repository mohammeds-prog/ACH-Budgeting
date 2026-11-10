import { NextResponse } from 'next/server'
import { refuseUnlessOwner } from '@/lib/serverAuth'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/marketing?months=2026-10[,2026-09…] — real ad spend per campaign.
//
// Meta: Marketing API insights for each ad account in META_AD_ACCOUNTS, using
// META_ACCESS_TOKEN (needs ads_read). Both live in .env.local / Vercel — the
// token never reaches the browser. Read only.
//
// META_AD_ACCOUNTS is a comma-separated list of "act_<id>:<brand>", where brand
// is the name the page matches against office names (Valley View Dental,
// Dentique, Alora Dental Spa).
//
// Google: Google Ads API (REST), using GOOGLE_ADS_DEVELOPER_TOKEN,
// GOOGLE_ADS_CLIENT_ID / _SECRET / _REFRESH_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID
// (the manager account) and GOOGLE_ADS_ACCOUNTS ("<10-digit id>:<brand>,…").
// GOOGLE_ADS_API_VERSION overrides the API version when Google retires one.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

const GRAPH = 'https://graph.facebook.com/v19.0'

function metaAccounts() {
  return (process.env.META_AD_ACCOUNTS || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const i = s.indexOf(':'); return { id: s.slice(0, i).trim(), brand: s.slice(i + 1).trim() } })
    .filter((a) => /^act_\d+$/.test(a.id) && a.brand)
}

function monthRange(period) {
  const [y, m] = period.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { since: `${period}-01`, until: `${period}-${String(last).padStart(2, '0')}` }
}

// Never echo the token back in an error message.
const clean = (msg) => String(msg || '').replace(/access_token=[^&\s]+/g, 'access_token=[hidden]')

async function metaSpend(period, token) {
  const rows = []
  const errors = []
  const range = encodeURIComponent(JSON.stringify(monthRange(period)))
  for (const acct of metaAccounts()) {
    let url = `${GRAPH}/${acct.id}/insights?level=campaign&fields=campaign_name,spend,actions&time_range=${range}&limit=200&access_token=${encodeURIComponent(token)}`
    while (url) {
      const json = await (await fetch(url, { cache: 'no-store' })).json()
      if (json.error) { errors.push(`${acct.brand}: ${clean(json.error.message)}`); break }
      for (const c of json.data || []) {
        const spend = Number(c.spend || 0)
        if (!spend) continue
        const leads = Number((c.actions || []).find((a) => a.action_type === 'lead')?.value || 0)
        rows.push({ period, platform: 'Meta', brand: acct.brand, campaign: c.campaign_name, spend, leads })
      }
      url = json.paging?.next || null
    }
  }
  return { rows, errors }
}

// ── Google Ads ─────────────────────────────────────────────────────────────
const GOOGLE_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v21'

function googleAccounts() {
  return (process.env.GOOGLE_ADS_ACCOUNTS || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const i = s.indexOf(':'); return { id: s.slice(0, i).replace(/\D/g, ''), brand: s.slice(i + 1).trim() } })
    .filter((a) => /^\d{10}$/.test(a.id) && a.brand)
}

function googleConfigured() {
  const e = process.env
  return !!(e.GOOGLE_ADS_DEVELOPER_TOKEN && e.GOOGLE_ADS_CLIENT_ID && e.GOOGLE_ADS_CLIENT_SECRET && e.GOOGLE_ADS_REFRESH_TOKEN && googleAccounts().length)
}

// A short-lived access token from the long-lived refresh token.
async function googleAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', { cache: 'no-store',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    }),
  })
  const json = await res.json()
  if (!json.access_token) throw new Error(`Google sign-in failed: ${json.error_description || json.error || res.status}`)
  return json.access_token
}

async function googleSpend(period, accessToken) {
  const rows = []
  const errors = []
  const { since, until } = monthRange(period)
  const query = `SELECT campaign.name, metrics.cost_micros, metrics.conversions FROM campaign
    WHERE segments.date BETWEEN '${since}' AND '${until}' AND metrics.cost_micros > 0`
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
    ...(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ? { 'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/\D/g, '') } : {}),
  }
  for (const acct of googleAccounts()) {
    let pageToken
    do {
      const res = await fetch(`https://googleads.googleapis.com/${GOOGLE_VERSION}/customers/${acct.id}/googleAds:search`, { cache: 'no-store',
        method: 'POST', headers, body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = json.error?.details?.[0]?.errors?.[0]?.message || json.error?.message || `HTTP ${res.status}`
        errors.push(`Google ${acct.brand}: ${detail}${res.status === 404 ? ` (API version ${GOOGLE_VERSION} may be retired — set GOOGLE_ADS_API_VERSION)` : ''}`)
        break
      }
      for (const r of json.results || []) {
        const spend = Number(r.metrics?.costMicros || 0) / 1e6
        if (!spend) continue
        rows.push({ period, platform: 'Google', brand: acct.brand, campaign: r.campaign?.name || 'Campaign', spend, leads: Math.round(Number(r.metrics?.conversions || 0)) })
      }
      pageToken = json.nextPageToken
    } while (pageToken)
  }
  return { rows, errors }
}

export async function GET(request) {
  try {
    const refused = await refuseUnlessOwner(request)
    if (refused) return refused

    const asked = [...new Set((new URL(request.url).searchParams.get('months') || '')
      .split(',').filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort()
    if (!asked.length) return NextResponse.json({ error: 'months=YYYY-MM is required' }, { status: 400 })
    // Meta keeps 37 months of insights; older months can only fail, so they
    // aren't asked for. The most recent 36 are fetched (newest first matters:
    // "All months" sends every month back to 2018).
    const now = new Date()
    const oldest = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 36, 1)).toISOString().slice(0, 7)
    const months = asked.filter((m) => m >= oldest).slice(-36)
    const skipped = asked.length - months.length

    const platforms = {}
    const rows = []
    const errors = []

    const token = process.env.META_ACCESS_TOKEN
    if (token && metaAccounts().length) {
      for (const p of months) {
        const r = await metaSpend(p, token)
        rows.push(...r.rows); errors.push(...r.errors)
      }
      platforms.meta = 'connected'
    } else {
      platforms.meta = 'not configured'
    }
    if (googleConfigured()) {
      try {
        const accessToken = await googleAccessToken()
        for (const p of months) {
          const r = await googleSpend(p, accessToken)
          rows.push(...r.rows); errors.push(...r.errors)
        }
        platforms.google = 'connected'
      } catch (e) {
        errors.push(e.message)
        platforms.google = 'error'
      }
    } else {
      platforms.google = 'not configured'
    }

    // The same message for every month and account is said once.
    return NextResponse.json({ months, skipped, platforms, rows, errors: [...new Set(errors)] })
  } catch (e) {
    return NextResponse.json({ error: clean(e?.message) || 'Server error' }, { status: 500 })
  }
}
