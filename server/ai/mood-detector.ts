/**
 * Mood Detector — rule-based pre-filter for emotion detection
 * Analyzes messages for mood signals WITHOUT LLM calls.
 * Only escalates to LLM when signals are ambiguous.
 *
 * v2: Baseline-aware detection — compares against per-contact norms
 * instead of absolute thresholds. If Лёха always writes in caps,
 * that's HIS normal — not a negative signal.
 */

import type { CommunicationBaseline } from './contact-intelligence'

// Emoji sentiment clusters
const POSITIVE_EMOJI = /[\u{1F600}-\u{1F606}\u{1F609}-\u{1F60D}\u{1F618}\u{1F617}\u{1F619}\u{1F61A}\u{1F970}\u{1F60F}\u{1F642}\u{1F643}\u{2764}\u{1F49A}-\u{1F49F}\u{1F389}\u{1F38A}\u{1F973}\u{2705}\u{1F44D}\u{1F44F}\u{1F525}]/gu

const NEGATIVE_EMOJI = /[\u{1F614}\u{1F622}\u{1F62D}\u{1F61E}\u{1F61F}\u{1F620}\u{1F621}\u{1F624}\u{1F616}\u{1F623}\u{1F629}\u{1F62B}\u{1F630}\u{1F631}\u{1F633}\u{1F641}\u{2639}\u{1F494}\u{1F4A2}\u{1F44E}]/gu

export interface MoodSignal {
  needsLLM: boolean
  hintMood: 'positive' | 'negative' | 'neutral' | null
  signals: string[]
  /** Deviation signals detected by baseline comparison (v2) */
  deviations: string[]
}

/**
 * Quick rule-based mood signal detection from recent messages.
 * v2: accepts optional baseline for per-contact deviation detection.
 */
export function quickMoodSignal(
  messages: string[],
  previousMood: string = 'neutral',
  baseline?: CommunicationBaseline | null,
): MoodSignal {
  if (messages.length === 0) {
    return { needsLLM: false, hintMood: null, signals: [], deviations: [] }
  }

  const signals: string[] = []
  const deviations: string[] = []
  let positiveScore = 0
  let negativeScore = 0
  const hasBaseline = baseline && baseline.sampleSize >= 20

  // 1. Emoji sentiment analysis
  let totalPositiveEmoji = 0
  let totalNegativeEmoji = 0
  for (const msg of messages) {
    totalPositiveEmoji += (msg.match(POSITIVE_EMOJI) || []).length
    totalNegativeEmoji += (msg.match(NEGATIVE_EMOJI) || []).length
  }

  if (totalNegativeEmoji >= 3) {
    negativeScore += 2
    signals.push(`negative_emoji_cluster (${totalNegativeEmoji} negative emoji)`)
  } else if (totalNegativeEmoji >= 1) {
    negativeScore += 1
    signals.push(`negative_emoji (${totalNegativeEmoji})`)
  }

  if (totalPositiveEmoji >= 3) {
    positiveScore += 2
    signals.push(`positive_emoji_cluster (${totalPositiveEmoji} positive emoji)`)
  }

  // v2: Baseline-aware emoji deviation
  if (hasBaseline) {
    const currentPositiveRate = totalPositiveEmoji / messages.length
    // If they usually use lots of positive emoji but suddenly stopped
    if (baseline.positiveEmojiRate > 0.3 && currentPositiveRate < baseline.positiveEmojiRate * 0.3) {
      negativeScore += 1
      deviations.push(`positive_emoji_drop (usual: ${baseline.positiveEmojiRate.toFixed(2)}/msg, now: ${currentPositiveRate.toFixed(2)})`)
    }
  }

  // 2. Punctuation density
  const exclamationCount = messages.reduce((c, m) => c + (m.match(/!{2,}/g) || []).length, 0)
  const ellipsisCount = messages.reduce((c, m) => c + (m.match(/\.{3,}/g) || []).length, 0)

  if (exclamationCount >= 2) {
    signals.push(`emphatic_punctuation (${exclamationCount} !! patterns)`)
  }

  // v2: Only flag ellipsis if it's unusual for this person
  const currentEllipsisRate = ellipsisCount / messages.length
  if (hasBaseline) {
    if (currentEllipsisRate > baseline.ellipsisFrequency * 3 && currentEllipsisRate > 0.2) {
      negativeScore += 1
      deviations.push(`ellipsis_spike (usual: ${(baseline.ellipsisFrequency * 100).toFixed(0)}%, now: ${(currentEllipsisRate * 100).toFixed(0)}%)`)
    }
  } else if (ellipsisCount >= 2) {
    negativeScore += 1
    signals.push(`excessive_ellipsis (${ellipsisCount} ... patterns)`)
  }

  // 3. Message length change — v2: compare to THEIR baseline, not just recent window
  const recentAvgLength = messages.reduce((s, m) => s + m.length, 0) / messages.length

  if (hasBaseline && baseline.stdMessageLength > 0) {
    const zScore = (recentAvgLength - baseline.avgMessageLength) / baseline.stdMessageLength
    if (zScore < -2) {
      negativeScore += 2
      deviations.push(`message_length_drop (z=${zScore.toFixed(1)}, usual: ${baseline.avgMessageLength} chars, now: ${Math.round(recentAvgLength)})`)
    } else if (zScore < -1.5) {
      negativeScore += 1
      deviations.push(`message_length_decrease (z=${zScore.toFixed(1)}, usual: ${baseline.avgMessageLength}, now: ${Math.round(recentAvgLength)})`)
    }
  } else if (messages.length >= 3) {
    // Fallback: compare recent vs older within this batch
    const recentBatchAvg = messages.slice(0, 3).reduce((s, m) => s + m.length, 0) / 3
    const olderBatchAvg = messages.slice(3).reduce((s, m) => s + m.length, 0) / Math.max(1, messages.length - 3)
    if (olderBatchAvg > 0 && recentBatchAvg < olderBatchAvg * 0.5) {
      negativeScore += 1
      signals.push('message_length_drop (recent messages much shorter)')
    }
  }

  // 4. All-caps detection — v2: only flag if unusual for this person
  const capsMessages = messages.filter(m => m.length > 3 && m === m.toUpperCase() && /[A-ZА-ЯЁ]/.test(m))
  const currentCapsRate = capsMessages.length / messages.length

  if (hasBaseline) {
    if (currentCapsRate > baseline.capsFrequency * 3 && currentCapsRate > 0.1 && capsMessages.length >= 1) {
      negativeScore += 1
      deviations.push(`caps_spike (usual: ${(baseline.capsFrequency * 100).toFixed(0)}%, now: ${(currentCapsRate * 100).toFixed(0)}%)`)
    }
    // Skip if caps is their normal style
  } else if (capsMessages.length >= 1) {
    negativeScore += 1
    signals.push(`all_caps (${capsMessages.length} messages in ALL CAPS)`)
  }

  // 5. Negative keyword patterns
  const negativePatterns = /\b(ужас|плохо|грустно|устал|бесит|злюсь|ненавижу|хреново|отстой|достало|надоело|невозможно|кошмар|horrible|terrible|awful|hate|angry|sad|tired|exhausted|frustrated|depressed|worst)\b/gi
  const negHits = messages.reduce((c, m) => c + (m.match(negativePatterns) || []).length, 0)
  const currentNegKeywordRate = negHits / messages.length

  if (hasBaseline) {
    // Only flag if significantly above their normal negative keyword rate
    if (currentNegKeywordRate > baseline.negativeKeywordRate * 2.5 && negHits >= 1) {
      negativeScore += currentNegKeywordRate > baseline.negativeKeywordRate * 4 ? 2 : 1
      deviations.push(`negative_keyword_spike (usual: ${(baseline.negativeKeywordRate * 100).toFixed(0)}%, now: ${(currentNegKeywordRate * 100).toFixed(0)}%)`)
    }
  } else {
    if (negHits >= 2) {
      negativeScore += 2
      signals.push(`negative_keywords (${negHits} matches)`)
    } else if (negHits === 1) {
      negativeScore += 1
      signals.push(`negative_keyword (${negHits} match)`)
    }
  }

  // 6. Positive keyword patterns
  const positivePatterns = /\b(круто|класс|отлично|супер|ура|замечательно|прекрасно|здорово|великолепно|awesome|great|amazing|wonderful|fantastic|excited|love|perfect|brilliant)\b/gi
  const posHits = messages.reduce((c, m) => c + (m.match(positivePatterns) || []).length, 0)
  if (posHits >= 2) {
    positiveScore += 2
    signals.push(`positive_keywords (${posHits} matches)`)
  }

  // Determine hint mood
  let hintMood: MoodSignal['hintMood'] = null
  if (positiveScore >= 3 && negativeScore <= 1) {
    hintMood = 'positive'
  } else if (negativeScore >= 3 && positiveScore <= 1) {
    hintMood = 'negative'
  } else if (positiveScore > 0 || negativeScore > 0) {
    hintMood = 'neutral' // mixed signals
  }

  // v2: Baseline deviations can also hint mood
  if (deviations.length >= 2 && !hintMood) {
    hintMood = 'negative'
    signals.push('multiple_baseline_deviations')
  }

  // Determine if LLM is needed
  const needsLLM =
    // Ambiguous signals
    (positiveScore > 0 && negativeScore > 0) ||
    // Weak signal that differs from previous mood
    (hintMood !== null && hintMood !== previousMoodCategory(previousMood)) ||
    // No clear signal but previous mood was concerning
    (signals.length === 0 && (previousMood === 'stressed' || previousMood === 'seems_off')) ||
    // v2: Multiple baseline deviations warrant deeper analysis
    (deviations.length >= 2)

  return { needsLLM, hintMood, signals, deviations }
}

function previousMoodCategory(mood: string): 'positive' | 'negative' | 'neutral' {
  const m = mood.toLowerCase()
  if (['happy', 'excited', 'cheerful', 'good', 'great', 'positive', 'радостный', 'хороший', 'веселый', 'счастливый'].some(w => m.includes(w))) return 'positive'
  if (['sad', 'stressed', 'angry', 'upset', 'frustrated', 'seems_off', 'anxious', 'грустный', 'злой', 'раздраженный', 'расстроенный', 'стресс'].some(w => m.includes(w))) return 'negative'
  return 'neutral'
}
