import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import { getBalance, getUsageHistory } from '../middleware/billing'
import { getSkillList } from '../ai/skills/registry'

const billing = new Hono()
billing.use('*', authMiddleware)

// Get current balance
billing.get('/balance', (c) => {
  const userId = c.get('userId')
  const balance = getBalance(userId)
  return c.json({ balance })
})

// Get usage history
billing.get('/history', (c) => {
  const userId = c.get('userId')
  const history = getUsageHistory(userId, 50)
  return c.json(history)
})

// Get available skills and their costs
billing.get('/skills', (c) => {
  const skills = getSkillList()
  return c.json(skills)
})

// Estimate cost of a skill before executing
billing.get('/estimate', async (c) => {
  const command = c.req.query('command')
  if (!command) return c.json({ error: 'command required' }, 400)
  const { findSkillByCommand } = await import('../ai/skills/registry')
  const skill = findSkillByCommand(command)
  if (!skill) return c.json({ error: 'Skill not found' }, 404)
  return c.json({ cost: skill.cost, skillName: skill.name })
})

export default billing
