import { Hono } from 'hono'
import { Env } from '../index'
import { authMiddleware, adminMiddleware } from '../middleware/auth'

// ─── SCORES ────────────────────────────────────────────────────────────────
export const scoreRoutes = new Hono<{ Bindings: Env }>()

scoreRoutes.get('/', authMiddleware, async (c) => {
  const payload = c.get('jwtPayload' as never) as any
  const { member_id, period } = c.req.query()
  const targetId = payload.role === 'member' ? payload.sub : (member_id || payload.sub)
  let query = 'SELECT * FROM scores WHERE member_id = ?'
  const bindings: string[] = [targetId]
  if (period) { query += ' AND period = ?'; bindings.push(period) }
  query += ' ORDER BY period DESC, created_at DESC'
  const { results } = await c.env.DB.prepare(query).bind(...bindings).all()
  return c.json(results)
})

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

scoreRoutes.get('/summary', authMiddleware, async (c) => {
  const payload = c.get('jwtPayload' as never) as any
  const { period } = c.req.query()
  const query = period
    ? 'SELECT member_id, period, SUM(score) as total, COUNT(*) as count FROM scores WHERE period = ? GROUP BY member_id ORDER BY total DESC'
    : 'SELECT member_id, SUM(score) as total, COUNT(*) as count FROM scores GROUP BY member_id ORDER BY total DESC'
  const { results } = await c.env.DB.prepare(query).bind(...(period ? [period] : [])).all()
  return c.json(results)
})

// ─── SCHEDULE VOTE ─────────────────────────────────────────────────────────
export const scheduleRoutes = new Hono<{ Bindings: Env }>()

scheduleRoutes.get('/polls', authMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM schedule_polls WHERE status = \'open\' ORDER BY created_at DESC'
  ).all()
  return c.json(results)
})

scheduleRoutes.post('/polls', adminMiddleware, async (c) => {
  const { title, description, time_slots, deadline } = await c.req.json()
  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    'INSERT INTO schedule_polls (id, title, description, time_slots, deadline, status, created_at) VALUES (?, ?, ?, ?, ?, \'open\', datetime(\'now\'))'
  ).bind(id, title, description || null, JSON.stringify(time_slots), deadline || null).run()
  return c.json({ id }, 201)
})

scheduleRoutes.post('/polls/:id/vote', authMiddleware, async (c) => {
  const payload = c.get('jwtPayload' as never) as any
  const pollId = c.req.param('id')
  const { available_slots } = await c.req.json()

  await c.env.DB.prepare(
    'INSERT OR REPLACE INTO schedule_votes (poll_id, member_id, available_slots, updated_at) VALUES (?, ?, ?, datetime(\'now\'))'
  ).bind(pollId, payload.sub, JSON.stringify(available_slots)).run()
  return c.json({ message: 'Vote saved' })
})

scheduleRoutes.get('/polls/:id/results', authMiddleware, async (c) => {
  const pollId = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    'SELECT sv.*, m.name FROM schedule_votes sv JOIN members m ON sv.member_id = m.id WHERE sv.poll_id = ?'
  ).bind(pollId).all()
  return c.json(results)
})

// ─── NOTIFICATIONS ──────────────────────────────────────────────────────────
export const notificationRoutes = new Hono<{ Bindings: Env }>()

notificationRoutes.get('/', authMiddleware, async (c) => {
  const payload = c.get('jwtPayload' as never) as any
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM notifications WHERE member_id = ? OR member_id IS NULL ORDER BY created_at DESC LIMIT 50'
  ).bind(payload.sub).all()
  return c.json(results)
})

notificationRoutes.post('/', adminMiddleware, async (c) => {
  const { title, body, member_id, type = 'info' } = await c.req.json()
  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    'INSERT INTO notifications (id, title, body, member_id, type, read, created_at) VALUES (?, ?, ?, ?, ?, 0, datetime(\'now\'))'
  ).bind(id, title, body, member_id || null, type).run()
  return c.json({ id }, 201)
})

notificationRoutes.patch('/:id/read', authMiddleware, async (c) => {
  const payload = c.get('jwtPayload' as never) as any
  await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND member_id = ?')
    .bind(c.req.param('id'), payload.sub).run()
  return c.json({ message: 'Marked as read' })
})

// ─── C&B (Compensation & Benefits) ─────────────────────────────────────────
export const cnbRoutes = new Hono<{ Bindings: Env }>()

cnbRoutes.get('/', authMiddleware, async (c) => {
  const payload = c.get('jwtPayload' as never) as any
  const targetId = payload.role === 'member' ? payload.sub : (c.req.query('member_id') || payload.sub)
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM cnb_records WHERE member_id = ? ORDER BY period DESC'
  ).bind(targetId).all()
  return c.json(results)
})

cnbRoutes.post('/', adminMiddleware, async (c) => {
  const { member_id, period, type, amount, note } = await c.req.json()
  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    'INSERT INTO cnb_records (id, member_id, period, type, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))'
  ).bind(id, member_id, period, type, amount, note || null).run()
  return c.json({ id }, 201)
})

cnbRoutes.get('/summary', adminMiddleware, async (c) => {
  const { period } = c.req.query()
  const query = period
    ? 'SELECT member_id, period, SUM(CASE WHEN type=\'benefit\' THEN amount ELSE 0 END) as benefits, SUM(CASE WHEN type=\'deduction\' THEN amount ELSE 0 END) as deductions FROM cnb_records WHERE period = ? GROUP BY member_id'
    : 'SELECT member_id, SUM(CASE WHEN type=\'benefit\' THEN amount ELSE 0 END) as benefits, SUM(CASE WHEN type=\'deduction\' THEN amount ELSE 0 END) as deductions FROM cnb_records GROUP BY member_id'
  const { results } = await c.env.DB.prepare(query).bind(...(period ? [period] : [])).all()
  return c.json(results)
})
