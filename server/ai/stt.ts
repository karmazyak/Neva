// STT (Speech-to-Text) integration
// Primary: NVIDIA Parakeet via local microservice
// Fallback: OpenRouter Whisper API

const STT_URL = process.env.STT_URL || 'http://127.0.0.1:8000'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''

export async function transcribeAudio(audioPath: string): Promise<string> {
  // Download the audio file first
  const audioUrl = audioPath.startsWith('http')
    ? audioPath
    : `http://localhost:${process.env.PORT || 3000}${audioPath}`

  const audioResponse = await fetch(audioUrl)
  if (!audioResponse.ok) {
    throw new Error(`Failed to download audio: ${audioResponse.status}`)
  }

  const audioBlob = await audioResponse.blob()

  // Try local STT service first
  const localAvailable = await isSTTAvailable()
  if (localAvailable) {
    try {
      const formData = new FormData()
      formData.append('file', audioBlob, 'audio.ogg')

      const response = await fetch(`${STT_URL}/transcribe`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(30_000), // 30s timeout
      })

      if (response.ok) {
        const result = await response.json() as { text: string }
        if (result.text?.trim()) return result.text
      }
    } catch (e) {
      console.log('Local STT failed, trying OpenRouter fallback:', e)
    }
  }

  // Fallback: Use OpenRouter's Whisper model
  if (OPENROUTER_API_KEY) {
    try {
      const formData = new FormData()
      formData.append('file', audioBlob, 'audio.webm')
      formData.append('model', 'openai/whisper-1')

      const response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://mlsendger.app',
          'X-Title': 'MLSendger',
        },
        body: formData,
        signal: AbortSignal.timeout(30_000),
      })

      if (response.ok) {
        const result = await response.json() as { text: string }
        if (result.text?.trim()) return result.text
      }

      // If Whisper API doesn't work, try chat-based transcription hint
      console.log('Whisper API failed, audio transcription unavailable')
    } catch (e) {
      console.log('OpenRouter STT fallback failed:', e)
    }
  }

  throw new Error('Speech-to-text service unavailable. Please try again later.')
}

export async function isSTTAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${STT_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}
