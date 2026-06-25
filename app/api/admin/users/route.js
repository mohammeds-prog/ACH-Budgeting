import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function getCallerProfile(request) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return null
  const { data } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single()
  return data
}

function isAdminOrManagement(caller) {
  return caller?.role === 'admin' || caller?.role === 'management'
}

// POST /api/admin/users — create a new user + profile
export async function POST(request) {
  const caller = await getCallerProfile(request)
  if (!isAdminOrManagement(caller)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const VALID_ROLES = ['admin', 'management', 'user', 'viewer']
  const { email, full_name, password, role } = await request.json()
  if (!email || !password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 })
  }

  // Management cannot create admin users
  if (caller.role === 'management' && role === 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: full_name || '' },
  })

  if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

  const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
    id: user.id,
    email,
    full_name: full_name || null,
    role: VALID_ROLES.includes(role) ? role : 'viewer',
  })

  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 })

  return NextResponse.json({ success: true, userId: user.id })
}

// PUT /api/admin/users — update a user's profile (role, module toggles)
export async function PUT(request) {
  const caller = await getCallerProfile(request)
  if (!isAdminOrManagement(caller)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId, ...updates } = await request.json()
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  // Get target user's current role
  const { data: target } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).single()

  // Management cannot touch admin users
  if (caller.role === 'management' && target?.role === 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Management cannot assign admin role
  if (caller.role === 'management' && updates.role === 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const VALID_KEYS = ['role', 'can_view_ach', 'can_view_budgeting']
  const safeUpdates = Object.fromEntries(Object.entries(updates).filter(([k]) => VALID_KEYS.includes(k)))
  if (Object.keys(safeUpdates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('profiles').update(safeUpdates).eq('id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true })
}

// PATCH /api/admin/users — update a user's password
export async function PATCH(request) {
  const caller = await getCallerProfile(request)
  if (!isAdminOrManagement(caller)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId, password } = await request.json()
  if (!userId || !password) {
    return NextResponse.json({ error: 'userId and password are required' }, { status: 400 })
  }

  // Management cannot change admin password
  if (caller.role === 'management') {
    const { data: target } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).single()
    if (target?.role === 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true })
}

// DELETE /api/admin/users — delete a user and their profile
export async function DELETE(request) {
  const caller = await getCallerProfile(request)
  if (!isAdminOrManagement(caller)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await request.json()
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  // Management cannot delete admin users
  if (caller.role === 'management') {
    const { data: target } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).single()
    if (target?.role === 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true })
}
