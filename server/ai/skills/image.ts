import type { Skill } from './registry'
import { chatCompletion } from '../openrouter'

export const imageSkill: Skill = {
  id: 'image_generate',
  command: '/image',
  name: 'Image Generation',
  description: 'Generate images from text descriptions',
  icon: '🎨',
  cost: 5,
  isAutoTrigger: false,
  inputType: 'text',
  inputDescription: 'Text description',
  outputDescription: 'Generated image',
  configSchema: {
    needsSystemPrompt: false,
    needsModel: true,
    needsTemperature: false,
    fields: [],
  },

  async execute(ctx) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
    const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

    // Try actual image generation via DALL-E
    try {
      const response = await fetch(`${OPENROUTER_BASE_URL}/images/generations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://mlsendger.app',
          'X-Title': 'MLSendger',
        },
        body: JSON.stringify({
          model: 'openai/dall-e-3',
          prompt: ctx.prompt,
          n: 1,
          size: '1024x1024',
        }),
      })

      if (response.ok) {
        const data = await response.json() as any
        const imageUrl = data.data?.[0]?.url
        if (imageUrl) {
          return {
            content: imageUrl,
            type: 'image' as const,
            visibility: 'ghost' as const,
            metadata: { agentName: 'Image Generator' },
          }
        }
      }
    } catch (e) {
      console.log('Direct image generation failed, using description fallback')
    }

    // Fallback: Generate rich description as ghost message
    try {
      const description = await chatCompletion({
        model: 'openai/gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an image description generator. The user asked for an image.
Create a vivid, detailed description of what the image would look like.
Format your response as:
🎨 **[Title]**

[2-3 sentences of vivid visual description]

_Image generation unavailable — showing AI description_`,
          },
          { role: 'user', content: ctx.prompt },
        ],
        temperature: 0.9,
        maxTokens: 300,
      })

      return {
        content: description || `🎨 **${ctx.prompt}**\n\n_Image generation temporarily unavailable._`,
        type: 'text',
        visibility: 'ghost' as const,
        metadata: { agentName: 'Image Generator' },
      }
    } catch (e) {
      return {
        content: `🎨 **${ctx.prompt}**\n\n_Image generation temporarily unavailable. Please try again later._`,
        type: 'text',
        visibility: 'ghost' as const,
        metadata: { agentName: 'Image Generator' },
      }
    }
  },
}
