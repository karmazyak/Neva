/**
 * Smart Model Router — selects the optimal model based on task type + complexity
 * Uses OpenRouter's model catalog with cost/quality tradeoffs
 *
 * v2: Complexity-aware routing — simple messages use cheap models,
 * emotionally complex or goal-driven contexts use powerful models.
 */

export type TaskType =
  | 'planning'          // Mission planning, complex reasoning
  | 'replanning'        // Adaptive replanning mid-mission
  | 'evaluation'        // Progress evaluation, confidence scoring
  | 'persona_extraction' // Deep persona profile analysis
  | 'simulation'        // What-if response generation
  | 'generation'        // Message drafting, text generation
  | 'classification'    // Quick classification (relationship type, mood)
  | 'analysis'          // Chat analysis, summarization

export type Complexity = 'low' | 'medium' | 'high'

interface ModelConfig {
  model: string
  temperature: number
  maxTokens: number
  description: string
}

const MODELS = {
  haiku: 'anthropic/claude-3-haiku',
  gpt4omini: 'openai/gpt-4o-mini',
  sonnet: 'anthropic/claude-3.5-sonnet',
}

const MODEL_MAP: Record<TaskType, ModelConfig> = {
  planning: {
    model: MODELS.sonnet,
    temperature: 0.4,
    maxTokens: 4096,
    description: 'Complex reasoning for mission planning',
  },
  replanning: {
    model: MODELS.sonnet,
    temperature: 0.3,
    maxTokens: 2048,
    description: 'Adaptive replanning when situation changes',
  },
  evaluation: {
    model: MODELS.gpt4omini,
    temperature: 0.2,
    maxTokens: 512,
    description: 'Quick evaluation and scoring',
  },
  persona_extraction: {
    model: MODELS.sonnet,
    temperature: 0.3,
    maxTokens: 2048,
    description: 'Deep persona analysis from message history',
  },
  simulation: {
    model: MODELS.gpt4omini,
    temperature: 0.7,
    maxTokens: 500,
    description: 'Role-play simulation with persona profile',
  },
  generation: {
    model: MODELS.gpt4omini,
    temperature: 0.7,
    maxTokens: 1024,
    description: 'Text generation and message drafting',
  },
  classification: {
    model: MODELS.haiku, // v2: downgraded from gpt4o-mini — classification doesn't need it
    temperature: 0.1,
    maxTokens: 50,
    description: 'Quick classification tasks',
  },
  analysis: {
    model: MODELS.gpt4omini,
    temperature: 0.3,
    maxTokens: 1024,
    description: 'Summarization and analysis',
  },
}

// v2: Complexity-aware overrides per task type
const COMPLEXITY_OVERRIDES: Partial<Record<TaskType, Record<Complexity, Partial<ModelConfig>>>> = {
  generation: {
    low: { model: MODELS.haiku, maxTokens: 256 },       // Simple replies: "код 4512", "ок"
    medium: { model: MODELS.gpt4omini, maxTokens: 1024 }, // Standard replies
    high: { model: MODELS.sonnet, maxTokens: 2048 },      // Emotional, goal-driven, conflict
  },
  analysis: {
    low: { model: MODELS.haiku, maxTokens: 512 },
    medium: { model: MODELS.gpt4omini, maxTokens: 1024 },
    high: { model: MODELS.sonnet, maxTokens: 2048 },
  },
  simulation: {
    low: { model: MODELS.haiku, maxTokens: 256 },
    medium: { model: MODELS.gpt4omini, maxTokens: 500 },
    high: { model: MODELS.sonnet, maxTokens: 1024 },
  },
}

/**
 * v2: Estimate complexity from context — pure heuristics, no ML
 */
export function estimateComplexity(context: {
  messageLength?: number
  hasGoal?: boolean
  relationshipType?: string | null
  moodTrend?: string | null
  hasDeviations?: boolean
}): Complexity {
  const { messageLength = 0, hasGoal, relationshipType, moodTrend, hasDeviations } = context

  // High complexity: emotional situations, active goals with declining mood, family tensions
  if (hasGoal && (moodTrend === 'declining' || moodTrend === 'volatile')) return 'high'
  if (relationshipType === 'family' && (moodTrend === 'declining' || hasDeviations)) return 'high'
  if (hasDeviations && hasGoal) return 'high'

  // Low complexity: short factual messages, work/acquaintance chats without goals
  if (messageLength < 50 && !hasGoal && (relationshipType === 'work' || relationshipType === 'acquaintance' || !relationshipType)) return 'low'
  if (messageLength < 30 && !hasGoal) return 'low'

  return 'medium'
}

/** Get model config — v2: optionally accepts complexity for dynamic routing */
export function getModelConfig(task: TaskType, complexity?: Complexity): ModelConfig {
  const base = MODEL_MAP[task]
  if (!complexity) return base

  const overrides = COMPLEXITY_OVERRIDES[task]
  if (!overrides) return base

  const override = overrides[complexity]
  if (!override) return base

  return { ...base, ...override }
}

export function getModel(task: TaskType): string {
  return MODEL_MAP[task].model
}

export function getTemperature(task: TaskType): number {
  return MODEL_MAP[task].temperature
}

export function getMaxTokens(task: TaskType): number {
  return MODEL_MAP[task].maxTokens
}
