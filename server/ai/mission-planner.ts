/**
 * Mission Planner — structured planning and adaptive replanning for autopilot missions
 * Uses strong model for planning, cheap model for execution evaluation
 */

import { chatCompletion } from './openrouter'
import { getModelConfig } from './model-router'

export interface MissionPlan {
  goal: string
  successCriteria: string[]
  abortConditions: string[]
  steps: MissionStep[]
  estimatedMessages: number
  riskLevel: 'low' | 'medium' | 'high'
  strategy: string
}

export interface MissionStep {
  id: number
  action: 'read_context' | 'send_message' | 'wait_and_evaluate' | 'adapt' | 'finalize'
  description: string
  messageTemplate?: string
  ifPositive?: string
  ifNegative?: string
  ifNeutral?: string
}

export interface MissionEvaluation {
  progressPercent: number
  currentStatus: 'on_track' | 'needs_replan' | 'blocked' | 'goal_reached' | 'goal_failed'
  reasoning: string
  suggestedAction: string
  shouldAbort: boolean
}

/**
 * Generate a structured mission plan from a user goal
 */
export async function generateMissionPlan(
  goal: string,
  chatContext: string,
  contactName: string,
  relationshipType: string | null,
  userStyleHint?: string,
): Promise<MissionPlan> {
  const config = getModelConfig('planning')

  const result = await chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content: `You are a strategic communication planner. Given a user's goal for a chat conversation, create a structured plan.

You MUST respond with valid JSON only. No markdown, no explanation.

JSON schema:
{
  "goal": "rephrased clear goal",
  "successCriteria": ["specific measurable criteria for success"],
  "abortConditions": ["when to stop trying"],
  "steps": [
    {
      "id": 1,
      "action": "read_context|send_message|wait_and_evaluate|adapt|finalize",
      "description": "what to do",
      "messageTemplate": "message template with {placeholders} if send_message",
      "ifPositive": "what to do if response is positive",
      "ifNegative": "what to do if response is negative",
      "ifNeutral": "what to do if response is neutral"
    }
  ],
  "estimatedMessages": 2-5,
  "riskLevel": "low|medium|high",
  "strategy": "1-2 sentence strategy description"
}

Rules:
- Plans should be 2-5 steps, not more
- First step is usually read_context to understand current situation
- Message templates should sound natural, like a real person
- Account for relationship type in tone planning
- Include realistic abort conditions (3 ignored messages, explicit refusal, etc.)
- Strategy should describe the persuasion/communication approach`,
      },
      {
        role: 'user',
        content: `Goal: ${goal}
Contact: ${contactName}
Relationship: ${relationshipType || 'unknown'}
Recent chat context:
${chatContext.slice(-2000)}
${userStyleHint ? `\nUser's writing style: ${userStyleHint}` : ''}`,
      },
    ],
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  })

  try {
    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned)

    return {
      goal: parsed.goal || goal,
      successCriteria: parsed.successCriteria || ['Goal achieved'],
      abortConditions: parsed.abortConditions || ['3 ignored messages', 'Explicit refusal'],
      steps: (parsed.steps || []).map((s: any, i: number) => ({
        id: s.id || i + 1,
        action: s.action || 'send_message',
        description: s.description || '',
        messageTemplate: s.messageTemplate,
        ifPositive: s.ifPositive,
        ifNegative: s.ifNegative,
        ifNeutral: s.ifNeutral,
      })),
      estimatedMessages: parsed.estimatedMessages || 3,
      riskLevel: parsed.riskLevel || 'medium',
      strategy: parsed.strategy || 'Direct approach',
    }
  } catch {
    // Fallback simple plan
    return {
      goal,
      successCriteria: ['Goal achieved'],
      abortConditions: ['Explicit refusal', '3 ignored messages'],
      steps: [
        { id: 1, action: 'read_context', description: 'Read recent chat history' },
        { id: 2, action: 'send_message', description: 'Send initial message', messageTemplate: goal },
        { id: 3, action: 'wait_and_evaluate', description: 'Wait for response and evaluate' },
      ],
      estimatedMessages: 3,
      riskLevel: 'medium',
      strategy: 'Direct approach based on goal',
    }
  }
}

/**
 * Evaluate mission progress after receiving a response
 * Uses cheap model for quick evaluation
 */
export async function evaluateMissionProgress(
  plan: MissionPlan,
  currentStep: number,
  conversationSoFar: string,
  lastResponse: string,
): Promise<MissionEvaluation> {
  const config = getModelConfig('evaluation')

  const result = await chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content: `You evaluate progress toward a communication goal. Respond with JSON only.

{
  "progressPercent": 0-100,
  "currentStatus": "on_track|needs_replan|blocked|goal_reached|goal_failed",
  "reasoning": "1 sentence why",
  "suggestedAction": "what to do next",
  "shouldAbort": false
}

Rules:
- goal_reached: success criteria clearly met
- goal_failed: abort condition triggered or clearly impossible
- needs_replan: unexpected response requires strategy change
- blocked: no response or unclear how to proceed
- on_track: progressing toward goal normally`,
      },
      {
        role: 'user',
        content: `Mission goal: ${plan.goal}
Success criteria: ${plan.successCriteria.join('; ')}
Abort conditions: ${plan.abortConditions.join('; ')}
Current step: ${currentStep}/${plan.steps.length}

Conversation so far:
${conversationSoFar.slice(-1500)}

Latest response: "${lastResponse}"`,
      },
    ],
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  })

  try {
    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned)

    return {
      progressPercent: Math.min(100, Math.max(0, parsed.progressPercent ?? 50)),
      currentStatus: parsed.currentStatus || 'on_track',
      reasoning: parsed.reasoning || '',
      suggestedAction: parsed.suggestedAction || 'Continue with plan',
      shouldAbort: parsed.shouldAbort ?? false,
    }
  } catch {
    return {
      progressPercent: 50,
      currentStatus: 'on_track',
      reasoning: 'Could not evaluate — continuing with plan',
      suggestedAction: 'Continue with next step',
      shouldAbort: false,
    }
  }
}

/**
 * Replan the mission when strategy needs to change
 * Uses strong model for replanning
 */
export async function replanMission(
  originalPlan: MissionPlan,
  conversationSoFar: string,
  evaluation: MissionEvaluation,
  contactName: string,
): Promise<MissionPlan> {
  const config = getModelConfig('replanning')

  const result = await chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content: `You are replanning a communication mission that hit an obstacle. Respond with the same JSON plan format as before.

{
  "goal": "same or adjusted goal",
  "successCriteria": ["updated criteria"],
  "abortConditions": ["updated conditions"],
  "steps": [{"id":1, "action":"...", "description":"...", ...}],
  "estimatedMessages": N,
  "riskLevel": "low|medium|high",
  "strategy": "new strategy description"
}

Rules:
- Keep remaining steps to 2-3 max
- Adapt strategy based on what happened
- Don't repeat failed approaches
- Consider stepping back or changing angle`,
      },
      {
        role: 'user',
        content: `Original plan: ${JSON.stringify(originalPlan)}
What happened: ${evaluation.reasoning}
Suggested action: ${evaluation.suggestedAction}
Contact: ${contactName}

Conversation so far:
${conversationSoFar.slice(-2000)}

Create an adapted plan.`,
      },
    ],
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  })

  try {
    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned)

    return {
      goal: parsed.goal || originalPlan.goal,
      successCriteria: parsed.successCriteria || originalPlan.successCriteria,
      abortConditions: parsed.abortConditions || originalPlan.abortConditions,
      steps: (parsed.steps || []).map((s: any, i: number) => ({
        id: s.id || i + 1,
        action: s.action || 'send_message',
        description: s.description || '',
        messageTemplate: s.messageTemplate,
        ifPositive: s.ifPositive,
        ifNegative: s.ifNegative,
        ifNeutral: s.ifNeutral,
      })),
      estimatedMessages: parsed.estimatedMessages || 3,
      riskLevel: parsed.riskLevel || 'high',
      strategy: parsed.strategy || 'Adapted approach',
    }
  } catch {
    return originalPlan // Keep original if replan fails
  }
}

/**
 * Format mission plan as a human-readable summary for the user
 */
export function formatPlanForUser(plan: MissionPlan): string {
  let text = `🎯 **Цель**: ${plan.goal}\n`
  text += `📊 **Стратегия**: ${plan.strategy}\n`
  text += `⚡ **Риск**: ${plan.riskLevel === 'low' ? '🟢 низкий' : plan.riskLevel === 'medium' ? '🟡 средний' : '🔴 высокий'}\n\n`
  text += `**План:**\n`

  for (const step of plan.steps) {
    const icon = step.action === 'read_context' ? '📖'
      : step.action === 'send_message' ? '✉️'
      : step.action === 'wait_and_evaluate' ? '⏳'
      : step.action === 'adapt' ? '🔄'
      : '✅'
    text += `${icon} ${step.id}. ${step.description}\n`
  }

  text += `\n**Критерии успеха**: ${plan.successCriteria.join('; ')}\n`
  text += `**Когда остановиться**: ${plan.abortConditions.join('; ')}`

  return text
}
