import crypto from 'crypto'

// ─────────────────────────────────────────────────────────────────────────────
// Server only. Reads one tab of a private Google Sheet as CSV text. No Google
// libraries. Two ways to sign in, the first one set up wins:
//
//   1. A Google user's OAuth sign-in — the same as TuskPortal: reads any sheet
//      that user can open.
//        GOOGLE_SHEETS_CLIENT_ID, GOOGLE_SHEETS_CLIENT_SECRET, GOOGLE_SHEETS_REFRESH_TOKEN
//   2. A service account with "Viewer" access to the sheet.
//        GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY (line breaks written as \n)
// ─────────────────────────────────────────────────────────────────────────────

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
let token = null   // { value, exp }

const OAUTH = ['GOOGLE_SHEETS_CLIENT_ID', 'GOOGLE_SHEETS_CLIENT_SECRET', 'GOOGLE_SHEETS_REFRESH_TOKEN']
const SA = ['GOOGLE_SA_EMAIL', 'GOOGLE_SA_PRIVATE_KEY']
const has = (keys) => keys.every((k) => process.env[k])

/** Which way is set up: 'oauth', 'service-account' or null. */
export function sheetAuthMode() {
  return has(OAUTH) ? 'oauth' : has(SA) ? 'service-account' : null
}

/** The settings still missing (empty when either sign-in is set up). */
export function sheetAccessMissing() {
  return sheetAuthMode() ? [] : OAUTH
}
// Older name, kept for callers.
export const serviceAccountMissing = sheetAccessMissing

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64')
  .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

async function accessToken() {
  if (token && token.exp > Date.now() + 60_000) return token.value
  let body
  if (sheetAuthMode() === 'oauth') {
    body = new URLSearchParams({
      client_id: process.env.GOOGLE_SHEETS_CLIENT_ID,
      client_secret: process.env.GOOGLE_SHEETS_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_SHEETS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    })
  } else {
    const now = Math.floor(Date.now() / 1000)
    const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
      iss: process.env.GOOGLE_SA_EMAIL, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    })}`
    const key = process.env.GOOGLE_SA_PRIVATE_KEY.replace(/\\n/g, '\n')
    const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(key, 'base64')
      .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` })
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.access_token) throw new Error(`Google sign-in failed: ${json.error_description || json.error || res.status}`)
  token = { value: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 }
  return token.value
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`

/** The tab with this gid (the number after #gid= in the sheet's address), as CSV text. */
export async function readSheetTabCsv(sheetId, gid) {
  const auth = { Authorization: `Bearer ${await accessToken()}` }
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`
  const meta = await fetch(`${base}?fields=sheets.properties(sheetId,title)`, { headers: auth })
  const mj = await meta.json().catch(() => ({}))
  if (!meta.ok) {
    throw new Error(meta.status === 403 || meta.status === 404
      ? (sheetAuthMode() === 'oauth'
        ? 'The Google account signed in for Sheets can’t open this sheet — share it with that account.'
        : `The service account can't open the sheet — share it with ${process.env.GOOGLE_SA_EMAIL} as Viewer.`)
      : `Google Sheets: ${mj.error?.message || meta.status}`)
  }
  const tab = (mj.sheets || []).find((s) => String(s.properties.sheetId) === String(gid)) || mj.sheets?.[0]
  if (!tab) throw new Error('The sheet has no tabs.')
  const res = await fetch(`${base}/values/${encodeURIComponent(`'${tab.properties.title}'`)}?valueRenderOption=FORMATTED_VALUE`, { headers: auth })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Google Sheets: ${json.error?.message || res.status}`)
  return { title: tab.properties.title, csv: (json.values || []).map((r) => r.map(csvCell).join(',')).join('\n') }
}
