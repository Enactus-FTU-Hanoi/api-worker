import { Hono } from 'hono'
import { Env } from '../index'
import { authMiddleware, getPayload } from '../middleware/auth'

export const notificationRoutes = new Hono<{ Bindings: Env }>()

// GET /notifications
notificationRoutes.get('/', authMiddleware, async (c) => {
  const payload = getPayload(c)
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM notifications WHERE member_id = ? OR member_id IS NULL ORDER BY created_at DESC LIMIT 50'
  ).bind(payload.sub).all()
  return c.json(results)
})

// PATCH /notifications/:id/read
notificationRoutes.patch('/:id/read', authMiddleware, async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare(
    'UPDATE notifications SET read = 1 WHERE id = ?'
  ).bind(id).run()
  return c.json({ success: true })
})

// PATCH /notifications/read-all
notificationRoutes.patch('/read-all', authMiddleware, async (c) => {
  const payload = getPayload(c)
  await c.env.DB.prepare(
    'UPDATE notifications SET read = 1 WHERE member_id = ? OR member_id IS NULL'
  ).bind(payload.sub).run()
  return c.json({ success: true })
})
