// Use OPENAI_API_KEY if available, otherwise fallback to OPENROUTER for embeddings
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''

const API_KEY = OPENAI_API_KEY || OPENROUTER_API_KEY
const BASE_URL = OPENAI_API_KEY
  ? 'https://api.openai.com/v1'
  : 'https://openrouter.ai/api/v1'
const EMBEDDING_MODEL = 'openai/text-embedding-3-small'

if (!API_KEY) {
  console.warn('[EMBEDDINGS] WARNING: No API key set for embeddings. Set OPENAI_API_KEY or OPENROUTER_API_KEY.')
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!API_KEY) {
    throw new Error('No API key configured for embeddings')
  }

  const response = await fetch(`${BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      ...(OPENAI_API_KEY ? {} : {
        'HTTP-Referer': 'https://mlsendger.app',
        'X-Title': 'MLSendger',
      }),
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000),
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Embedding API error ${response.status}: ${err}`)
  }

  const data = await response.json() as {
    data: Array<{ embedding: number[] }>
  }

  return data.data[0].embedding
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (!API_KEY) {
    throw new Error('No API key configured for embeddings')
  }

  const response = await fetch(`${BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      ...(OPENAI_API_KEY ? {} : {
        'HTTP-Referer': 'https://mlsendger.app',
        'X-Title': 'MLSendger',
      }),
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts.map(t => t.slice(0, 8000)),
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Embedding API error ${response.status}: ${err}`)
  }

  const data = await response.json() as {
    data: Array<{ embedding: number[]; index: number }>
  }

  return data.data
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding)
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}
