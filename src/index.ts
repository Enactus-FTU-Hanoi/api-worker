import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { authRoutes } from './routes/auth'
import { memberRoutes } from './routes/members'
import { taskRoutes } from './routes/tasks'
import { scoreRoutes } from './routes/scores'
import { scheduleRoutes } from './routes/schedule'
import { notificationRoutes } from './routes/notifications'
import { cnbRoutes } from './routes/cnb'
import { formRoutes } from './routes/forms'
import { badgeRoutes } from './routes/badges'

export type Env = {
  DB: D1Database
  KV: KVNamespace
  JWT_SECRET: string
  ENVIRONMENT: string
}

const ALLOWED_ORIGINS = [
  'https://member.enactusftuhanoi.id.vn',
  'https://admin.enactusftuhanoi.id.vn',
  'http://localhost:5173',
  'http://localhost:5174',
]

const app = new Hono<{ Bindings: Env }>()

app.use('*', logger())

// CORS middleware viết tay — đảm bảo OPTIONS luôn được trả về đúng
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || ''
  const isAllowed = ALLOWED_ORIGINS.includes(origin)

  // Với preflight OPTIONS — phải trả về 204 ngay, không đi vào route
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  await next()

  // Thêm CORS headers vào mọi response
  if (isAllowed) {
    c.res.headers.set('Access-Control-Allow-Origin', origin)
    c.res.headers.set('Access-Control-Allow-Credentials', 'true')
    c.res.headers.set('Vary', 'Origin')
  }
})

app.get('/health', (c) => c.json({ status: 'ok', env: c.env.ENVIRONMENT }))

app.route('/auth', authRoutes)
app.route('/members', memberRoutes)
app.route('/tasks', taskRoutes)
app.route('/scores', scoreRoutes)
app.route('/schedule', scheduleRoutes)
app.route('/notifications', notificationRoutes)
app.route('/cnb', cnbRoutes)
app.route('/forms', formRoutes)
app.route('/badges', badgeRoutes)

app.notFound((c) => c.json({ error: 'Not found' }, 404))
app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app