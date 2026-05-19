import { Hono } from 'hono'
import { Env } from '../index'
import { authMiddleware, adminMiddleware } from '../middleware/auth'

export const taskRoutes = new Hono<{ Bindings: Env }>()

// GET /tasks — lấy tasks của member hiện tại
taskRoutes.get('/tasks', authMiddleware, async (c) => {
  const payload = c.get('jwtPayload' as never) as any
  const { results } = await c.env.DB.prepare(`
    SELECT t.*, m.name as assignee_name 
    FROM tasks t 
    LEFT JOIN members m ON t.assigned_to = m.id 
    WHERE t.assigned_to = ?
    ORDER BY t.due_date ASC
  `).bind(payload.sub).all()
  return c.json(results)
})

// GET /tasks — lấy tasks của mình (member) hoặc tất cả (admin)
taskRoutes.get('/', authMiddleware, async (c) => {
  const payload = c.get('jwtPayload' as never) as any
  const { status, assigned_to, project } = c.req.query()
  let query = `SELECT t.*, m.name as assignee_name FROM tasks t
               LEFT JOIN members m ON t.assigned_to = m.id WHERE 1=1`
  const bindings: string[] = []

  if (payload.role === 'member') {
    query += ' AND t.assigned_to = ?'; bindings.push(payload.sub)
  } else if (assigned_to) {
    query += ' AND t.assigned_to = ?'; bindings.push(assigned_to)
  }
  if (status)  { query += ' AND t.status = ?';  bindings.push(status) }
  if (project) { query += ' AND t.project = ?'; bindings.push(project) }
  query += ' ORDER BY t.due_date ASC'

  const { results } = await c.env.DB.prepare(query).bind(...bindings).all()
  return c.json(results)
})

// GET /tasks/all — admin lấy tất cả tasks
taskRoutes.get('/all', adminMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT t.*, m.name as assignee_name 
    FROM tasks t 
    LEFT JOIN members m ON t.assigned_to = m.id 
    ORDER BY t.created_at DESC
  `).all()
  return c.json(results)
})

// POST /tasks — admin only
taskRoutes.post('/', adminMiddleware, async (c) => {
  const { title, description, assigned_to, due_date, project, priority = 'medium', points = 10, status = 'todo', note } = await c.req.json()
  if (!title || !assigned_to) return c.json({ error: 'title và assigned_to là bắt buộc' }, 400)

  const id = crypto.randomUUID()
  const payload = c.get('jwtPayload' as never) as any
  await c.env.DB.prepare(
    `INSERT INTO tasks (id, title, description, assigned_to, created_by, due_date, project, priority, points, status, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(id, title, description || null, assigned_to, payload.sub, due_date || null, project || null, priority, points, status, note || null).run()

  return c.json({ id, title, assigned_to, status }, 201)
})

// PATCH /tasks/:id
taskRoutes.patch('/:id', authMiddleware, async (c) => {
  const payload = c.get('jwtPayload' as never) as any
  const id = c.req.param('id')
  const task = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<any>()
  if (!task) return c.json({ error: 'Task not found' }, 404)

  const body = await c.req.json()
  const isAdmin = ['admin', 'super_admin'].includes(payload.role)
  const isAssignee = task.assigned_to === payload.sub

  if (!isAdmin && !isAssignee) return c.json({ error: 'Forbidden' }, 403)

  const allowed = isAdmin ? ['title', 'description', 'assigned_to', 'due_date', 'project', 'priority', 'points', 'status', 'note'] : ['status', 'note']
  const fields = Object.keys(body).filter(k => allowed.includes(k))
  if (fields.length === 0) return c.json({ error: 'No valid fields' }, 400)

  const setClauses = fields.map(f => `${f} = ?`).join(', ')
  const values = fields.map(f => body[f])
  await c.env.DB.prepare(`UPDATE tasks SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`).bind(...values, id).run()
  return c.json({ message: 'Updated' })
})

// DELETE /tasks/:id — admin only
taskRoutes.delete('/:id', adminMiddleware, async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run()
  return c.json({ message: 'Deleted' })
})