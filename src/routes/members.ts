import { Hono } from 'hono'
import { Env } from '../index'
import { authMiddleware, adminMiddleware, getPayload } from '../middleware/auth'

export const memberRoutes = new Hono<{ Bindings: Env }>()

// GET /members
memberRoutes.get('/', authMiddleware, async (c) => {
  const payload = getPayload(c)
  const { department, status, generation, search, role } = c.req.query()

  let query = `SELECT id, name, email, role, photo_url, department, position,
    generation, dob, phone, student_id, facebook_url, linkedin_url, bio,
    joined_at, status, updated_at FROM members WHERE 1=1`
  const bindings: string[] = []

  if (payload.role === 'member') {
    // Members chỉ xem được danh sách cơ bản
    query = `SELECT id, name, email, role, photo_url, department, position,
      generation, bio, joined_at, status FROM members WHERE status = 'ACTIVE'`
  } else {
    if (department) { query += ' AND department = ?'; bindings.push(department) }
    if (status)     { query += ' AND status = ?';     bindings.push(status) }
    if (generation) { query += ' AND generation = ?'; bindings.push(generation) }
    if (role)       { query += ' AND role = ?';       bindings.push(role) }
    if (search)     { query += ' AND (name LIKE ? OR email LIKE ? OR student_id LIKE ?)'; bindings.push(`%${search}%`, `%${search}%`, `%${search}%`) }
  }

  query += ' ORDER BY joined_at DESC'
  const { results } = await c.env.DB.prepare(query).bind(...bindings).all()
  return c.json(results)
})

// GET /members/stats — admin only
memberRoutes.get('/stats', adminMiddleware, async (c) => {
  const [total, active, alumni, byDept, byGen] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM members').first<{count:number}>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM members WHERE status = 'ACTIVE'").first<{count:number}>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM members WHERE status = 'ALUMNI'").first<{count:number}>(),
    c.env.DB.prepare('SELECT department, COUNT(*) as count FROM members WHERE status = "ACTIVE" GROUP BY department').all(),
    c.env.DB.prepare('SELECT generation, COUNT(*) as count FROM members GROUP BY generation ORDER BY generation DESC').all(),
  ])
  return c.json({
    total: total?.count || 0,
    active: active?.count || 0,
    alumni: alumni?.count || 0,
    byDepartment: byDept.results,
    byGeneration: byGen.results,
  })
})

// GET /members/:id
memberRoutes.get('/:id', authMiddleware, async (c) => {
  const payload = getPayload(c)
  const id = c.req.param('id')
  if (payload.role === 'member' && payload.sub !== id) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const member = await c.env.DB.prepare(
    `SELECT id, name, email, role, photo_url, department, position, generation,
     dob, phone, student_id, facebook_url, linkedin_url, bio, joined_at, status
     FROM members WHERE id = ?`
  ).bind(id).first()
  if (!member) return c.json({ error: 'Not found' }, 404)

  // Lấy badges
  const { results: badges } = await c.env.DB.prepare(
    `SELECT b.*, mb.awarded_at, mb.note FROM badges b
     JOIN member_badges mb ON b.id = mb.badge_id
     WHERE mb.member_id = ? ORDER BY mb.awarded_at DESC`
  ).bind(id).all()

  return c.json({ ...member, badges })
})

// POST /members — admin only
memberRoutes.post('/', adminMiddleware, async (c) => {
  const body = await c.req.json()
  const { name, email, password, role = 'member', department, position,
    phone, student_id, generation, dob, facebook_url, linkedin_url, bio } = body

  if (!name || !email || !password) return c.json({ error: 'Thiếu thông tin bắt buộc' }, 400)

  const exists = await c.env.DB.prepare('SELECT id FROM members WHERE email = ?').bind(email.toLowerCase()).first()
  if (exists) return c.json({ error: 'Email đã tồn tại' }, 409)

  const encoder = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const saltB64 = btoa(String.fromCharCode(...salt))
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const derivedBits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256)
  const hash = btoa(String.fromCharCode(...new Uint8Array(derivedBits)))
  const passwordHash = `${saltB64}:${hash}`

  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO members (id, name, email, password_hash, role, department, position,
     phone, student_id, generation, dob, facebook_url, linkedin_url, bio, joined_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'ACTIVE')`
  ).bind(id, name, email.toLowerCase(), passwordHash, role, department||null,
    position||null, phone||null, student_id||null, generation||null,
    dob||null, facebook_url||null, linkedin_url||null, bio||null).run()

  // Auto-award "Thành viên mới" badge
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO member_badges (id, member_id, badge_id, awarded_at)
     VALUES (?, ?, 'badge-001', datetime('now'))`
  ).bind(crypto.randomUUID(), id).run()

  return c.json({ id, name, email, role, department, generation }, 201)
})

// PATCH /members/:id
memberRoutes.patch('/:id', authMiddleware, async (c) => {
  const payload = getPayload(c)
  const id = c.req.param('id')
  const isAdmin = ['admin', 'super_admin'].includes(payload.role)
  if (!isAdmin && payload.sub !== id) return c.json({ error: 'Forbidden' }, 403)

  const body = await c.req.json()
  const memberFields = ['name', 'photo_url', 'phone', 'dob', 'facebook_url', 'linkedin_url', 'bio']
  const adminFields  = ['role', 'status', 'department', 'position', 'generation', 'student_id']

  const allowed = isAdmin ? [...memberFields, ...adminFields] : memberFields
  const fields = Object.keys(body).filter(k => allowed.includes(k))
  if (fields.length === 0) return c.json({ error: 'Không có field hợp lệ' }, 400)

  const setClauses = fields.map(f => `${f} = ?`).join(', ')
  await c.env.DB.prepare(
    `UPDATE members SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`
  ).bind(...fields.map(f => body[f]), id).run()

  return c.json({ message: 'Updated' })
})

// DELETE /members/:id — super_admin only
memberRoutes.delete('/:id', async (c) => {
  const payload = getPayload(c)
  if (payload.role !== 'super_admin') return c.json({ error: 'Forbidden' }, 403)
  await c.env.DB.prepare("UPDATE members SET status = 'INACTIVE', updated_at = datetime('now') WHERE id = ?")
    .bind(c.req.param('id')).run()
  return c.json({ message: 'Deactivated' })
})

// POST /members/:id/badges — admin only
memberRoutes.post('/:id/badges', adminMiddleware, async (c) => {
  const payload = getPayload(c)
  const { badge_id, note } = await c.req.json()
  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO member_badges (id, member_id, badge_id, awarded_by, note, awarded_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  ).bind(id, c.req.param('id'), badge_id, payload.sub, note||null).run()
  return c.json({ message: 'Badge awarded' }, 201)
})

