import { Hono } from 'hono'
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

const allowedOrigins = new Set([
  'https://member.enactusftuhanoi.id.vn',
  'https://admin.enactusftuhanoi.id.vn',
  'http://localhost:5173',
  'http://localhost:5174',
])

function buildCorsHeaders(origin: string, requestHeaders?: string | null) {
  const headers = new Headers()
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Vary', 'Origin')
  headers.set('Access-Control-Allow-Credentials', 'true')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')

  const allowHeaders = requestHeaders?.trim() || 'Content-Type, Authorization'
  headers.set('Access-Control-Allow-Headers', allowHeaders)
  return headers
}

app.use('*', logger())
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin')
  const requestHeaders = c.req.header('Access-Control-Request-Headers')

  // Handle preflight requests
  if (c.req.method === 'OPTIONS') {
    if (origin && allowedOrigins.has(origin)) {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(origin, requestHeaders ?? null),
      })
    }
    // Reject preflight requests from disallowed origins
    return new Response(null, { status: 403 })
  }

  // Process actual request
  await next()

  // Apply CORS headers if origin is allowed
  if (origin && allowedOrigins.has(origin)) {
    const corsHeaders = buildCorsHeaders(origin, requestHeaders ?? null)
    corsHeaders.forEach((value, key) => c.res.headers.set(key, value))
  }

  return c.res
})

app.get('/health', (c) => c.json({ status: 'ok', env: c.env.ENVIRONMENT }))

app.route('/auth', authRoutes)
app.route('/admin/auth', authRoutes)
app.route('/members', memberRoutes)
app.route('/tasks', taskRoutes)
app.route('/scores', scoreRoutes)
app.route('/schedule', scheduleRoutes)
app.route('/notifications', notificationRoutes)
app.route('/cnb', cnbRoutes)

app.notFound((c) => {
  const response = c.json({ error: 'Not found' }, 404)
  const origin = c.req.header('Origin')
  if (origin && allowedOrigins.has(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Vary', 'Origin')
    response.headers.set('Access-Control-Allow-Credentials', 'true')
  }
  return response
})

app.onError((err, c) => {
  console.error(err)
  const response = c.json({ error: 'Internal server error' }, 500)
  const origin = c.req.header('Origin')
  if (origin && allowedOrigins.has(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Vary', 'Origin')
    response.headers.set('Access-Control-Allow-Credentials', 'true')
  }
  return response
})

export default app
