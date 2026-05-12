import { Context, Next } from 'hono'
import { Env } from '../index'

export type JWTPayload = {
  sub: string       // member id
  role: 'member' | 'admin' | 'super_admin'
  name: string
  iat: number
  exp: number
}

async function signJWT(payload: object, secret: string): Promise<string> {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload))
  const data = `${header}.${body}`
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return `${data}.${sigB64}`
}

async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const [header, body, sig] = token.split('.')
    const data = `${header}.${body}`
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    )
    const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data))
    if (!valid) return null
    const payload: JWTPayload = JSON.parse(atob(body))
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export function createTokens(payload: Omit<JWTPayload, 'iat' | 'exp'>, secret: string) {
  const now = Math.floor(Date.now() / 1000)
  const accessToken = signJWT({ ...payload, iat: now, exp: now + 15 * 60 }, secret)
  const refreshToken = signJWT({ ...payload, iat: now, exp: now + 7 * 24 * 60 * 60 }, secret)
  return Promise.all([accessToken, refreshToken])
}

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const token = auth.slice(7)
  const payload = await verifyJWT(token, c.env.JWT_SECRET)
  if (!payload) return c.json({ error: 'Invalid or expired token' }, 401)
  c.set('jwtPayload' as never, payload)
  await next()
}

export async function adminMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  await authMiddleware(c, async () => {})
  const payload = c.get('jwtPayload' as never) as JWTPayload
  if (!payload || !['admin', 'super_admin'].includes(payload.role)) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await next()
}

export { verifyJWT, signJWT }
