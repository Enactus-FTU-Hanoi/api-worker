import { Hono } from 'hono'
import { Env } from '../index'
import { authMiddleware, adminMiddleware, getPayload } from '../middleware/auth'

export const cnbRoutes = new Hono<{ Bindings: Env }>()

// GET /cnb — member xem của mình
cnbRoutes.get('/', authMiddleware, async (c) => {
  const payload = getPayload(c)
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM cnb_records WHERE member_id = ? ORDER BY created_at DESC'
  ).bind(payload.sub).all()
  return c.json(results)
})

// GET /cnb/all — admin xem tất cả
cnbRoutes.get('/all', adminMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT c.*, m.name as member_name 
    FROM cnb_records c LEFT JOIN members m ON c.member_id = m.id 
    ORDER BY c.created_at DESC
  `).all()
  return c.json(results)
})

// POST /cnb — admin tạo
cnbRoutes.post('/', adminMiddleware, async (c) => {
  const { member_id, period, type, amount, note } = await c.req.json()
  if (!member_id || !period || !type || amount == null) {
    return c.json({ error: 'Thiếu thông tin bắt buộc' }, 400)
  }
  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    'INSERT INTO cnb_records (id, member_id, period, type, amount, note) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, member_id, period, type, amount, note || null).run()
  return c.json({ id }, 201)
})

// DELETE /cnb/:id
cnbRoutes.delete('/:id', adminMiddleware, async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM cnb_records WHERE id = ?').bind(id).run()
  return c.json({ message: 'Deleted' })
})
