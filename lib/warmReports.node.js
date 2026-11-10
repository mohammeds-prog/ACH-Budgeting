import { warmReports as warmFolder } from '@/lib/reportsCache'
import { storedReports } from '@/lib/analysisStore'

// Server start-up only (see instrumentation.js): load the Analysis data from
// the database, and read this computer's reports folder when there is one.
// Never waits; never throws.
export function warmReports() {
  setTimeout(() => {
    storedReports().catch(() => {})
    warmFolder().catch(() => {})
  }, 0)
}
