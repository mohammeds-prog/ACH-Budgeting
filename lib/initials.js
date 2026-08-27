// One definition of a person's initials, used everywhere the app stamps or
// pre-fills them — so the same user always gets the same initials on every
// page. Previously three copies disagreed on three-word names (e.g. "JS" vs
// "MJW" logic living side by side), which broke "who last touched this".
//
// Rule: first letter of each name word, capped at three. Falls back to the
// email local-part when there is no name on the profile.
export function deriveInitials(profile) {
  const name = (profile?.full_name || '').trim()
  if (name) {
    return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase()
  }
  const email = (profile?.email || '').split('@')[0]
  return email.slice(0, 2).toUpperCase()
}
