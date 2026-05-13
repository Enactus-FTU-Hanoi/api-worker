import { Hono } from 'hono'
import { Env } from '../index'
import { createTokens, verifyJWT, authMiddleware } from '../middleware/auth'

export const authRoutes = new Hono<{ Bindings: Env }>()

// POST /auth/login
authRoutes.post('/login', async (c) => {
  const { email, password } = await c.req.json()
  if (!email || !password) {
    return c.json({ error: 'Email và mật khẩu là bắt buộc' }, 400)
  }

  const member = await c.env.DB.prepare(
    'SELECT id, name, email, password_hash, role, status FROM members WHERE email = ?'
  ).bind(email.toLowerCase()).first<{
    id: string; name: string; email: string
    password_hash: string; role: string; status: string
  }>()

  if (!member || member.status === 'inactive') {
    return c.json({ error: 'Email hoặc mật khẩu không đúng' }, 401)
  }

  // Verify password using PBKDF2
  const encoder = new TextEncoder()
  const [salt, storedHash] = member.password_hash.split(':')
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: Uint8Array.from(atob(salt), c => c.charCodeAt(0)), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  )
  const hash = btoa(String.fromCharCode(...new Uint8Array(derivedBits)))

  if (hash !== storedHash) {
    return c.json({ error: 'Email hoặc mật khẩu không đúng' }, 401)
  }

  const [accessToken, refreshToken] = await createTokens(
    { sub: member.id, role: member.role as any, name: member.name },
    c.env.JWT_SECRET
  )

  // Store refresh token in KV (TTL 7 days)
  await c.env.KV.put(`refresh:${member.id}:${refreshToken.slice(-16)}`, refreshToken, { expirationTtl: 604800 })

  return c.json({
    accessToken,
    refreshToken,
    member: { id: member.id, name: member.name, email: member.email, role: member.role }
  })
})

// POST /auth/register
authRoutes.post('/register', async (c) => {
  const { email, password, name, role = 'member', department, position, phone, student_id } = await c.req.json()
  if (!email || !password || !name) {
    return c.json({ error: 'name, email, password là bắt buộc' }, 400)
  }

  const allowedRoles = ['member', 'admin', 'super_admin']
  if (!allowedRoles.includes(role)) {
    return c.json({ error: 'Role không hợp lệ' }, 400)
  }

  const existing = await c.env.DB.prepare('SELECT id FROM members WHERE email = ?').bind(email.toLowerCase()).first()
  if (existing) {
    return c.json({ error: 'Email đã tồn tại' }, 409)
  }

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

  return c.json({ id, name, email: email.toLowerCase(), role }, 201)
})

// POST /auth/refresh
authRoutes.post('/refresh', async (c) => {
  const { refreshToken } = await c.req.json()
  if (!refreshToken) return c.json({ error: 'Refresh token required' }, 400)

  const payload = await verifyJWT(refreshToken, c.env.JWT_SECRET)
  if (!payload) return c.json({ error: 'Invalid refresh token' }, 401)

  const stored = await c.env.KV.get(`refresh:${payload.sub}:${refreshToken.slice(-16)}`)
  if (!stored) return c.json({ error: 'Refresh token revoked' }, 401)

  const [newAccessToken, newRefreshToken] = await createTokens(
    { sub: payload.sub, role: payload.role, name: payload.name },
    c.env.JWT_SECRET
  )

  await c.env.KV.delete(`refresh:${payload.sub}:${refreshToken.slice(-16)}`)
  await c.env.KV.put(`refresh:${payload.sub}:${newRefreshToken.slice(-16)}`, newRefreshToken, { expirationTtl: 604800 })

  return c.json({ accessToken: newAccessToken, refreshToken: newRefreshToken })
})

// POST /auth/logout
authRoutes.post('/logout', authMiddleware, async (c) => {
  const { refreshToken } = await c.req.json()
  const payload = c.get('jwtPayload' as never) as any
  if (refreshToken) {
    await c.env.KV.delete(`refresh:${payload.sub}:${refreshToken.slice(-16)}`)
  }
  return c.json({ message: 'Logged out' })
})

// GET /auth/me
authRoutes.get('/me', authMiddleware, async (c) => {
  const payload = c.get('jwtPayload' as never) as any
  const member = await c.env.DB.prepare(
    'SELECT id, name, email, role, avatar_url, department, position, joined_at, status FROM members WHERE id = ?'
  ).bind(payload.sub).first()
  if (!member) return c.json({ error: 'Member not found' }, 404)
  return c.json(member)
})
