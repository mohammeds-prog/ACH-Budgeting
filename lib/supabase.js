import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Browser fetch() has NO default timeout. A stalled request — a flaky network,
// a Supabase hiccup, a sleeping laptop waking up mid-flight — hangs forever.
// That is what made the auth token refresh inside getSession() never resolve,
// leaving the app on its loading spinner until the user hit refresh.
//
// Every Supabase request now aborts after REQUEST_TIMEOUT_MS and rejects, so
// callers get an error they can handle instead of waiting indefinitely.
const REQUEST_TIMEOUT_MS = 10_000

function fetchWithTimeout(input, init = {}) {
  // No AbortController (very old browser / SSR shim) — fall through unchanged.
  if (typeof AbortController === 'undefined') return fetch(input, init)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  // Respect a signal the caller already passed rather than discarding it.
  let signal = controller.signal
  if (init.signal) {
    if (typeof AbortSignal !== 'undefined' && AbortSignal.any) {
      signal = AbortSignal.any([init.signal, controller.signal])
    } else {
      init.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
  }

  return fetch(input, { ...init, signal }).finally(() => clearTimeout(timer))
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
})
