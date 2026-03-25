import type { Skill } from './registry'
import { analyzeStyle } from '../style/analyzer'
import { generateStyledVariants } from '../style/generator'
import { getCachedProfile, saveProfileToCache } from '../style/cache'
import { STYLE_PRESETS, getPresetById, getPresetAsFullProfile } from '../style/presets'
import { db, schema } from '../../db'
import { eq, and, desc } from 'drizzle-orm'

export const styleReplySkill: Skill = {
  id: 'style_reply',
  command: '/style',
  name: 'Style Reply',
  description: 'Generate reply in someone\'s communication style or choose a preset style',
  icon: '🎭',
  cost: 2,
  isAutoTrigger: false,
  inputType: 'text',
  inputDescription: 'Person name or preset style name, optionally with intent',
  outputDescription: 'Reply variants in the specified style',
  configSchema: {
    needsSystemPrompt: false,
    needsModel: true,
    needsTemperature: true,
    fields: [
      {
        key: 'defaultPreset',
        label: 'Default style preset',
        type: 'select',
        options: [
          { value: '', label: 'None (analyze from messages)' },
          ...STYLE_PRESETS.map(p => ({ value: p.id, label: `${p.icon} ${p.name}` })),
        ],
        defaultValue: '',
      },
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
    const chatMessages = (ctx.chatHistory || []).filter(m => m.role !== 'system')

    if (chatMessages.length === 0) {
      return {
        content: 'No chat history available to generate styled reply.',
        type: 'text',
        visibility: 'ghost' as const,
        metadata: { agentName: 'Style Assistant' },
      }
    }

    const numVariants = ctx.skillSettings?.variants || 3
    const defaultPreset = ctx.skillSettings?.defaultPreset || ''

    // Parse prompt: "/style Маша давай встретимся" or "/style casual_friendly привет"
    const prompt = ctx.prompt.trim()
    let targetName = ''
    let intent = ''

    if (prompt) {
      const parts = prompt.split(/\s+/)
      targetName = parts[0]
      intent = parts.slice(1).join(' ')
    }

    let profile

    // 1. Check if targetName matches a preset
    const preset = getPresetById(targetName) || STYLE_PRESETS.find(p =>
      p.name.toLowerCase() === targetName.toLowerCase() ||
      p.nameEn.toLowerCase() === targetName.toLowerCase()
    )

    if (preset) {
      profile = getPresetAsFullProfile(preset, ctx.userId)
    } else if (targetName) {
      // 2. Try to find user by name in chat members
      const members = db.select({
        userId: schema.chatMembers.userId,
        displayName: schema.users.displayName,
      })
        .from(schema.chatMembers)
        .innerJoin(schema.users, eq(schema.chatMembers.userId, schema.users.id))
        .where(eq(schema.chatMembers.chatId, ctx.chatId))
        .all()

      const match = members.find(m =>
        m.displayName.toLowerCase().includes(targetName.toLowerCase())
      )

      if (match) {
        // Check cache
        const cached = getCachedProfile(match.userId, ctx.userId, ctx.chatId)
        if (cached) {
          profile = cached.profile
        } else {
          try {
            profile = await analyzeStyle(match.userId, ctx.chatId, ctx.agentModel)
            saveProfileToCache(match.userId, ctx.userId, profile, ctx.chatId)
          } catch {
            // Not enough messages — suggest presets
            const presetList = STYLE_PRESETS
              .map(p => `${p.icon} **${p.name}** — ${p.description}`)
              .join('\n')

            return {
              content: `Недостаточно сообщений от ${match.displayName} для анализа стиля.\n\nДоступные стили:\n${presetList}\n\nИспользуй: /style ${STYLE_PRESETS[0].id} [текст]`,
              type: 'text',
              visibility: 'ghost' as const,
              metadata: { agentName: 'Style Assistant' },
            }
          }
        }
      } else {
        // No user found, no preset found — use default or suggest
        if (defaultPreset) {
          const dp = getPresetById(defaultPreset)
          if (dp) profile = getPresetAsFullProfile(dp, ctx.userId)
        }

        if (!profile) {
          intent = prompt // Treat entire prompt as intent
          const dp = getPresetById('casual_friendly')!
          profile = getPresetAsFullProfile(dp, ctx.userId)
        }
      }
    } else if (defaultPreset) {
      const dp = getPresetById(defaultPreset)
      if (dp) profile = getPresetAsFullProfile(dp, ctx.userId)
    }

    if (!profile) {
      const presetList = STYLE_PRESETS
        .map(p => `${p.icon} **${p.name}** (\`${p.id}\`) — ${p.description}`)
        .join('\n')

      return {
        content: `Укажи имя человека или стиль:\n\n/style Маша [текст]\n/style casual_friendly [текст]\n\nДоступные стили:\n${presetList}`,
        type: 'text',
        visibility: 'ghost' as const,
        metadata: { agentName: 'Style Assistant' },
      }
    }

    // Generate variants
    const variants = await generateStyledVariants({
      profile,
      chatHistory: chatMessages as any,
      intent: intent || undefined,
      model: ctx.agentModel,
      variants: numVariants,
    })

    if (variants.length >= 2) {
      const actions = variants.map((v, i) => ({
        label: `${i + 1}`,
        action: 'send',
        value: v,
      }))
      actions.push({
        label: 'Edit',
        action: 'edit',
        value: variants[0],
      })

      return {
        content: `🎭 **В стиле ${profile.sourceName}** (${profile.confidence === 'high' ? '✅ точный' : profile.confidence === 'medium' ? '⚡ средний' : '⚠️ приблизительный'}):\n\n${variants.map((v, i) => `**${i + 1}.** ${v}`).join('\n\n')}`,
        type: 'text',
        visibility: 'ghost' as const,
        metadata: {
          agentName: 'Style Assistant',
          actions,
        },
      }
    }

    return {
      content: `🎭 **В стиле ${profile.sourceName}:**\n\n${variants[0]}`,
      type: 'text',
      visibility: 'ghost' as const,
      metadata: { agentName: 'Style Assistant' },
    }
  },
}
