import { Hono } from 'hono'
import { Env } from '../index'
import { authMiddleware, adminMiddleware, getPayload } from '../middleware/auth'

export const scheduleRoutes = new Hono<{ Bindings: Env }>()

// GET /schedule/polls — member xem polls đang mở
scheduleRoutes.get('/polls', authMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM schedule_polls WHERE status = 'open' ORDER BY created_at DESC"
  ).all()
  return c.json(results)
})

// GET /schedule/polls/all — admin xem tất cả
scheduleRoutes.get('/polls/all', adminMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM schedule_polls ORDER BY created_at DESC'
  ).all()
  return c.json(results)
})

// POST /schedule/polls — admin tạo
scheduleRoutes.post('/polls', adminMiddleware, async (c) => {
  const { title, description, time_slots, deadline } = await c.req.json()
  if (!title || !time_slots) return c.json({ error: 'Thiếu thông tin' }, 400)
  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    "INSERT INTO schedule_polls (id, title, description, time_slots, deadline, status) VALUES (?, ?, ?, ?, ?, 'open')"
  ).bind(id, title, description || null, time_slots, deadline || null).run()
  return c.json({ id }, 201)
})

// PATCH /schedule/polls/:id
scheduleRoutes.patch('/polls/:id', adminMiddleware, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const fields = Object.keys(body).filter(k => ['title','description','status','deadline'].includes(k))
  if (!fields.length) return c.json({ error: 'No valid fields' }, 400)
  const setClauses = fields.map(f => `${f} = ?`).join(', ')
  await c.env.DB.prepare(`UPDATE schedule_polls SET ${setClauses} WHERE id = ?`)
    .bind(...fields.map(f => body[f]), id).run()
  return c.json({ message: 'Updated' })
})

// DELETE /schedule/polls/:id
scheduleRoutes.delete('/polls/:id', adminMiddleware, async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM schedule_polls WHERE id = ?').bind(id).run()
  return c.json({ message: 'Deleted' })
})

// POST /schedule/polls/:id/vote — member vote
scheduleRoutes.post('/polls/:id/vote', authMiddleware, async (c) => {
  const payload = getPayload(c)
  const pollId = c.req.param('id')
  const { available_slots } = await c.req.json()
  await c.env.DB.prepare(
    'INSERT OR REPLACE INTO schedule_votes (id, poll_id, member_id, available_slots) VALUES (?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), pollId, payload.sub, JSON.stringify(available_slots)).run()
  return c.json({ message: 'Vote saved' })
})

// GET /schedule/polls/:id/results — admin xem kết quả
scheduleRoutes.get('/polls/:id/results', adminMiddleware, async (c) => {
  const pollId = c.req.param('id')
  const poll = await c.env.DB.prepare('SELECT * FROM schedule_polls WHERE id = ?').bind(pollId).first<any>()
  if (!poll) return c.json({ error: 'Not found' }, 404)
  const { results: votes } = await c.env.DB.prepare(
    'SELECT sv.*, m.name FROM schedule_votes sv LEFT JOIN members m ON sv.member_id = m.id WHERE sv.poll_id = ?'
  ).bind(pollId).all<any>()
  const slots: string[] = JSON.parse(poll.time_slots || '[]')
  const tally = slots.map(slot => ({
    slot,
    count: votes.filter(v => JSON.parse(v.available_slots || '[]').includes(slot)).length,
    voters: votes.filter(v => JSON.parse(v.available_slots || '[]').includes(slot)).map(v => v.name),
  }))
  return c.json(tally)
})
