// PostgREST caps every response at 1000 rows (Supabase's `db-max-rows`) and it
// does so SILENTLY — an unbounded `.select()` returns a truncated slice with no
// error and no warning, so callers quietly lose data. This surfaced as an
// attachment badge that never appeared: the counts query read the first 1000
// attachment rows and dropped everything newer.
//
// Page through explicitly so callers always get the complete set.
//
// `build` must return a NEW query builder on every call — a PostgREST builder
// is a one-shot thenable and cannot be re-executed.
//
// Always give the query a deterministic order (ideally ending in a unique
// column such as id). Paginating an unordered query lets Postgres return rows
// in a different order per page, which silently skips and duplicates rows.
export const PAGE_ROWS = 1000

export async function fetchAllRows(build) {
  const rows = []
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await build().range(from, from + PAGE_ROWS - 1)
    if (error) throw error
    rows.push(...(data || []))
    // A short page (or an empty one past the end) means we've read everything.
    if (!data || data.length < PAGE_ROWS) return rows
  }
}
