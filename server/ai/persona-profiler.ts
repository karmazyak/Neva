/**
 * Persona Profiler — builds a structured "digital twin" of a contact
 * Stage 1: Extract structured persona from chat history (cached)
 * Stage 2: Use persona for realistic simulation
 */

import { chatCompletion } from './openrouter'
import { getModelConfig } from './model-router'

export interface PersonaProfile {
  name: string
  // Linguistic traits
  linguistic: {
    avgMessageLength: 'short' | 'medium' | 'long'
    emojiUsage: 'none' | 'rare' | 'moderate' | 'heavy'
    punctuationStyle: string  // e.g. "minimal, no caps" or "formal with periods"
    language: string
    formality: number         // 0-1 scale
    signaturePatterns: string[] // characteristic phrases
    greeting: string          // typical greeting
    farewell: string          // typical sign-off
  }
  // Behavioral model
  behavioral: {
    agreeableness: number     // 0-1: how easily they agree
    directness: number        // 0-1: blunt vs diplomatic
    emotionalReactivity: number // 0-1: calm vs emotional
    humor: 'none' | 'dry' | 'playful' | 'sarcastic'
    decisionSpeed: 'quick' | 'deliberate' | 'avoidant'
    conflictStyle: 'confrontational' | 'diplomatic' | 'avoidant' | 'passive-aggressive'
  }
  // Contextual state
  currentState: {
    recentMood: string
    activeTopics: string[]
    pendingExpectations: string[]
    lastInteractionTone: string
  }
  // Relationship dynamics
  dynamics: {
    relationshipType: string
    powerDynamic: 'equal' | 'dominant' | 'submissive' | 'varies'
    sharedContext: string[]    // shared knowledge/history
    sensitiveTopics: string[] // topics to approach carefully
  }
  // Metadata
  extractedAt: number
  messageCountUsed: number
}

// In-memory cache: chatId:userId -> PersonaProfile
const personaCache = new Map<string, PersonaProfile>()
const CACHE_TTL = 4 * 60 * 60 * 1000 // 4 hours — profiles don't change rapidly
// Lowered from 5 to 2 for zero-shot bootstrap — better to have a low-confidence
// profile than no profile at all. The profile will be refined as more messages arrive.
const MIN_MESSAGES_FOR_PROFILE = 2

/**
 * D2: Update persona cache mood from mood radar
 */
export function updatePersonaMood(chatId: string, userId: string, mood: string) {
  const key = `${chatId}:${userId}`
  const cached = personaCache.get(key)
  if (cached && Date.now() - cached.extractedAt < CACHE_TTL) {
    cached.currentState.recentMood = mood
  }
}

export function getCachedPersona(chatId: string, userId: string): PersonaProfile | null {
  const key = `${chatId}:${userId}`
  const cached = personaCache.get(key)
  if (!cached) return null
  if (Date.now() - cached.extractedAt > CACHE_TTL) {
    personaCache.delete(key)
    return null
  }
  return cached
}

/**
 * Stage 1: Extract structured persona profile from chat history
 * Uses a strong model (claude-3.5-sonnet) for deep analysis
 */
export async function extractPersonaProfile(
  contactName: string,
  contactMessages: string[],
  fullChatHistory: string,
  relationshipType: string | null,
): Promise<PersonaProfile> {
  const config = getModelConfig('persona_extraction')

  // Only use contact's own messages for linguistic analysis
  const contactTextSample = contactMessages.slice(-50).join('\n')

  const result = await chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content: `You are a psycholinguistic profiler. Analyze the person's messages and build a detailed behavioral profile.

You MUST respond with valid JSON only. No markdown, no backticks, no explanation.

JSON schema:
{
  "linguistic": {
    "avgMessageLength": "short|medium|long",
    "emojiUsage": "none|rare|moderate|heavy",
    "punctuationStyle": "description of their punctuation habits",
    "language": "primary language code (ru/en/etc)",
    "formality": 0.0-1.0,
    "signaturePatterns": ["up to 5 characteristic phrases or patterns"],
    "greeting": "their typical greeting or empty string",
    "farewell": "their typical sign-off or empty string"
  },
  "behavioral": {
    "agreeableness": 0.0-1.0,
    "directness": 0.0-1.0,
    "emotionalReactivity": 0.0-1.0,
    "humor": "none|dry|playful|sarcastic",
    "decisionSpeed": "quick|deliberate|avoidant",
    "conflictStyle": "confrontational|diplomatic|avoidant|passive-aggressive"
  },
  "currentState": {
    "recentMood": "one word mood",
    "activeTopics": ["current topics they care about"],
    "pendingExpectations": ["things they seem to be waiting for"],
    "lastInteractionTone": "brief description of latest tone"
  },
  "dynamics": {
    "powerDynamic": "equal|dominant|submissive|varies",
    "sharedContext": ["shared knowledge or ongoing themes"],
    "sensitiveTopics": ["topics that seem sensitive for them"]
  }
}

Rules:
- Base ALL assessments on actual message evidence, not stereotypes
- signaturePatterns: actual phrases they use, verbatim
- If data is insufficient for a field, use reasonable defaults
- Focus on observable patterns, not assumptions`,
      },
      {
        role: 'user',
        content: `Person: "${contactName}"
Relationship: ${relationshipType || 'unknown'}

Their messages (most recent):
${contactTextSample}

Full conversation context:
${fullChatHistory.slice(-3000)}`,
      },
    ],
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  })

  try {
    // Clean potential markdown wrapping
    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned)

    const profile: PersonaProfile = {
      name: contactName,
      linguistic: {
        avgMessageLength: parsed.linguistic?.avgMessageLength || 'medium',
        emojiUsage: parsed.linguistic?.emojiUsage || 'rare',
        punctuationStyle: parsed.linguistic?.punctuationStyle || 'standard',
        language: parsed.linguistic?.language || 'ru',
        formality: parsed.linguistic?.formality ?? 0.5,
        signaturePatterns: parsed.linguistic?.signaturePatterns || [],
        greeting: parsed.linguistic?.greeting || '',
        farewell: parsed.linguistic?.farewell || '',
      },
      behavioral: {
        agreeableness: parsed.behavioral?.agreeableness ?? 0.5,
        directness: parsed.behavioral?.directness ?? 0.5,
        emotionalReactivity: parsed.behavioral?.emotionalReactivity ?? 0.5,
        humor: parsed.behavioral?.humor || 'none',
        decisionSpeed: parsed.behavioral?.decisionSpeed || 'deliberate',
        conflictStyle: parsed.behavioral?.conflictStyle || 'diplomatic',
      },
      currentState: {
        recentMood: parsed.currentState?.recentMood || 'neutral',
        activeTopics: parsed.currentState?.activeTopics || [],
        pendingExpectations: parsed.currentState?.pendingExpectations || [],
        lastInteractionTone: parsed.currentState?.lastInteractionTone || 'neutral',
      },
      dynamics: {
        relationshipType: relationshipType || 'other',
        powerDynamic: parsed.dynamics?.powerDynamic || 'equal',
        sharedContext: parsed.dynamics?.sharedContext || [],
        sensitiveTopics: parsed.dynamics?.sensitiveTopics || [],
      },
      extractedAt: Date.now(),
      messageCountUsed: contactMessages.length,
    }

    // Cache it
    personaCache.set(`profile:${contactName}`, profile)
    return profile
  } catch (e) {
    // Fallback minimal profile
    return {
      name: contactName,
      linguistic: {
        avgMessageLength: 'medium',
        emojiUsage: 'rare',
        punctuationStyle: 'standard',
        language: 'ru',
        formality: 0.5,
        signaturePatterns: [],
        greeting: '',
        farewell: '',
      },
      behavioral: {
        agreeableness: 0.5,
        directness: 0.5,
        emotionalReactivity: 0.5,
        humor: 'none',
        decisionSpeed: 'deliberate',
        conflictStyle: 'diplomatic',
      },
      currentState: {
        recentMood: 'neutral',
        activeTopics: [],
        pendingExpectations: [],
        lastInteractionTone: 'neutral',
      },
      dynamics: {
        relationshipType: relationshipType || 'other',
        powerDynamic: 'equal',
        sharedContext: [],
        sensitiveTopics: [],
      },
      extractedAt: Date.now(),
      messageCountUsed: contactMessages.length,
    }
  }
}

/**
 * Format persona profile as a compact prompt injection for simulation
 */
export function personaToPrompt(profile: PersonaProfile): string {
  const { linguistic: l, behavioral: b, currentState: s, dynamics: d } = profile

  return `=== PERSONA PROFILE: "${profile.name}" ===
WRITING STYLE:
- Message length: ${l.avgMessageLength}, Emoji: ${l.emojiUsage}, Formality: ${(l.formality * 100).toFixed(0)}%
- Punctuation: ${l.punctuationStyle}
- Language: ${l.language}
- Signature phrases: ${l.signaturePatterns.length > 0 ? l.signaturePatterns.map(p => `"${p}"`).join(', ') : 'none detected'}
- Greeting: "${l.greeting || 'varies'}", Farewell: "${l.farewell || 'varies'}"

BEHAVIORAL MODEL:
- Agreeableness: ${(b.agreeableness * 100).toFixed(0)}% | Directness: ${(b.directness * 100).toFixed(0)}%
- Emotional reactivity: ${(b.emotionalReactivity * 100).toFixed(0)}% | Humor: ${b.humor}
- Decision speed: ${b.decisionSpeed} | Conflict style: ${b.conflictStyle}

CURRENT STATE:
- Mood: ${s.recentMood} | Last tone: ${s.lastInteractionTone}
- Active topics: ${s.activeTopics.join(', ') || 'none'}
- Waiting for: ${s.pendingExpectations.join(', ') || 'nothing specific'}

DYNAMICS:
- Relationship: ${d.relationshipType} | Power: ${d.powerDynamic}
- Shared context: ${d.sharedContext.join(', ') || 'none'}
- Sensitive topics: ${d.sensitiveTopics.join(', ') || 'none detected'}
=== END PROFILE ===`
}

/**
 * Stage 2: Generate simulated response using persona profile
 * Returns main response + optional branches with confidence
 */
export interface SimulationResult {
  response: string
  confidence: number           // 0-100
  branches?: SimulationBranch[]
  innerMonologue?: string      // hidden reasoning
}

export interface SimulationBranch {
  response: string
  probability: number // 0-100
  label: string       // e.g. "Most likely", "Possible", "Unlikely"
}

export async function simulateWithPersona(
  profile: PersonaProfile,
  chatHistory: string,
  simHistory: string,
  userMessage: string,
  options: { branching?: boolean } = {},
): Promise<SimulationResult> {
  const config = getModelConfig('simulation')
  const personaPrompt = personaToPrompt(profile)

  const branchingInstruction = options.branching
    ? `\n\nAfter the MAIN response, also provide 2 alternative responses with probability estimates.

Format your output as JSON:
{
  "innerMonologue": "1 sentence: what would this person think before responding?",
  "mainResponse": "the most likely response",
  "confidence": 0-100,
  "branches": [
    { "response": "alternative response 1", "probability": 0-100, "label": "short label" },
    { "response": "alternative response 2", "probability": 0-100, "label": "short label" }
  ]
}`
    : `\n\nFormat your output as JSON:
{
  "innerMonologue": "1 sentence: what would this person think before responding?",
  "mainResponse": "the most likely response",
  "confidence": 0-100
}`

  const result = await chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content: `You are role-playing as "${profile.name}" in a chat conversation.

${personaPrompt}

CRITICAL RULES:
- You ARE this person. Write EXACTLY how they would write.
- Match their message length, emoji usage, punctuation, and language precisely.
- Use their signature phrases naturally when appropriate.
- Consider their current mood and behavioral traits when crafting the response.
- Account for the relationship dynamics and sensitive topics.
- Stay in character completely — never break the fourth wall.
- Your "confidence" score reflects how predictable this response is given the person's patterns.
${branchingInstruction}`,
      },
      {
        role: 'user',
        content: `Recent chat history:\n${chatHistory}\n\n${simHistory ? `Simulation so far:\n${simHistory}\n\n` : ''}User says: "${userMessage}"\n\nRespond as ${profile.name} would.`,
      },
    ],
    temperature: config.temperature,
    maxTokens: options.branching ? 800 : config.maxTokens,
  })

  try {
    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned)

    return {
      response: parsed.mainResponse || result,
      confidence: Math.min(100, Math.max(0, parsed.confidence ?? 70)),
      branches: parsed.branches?.map((b: any) => ({
        response: b.response,
        probability: Math.min(100, Math.max(0, b.probability ?? 20)),
        label: b.label || 'Alternative',
      })),
      innerMonologue: parsed.innerMonologue,
    }
  } catch {
    // Fallback: treat entire response as the main response
    return {
      response: result.trim(),
      confidence: 60,
    }
  }
}
