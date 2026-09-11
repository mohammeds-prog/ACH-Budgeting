export const LOCATIONS = [
  'Valley View Dental Romeoville',
  'Valley View Dental Naperville',
  'Valley View Dental Montgomery',
  'Alora',
  'Dentique',
]

export const ACH_STATUSES = ['Not Posted', 'In Progress', 'Posted']

// ── Hygiene utilization ─────────────────────────────────────────────────────
// Hygiene tracks Dentique as two separate offices. This list is deliberately
// NOT the shared LOCATIONS constant: ACH, Zero Payments and Expenditure all
// hold existing rows against the single "Dentique", and splitting it there
// would orphan them.
export const HYGIENE_LOCATIONS = [
  'Valley View Dental Romeoville',
  'Valley View Dental Naperville',
  'Valley View Dental Montgomery',
  'Alora',
  'Dentique Downers Grove',
  'Dentique Lemont',
]

// Display name. Only the "Valley View Dental" brand is dropped — every clinic
// under it is uniquely identified by its town. The Dentique offices keep their
// full names ("Dentique Downers Grove", "Dentique Lemont") because the brand is
// part of how they are referred to.
export function shortLocation(l) {
  return (l || '').replace(/^Valley View Dental /, '')
}

// Shift windows offered in the Hours dropdown. Add to this list as schedules
// change — it is the only place the options are defined.
export const HYGIENE_HOURS = [
  '7:00 AM - 3:00 PM',
  '7:00 AM - 4:00 PM',
  '8:00 AM - 1:00 PM',
  '8:00 AM - 2:00 PM',
  '8:00 AM - 4:00 PM',
  '8:00 AM - 5:00 PM',
  '9:00 AM - 5:00 PM',
  '9:00 AM - 6:00 PM',
  '10:00 AM - 6:00 PM',
  '10:00 AM - 7:00 PM',
]

// ISO day numbers: 1 = Monday … 7 = Sunday. The database generates day_num from
// work_date, so this is only ever used to render a label.
export const DAY_LABELS = {
  1: 'Monday', 2: 'Tuesday', 3: 'Wednesday',
  4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday',
}

// The clinic operates Monday-Saturday; Sunday is offered in filters only so an
// accidentally-dated row stays visible rather than silently disappearing.
export const HYGIENE_DAYS = [1, 2, 3, 4, 5, 6]
