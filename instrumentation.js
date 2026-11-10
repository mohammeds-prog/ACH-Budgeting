// Runs once when the server starts. Reads the Dentrix reports in the
// background so the first person to open Analysis doesn't wait for the
// schedule export to be parsed. Next.js builds this file for the edge
// runtime too, which has no file system: the import sits inside the
// NEXT_RUNTIME check so it is left out of that build entirely.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { warmReports } = await import('./lib/warmReports.node')
    warmReports()
  }
}
