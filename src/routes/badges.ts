import { Hono } from 'hono'
import { Env } from '../index'
import { authMiddleware, adminMiddleware, getPayload } from '../middleware/auth'

export const badgeRoutes = new Hono<{ Bindings: Env }>()

// GET /badges — lấy danh sách badges
badgeRoutes.get('/', authMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM badges ORDER BY created_at DESC'
  ).all()
  return c.json(results.map(b => ({
    ...b,
    criteria: b.criteria ? JSON.parse(b.criteria as string) : null
  })))
})

// GET /badges/my — lấy badges của member hiện tại
badgeRoutes.get('/my', authMiddleware, async (c) => {
  const payload = getPayload(c)
  const { results } = await c.env.DB.prepare(`
    SELECT b.*, mb.awarded_at, mb.note 
    FROM badges b
    JOIN member_badges mb ON b.id = mb.badge_id
    WHERE mb.member_id = ?
    ORDER BY mb.awarded_at DESC
  `).bind(payload.sub).all()
  return c.json(results)
})

// GET /badges/:id
badgeRoutes.get('/:id', authMiddleware, async (c) => {
  const badge = await c.env.DB.prepare('SELECT * FROM badges WHERE id = ?').bind(c.req.param('id')).first<any>()
  if (!badge) return c.json({ error: 'Not found' }, 404)
  if (badge.criteria) badge.criteria = JSON.parse(badge.criteria)
  return c.json(badge)
})

// POST /badges — admin only
badgeRoutes.post('/', adminMiddleware, async (c) => {
  const { name, description, icon, color = '#FFC107', criteria } = await c.req.json()
  if (!name || !icon) return c.json({ error: 'Thiếu thông tin bắt buộc' }, 400)

  const id = `badge-${Date.now()}`
  await c.env.DB.prepare(
    `INSERT INTO badges (id, name, description, icon, color, criteria, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(id, name, description||null, icon, color, criteria ? JSON.stringify(criteria) : null).run()

  return c.json({ id, name, icon }, 201)
})

// POST /badges/:id/award — admin award badge (format frontend mong đợi)
badgeRoutes.post('/:id/award', adminMiddleware, async (c) => {
  const payload = getPayload(c)
  const badgeId = c.req.param('id')
  const { member_id, note } = await c.req.json()
  
  if (!member_id) return c.json({ error: 'Thiếu member_id' }, 400)

  const id = crypto.randomUUID()
  try {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO member_badges (id, member_id, badge_id, awarded_by, note, awarded_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).bind(id, member_id, badgeId, payload.sub, note || null).run()
    return c.json({ success: true, message: 'Badge awarded' }, 201)
  } catch (e) {
    return c.json({ error: 'Failed to award badge' }, 400)
  }
})

// PATCH /badges/:id — admin only
badgeRoutes.patch('/:id', adminMiddleware, async (c) => {
  const body = await c.req.json()
  const allowed = ['name', 'description', 'icon', 'color', 'criteria']
  const fields = Object.keys(body).filter(k => allowed.includes(k))
  if (!fields.length) return c.json({ error: 'No valid fields' }, 400)

  const updates = fields.map(f => {
    if (f === 'criteria' && body[f]) body[f] = JSON.stringify(body[f])
    return `${f} = ?`
  }).join(', ')

  await c.env.DB.prepare(
    `UPDATE badges SET ${updates} WHERE id = ?`
  ).bind(...fields.map(f => body[f]), c.req.param('id')).run()

  return c.json({ message: 'Updated' })
})

// DELETE /badges/:id — super_admin only
badgeRoutes.delete('/:id', async (c) => {
  const payload = getPayload(c)
  if (payload.role !== 'super_admin') return c.json({ error: 'Forbidden' }, 403)
  await c.env.DB.prepare('DELETE FROM badges WHERE id = ?').bind(c.req.param('id')).run()
  return c.json({ message: 'Deleted' })
})

// GET /badges/:id/members — xem ai có badge này
badgeRoutes.get('/:id/members', adminMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.name, m.email, m.department, mb.awarded_at, mb.note, mb.awarded_by
     FROM member_badges mb JOIN members m ON mb.member_id = m.id
     WHERE mb.badge_id = ? ORDER BY mb.awarded_at DESC`
  ).bind(c.req.param('id')).all<any>()
  return c.json(results)
})

// POST /members/:memberId/badge/:badgeId — admin award badge (cách cũ)
badgeRoutes.post('/member/:memberId/badge/:badgeId', adminMiddleware, async (c) => {
  const payload = getPayload(c)
  const memberId = c.req.param('memberId')
  const badgeId = c.req.param('badgeId')
  const { note } = await c.req.json() || {}

  const id = crypto.randomUUID()
  try {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO member_badges (id, member_id, badge_id, awarded_by, note, awarded_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).bind(id, memberId, badgeId, payload.sub, note||null).run()
    return c.json({ message: 'Badge awarded' }, 201)
  } catch (e) {
    return c.json({ error: 'Failed to award badge' }, 400)
  }
})

// DELETE /members/:memberId/badge/:badgeId — admin revoke badge
badgeRoutes.delete('/member/:memberId/badge/:badgeId', adminMiddleware, async (c) => {
  const memberId = c.req.param('memberId')
  const badgeId = c.req.param('badgeId')
  
  await c.env.DB.prepare(
    'DELETE FROM member_badges WHERE member_id = ? AND badge_id = ?'
  ).bind(memberId, badgeId).run()

  return c.json({ message: 'Badge revoked' })
})