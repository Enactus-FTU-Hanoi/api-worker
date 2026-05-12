import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { authRoutes } from './routes/auth'
import { memberRoutes } from './routes/members'
import { taskRoutes } from './routes/tasks'
import { scoreRoutes } from './routes/scores'
import { scheduleRoutes } from './routes/schedule'
import { notificationRoutes } from './routes/notifications'
import { cnbRoutes } from './routes/cnb'

export type Env = {
  DB: D1Database
  KV: KVNamespace
  JWT_SECRET: string
  ENVIRONMENT: string
}

const app = new Hono<{ Bindings: Env }>()

app.use('*', logger())
app.use('*', cors({
  origin: [
    'https://member.enactusftuhanoi.id.vn',
    'https://admin.enactusftuhanoi.id.vn',
    'http://localhost:5173',
    'http://localhost:5174',
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))

app.get('/health', (c) => c.json({ status: 'ok', env: c.env.ENVIRONMENT }))

app.route('/auth', authRoutes)
app.route('/members', memberRoutes)
app.route('/tasks', taskRoutes)
app.route('/scores', scoreRoutes)
app.route('/schedule', scheduleRoutes)
app.route('/notifications', notificationRoutes)
app.route('/cnb', cnbRoutes)

app.notFound((c) => c.json({ error: 'Not found' }, 404))
app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
