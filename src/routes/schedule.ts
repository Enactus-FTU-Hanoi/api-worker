import { Hono } from 'hono'
import { Env } from '../index'
import { authMiddleware, adminMiddleware, getPayload } from '../middleware/auth'

export const scheduleRoutes = new Hono<{ Bindings: Env }>()

// GET /schedule/polls — member xem polls đang mở
scheduleRoutes.get('/polls', authMiddleware, async (c) => {
  const payload = getPayload(c)
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM schedule_polls WHERE status = 'open' ORDER BY created_at DESC"
  ).all()
  
  // Lấy votes của member hiện tại cho các poll này
  const myVotes: Record<string, string> = {}
  const voteResults = await c.env.DB.prepare(
    'SELECT poll_id, available_slots FROM schedule_votes WHERE member_id = ?'
  ).bind(payload.sub).all<any>()
  
  for (const vote of voteResults.results) {
    const slots = JSON.parse(vote.available_slots || '[]')
    if (slots.length > 0) myVotes[vote.poll_id] = slots[0] // lấy slot đầu tiên làm vote hiện tại
  }
  
  return c.json({ polls: results, myVotes })
})

// GET /schedule/polls/all — admin xem tất cả
scheduleRoutes.get('/polls/all', adminMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM schedule_polls ORDER BY created_at DESC'
  ).all()
  return c.json(results)
})

// GET /schedule/my-votes — lấy votes của member hiện tại (cho member-app)
scheduleRoutes.get('/my-votes', authMiddleware, async (c) => {
  const payload = getPayload(c)
  const { results } = await c.env.DB.prepare(
    'SELECT poll_id, available_slots FROM schedule_votes WHERE member_id = ?'
  ).bind(payload.sub).all<any>()
  
  const myVotes: Record<string, string> = {}
  for (const vote of results) {
    const slots = JSON.parse(vote.available_slots || '[]')
    if (slots.length > 0) myVotes[vote.poll_id] = slots[0]
  }
  return c.json(myVotes)
})

// POST /schedule/polls — admin tạo
scheduleRoutes.post('/polls', adminMiddleware, async (c) => {
  const { title, description, time_slots, deadline } = await c.req.json()
  if (!title || !time_slots) return c.json({ error: 'Thiếu thông tin' }, 400)
  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    "INSERT INTO schedule_polls (id, title, description, time_slots, deadline, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', datetime('now'))"
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
  await c.env.DB.prepare(`UPDATE schedule_polls SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...fields.map(f => body[f]), id).run()
  return c.json({ message: 'Updated' })
})

// DELETE /schedule/polls/:id
scheduleRoutes.delete('/polls/:id', adminMiddleware, async (c) => {
  const id = c.req.param('id')
  // Xóa cả votes liên quan
  await c.env.DB.prepare('DELETE FROM schedule_votes WHERE poll_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM schedule_polls WHERE id = ?').bind(id).run()
  return c.json({ message: 'Deleted' })
})

// POST /schedule/vote — member vote (endpoint mới, đơn giản hơn)
scheduleRoutes.post('/vote', authMiddleware, async (c) => {
  const payload = getPayload(c)
  const { poll_id, slot } = await c.req.json()
  if (!poll_id || !slot) return c.json({ error: 'Thiếu poll_id hoặc slot' }, 400)
  
  // Kiểm tra poll có tồn tại và đang mở không
  const poll = await c.env.DB.prepare('SELECT * FROM schedule_polls WHERE id = ? AND status = ?').bind(poll_id, 'open').first()
  if (!poll) return c.json({ error: 'Poll không tồn tại hoặc đã đóng' }, 404)
  
  await c.env.DB.prepare(
    'INSERT OR REPLACE INTO schedule_votes (id, poll_id, member_id, available_slots, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'))'
  ).bind(crypto.randomUUID(), poll_id, payload.sub, JSON.stringify([slot])).run()
  
  return c.json({ message: 'Vote saved', slot })
})

// POST /schedule/polls/:id/vote — member vote (cách cũ, giữ lại cho tương thích)
scheduleRoutes.post('/polls/:id/vote', authMiddleware, async (c) => {
  const payload = getPayload(c)
  const pollId = c.req.param('id')
  const { available_slots } = await c.req.json()
  
  // Kiểm tra poll có tồn tại và đang mở không
  const poll = await c.env.DB.prepare('SELECT * FROM schedule_polls WHERE id = ? AND status = ?').bind(pollId, 'open').first()
  if (!poll) return c.json({ error: 'Poll không tồn tại hoặc đã đóng' }, 404)
  
  await c.env.DB.prepare(
    'INSERT OR REPLACE INTO schedule_votes (id, poll_id, member_id, available_slots, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'))'
  ).bind(crypto.randomUUID(), pollId, payload.sub, JSON.stringify(available_slots)).run()
  return c.json({ message: 'Vote saved' })
})

// GET /schedule/polls/:id/results — admin xem kết quả (có thể cho member xem nếu poll đã đóng)
scheduleRoutes.get('/polls/:id/results', authMiddleware, async (c) => {
  const pollId = c.req.param('id')
  const poll = await c.env.DB.prepare('SELECT * FROM schedule_polls WHERE id = ?').bind(pollId).first<any>()
  if (!poll) return c.json({ error: 'Not found' }, 404)
  
  // Member chỉ xem được kết quả nếu poll đã đóng
  const payload = getPayload(c)
  const isAdmin = ['admin', 'super_admin'].includes(payload.role)
  if (!isAdmin && poll.status === 'open') {
    return c.json({ error: 'Poll chưa đóng, chưa thể xem kết quả' }, 403)
  }
  
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