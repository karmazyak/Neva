import { Hono } from 'hono'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth'
import { analyzeStyle } from '../ai/style/analyzer'
import { generateStyledReply, generateStyledVariants } from '../ai/style/generator'
import { getCachedProfile, saveProfileToCache, listProfiles, deleteProfile, getOwnProfileForDisplay, deleteOwnProfile } from '../ai/style/cache'
import { STYLE_PRESETS, getPresetById, getPresetAsFullProfile } from '../ai/style/presets'
import { db, schema } from '../db'
import { eq, and, desc } from 'drizzle-orm'

const style = new Hono()
style.use('*', authMiddleware)

// ============================
// Analyze a person's writing style
// ============================
const analyzeSchema = z.object({
  targetUserId: z.string(),
  chatId: z.string().optional(),
  model: z.string().optional(),
  forceRefresh: z.boolean().optional(),
})

style.post('/analyze', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const parsed = analyzeSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  const { targetUserId, chatId, model, forceRefresh } = parsed.data

  try {
    // Check cache first
    if (!forceRefresh) {
      const cached = getCachedProfile(targetUserId, userId, chatId)
      if (cached) {
        return c.json({
          profile: cached.profile,
          fromCache: true,
          message: `Style profile loaded from cache (${cached.messageCount} messages analyzed)`,
        })
      }
    }

    // Analyze
    const profile = await analyzeStyle(targetUserId, chatId, model)

    // Cache result
    saveProfileToCache(targetUserId, userId, profile, chatId)

    return c.json({
      profile,
      fromCache: false,
      message: `Analyzed ${profile.messageCount} messages. Confidence: ${profile.confidence}`,
    })
  } catch (error: any) {
    return c.json({ error: error.message || 'Analysis failed' }, 500)
  }
})

// ============================
// Generate reply in someone's style
// ============================
const generateSchema = z.object({
  targetUserId: z.string().optional(),
  presetId: z.string().optional(),
  chatId: z.string(),
  intent: z.string().optional(),
  model: z.string().optional(),
  variants: z.number().min(1).max(5).optional(),
})

style.post('/generate', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const parsed = generateSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400)

  const { targetUserId, presetId, chatId, intent, model, variants } = parsed.data

  try {
    // Get style profile — from cache, preset, or fresh analysis
    let profile
    if (presetId) {
      const preset = getPresetById(presetId)
      if (!preset) return c.json({ error: `Preset not found: ${presetId}` }, 404)
      profile = getPresetAsFullProfile(preset, userId)
    } else if (targetUserId) {
      const cached = getCachedProfile(targetUserId, userId, chatId)
      if (cached) {
        profile = cached.profile
      } else {
        // Auto-analyze
        profile = await analyzeStyle(targetUserId, chatId, model)
        saveProfileToCache(targetUserId, userId, profile, chatId)
      }
    } else {
      return c.json({ error: 'Provide targetUserId or presetId' }, 400)
    }

    // Load chat history
    const chatHistory = db.select({
      senderId: schema.messages.senderId,
      content: schema.messages.content,
    })
      .from(schema.messages)
      .where(and(
        eq(schema.messages.chatId, chatId),
        eq(schema.messages.visibility, 'normal'),
        eq(schema.messages.type, 'text'),
      ))
      .orderBy(desc(schema.messages.createdAt))
      .limit(20)
      .all()
      .reverse()
      .map(msg => ({
        role: (msg.senderId === userId ? 'assistant' : 'user') as 'user' | 'assistant',
        content: msg.content,
      }))

    if (variants && variants > 1) {
      const results = await generateStyledVariants({
        profile,
        chatHistory,
        intent,
        model,
        variants,
      })
      return c.json({ variants: results, styleName: profile.sourceName })
    }

    const result = await generateStyledReply({
      profile,
      chatHistory,
      intent,
      model,
    })

    return c.json({ reply: result, styleName: profile.sourceName })
  } catch (error: any) {
    return c.json({ error: error.message || 'Generation failed' }, 500)
  }
})

// ============================
// List saved style profiles
// ============================
style.get('/profiles', async (c) => {
  const userId = c.get('userId')
  const profiles = listProfiles(userId)
  return c.json({ profiles })
})

// ============================
// Delete a style profile
// ============================
style.delete('/profiles/:profileId', async (c) => {
  const userId = c.get('userId')
  const profileId = c.req.param('profileId')
  const deleted = deleteProfile(profileId, userId)
  return c.json({ ok: deleted })
})

// ============================
// Get style presets
// ============================
style.get('/presets', async (c) => {
  const presets = STYLE_PRESETS.map(p => ({
    id: p.id,
    name: p.name,
    nameEn: p.nameEn,
    description: p.description,
    icon: p.icon,
  }))
  return c.json({ presets })
})

// ============================
// Get own style profile for Profile page
// ============================
style.get('/my-profile', async (c) => {
  const userId = c.get('userId')
  const data = getOwnProfileForDisplay(userId)
  if (!data) return c.json({ profile: null })
  return c.json({
    profile: data.profile,
    updatedAt: data.updatedAt,
    messageCount: data.messageCount,
  })
})

// ============================
// Force re-analyze own style
// ============================
style.post('/my-profile/reanalyze', async (c) => {
  const userId = c.get('userId')
  try {
    const profile = await analyzeStyle(userId) // cross-chat
    saveProfileToCache(userId, userId, profile, undefined, 'global')
    return c.json({ profile })
  } catch (error: any) {
    return c.json({ error: error.message || 'Analysis failed' }, 500)
  }
})

// ============================
// Delete own style profile
// ============================
style.delete('/my-profile', async (c) => {
  const userId = c.get('userId')
  deleteOwnProfile(userId)
  return c.json({ ok: true })
})

export default style
