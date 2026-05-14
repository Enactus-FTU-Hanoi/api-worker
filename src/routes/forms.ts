import { Hono } from 'hono'
import { Env } from '../index'
import { authMiddleware, adminMiddleware, getPayload } from '../middleware/auth'

export const formRoutes = new Hono<{ Bindings: Env }>()

// GET /forms — lấy forms mà user có quyền xem
formRoutes.get('/', authMiddleware, async (c) => {
  const payload = getPayload(c)
  const isAdmin = ['admin', 'super_admin'].includes(payload.role)

  let query = `SELECT f.*, m.name as creator_name,
    (SELECT COUNT(*) FROM form_responses WHERE form_id = f.id) as response_count
    FROM forms f LEFT JOIN members m ON f.created_by = m.id`

  if (!isAdmin) {
    query += ` WHERE f.status = 'open' AND (f.access = 'all' OR f.access LIKE '%"${payload.sub}"%')`
  }
  query += ' ORDER BY f.created_at DESC'

  const { results } = await c.env.DB.prepare(query).all()
  return c.json(results.map(f => ({ ...f, fields: JSON.parse(f.fields as string || '[]') })))
})

// GET /forms/:id
formRoutes.get('/:id', authMiddleware, async (c) => {
  const payload = getPayload(c)
  const form = await c.env.DB.prepare(
    `SELECT f.*, m.name as creator_name FROM forms f
     LEFT JOIN members m ON f.created_by = m.id WHERE f.id = ?`
  ).bind(c.req.param('id')).first<any>()
  if (!form) return c.json({ error: 'Not found' }, 404)

  form.fields = JSON.parse(form.fields || '[]')

  // Check if user already responded
  const myResponse = await c.env.DB.prepare(
    'SELECT * FROM form_responses WHERE form_id = ? AND member_id = ?'
  ).bind(form.id, payload.sub).first<any>()

  if (myResponse) myResponse.answers = JSON.parse(myResponse.answers || '{}')

  return c.json({ ...form, myResponse: myResponse || null })
})

// GET /forms/:id/responses — admin only
formRoutes.get('/:id/responses', adminMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT fr.*, m.name, m.email, m.department, m.generation
     FROM form_responses fr JOIN members m ON fr.member_id = m.id
     WHERE fr.form_id = ? ORDER BY fr.submitted_at DESC`
  ).bind(c.req.param('id')).all<any>()
  return c.json(results.map(r => ({ ...r, answers: JSON.parse(r.answers || '{}') })))
})

// POST /forms — admin only
formRoutes.post('/', adminMiddleware, async (c) => {
  const payload = getPayload(c)
  const { title, description, fields, access = 'all', deadline } = await c.req.json()
  if (!title || !fields?.length) return c.json({ error: 'Thiếu thông tin' }, 400)

  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO forms (id, title, description, fields, access, created_by, deadline, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', datetime('now'))`
  ).bind(id, title, description||null, JSON.stringify(fields), JSON.stringify(access), payload.sub, deadline||null).run()

  return c.json({ id, title }, 201)
})

// PATCH /forms/:id — admin only
formRoutes.patch('/:id', adminMiddleware, async (c) => {
  const body = await c.req.json()
  const allowed = ['title', 'description', 'fields', 'access', 'deadline', 'status']
  const fields = Object.keys(body).filter(k => allowed.includes(k))
  if (!fields.length) return c.json({ error: 'No valid fields' }, 400)

  const updates = fields.map(f => {
    if (f === 'fields' || f === 'access') body[f] = JSON.stringify(body[f])
    return `${f} = ?`
  }).join(', ')

  await c.env.DB.prepare(
    `UPDATE forms SET ${updates}, updated_at = datetime('now') WHERE id = ?`
  ).bind(...fields.map(f => body[f]), c.req.param('id')).run()

  return c.json({ message: 'Updated' })
})

// DELETE /forms/:id — admin only
formRoutes.delete('/:id', adminMiddleware, async (c) => {
  await c.env.DB.prepare('DELETE FROM forms WHERE id = ?').bind(c.req.param('id')).run()
  return c.json({ message: 'Deleted' })
})

// POST /forms/:id/submit — member submit response
formRoutes.post('/:id/submit', authMiddleware, async (c) => {
  const payload = getPayload(c)
  const formId = c.req.param('id')

  const form = await c.env.DB.prepare("SELECT * FROM forms WHERE id = ? AND status = 'open'").bind(formId).first()
  if (!form) return c.json({ error: 'Form không tồn tại hoặc đã đóng' }, 404)

  const { answers } = await c.req.json()
  const id = crypto.randomUUID()

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO form_responses (id, form_id, member_id, answers, submitted_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).bind(id, formId, payload.sub, JSON.stringify(answers)).run()

  return c.json({ message: 'Submitted' }, 201)
})
