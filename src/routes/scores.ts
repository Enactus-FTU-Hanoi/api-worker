import { Hono } from 'hono'
import { Env } from '../index'
import { authMiddleware, adminMiddleware } from '../middleware/auth'

export const scoreRoutes = new Hono<{ Bindings: Env }>()

// GET /scores — lấy scores của member hiện tại (member) hoặc theo member_id (admin)
scoreRoutes.get('/', authMiddleware, async (c) => {
  const payload = c.get('jwtPayload' as never) as any
  const { member_id, period } = c.req.query()
  
  // Nếu là member, chỉ lấy của mình
  if (payload.role === 'member') {
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM scores WHERE member_id = ? ORDER BY period DESC, created_at DESC
    `).bind(payload.sub).all()
    return c.json(results)
  }
  
  // Admin: lấy theo member_id hoặc tất cả
  const targetId = member_id || payload.sub
  let query = 'SELECT * FROM scores WHERE member_id = ?'
  const bindings: string[] = [targetId]
  if (period) { query += ' AND period = ?'; bindings.push(period) }
  query += ' ORDER BY period DESC, created_at DESC'
  
  const { results } = await c.env.DB.prepare(query).bind(...bindings).all()
  return c.json(results)
})

// GET /scores/all — admin lấy tất cả scores (kèm tên member)
scoreRoutes.get('/all', adminMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT s.*, m.name as member_name 
    FROM scores s 
    LEFT JOIN members m ON s.member_id = m.id 
    ORDER BY s.created_at DESC
  `).all()
  return c.json(results)
})

// POST /scores — admin only
scoreRoutes.post('/', adminMiddleware, async (c) => {
  const { member_id, category, score, period, note } = await c.req.json()
  if (!member_id || score == null || !period) return c.json({ error: 'Thiếu thông tin' }, 400)
  const id = crypto.randomUUID()
  const payload = c.get('jwtPayload' as never) as any
  await c.env.DB.prepare(
    'INSERT INTO scores (id, member_id, category, score, period, note, graded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
  ).bind(id, member_id, category || 'general', score, period, note || null, payload.sub).run()
  return c.json({ id }, 201)
})

// DELETE /scores/:id — admin only
scoreRoutes.delete('/:id', adminMiddleware, async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM scores WHERE id = ?').bind(id).run()
  return c.json({ message: 'Deleted' })
})

// GET /scores/summary
scoreRoutes.get('/summary', authMiddleware, async (c) => {
  const payload = c.get('jwtPayload' as never) as any
  const { period } = c.req.query()
  
  if (payload.role === 'member') {
    const query = period
      ? 'SELECT SUM(score) as total, COUNT(*) as count, period FROM scores WHERE member_id = ? AND period = ? GROUP BY period'
      : 'SELECT SUM(score) as total, COUNT(*) as count FROM scores WHERE member_id = ?'
    const bindings = period ? [payload.sub, period] : [payload.sub]
    const result = await c.env.DB.prepare(query).bind(...bindings).first()
    return c.json(result || { total: 0, count: 0 })
  }
  
  const query = period
    ? 'SELECT member_id, period, SUM(score) as total, COUNT(*) as count FROM scores WHERE period = ? GROUP BY member_id ORDER BY total DESC'
    : 'SELECT member_id, SUM(score) as total, COUNT(*) as count FROM scores GROUP BY member_id ORDER BY total DESC'
  const { results } = await c.env.DB.prepare(query).bind(...(period ? [period] : [])).all()
  return c.json(results)
})