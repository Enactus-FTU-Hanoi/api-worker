import { Hono } from 'hono'
import { Env } from '../index'
import { authMiddleware, adminMiddleware, getPayload } from '../middleware/auth'

export const cnbRoutes = new Hono<{ Bindings: Env }>()

// GET /cnb/my — member xem C&B của mình
cnbRoutes.get('/my', authMiddleware, async (c) => {
  const payload = getPayload(c)
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM cnb_records WHERE member_id = ? ORDER BY period DESC, created_at DESC'
  ).bind(payload.sub).all()
  return c.json(results)
})

// GET /cnb/my/summary — member xem tổng kết C&B của mình
cnbRoutes.get('/my/summary', authMiddleware, async (c) => {
  const payload = getPayload(c)
  const result = await c.env.DB.prepare(`
    SELECT 
      COALESCE(SUM(CASE WHEN type = 'benefit' THEN amount ELSE 0 END), 0) as total_benefit,
      COALESCE(SUM(CASE WHEN type = 'deduction' THEN amount ELSE 0 END), 0) as total_deduction,
      COALESCE(SUM(CASE WHEN type = 'benefit' THEN amount ELSE -amount END), 0) as net
    FROM cnb_records WHERE member_id = ?
  `).bind(payload.sub).first<any>()
  return c.json(result || { total_benefit: 0, total_deduction: 0, net: 0 })
})

// GET /cnb — member xem của mình (cách cũ)
cnbRoutes.get('/', authMiddleware, async (c) => {
  const payload = getPayload(c)
  const targetId = payload.role === 'member' ? payload.sub : (c.req.query('member_id') || payload.sub)
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM cnb_records WHERE member_id = ? ORDER BY period DESC'
  ).bind(targetId).all()
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
    'INSERT INTO cnb_records (id, member_id, period, type, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))'
  ).bind(id, member_id, period, type, amount, note || null).run()
  return c.json({ id }, 201)
})

// DELETE /cnb/:id — admin only
cnbRoutes.delete('/:id', adminMiddleware, async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM cnb_records WHERE id = ?').bind(id).run()
  return c.json({ message: 'Deleted' })
})

// GET /cnb/summary — admin summary
cnbRoutes.get('/summary', adminMiddleware, async (c) => {
  const { period } = c.req.query()
  const query = period
    ? 'SELECT member_id, period, SUM(CASE WHEN type=\'benefit\' THEN amount ELSE 0 END) as benefits, SUM(CASE WHEN type=\'deduction\' THEN amount ELSE 0 END) as deductions FROM cnb_records WHERE period = ? GROUP BY member_id'
    : 'SELECT member_id, SUM(CASE WHEN type=\'benefit\' THEN amount ELSE 0 END) as benefits, SUM(CASE WHEN type=\'deduction\' THEN amount ELSE 0 END) as deductions FROM cnb_records GROUP BY member_id'
  const { results } = await c.env.DB.prepare(query).bind(...(period ? [period] : [])).all()
  return c.json(results)
})