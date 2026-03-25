import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../db'
import { eq, and } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { executeSkill, getUserAvailableSkills } from '../ai/engine'
import { getSkillList, getAgentSkills } from '../ai/skills/registry'
import { PIPELINE_METHODS } from '../ai/methods'

const agents = new Hono()
agents.use('*', authMiddleware)

const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  avatar: z.string().optional(),
  systemPrompt: z.string().min(1),
  model: z.string().default('openai/gpt-4o'),
  tools: z.array(z.string()).default([]),
  modes: z.array(z.enum(['command', 'auto', 'background'])).default(['command']),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().min(100).max(16000).default(2048),
  isPublic: z.boolean().default(false),
  category: z.string().optional(),
  skillSettings: z.record(z.string(), z.record(z.string(), z.any())).optional(),
})

// Get user's agents
agents.get('/', async (c) => {
  const userId = c.get('userId')

  const userAgents = db.select().from(schema.agents)
    .where(eq(schema.agents.ownerId, userId))
    .all()

  return c.json(userAgents)
})

// Create agent
agents.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const parsed = createAgentSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }

  const agentId = crypto.randomUUID()
  db.insert(schema.agents).values({
    id: agentId,
    ownerId: userId,
    ...parsed.data,
  }).run()

  const agent = db.select().from(schema.agents)
    .where(eq(schema.agents.id, agentId)).get()

  return c.json(agent, 201)
})

// Update agent
agents.put('/:agentId', async (c) => {
  const userId = c.get('userId')
  const agentId = c.req.param('agentId')

  const agent = db.select().from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.ownerId, userId)))
    .get()

  if (!agent) return c.json({ error: 'Agent not found' }, 404)

  const body = await c.req.json()
  const parsed = createAgentSchema.partial().safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input' }, 400)
  }

  db.update(schema.agents).set(parsed.data)
    .where(eq(schema.agents.id, agentId)).run()

  const updated = db.select().from(schema.agents)
    .where(eq(schema.agents.id, agentId)).get()

  return c.json(updated)
})

// Delete agent
agents.delete('/:agentId', async (c) => {
  const userId = c.get('userId')
  const agentId = c.req.param('agentId')

  const agent = db.select().from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.ownerId, userId)))
    .get()

  if (!agent) return c.json({ error: 'Agent not found' }, 404)

  db.delete(schema.agentCommandAliases).where(and(
    eq(schema.agentCommandAliases.userId, userId),
    eq(schema.agentCommandAliases.agentId, agentId)
  )).run()
  db.delete(schema.agentConfigs).where(eq(schema.agentConfigs.agentId, agentId)).run()
  db.delete(schema.agents).where(eq(schema.agents.id, agentId)).run()

  return c.json({ ok: true })
})

// Assign agent to chat
agents.post('/assign', async (c) => {
  const userId = c.get('userId')
  const { agentId, chatId, triggerMode } = await c.req.json()

  const agent = db.select().from(schema.agents)
    .where(eq(schema.agents.id, agentId)).get()
  if (!agent) return c.json({ error: 'Agent not found' }, 404)

  const member = db.select().from(schema.chatMembers)
    .where(and(
      eq(schema.chatMembers.chatId, chatId),
      eq(schema.chatMembers.userId, userId)
    )).get()
  if (!member) return c.json({ error: 'Not a member of this chat' }, 403)

  // Remove existing config for this chat
  db.delete(schema.agentConfigs)
    .where(and(
      eq(schema.agentConfigs.userId, userId),
      eq(schema.agentConfigs.chatId, chatId)
    )).run()

  const configId = crypto.randomUUID()
  db.insert(schema.agentConfigs).values({
    id: configId,
    userId,
    chatId,
    agentId,
    enabled: true,
    triggerMode: triggerMode || 'auto',
  }).run()

  return c.json({ ok: true })
})

// Remove agent from chat
agents.delete('/assign/:chatId', async (c) => {
  const userId = c.get('userId')
  const chatId = c.req.param('chatId')

  db.delete(schema.agentConfigs)
    .where(and(
      eq(schema.agentConfigs.userId, userId),
      eq(schema.agentConfigs.chatId, chatId)
    )).run()

  return c.json({ ok: true })
})

// Get available skills for current user (agent-aware, with custom commands)
// IMPORTANT: This must be before /:agentId routes to avoid matching "my-skills" as agentId
agents.get('/my-skills', async (c) => {
  const userId = c.get('userId')
  const skills = getUserAvailableSkills(userId)
  return c.json(skills)
})

// Get available skills list (for autocomplete in UI) — all system skills
agents.get('/skills', (c) => {
  return c.json(getSkillList())
})

// Get pipeline methods registry
agents.get('/pipeline-methods', (c) => {
  return c.json(PIPELINE_METHODS)
})

// Get agent config for a chat
agents.get('/config/:chatId', async (c) => {
  const userId = c.get('userId')
  const chatId = c.req.param('chatId')

  const config = db.select({
    id: schema.agentConfigs.id,
    agentId: schema.agentConfigs.agentId,
    enabled: schema.agentConfigs.enabled,
    triggerMode: schema.agentConfigs.triggerMode,
    agentName: schema.agents.name,
    agentModel: schema.agents.model,
    agentModes: schema.agents.modes,
    agentTools: schema.agents.tools,
  })
    .from(schema.agentConfigs)
    .innerJoin(schema.agents, eq(schema.agentConfigs.agentId, schema.agents.id))
    .where(and(
      eq(schema.agentConfigs.userId, userId),
      eq(schema.agentConfigs.chatId, chatId)
    ))
    .get()

  return c.json(config || null)
})

// Set custom command alias for an agent's skill
const aliasSchema = z.object({
  agentId: z.string(),
  skillId: z.string(),
  customCommand: z.string().regex(/^\/[a-z0-9_]+$/, 'Command must start with / and contain only lowercase letters, numbers, underscores'),
})

agents.post('/command-alias', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const parsed = aliasSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }

  const { agentId, skillId, customCommand } = parsed.data

  // Verify user owns the agent
  const agent = db.select().from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.ownerId, userId)))
    .get()
  if (!agent) return c.json({ error: 'Agent not found' }, 404)

  // Remove existing alias for this agent+skill
  db.delete(schema.agentCommandAliases)
    .where(and(
      eq(schema.agentCommandAliases.userId, userId),
      eq(schema.agentCommandAliases.agentId, agentId),
      eq(schema.agentCommandAliases.skillId, skillId)
    )).run()

  // Create new alias
  db.insert(schema.agentCommandAliases).values({
    id: crypto.randomUUID(),
    userId,
    agentId,
    skillId,
    customCommand,
  }).run()

  return c.json({ ok: true })
})

// Delete command alias
agents.delete('/command-alias/:aliasId', async (c) => {
  const userId = c.get('userId')
  const aliasId = c.req.param('aliasId')

  db.delete(schema.agentCommandAliases)
    .where(and(
      eq(schema.agentCommandAliases.id, aliasId),
      eq(schema.agentCommandAliases.userId, userId)
    )).run()

  return c.json({ ok: true })
})

// Get command aliases for an agent
agents.get('/:agentId/aliases', async (c) => {
  const userId = c.get('userId')
  const agentId = c.req.param('agentId')

  const aliases = db.select().from(schema.agentCommandAliases)
    .where(and(
      eq(schema.agentCommandAliases.userId, userId),
      eq(schema.agentCommandAliases.agentId, agentId)
    ))
    .all()

  return c.json(aliases)
})

// Execute a skill command (hidden from chat partner)
const skillSchema = z.object({
  chatId: z.string(),
  command: z.string(),   // e.g. '/image', '/translate'
  prompt: z.string().max(10000).default(''),
})

agents.post('/skill', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const parsed = skillSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input' }, 400)
  }

  const { chatId, command, prompt } = parsed.data

  try {
    const result = await executeSkill(chatId, userId, command, prompt)
    return c.json(result)
  } catch (error: any) {
    console.error('Skill execution error:', error)
    return c.json({ error: error.message || 'Skill execution failed' }, 500)
  }
})

// Get skills available for a specific agent
agents.get('/:agentId/skills', (c) => {
  const agentId = c.req.param('agentId')
  const agent = db.select().from(schema.agents)
    .where(eq(schema.agents.id, agentId)).get()

  if (!agent) return c.json({ error: 'Agent not found' }, 404)

  const tools = (agent.tools as string[]) || []
  const skills = getAgentSkills(tools).map(({ execute, ...rest }) => rest)
  return c.json(skills)
})

// ========== PIPELINE ENDPOINTS ==========

// Get pipelines (triggers) for an agent/robot
agents.get('/:agentId/pipelines', async (c) => {
  const userId = c.get('userId')
  const agentId = c.req.param('agentId')

  const pipelines = db.select().from(schema.triggers)
    .where(and(
      eq(schema.triggers.userId, userId),
      eq(schema.triggers.agentId, agentId)
    ))
    .all()

  return c.json(pipelines)
})

// Create pipeline for an agent/robot
const pipelineSchema = z.object({
  name: z.string().min(1).max(100),
  event: z.enum(['on_audio', 'on_image', 'on_message', 'on_message_from', 'on_keyword', 'on_schedule']),
  condition: z.object({
    fromUserId: z.string().optional(),
    keyword: z.string().optional(),
    chatId: z.string().optional(),
    cronExpression: z.string().optional(),
    sourceChats: z.array(z.string()).optional(),
  }).optional(),
  action: z.object({
    type: z.enum(['skill', 'agent_reply', 'stt']),
    skillCommand: z.string().optional(),
    skillId: z.string().optional(),
    agentId: z.string().optional(),
    params: z.any().optional(),
  }),
  method: z.enum(['pass_content', 'last_n_messages', 'collect_from_channels']).default('pass_content'),
  outputMode: z.enum(['ghost', 'normal']).default('ghost'),
  chatId: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
})

agents.post('/:agentId/pipelines', async (c) => {
  const userId = c.get('userId')
  const agentId = c.req.param('agentId')

  const agent = db.select().from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.ownerId, userId)))
    .get()
  if (!agent) return c.json({ error: 'Agent not found' }, 404)

  const body = await c.req.json()
  const parsed = pipelineSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }

  const triggerId = crypto.randomUUID()
  db.insert(schema.triggers).values({
    id: triggerId,
    userId,
    agentId,
    isDefault: false,
    ...parsed.data,
    chatId: parsed.data.chatId || null,
  }).run()

  const pipeline = db.select().from(schema.triggers)
    .where(eq(schema.triggers.id, triggerId)).get()

  return c.json(pipeline, 201)
})

// ========== SCHEDULE ENDPOINTS ==========

// Get schedule for an agent
agents.get('/:agentId/schedule', async (c) => {
  const userId = c.get('userId')
  const agentId = c.req.param('agentId')

  const schedule = db.select().from(schema.agentSchedules)
    .where(and(
      eq(schema.agentSchedules.agentId, agentId),
      eq(schema.agentSchedules.userId, userId)
    ))
    .get()

  return c.json(schedule || null)
})

// Create/update schedule for an agent
const scheduleSchema = z.object({
  cronExpression: z.string().min(1),
  taskType: z.enum(['digest', 'custom']).default('digest'),
  config: z.object({
    sourceChats: z.array(z.string()),
    targetChatId: z.string().optional(),
    maxMessages: z.number().optional(),
    prompt: z.string().optional(),
  }),
  enabled: z.boolean().default(true),
})

agents.post('/:agentId/schedule', async (c) => {
  const userId = c.get('userId')
  const agentId = c.req.param('agentId')

  const agent = db.select().from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.ownerId, userId)))
    .get()
  if (!agent) return c.json({ error: 'Agent not found' }, 404)

  const body = await c.req.json()
  const parsed = scheduleSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }

  // Delete existing schedule for this agent+user
  db.delete(schema.agentSchedules)
    .where(and(
      eq(schema.agentSchedules.agentId, agentId),
      eq(schema.agentSchedules.userId, userId)
    )).run()

  const scheduleId = crypto.randomUUID()
  db.insert(schema.agentSchedules).values({
    id: scheduleId,
    agentId,
    userId,
    ...parsed.data,
  }).run()

  const schedule = db.select().from(schema.agentSchedules)
    .where(eq(schema.agentSchedules.id, scheduleId)).get()

  return c.json(schedule, 201)
})

// Run schedule manually (for testing)
agents.post('/:agentId/schedule/run', async (c) => {
  const userId = c.get('userId')
  const agentId = c.req.param('agentId')

  const schedule = db.select().from(schema.agentSchedules)
    .where(and(
      eq(schema.agentSchedules.agentId, agentId),
      eq(schema.agentSchedules.userId, userId)
    ))
    .get()

  if (!schedule) return c.json({ error: 'No schedule found' }, 404)

  const agent = db.select().from(schema.agents)
    .where(eq(schema.agents.id, agentId)).get()
  if (!agent) return c.json({ error: 'Agent not found' }, 404)

  // Import and run digest
  const { runDigestTask } = await import('../scheduler')
  try {
    await runDigestTask(schedule, agent)
    return c.json({ ok: true, message: 'Digest task completed' })
  } catch (error: any) {
    return c.json({ error: error.message || 'Task failed' }, 500)
  }
})

export default agents
