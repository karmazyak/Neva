import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { AgentCard, JsonRpcRequest } from './types'
import { JSONRPC_ERRORS } from './types'
import { handleJsonRpc } from './jsonrpc'
import { NevaAgentExecutor } from './executor'
import { SqliteTaskStore } from './task-store'
import { a2aAuthMiddleware } from './auth'

// ── Agent Card ──────────────────────────────────────────────────────────────

const AGENT_CARD: AgentCard = {
  name: 'Neva Personal Agent',
  description: 'Personal AI agent for relationship management and needs/offers matching',
  url: process.env.BASE_URL || 'http://localhost:3000/a2a',
  version: '0.1.0',
  provider: {
    organization: 'Neva',
    url: 'https://neva.app',
  },
  capabilities: {
    streaming: true,
    pushNotifications: false,
  },
  skills: [
    {
      id: 'check-availability',
      name: 'Check Availability',
      description: 'Check if a user is available at a given time. Requires targetUserId and callerUserId in metadata.',
      inputModes: ['text'],
      outputModes: ['text'],
      tags: ['availability', 'scheduling'],
    },
    {
      id: 'match-need',
      name: 'Match Need',
      description: 'Find people in the network who can fulfill a specific need. Describe the need in the message text.',
      inputModes: ['text'],
      outputModes: ['text'],
      tags: ['matching', 'networking'],
    },
    {
      id: 'get-interests',
      name: 'Get Interests',
      description: 'Get shared interests and current topics of a user. Requires targetUserId and callerUserId in metadata.',
      inputModes: ['text'],
      outputModes: ['text'],
      tags: ['interests', 'social'],
    },
  ],
  securitySchemes: {
    bearer: { type: 'http', scheme: 'bearer' },
  },
  security: [{ bearer: [] }],
}

// ── Singletons ──────────────────────────────────────────────────────────────

const taskStore = new SqliteTaskStore()
const executor = new NevaAgentExecutor()

// ── Routes ──────────────────────────────────────────────────────────────────

const a2a = new Hono()

// Agent Card — public, no auth
a2a.get('/.well-known/agent.json', (c) => {
  return c.json(AGENT_CARD)
})

// JSON-RPC endpoint — requires A2A auth
a2a.post('/', a2aAuthMiddleware, async (c) => {
  let body: JsonRpcRequest
  try {
    body = await c.req.json<JsonRpcRequest>()
  } catch {
    return c.json({
      jsonrpc: '2.0',
      id: null,
      error: { code: JSONRPC_ERRORS.PARSE_ERROR, message: 'Invalid JSON' },
    }, 400)
  }

  // Validate JSON-RPC 2.0
  if (body.jsonrpc !== '2.0' || !body.method || body.id == null) {
    return c.json({
      jsonrpc: '2.0',
      id: body?.id ?? null,
      error: { code: JSONRPC_ERRORS.INVALID_REQUEST, message: 'Invalid JSON-RPC 2.0 request' },
    }, 400)
  }

  const result = await handleJsonRpc(body, executor, taskStore)

  // Check if result is an AsyncGenerator (streaming)
  if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
    return streamSSE(c, async (stream) => {
      for await (const event of result as AsyncGenerator) {
        await stream.writeSSE({
          data: JSON.stringify(event),
        })
      }
    })
  }

  return c.json(result)
})

export default a2a
