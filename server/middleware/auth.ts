import { Context, Next } from 'hono'
import jwt from 'jsonwebtoken'

// JWT secret — require explicit setting in production
const JWT_SECRET = process.env.JWT_SECRET || 'mlsendger-dev-secret-DO-NOT-USE-IN-PRODUCTION'

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('FATAL: JWT_SECRET environment variable is required in production')
  process.exit(1)
}

export interface JwtPayload {
  userId: string
  username: string
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '24h',  // Shorter token lifetime (was 7d)
    algorithm: 'HS256',
    issuer: 'mlsendger',
  })
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: 'mlsendger',
  }) as JwtPayload
}

export async function authMiddleware(c: Context, next: Next) {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  try {
    const token = header.slice(7)
    // Prevent excessively long tokens (DoS protection)
    if (token.length > 1024) {
      return c.json({ error: 'Invalid token' }, 401)
    }
    const payload = verifyToken(token)
    c.set('userId', payload.userId)
    c.set('username', payload.username)
    await next()
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }
}
