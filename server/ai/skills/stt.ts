import type { Skill } from './registry'
import { transcribeAudio, isSTTAvailable } from '../stt'

export const sttSkill: Skill = {
  id: 'stt',
  command: '/transcribe',
  name: 'Speech-to-Text',
  description: 'Transcribe audio/voice messages to text',
  icon: '🎤',
  cost: 1,
  isAutoTrigger: false,
  inputType: 'audio',
  inputDescription: 'Audio/voice message',
  outputDescription: 'Transcribed text',
  configSchema: {
    needsSystemPrompt: false,
    needsModel: false,
    needsTemperature: false,
    fields: [
      {
        key: 'language',
        label: 'Language',
        type: 'select',
        defaultValue: 'auto',
        options: [
          { label: 'Auto-detect', value: 'auto' },
          { label: 'Russian', value: 'ru' },
          { label: 'English', value: 'en' },
        ],
      },
    ],
  },

  async execute(ctx) {
    const available = await isSTTAvailable()
    if (!available) {
      return {
        content: '🎤 STT service unavailable. Please try again later.',
        type: 'text',
        visibility: 'ghost' as const,
        metadata: { agentName: 'Scribe' },
      }
    }

    // The prompt should contain the audio file URL
    const audioUrl = ctx.prompt.trim()
    if (!audioUrl) {
      return {
        content: '🎤 No audio file provided for transcription.',
        type: 'text',
        visibility: 'ghost' as const,
        metadata: { agentName: 'Scribe' },
      }
    }

    try {
      const text = await transcribeAudio(audioUrl)
      return {
        content: `🎤 **Транскрипция:**\n\n${text}`,
        type: 'text',
        visibility: 'ghost' as const,
        metadata: { agentName: 'Scribe' },
      }
    } catch (error: any) {
      return {
        content: `🎤 Transcription failed: ${error.message}`,
        type: 'text',
        visibility: 'ghost' as const,
        metadata: { agentName: 'Scribe' },
      }
    }
  },
}
