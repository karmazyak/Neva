import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import authRoutes from './routes/auth'
import chatRoutes from './routes/chats'
import messageRoutes from './routes/messages'
import agentRoutes from './routes/agents'
import marketplaceRoutes from './routes/marketplace'
import aiChatRoutes from './routes/ai-chat'
import billingRoutes from './routes/billing'
import uploadRoutes from './routes/upload'
import agentApiRoutes from './routes/agent-api'
import triggerRoutes from './routes/triggers'
import aiToolsRoutes from './routes/ai-tools'
import styleRoutes from './routes/style'
import pushRoutes from './routes/push'
import savedRoutes from './routes/saved'
import folderRoutes from './routes/folders'
import { startScheduler } from './scheduler'
import { existsSync } from 'fs'
import { join } from 'path'
import { getAvailableModels } from './ai/openrouter'
import { securityHeaders, rateLimiter } from './middleware/security'
import {
  handleWSUpgrade,
  handleWSOpen,
  handleWSMessage,
  handleWSClose,
} from './ws'

const app = new Hono()

// ========== SECURITY MIDDLEWARE ==========

// CORS — only allow our frontend origin
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000,https://boards-conversion-joke-the.trycloudflare.com').split(',').map(s => s.trim())
// Also allow any trycloudflare.com origin (tunnel URLs change on restart)

app.use('*', cors({
  origin: (origin) => {
    if (!origin) return ALLOWED_ORIGINS[0]
    if (ALLOWED_ORIGINS.includes(origin)) return origin
    if (origin.endsWith('.trycloudflare.com')) return origin
    return ALLOWED_ORIGINS[0]
  },
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  credentials: true,
  maxAge: 86400,
}))

// Security headers (CSP, HSTS, X-Frame-Options, etc.)
app.use('*', securityHeaders)

// Request logging
app.use('*', logger())

// Global rate limit: 100 requests per minute per IP
app.use('/api/*', rateLimiter({ windowMs: 60_000, max: 100, keyPrefix: 'api' }))

// Strict rate limits on auth endpoints (anti-brute-force)
app.use('/api/auth/login', rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: 'auth-login' }))
app.use('/api/auth/register', rateLimiter({ windowMs: 300_000, max: 5, keyPrefix: 'auth-register' }))

// Rate limit on message sending
app.use('/api/messages', rateLimiter({ windowMs: 60_000, max: 60, keyPrefix: 'messages' }))

// Rate limit on AI chat
app.use('/api/ai/chat', rateLimiter({ windowMs: 60_000, max: 20, keyPrefix: 'ai-chat' }))

// ========== API ROUTES ==========
app.route('/api/auth', authRoutes)
app.route('/api/chats', chatRoutes)
app.route('/api/messages', messageRoutes)
app.route('/api/agents', agentRoutes)
app.route('/api/marketplace', marketplaceRoutes)
app.route('/api/ai', aiChatRoutes)
app.route('/api/billing', billingRoutes)
app.route('/api/upload', uploadRoutes)
app.route('/api/agent-api', agentApiRoutes)
app.route('/api/triggers', triggerRoutes)
app.route('/api/ai/tools', aiToolsRoutes)
app.route('/api/ai/style', styleRoutes)
app.route('/api/push', pushRoutes)
app.route('/api/saved', savedRoutes)
app.route('/api/folders', folderRoutes)

// Get available AI models (cached, lighter rate limit)
app.get('/api/models', async (c) => {
  const models = await getAvailableModels()
  return c.json(models)
})

// Health check (no rate limit)
app.get('/api/health', (c) => c.json({ status: 'ok', version: '0.1.0' }))

const PORT = parseInt(process.env.PORT || '3000')

const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url)

    // Serve uploaded files
    if (url.pathname.startsWith('/uploads/')) {
      const filePath = join('./data', url.pathname)
      if (existsSync(filePath)) {
        return new Response(Bun.file(filePath))
      }
      return new Response('Not found', { status: 404 })
    }

    // WebSocket upgrade
    if (url.pathname === '/ws') {
      const data = handleWSUpgrade(req)
      if (!data) {
        return new Response('Unauthorized', { status: 401 })
      }
      const success = server.upgrade(req, { data })
      if (success) return undefined
      return new Response('WebSocket upgrade failed', { status: 500 })
    }

    // Serve static client build
    const staticPath = join('./client/dist', url.pathname === '/' ? 'index.html' : url.pathname)
    if (existsSync(staticPath) && !url.pathname.startsWith('/api')) {
      return new Response(Bun.file(staticPath))
    }

    // SPA fallback — serve index.html for all non-API routes
    const apiResult = await app.fetch(req)
    if (apiResult.status === 404 && !url.pathname.startsWith('/api')) {
      const indexPath = './client/dist/index.html'
      if (existsSync(indexPath)) {
        return new Response(Bun.file(indexPath))
      }
    }

    return apiResult
  },
  websocket: {
    open: handleWSOpen,
    message: handleWSMessage as any,
    close: handleWSClose,
    // Ping/pong for dead connection detection
    idleTimeout: 120, // seconds
    sendPings: true,
  },
})

// Start background scheduler for digest/cron tasks
startScheduler()

console.log(`MLSendger server running on http://localhost:${PORT}`)
