/**
 * Smart Model Router — selects the optimal model based on task type
 * Uses OpenRouter's model catalog with cost/quality tradeoffs
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

const MODEL_MAP: Record<TaskType, {
  model: string
  temperature: number
  maxTokens: number
  description: string
}> = {
  planning: {
    model: 'anthropic/claude-3.5-sonnet',
    temperature: 0.4,
    maxTokens: 4096,
    description: 'Complex reasoning for mission planning',
  },
  replanning: {
    model: 'anthropic/claude-3.5-sonnet',
    temperature: 0.3,
    maxTokens: 2048,
    description: 'Adaptive replanning when situation changes',
  },
  evaluation: {
    model: 'openai/gpt-4o-mini',
    temperature: 0.2,
    maxTokens: 512,
    description: 'Quick evaluation and scoring',
  },
  persona_extraction: {
    model: 'anthropic/claude-3.5-sonnet',
    temperature: 0.3,
    maxTokens: 2048,
    description: 'Deep persona analysis from message history',
  },
  simulation: {
    model: 'openai/gpt-4o-mini',
    temperature: 0.7,
    maxTokens: 500,
    description: 'Role-play simulation with persona profile',
  },
  generation: {
    model: 'openai/gpt-4o-mini',
    temperature: 0.7,
    maxTokens: 1024,
    description: 'Text generation and message drafting',
  },
  classification: {
    model: 'openai/gpt-4o-mini',
    temperature: 0.1,
    maxTokens: 50,
    description: 'Quick classification tasks',
  },
  analysis: {
    model: 'openai/gpt-4o-mini',
    temperature: 0.3,
    maxTokens: 1024,
    description: 'Summarization and analysis',
  },
}

export function getModelConfig(task: TaskType) {
  return MODEL_MAP[task]
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
