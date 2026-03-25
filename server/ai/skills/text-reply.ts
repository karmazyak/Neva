import type { Skill } from './registry'
import { chatCompletion } from '../openrouter'

function getTimeContext(): string {
  const now = new Date()
  const hour = now.getHours()
  const minutes = now.getMinutes()
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const day = dayNames[now.getDay()]
  let timeOfDay = 'daytime'
  if (hour >= 0 && hour < 6) timeOfDay = 'late night'
  else if (hour >= 6 && hour < 12) timeOfDay = 'morning'
  else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon'
  else if (hour >= 17 && hour < 22) timeOfDay = 'evening'
  else timeOfDay = 'late evening'
  return `\nCurrent time: ${day}, ${hour}:${minutes.toString().padStart(2, '0')} (${timeOfDay}). Adapt greeting/tone to the time of day. Do NOT greet if conversation is already ongoing.`
}

export const textReplySkill: Skill = {
  id: 'text_reply',
  command: '/reply',
  name: 'Text Reply',
  description: 'Suggest 3 reply variants as ghost message with action buttons',
  icon: '💬',
  cost: 1,
  isAutoTrigger: true,
  inputType: 'text',
  inputDescription: 'Chat message',
  outputDescription: 'Reply variants with action buttons',
  configSchema: {
    needsSystemPrompt: true,
    needsModel: true,
    needsTemperature: true,
    fields: [
      {
        key: 'variants',
        label: 'Reply variants',
        type: 'number',
        defaultValue: 3,
        min: 1,
        max: 5,
      },
    ],
  },

  async execute(ctx) {
    const rawHistory = ctx.chatHistory || []

    if (rawHistory.length === 0) {
      return {
        content: 'No chat history available to generate reply suggestions.',
        type: 'text',
        visibility: 'ghost' as const,
        metadata: { agentName: 'Reply Assistant' },
      }
    }

    const isNormalMode = ctx.outputMode === 'normal'
    const numVariants = ctx.skillSettings?.variants || 3

    // Filter out existing system prompts from chatHistory
    const chatMessages = rawHistory.filter(m => m.role !== 'system')

    // Load owner's style profile for natural replies
    let styleHint = ''
    try {
      const { getOwnProfile } = await import('../style/cache')
      const cached = getOwnProfile(ctx.userId)
      if (cached) {
        const p = cached.profile
        styleHint = `\n\nIMPORTANT - Match this person's writing style:\n${p.styleInstruction}\nUse these phrases naturally: ${(p.commonPhrases || []).join(', ')}\nMessage length: ~${p.avgMessageLength} chars\nEmoji: ${p.emojiFrequency}\nCapitalization: ${p.capitalization}`
      }
    } catch {}

    if (isNormalMode) {
      // NORMAL MODE: Generate a single natural reply and send it as a real message
      const systemInstruction = {
        role: 'system' as const,
        content: `You are responding in a chat conversation. Write a natural, conversational reply to the last message.

Rules:
- Write in the SAME language as the conversation
- Keep it concise and natural (1-3 sentences)
- Match the conversation style and tone
- Do NOT start with the user's name
- Just write the message directly, as if you are chatting
- Do NOT just say "привет" or a generic greeting — respond meaningfully to what was said
${ctx.prompt ? `\nContext hint: "${ctx.prompt}"` : ''}${styleHint}${getTimeContext()}`,
      }

      const messages = [systemInstruction, ...chatMessages]

      const response = await chatCompletion({
        model: ctx.agentModel,
        messages: messages as any,
        temperature: 0.7,
        maxTokens: 1024,
      })

      return {
        content: response.trim(),
        type: 'text',
        visibility: 'normal' as const,
      }
    }

    // GHOST MODE (default): Generate multiple variants with action buttons
    const systemInstruction = {
      role: 'system' as const,
      content: `You are a reply assistant. Based on the chat history below, generate exactly ${numVariants} different reply variants that the user could send as their next message.

Rules:
- Each variant should have a different tone/approach (casual, detailed, witty, etc.)
- Write in the SAME language as the conversation
- Keep each variant concise (1-3 sentences)
- Separate variants with --- on its own line
- Do NOT add labels like "Variant 1:" — just write the reply text
- Match the conversation style and tone
- Do NOT generate generic greetings like "привет" — respond to the actual content
${ctx.prompt ? `\nUser's hint for replies: "${ctx.prompt}"` : ''}${styleHint}${getTimeContext()}`,
    }

    const messages = [systemInstruction, ...chatMessages]

    const response = await chatCompletion({
      model: ctx.agentModel,
      messages: messages as any,
      temperature: 0.8,
      maxTokens: 2048,
    })

    // Parse variants separated by ---
    const parsedVariants = response
      .split(/---+/)
      .map(v => v.trim())
      .filter(v => v.length > 0)

    if (parsedVariants.length >= 2) {
      // Build action buttons
      const actions = parsedVariants.map((v, i) => ({
        label: `${i + 1}`,
        action: 'send',
        value: v,
      }))
      // Add edit button with first variant
      actions.push({
        label: 'Edit',
        action: 'edit',
        value: parsedVariants[0],
      })

      return {
        content: parsedVariants.map((v, i) => `**${i + 1}.** ${v}`).join('\n\n'),
        type: 'text',
        visibility: 'ghost' as const,
        metadata: {
          agentName: 'Reply Assistant',
          actions,
        },
      }
    }

    // Fallback: single response without buttons
    return {
      content: response,
      type: 'text',
      visibility: 'ghost' as const,
      metadata: { agentName: 'Reply Assistant' },
    }
  },
}
