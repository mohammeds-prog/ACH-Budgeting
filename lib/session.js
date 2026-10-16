// ─────────────────────────────────────────────────────────────────────────────
// Session lifetime rules.
//
// Supabase keeps a login in localStorage and refreshes it forever, so on its
// own a closed tab — or a shared front-desk computer — stays signed in
// indefinitely, and the next person inherits the account (and the Activity
// Log attributes their edits to the wrong name). Two rules end that:
//
//  1. Inactivity: 30 minutes without a click, key, scroll or touch signs the
//     user out, with a one-minute warning first. Activity is shared across
//     tabs, so working in one tab keeps the others alive.
//
//  2. Browser closed: every open tab writes a heartbeat. When the app next
//     loads, a heartbeat older than CLOSED_AFTER_MS means no tab was open, so
//     the browser was closed — sign out before showing anything.
//
// Why a heartbeat and not sessionStorage: sessionStorage is per-tab (opening a
// link in a new tab would demand a fresh login) and Chrome's "continue where
// you left off" restores it after a restart anyway.
//
// Why 3 minutes and not seconds: Chrome throttles timers in background tabs to
// about once a minute, so a tighter window would sign out people who still
// have the app open in another tab.
// ─────────────────────────────────────────────────────────────────────────────

export const IDLE_MS         = 30 * 60 * 1000
export const WARN_MS         = 60 * 1000
export const HEARTBEAT_MS    = 30 * 1000
export const CLOSED_AFTER_MS = 3 * 60 * 1000

const ACTIVITY_KEY  = 'ach-last-activity'
const HEARTBEAT_KEY = 'ach-heartbeat'
const REASON_KEY    = 'ach-signout-reason'

function read(key) {
  try { return Number(window.localStorage.getItem(key)) || 0 } catch { return 0 }
}
function write(key, value) {
  try { window.localStorage.setItem(key, String(value)) } catch {}
}

export function markActivity(now = Date.now())  { write(ACTIVITY_KEY, now) }
export function markHeartbeat(now = Date.now()) { write(HEARTBEAT_KEY, now) }
export function lastActivity()                  { return read(ACTIVITY_KEY) }

export function markSessionStart() {
  const now = Date.now()
  markActivity(now)
  markHeartbeat(now)
}

export function clearSessionMarks() {
  try {
    window.localStorage.removeItem(ACTIVITY_KEY)
    window.localStorage.removeItem(HEARTBEAT_KEY)
  } catch {}
}

/**
 * On app load: was this session abandoned? Returns 'closed', 'idle' or null.
 *
 * A session with no marks at all predates this feature — start tracking it
 * rather than signing out every existing user the moment it deploys.
 */
export function expiredWhileAway(now = Date.now()) {
  const hb  = read(HEARTBEAT_KEY)
  const act = read(ACTIVITY_KEY)
  if (!hb && !act) return null
  if (hb  && now - hb  > CLOSED_AFTER_MS) return 'closed'
  if (act && now - act > IDLE_MS)         return 'idle'
  return null
}

// The login page reads this once to explain why the user landed there.
// sessionStorage: it only needs to survive the redirect within this tab.
export function setSignoutReason(reason) {
  try { window.sessionStorage.setItem(REASON_KEY, reason) } catch {}
}
export function takeSignoutReason() {
  try {
    const r = window.sessionStorage.getItem(REASON_KEY)
    window.sessionStorage.removeItem(REASON_KEY)
    return r
  } catch {
    return null
  }
}
