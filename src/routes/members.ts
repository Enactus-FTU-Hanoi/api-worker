import { Hono } from 'hono'
import { Env } from '../index'
import { authMiddleware, adminMiddleware } from '../middleware/auth'

export const memberRoutes = new Hono<{ Bindings: Env }>()

// GET /members — admin only
memberRoutes.get('/', adminMiddleware, async (c) => {
  const { department, status, search } = c.req.query()
  let query = 'SELECT id, name, email, role, avatar_url, department, position, joined_at, status FROM members WHERE 1=1'
  const bindings: string[] = []

  if (department) { query += ' AND department = ?'; bindings.push(department) }
  if (status)     { query += ' AND status = ?';     bindings.push(status) }
  if (search)     { query += ' AND (name LIKE ? OR email LIKE ?)'; bindings.push(`%${search}%`, `%${search}%`) }

  query += ' ORDER BY joined_at DESC'
  const { results } = await c.env.DB.prepare(query).bind(...bindings).all()
  return c.json(results)
})

// GET /members/:id
memberRoutes.get('/:id', authMiddleware, async (c) => {
  const payload = c.get('jwtPayload' as never) as any
  const id = c.req.param('id')
  // Members can only view themselves; admins can view all
  if (payload.role === 'member' && payload.sub !== id) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const member = await c.env.DB.prepare(
    'SELECT id, name, email, role, avatar_url, department, position, phone, student_id, joined_at, status FROM members WHERE id = ?'
  ).bind(id).first()
  if (!member) return c.json({ error: 'Member not found' }, 404)
  return c.json(member)
})

// POST /members — admin only
memberRoutes.post('/', adminMiddleware, async (c) => {
  const body = await c.req.json()
  const { name, email, password, role = 'member', department, position, phone, student_id } = body

  if (!name || !email || !password) {
    return c.json({ error: 'name, email, password là bắt buộc' }, 400)
  }

  const exists = await c.env.DB.prepare('SELECT id FROM members WHERE email = ?').bind(email.toLowerCase()).first()
  if (exists) return c.json({ error: 'Email đã tồn tại' }, 409)

  // Hash password
  const encoder = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const saltB64 = btoa(String.fromCharCode(...salt))
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  )
  const hash = btoa(String.fromCharCode(...new Uint8Array(derivedBits)))
  const passwordHash = `${saltB64}:${hash}`

  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO members (id, name, email, password_hash, role, department, position, phone, student_id, joined_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'active')`
  ).bind(id, name, email.toLowerCase(), passwordHash, role, department || null, position || null, phone || null, student_id || null).run()

  return c.json({ id, name, email, role, department, position }, 201)
})

// PATCH /members/:id
memberRoutes.patch('/:id', authMiddleware, async (c) => {
  const payload = c.get('jwtPayload' as never) as any
  const id = c.req.param('id')
  if (payload.role === 'member' && payload.sub !== id) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = await c.req.json()
  const allowed = ['name', 'avatar_url', 'phone', 'department', 'position', 'status']
  // Only admins can change role/status/department
  const adminOnly = ['role', 'status', 'department']
  const fields = Object.keys(body).filter(k => {
    if (adminOnly.includes(k) && payload.role === 'member') return false
    return allowed.includes(k) || (payload.role !== 'member' && adminOnly.includes(k))
  })

  if (fields.length === 0) return c.json({ error: 'No valid fields to update' }, 400)

  const setClauses = fields.map(f => `${f} = ?`).join(', ')
  const values = fields.map(f => body[f])
  await c.env.DB.prepare(`UPDATE members SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...values, id).run()

  return c.json({ message: 'Updated' })
})

// DELETE /members/:id — admin only
memberRoutes.delete('/:id', adminMiddleware, async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare("UPDATE members SET status = 'inactive', updated_at = datetime('now') WHERE id = ?").bind(id).run()
  return c.json({ message: 'Deactivated' })
})
