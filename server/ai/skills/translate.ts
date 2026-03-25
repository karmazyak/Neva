import type { Skill } from './registry'
import { chatCompletion } from '../openrouter'

export const translateSkill: Skill = {
  id: 'translate',
  command: '/translate',
  name: 'Translate',
  description: 'Translate text to any language',
  icon: '🌍',
  cost: 1,
  isAutoTrigger: false,
  inputType: 'text',
  inputDescription: 'Text in any language',
  outputDescription: 'Translated text',
  configSchema: {
    needsSystemPrompt: false,
    needsModel: true,
    needsTemperature: false,
    fields: [
      {
        key: 'targetLang',
        label: 'Target language',
        type: 'select',
        defaultValue: 'auto',
        options: [
          { label: 'Auto-detect', value: 'auto' },
          { label: 'English', value: 'en' },
          { label: 'Russian', value: 'ru' },
        ],
      },
    ],
  },

  async execute(ctx) {
    const response = await chatCompletion({
      model: ctx.agentModel || 'openai/gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a professional translator. Translate the text provided by the user.
Auto-detect the source language. If the text is in Russian, translate to English. If in English, translate to Russian. For other languages, translate to English.
If the user specifies a target language (e.g. "/translate to Spanish: hello"), use that language.
Return ONLY the translation, no explanations or notes.`,
        },
        { role: 'user', content: ctx.prompt },
      ],
      temperature: 0.3,
      maxTokens: 2048,
    })

    return {
      content: `🌍 ${response}`,
      type: 'text',
      visibility: 'ghost' as const,
      metadata: { agentName: 'Translator' },
    }
  },
}
