import type { Skill } from './registry'
import { chatCompletion } from '../openrouter'

export const searchSkill: Skill = {
  id: 'web_search',
  command: '/search',
  name: 'Web Search',
  description: 'Search the web and get answers',
  icon: '🔍',
  cost: 2,
  isAutoTrigger: false,
  inputType: 'text',
  inputDescription: 'Search query',
  outputDescription: 'Search results and answer',
  configSchema: {
    needsSystemPrompt: false,
    needsModel: true,
    needsTemperature: false,
    fields: [],
  },

  async execute(ctx) {
    // Use AI model with knowledge to answer search-like queries
    // In production, this would call a real search API (Serper, Brave, etc.)
    const response = await chatCompletion({
      model: 'openai/gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a search assistant. The user is searching for information.
Provide a concise, factual answer based on your knowledge.
If you're not sure about something, say so.
Format with key facts, relevant details, and sources if applicable.
Keep response under 200 words.`,
        },
        { role: 'user', content: ctx.prompt },
      ],
      temperature: 0.3,
      maxTokens: 500,
    })

    return {
      content: `🔍 ${response}`,
      type: 'text',
      visibility: 'ghost' as const,
      metadata: { agentName: 'Search' },
    }
  },
}
