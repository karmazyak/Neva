const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any>
  }
}

export interface CompletionOptions {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  stream?: boolean
  tools?: ToolDefinition[]
}

export interface CompletionResult {
  content: string | null
  tool_calls: ToolCall[] | null
}

export async function chatCompletion(options: CompletionOptions): Promise<string> {
  const result = await chatCompletionWithTools(options)
  return result.content || ''
}

export async function chatCompletionWithTools(options: CompletionOptions): Promise<CompletionResult> {
  const body: Record<string, any> = {
    model: options.model,
    messages: options.messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 2048,
  }

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools
  }

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://mlsendger.app',
      'X-Title': 'MLSendger',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    if (response.status === 402) {
      return { content: null, tool_calls: null }
    }
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`)
  }

  const data = await response.json() as any
  const message = data.choices?.[0]?.message
  return {
    content: message?.content || null,
    tool_calls: message?.tool_calls || null,
  }
}

export async function generateImage(prompt: string): Promise<string> {
  // Use OpenRouter's image generation endpoint
  // This creates an image via DALL-E 3 or similar models
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
        prompt,
        n: 1,
        size: '1024x1024',
      }),
    })

    if (response.ok) {
      const data = await response.json() as any
      // Returns URL to generated image
      const imageUrl = data.data?.[0]?.url || data.data?.[0]?.b64_json
      if (imageUrl) {
        // If it's base64, convert to data URL
        if (data.data?.[0]?.b64_json) {
          return `data:image/png;base64,${data.data[0].b64_json}`
        }
        return imageUrl
      }
    }

    // Fallback: use a chat model to describe the image and generate via placeholder service
    console.log('Image generation API failed, using AI description fallback')
    const description = await chatCompletion({
      model: 'openai/gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Generate a very detailed visual description in English (max 100 words) for image generation. Only output the description, nothing else.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.8,
      maxTokens: 200,
    })

    // Use a placeholder image service with the description encoded
    const encodedPrompt = encodeURIComponent(prompt.slice(0, 50))
    const placeholderUrl = `https://placehold.co/512x512/1a1a2e/5288c1?text=${encodedPrompt}`

    // Return description with placeholder — the message will be type 'image' with text fallback
    return `🎨 **${prompt}**\n\n${description}\n\n_[Image generation via DALL-E is available with OpenRouter credits]_`
  } catch (error) {
    console.error('Image generation error:', error)
    return `🎨 **Image: ${prompt}**\n\n_Image generation temporarily unavailable. The agent described your request but couldn't render it._`
  }
}

export async function getAvailableModels(): Promise<{ id: string; name: string }[]> {
  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/models`, {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      },
    })
    const data = await response.json() as any
    return (data.data || []).map((m: any) => ({
      id: m.id,
      name: m.name || m.id,
    }))
  } catch {
    return [
      { id: 'openai/gpt-4o', name: 'GPT-4o' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
      { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B' },
      { id: 'mistralai/mistral-large-latest', name: 'Mistral Large' },
    ]
  }
}
