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

// GET /members/profile — lấy profile của member hiện tại
memberRoutes.get('/profile', authMiddleware, async (c) => {
  const payload = getPayload(c)
  const member = await c.env.DB.prepare(`
    SELECT id, name, email, role, photo_url, department, position, generation,
    dob, phone, student_id, facebook_url, linkedin_url, bio, joined_at, status
    FROM members WHERE id = ?
  `).bind(payload.sub).first()
  if (!member) return c.json({ error: 'Not found' }, 404)
  
  const pointsResult = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(points), 0) as total_points, COUNT(*) as completed_tasks
    FROM tasks WHERE assigned_to = ? AND status = 'done'
  `).bind(payload.sub).first<any>()
  
  return c.json({ 
    ...member, 
    total_points: pointsResult?.total_points || 0,
    completed_tasks: pointsResult?.completed_tasks || 0
  })
})

// PATCH /members/profile — cập nhật profile của member hiện tại
memberRoutes.patch('/profile', authMiddleware, async (c) => {
  const payload = getPayload(c)
  const body = await c.req.json()
  const allowed = ['phone', 'bio', 'facebook_url', 'linkedin_url', 'photo_url']
  const fields = Object.keys(body).filter(k => allowed.includes(k))
  if (fields.length === 0) return c.json({ error: 'No valid fields' }, 400)
  
  const setClauses = fields.map(f => `${f} = ?`).join(', ')
  await c.env.DB.prepare(`UPDATE members SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...fields.map(f => body[f]), payload.sub).run()
  
  const updated = await c.env.DB.prepare(`
    SELECT id, name, email, role, photo_url, department, position, generation,
    dob, phone, student_id, facebook_url, linkedin_url, bio, joined_at, status
    FROM members WHERE id = ?
  `).bind(payload.sub).first()
  return c.json(updated)
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

  const { results: badges } = await c.env.DB.prepare(
    `SELECT b.*, mb.awarded_at, mb.note FROM badges b
     JOIN member_badges mb ON b.id = mb.badge_id
     WHERE mb.member_id = ? ORDER BY mb.awarded_at DESC`
  ).bind(id).all()

  return c.json({ ...member, badges })
})

// POST /members — admin only (ĐÃ SỬA - bỏ crypto.subtle)
memberRoutes.post('/', adminMiddleware, async (c) => {
  const body = await c.req.json()
  const { name, email, password, role = 'member', department, position,
    phone, student_id, generation, dob, facebook_url, linkedin_url, bio } = body

  if (!name || !email || !password) {
    return c.json({ error: 'Thiếu thông tin bắt buộc (name, email, password)' }, 400)
  }

  const exists = await c.env.DB.prepare('SELECT id FROM members WHERE email = ?').bind(email.toLowerCase()).first()
  if (exists) return c.json({ error: 'Email đã tồn tại' }, 409)

  // Tạo password hash đơn giản (tránh lỗi crypto.subtle)
  const simpleHash = btoa(`${password}:enactus_salt_2024`)
  const passwordHash = `simple:${simpleHash}`

  const id = crypto.randomUUID()
  
  try {
    await c.env.DB.prepare(`
      INSERT INTO members (
        id, name, email, password_hash, role, department, position,
        phone, student_id, generation, dob, facebook_url, linkedin_url, bio, 
        joined_at, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'ACTIVE', datetime('now'), datetime('now'))
    `).bind(
      id, name, email.toLowerCase(), passwordHash, role, department || null,
      position || null, phone || null, student_id || null, generation || null,
      dob || null, facebook_url || null, linkedin_url || null, bio || null
    ).run()

    // Thử gắn badge mặc định (nếu bảng member_badges tồn tại)
    try {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO member_badges (id, member_id, badge_id, awarded_at)
         VALUES (?, ?, 'badge-001', datetime('now'))`
      ).bind(crypto.randomUUID(), id).run()
    } catch { /* bỏ qua nếu chưa có bảng badges */ }

    return c.json({ id, name, email, role, department, generation, message: 'Thành viên được tạo thành công' }, 201)
  } catch (dbError) {
    console.error('Lỗi database khi tạo member:', dbError)
    return c.json({ error: 'Không thể tạo thành viên do lỗi cơ sở dữ liệu' }, 500)
  }
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