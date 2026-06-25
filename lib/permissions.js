export const ROLES = [
  { value: 'admin',      label: 'Admin/Owner', color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20' },
  { value: 'management', label: 'Management',  color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/20' },
  { value: 'user',       label: 'User',        color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20' },
  { value: 'viewer',     label: 'Viewer',      color: 'text-slate-400',  bg: 'bg-slate-500/10 border-slate-500/20' },
]

const ROLE_PERMISSIONS = {
  admin: [
    'admin_panel',
    'view_ach', 'ach_add', 'ach_delete', 'ach_import', 'ach_edit_full', 'ach_edit_match', 'ach_transfer_complete',
    'view_budget', 'budget_add', 'budget_edit', 'budget_delete', 'budget_import', 'set_collections',
  ],
  management: [
    'admin_panel',
    'view_ach', 'ach_edit_match',
    'view_budget', 'budget_add', 'budget_edit', 'budget_delete', 'budget_import', 'set_collections',
  ],
  user: [
    'view_ach', 'ach_edit_match',
    'view_budget', 'budget_add', 'budget_edit', 'budget_delete', 'budget_import', 'set_collections',
  ],
  viewer: [
    'view_ach',
    'view_budget',
  ],
}

export function can(profile, action) {
  const role = profile?.role || 'viewer'
  return ROLE_PERMISSIONS[role]?.includes(action) ?? false
}

export function getRoleInfo(role) {
  return ROLES.find((r) => r.value === role) || ROLES[3]
}
