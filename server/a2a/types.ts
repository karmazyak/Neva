// ── A2A Protocol Types (from spec v0.3) ─────────────────────────────────────

// === Agent Card ===

export interface AgentCard {
  name: string
  description: string
  url: string
  provider?: { organization: string; url?: string }
  version?: string
  capabilities: {
    streaming: boolean
    pushNotifications: boolean
  }
  skills: AgentSkill[]
  securitySchemes?: Record<string, SecurityScheme>
  security?: Record<string, string[]>[]
}

export interface AgentSkill {
  id: string
  name: string
  description: string
  inputModes: string[]
  outputModes: string[]
  tags?: string[]
}

export interface SecurityScheme {
  type: 'http' | 'apiKey' | 'oauth2' | 'openIdConnect'
  scheme?: string
  in?: string
  name?: string
}

// === Task ===

export type TaskState =
  | 'pending'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'canceled'

export interface Task {
  id: string
  contextId?: string
  status: TaskStatus
  artifacts?: Artifact[]
  history?: A2AMessage[]
  metadata?: Record<string, unknown>
}

export interface TaskStatus {
  state: TaskState
  message?: A2AMessage
  timestamp: string
}

// === Message ===

export interface A2AMessage {
  role: 'user' | 'agent'
  parts: Part[]
  metadata?: Record<string, unknown>
}

export type Part =
  | TextPart
  | DataPart
  | FilePart

export interface TextPart {
  type: 'text'
  text: string
}

export interface DataPart {
  type: 'data'
  mimeType: string
  data: string
}

export interface FilePart {
  type: 'file'
  mimeType: string
  uri: string
}

export interface Artifact {
  name?: string
  description?: string
  parts: Part[]
  metadata?: Record<string, unknown>
}

// === JSON-RPC 2.0 ===

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: JsonRpcError
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

export const JSONRPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // A2A-specific
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  UNAUTHORIZED: -32003,
} as const

// === Send Message Params ===

export interface SendMessageParams {
  message: A2AMessage
  configuration?: {
    acceptedOutputModes?: string[]
    blocking?: boolean
    timeout?: number
  }
  metadata?: {
    taskId?: string
    contextId?: string
    skillId?: string
  }
}

// === Event Bus Types ===

export type TaskEvent =
  | { type: 'status'; state: TaskState; message?: A2AMessage }
  | { type: 'artifact'; artifact: Artifact }
  | { type: 'done' }

// ── Internal Network Types ──────────────────────────────────────────────────

export type NeedCategory = 'professional' | 'social' | 'care'
export type OfferCategory = 'professional' | 'social' | 'hobby'
export type Urgency = 'now' | 'this_week' | 'whenever'
export type Visibility = 'friends' | 'friends_of_friends' | 'network'
export type NeedStatus = 'active' | 'matched' | 'expired' | 'cancelled'
export type MatchStatus = 'proposed' | 'accepted' | 'declined' | 'completed'
export type ConsentStatus = 'pending' | 'approved' | 'denied' | 'expired'
export type ConsentType = 'availability' | 'match_offer' | 'info'

export type RelationshipLevel = 'acquaintance' | 'friend' | 'close'

export interface AccessRule {
  dataType: string
  minRelationship: RelationshipLevel
  requiresConsent: boolean
}

export interface MatchCandidate {
  userId: string
  offerId: string
  offerDescription: string
  similarity: number
  trustScore: number
  socialDistance: number
  mutualContactId?: string
  mutualContactName?: string
  finalScore: number
}
