import { showToast } from '../components/ui/Toast'

const API_BASE = '/api'

class ApiClient {
  private token: string | null = null

  setToken(token: string | null) {
    this.token = token
    if (token) {
      localStorage.setItem('token', token)
    } else {
      localStorage.removeItem('token')
    }
  }

  getToken(): string | null {
    if (!this.token) {
      this.token = localStorage.getItem('token')
    }
    return this.token
  }

  private async request<T>(path: string, options: RequestInit = {}, requestOptions?: { silent?: boolean }): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    }

    const token = this.getToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const silent = requestOptions?.silent

    let response: Response
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
      })
    } catch (err) {
      if (!silent) showToast('error', 'Network error — server is unavailable')
      throw new Error('Network error')
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }))
      const message = error.error || 'Request failed'
      if (!silent) {
        if (response.status >= 500) {
          showToast('error', `Server error: ${message}`)
        } else if (response.status === 401) {
          // Don't toast for auth errors (handled by auth flow)
        } else if (response.status !== 404) {
          showToast('error', message)
        }
      }
      throw new Error(message)
    }

    return response.json()
  }

  // Auth
  async register(data: { username: string; displayName: string; email: string; password: string }) {
    return this.request<{ token: string; user: any }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async login(data: { login: string; password: string }) {
    return this.request<{ token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getMe() {
    return this.request<any>('/auth/me')
  }

  // Chats
  async getChats() {
    return this.request<any[]>('/chats')
  }

  async createChat(data: { type?: string; name?: string; description?: string; avatar?: string; memberIds: string[] }) {
    return this.request<{ id: string }>('/chats', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateChat(chatId: string, data: { name?: string; description?: string; avatar?: string }) {
    return this.request<any>(`/chats/${chatId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async addChatMembers(chatId: string, memberIds: string[]) {
    return this.request<any>(`/chats/${chatId}/members`, {
      method: 'POST',
      body: JSON.stringify({ memberIds }),
    })
  }

  async removeChatMember(chatId: string, memberId: string) {
    return this.request<any>(`/chats/${chatId}/members/${memberId}`, { method: 'DELETE' })
  }

  async getChatMessages(chatId: string, limit = 50, includeGhost = false) {
    const params = new URLSearchParams({ limit: String(limit) })
    if (includeGhost) params.set('include_ghost', 'true')
    return this.request<any[]>(`/chats/${chatId}/messages?${params}`)
  }

  async searchUsers(query: string) {
    return this.request<any[]>(`/chats/users/search?q=${encodeURIComponent(query)}`)
  }

  // Delta sync — get changes since a timestamp
  async syncMessages(since: number) {
    return this.request<{ messages: { new: any[]; edited: any[] }; timestamp: number }>(`/chats/sync?since=${since}`)
  }

  // Messages
  async sendMessage(data: { chatId: string; content: string; type?: string; replyToId?: string; metadata?: Record<string, any> }) {
    return this.request<any>('/messages', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async editMessage(messageId: string, content: string) {
    return this.request<{ ok: boolean; content: string; editedAt: string }>(`/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    })
  }

  async forwardMessage(messageId: string, targetChatId: string) {
    return this.request<any>(`/messages/${messageId}/forward`, {
      method: 'POST',
      body: JSON.stringify({ targetChatId }),
    })
  }

  // Agents
  async getAgents() {
    return this.request<any[]>('/agents')
  }

  async createAgent(data: any) {
    return this.request<any>('/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateAgent(agentId: string, data: any) {
    return this.request<any>(`/agents/${agentId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteAgent(agentId: string) {
    return this.request<any>(`/agents/${agentId}`, { method: 'DELETE' })
  }

  async assignAgent(data: { agentId: string; chatId: string; triggerMode?: string }) {
    return this.request<any>('/agents/assign', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async removeAgentFromChat(chatId: string) {
    return this.request<any>(`/agents/assign/${chatId}`, { method: 'DELETE' })
  }

  async getAgentConfig(chatId: string) {
    return this.request<any>(`/agents/config/${chatId}`)
  }

  // Agent-aware skills (from user's installed agents)
  async getMySkills() {
    return this.request<any[]>('/agents/my-skills')
  }

  // Command aliases
  async setCommandAlias(data: { agentId: string; skillId: string; customCommand: string }) {
    return this.request<any>('/agents/command-alias', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async deleteCommandAlias(aliasId: string) {
    return this.request<any>(`/agents/command-alias/${aliasId}`, { method: 'DELETE' })
  }

  async getAgentAliases(agentId: string) {
    return this.request<any[]>(`/agents/${agentId}/aliases`)
  }

  // Marketplace
  async getMarketplace(params?: { category?: string; q?: string; sort?: string }) {
    const clean: Record<string, string> = {}
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') clean[k] = v
      }
    }
    const query = new URLSearchParams(clean).toString()
    return this.request<any[]>(`/marketplace${query ? '?' + query : ''}`)
  }

  async getMarketplaceAgent(agentId: string) {
    return this.request<any>(`/marketplace/${agentId}`)
  }

  async installAgent(agentId: string) {
    return this.request<any>(`/marketplace/${agentId}/install`, { method: 'POST' })
  }

  // Models
  async getModels() {
    return this.request<{ id: string; name: string }[]>('/models')
  }

  // AI Direct Chat
  async aiChat(data: { message: string; agentId?: string; model?: string; clearHistory?: boolean; autopilot?: boolean; mission?: boolean; missionChatId?: string }) {
    return this.request<{
      response: string
      model: string
      toolsUsed?: string[]
      pendingActions?: {
        id: string
        type: 'send_message'
        chatId: string
        chatName: string
        content: string
      }[]
      autopilotEvents?: {
        type: 'message_sent' | 'waiting_reply' | 'reply_received' | 'task_complete' | 'task_failed'
        chatName?: string
        content?: string
        timestamp: string
      }[]
      missionPlan?: {
        goal: string
        strategy: string
        steps: number
        riskLevel: string
      }
      historyLength: number
    }>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async confirmAiAction(actionId: string) {
    return this.request<{ ok: boolean; message: string }>('/ai/confirm-action', {
      method: 'POST',
      body: JSON.stringify({ actionId }),
    })
  }

  async clearAiHistory() {
    return this.request<any>('/ai/chat/history', { method: 'DELETE' })
  }

  // AI Privacy & Security
  async getAiPrivacy() {
    return this.request<{
      userId: string
      aiEnabled: boolean
      excludedChats: string[]
      dataMasking: boolean
      auditLogEnabled: boolean
    }>('/ai/privacy')
  }

  async updateAiPrivacy(data: { aiEnabled?: boolean; excludedChats?: string[]; dataMasking?: boolean; auditLogEnabled?: boolean }) {
    return this.request<{ ok: boolean }>('/ai/privacy', {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async getAiAuditLog(limit = 50) {
    return this.request<any[]>(`/ai/audit-log?limit=${limit}`)
  }

  // Skills
  async executeSkill(data: { chatId: string; command: string; prompt: string }) {
    return this.request<{ ok: boolean; messageId: string; skill: string; cost: number }>('/agents/skill', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getAvailableSkills() {
    return this.request<any[]>('/agents/skills')
  }

  // Pipelines (per robot)
  async getAgentPipelines(agentId: string) {
    return this.request<any[]>(`/agents/${agentId}/pipelines`)
  }

  async createAgentPipeline(agentId: string, data: any) {
    return this.request<any>(`/agents/${agentId}/pipelines`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // Methods registry
  async getMethods() {
    return this.request<any[]>('/agents/pipeline-methods')
  }

  // Triggers
  async getTriggers() {
    return this.request<any[]>('/triggers')
  }

  async createTrigger(data: any) {
    return this.request<any>('/triggers', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateTrigger(triggerId: string, data: any) {
    return this.request<any>(`/triggers/${triggerId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteTrigger(triggerId: string) {
    return this.request<any>(`/triggers/${triggerId}`, { method: 'DELETE' })
  }

  async toggleTrigger(triggerId: string) {
    return this.request<any>(`/triggers/${triggerId}/toggle`, { method: 'POST' })
  }

  // Schedule
  async getAgentSchedule(agentId: string) {
    return this.request<any>(`/agents/${agentId}/schedule`)
  }

  async saveAgentSchedule(agentId: string, data: any) {
    return this.request<any>(`/agents/${agentId}/schedule`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async runAgentSchedule(agentId: string) {
    return this.request<any>(`/agents/${agentId}/schedule/run`, { method: 'POST' })
  }

  // Billing
  async getBalance() {
    return this.request<{ balance: number }>('/billing/balance')
  }

  async getUsageHistory() {
    return this.request<any[]>('/billing/history')
  }

  // AI Tools - Text Transformation, Analysis, Briefing, Context
  async transformText(data: { text: string; mode: string; context?: string }) {
    return this.request<{ result: string }>('/ai/tools/transform', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async analyzeMessage(data: { text: string; action: string; chatContext?: string; chatId?: string }) {
    return this.request<{ result: string | string[] }>('/ai/tools/analyze', {
      method: 'POST',
      body: JSON.stringify(data),
    }, { silent: true })
  }

  async getChatBriefing(data: { chatId: string; messageCount?: number }) {
    return this.request<{ briefing: string | null }>('/ai/tools/briefing', {
      method: 'POST',
      body: JSON.stringify(data),
    }, { silent: true })
  }

  async getChatContext(data: { chatId: string; query?: string; forceRefresh?: boolean }) {
    return this.request<{ result: any; type: string; cached?: boolean }>('/ai/tools/context', {
      method: 'POST',
      body: JSON.stringify(data),
    }, { silent: true })
  }

  // Style — writing style cloning
  async getStylePresets() {
    return this.request<{ presets: Array<{ id: string; name: string; nameEn: string; description: string; icon: string }> }>('/ai/style/presets')
  }

  async getStyleProfiles() {
    return this.request<{ profiles: Array<{ id: string; userId: string; chatId: string | null; sourceName: string; messageCount: number; confidence: string }> }>('/ai/style/profiles')
  }

  async generateStyled(data: { chatId: string; targetUserId?: string; presetId?: string; intent?: string; model?: string }) {
    return this.request<{ reply: string; styleName: string }>('/ai/style/generate', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getMyStyleProfile() {
    return this.request<{ profile: any; updatedAt: string | null; messageCount: number }>('/ai/style/my-profile')
  }

  async reanalyzeMyStyle() {
    return this.request<{ profile: any }>('/ai/style/my-profile/reanalyze', { method: 'POST' })
  }

  async deleteMyStyleProfile() {
    return this.request<{ ok: boolean }>('/ai/style/my-profile', { method: 'DELETE' })
  }

  // === NEW FEATURES ===

  // Reactions
  async addReaction(messageId: string, emoji: string) {
    return this.request<{ ok: boolean }>(`/messages/${messageId}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) })
  }
  async removeReaction(messageId: string, emoji: string) {
    return this.request<{ ok: boolean }>(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, { method: 'DELETE' })
  }

  // Pinned messages
  async pinMessage(messageId: string) {
    return this.request<{ ok: boolean }>(`/messages/${messageId}/pin`, { method: 'POST' })
  }
  async unpinMessage(messageId: string) {
    return this.request<{ ok: boolean }>(`/messages/${messageId}/pin`, { method: 'DELETE' })
  }
  async getPinnedMessages(chatId: string) {
    return this.request<any[]>(`/chats/${chatId}/pinned`)
  }

  // Search
  async searchChatMessages(chatId: string, query: string, limit = 20) {
    return this.request<any[]>(`/chats/${chatId}/search?q=${encodeURIComponent(query)}&limit=${limit}`)
  }

  // Saved messages
  async saveMessage(messageId: string, chatId: string) {
    return this.request<{ ok: boolean }>('/saved', { method: 'POST', body: JSON.stringify({ messageId, chatId }) })
  }
  async unsaveMessage(messageId: string) {
    return this.request<{ ok: boolean }>(`/saved/${messageId}`, { method: 'DELETE' })
  }
  async getSavedMessages() {
    return this.request<any[]>('/saved')
  }

  // Folders
  async getFolders() {
    return this.request<any[]>('/folders')
  }
  async createFolder(data: { name: string; icon?: string }) {
    return this.request<{ id: string }>('/folders', { method: 'POST', body: JSON.stringify(data) })
  }
  async deleteFolder(folderId: string) {
    return this.request<{ ok: boolean }>(`/folders/${folderId}`, { method: 'DELETE' })
  }
  async addChatToFolder(folderId: string, chatId: string) {
    return this.request<{ ok: boolean }>(`/folders/${folderId}/chats`, { method: 'POST', body: JSON.stringify({ chatId }) })
  }

  // Scheduled messages
  async scheduleMessage(data: { chatId: string; content: string; type?: string; sendAt: string }) {
    return this.request<{ id: string }>('/messages/schedule', { method: 'POST', body: JSON.stringify(data) })
  }
  async getScheduledMessages(chatId?: string) {
    return this.request<any[]>(`/messages/scheduled${chatId ? '?chatId=' + chatId : ''}`)
  }
  async cancelScheduledMessage(id: string) {
    return this.request<{ ok: boolean }>(`/messages/scheduled/${id}`, { method: 'DELETE' })
  }

  // User status
  async updateStatus(data: { statusText?: string; statusEmoji?: string }) {
    return this.request<{ ok: boolean }>('/auth/status', { method: 'PUT', body: JSON.stringify(data) })
  }

  // Update profile
  async updateProfile(data: { displayName?: string }) {
    return this.request<{ ok: boolean }>('/auth/profile', { method: 'PUT', body: JSON.stringify(data) })
  }

  // Disappearing messages
  async setDisappearTimer(chatId: string, timer: number | null) {
    return this.request<{ ok: boolean }>(`/chats/${chatId}/disappear`, { method: 'PUT', body: JSON.stringify({ timer }) })
  }

  // Push notifications
  async getVapidKey() {
    return this.request<{ publicKey: string }>('/push/vapid-key')
  }
  async subscribePush(data: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    return this.request<{ ok: boolean }>('/push/subscribe', { method: 'POST', body: JSON.stringify(data) })
  }
  async unsubscribePush(endpoint: string) {
    return this.request<{ ok: boolean }>('/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) })
  }

  // Credit estimation
  async estimateSkillCost(command: string) {
    return this.request<{ cost: number; skillName: string }>(`/billing/estimate?command=${encodeURIComponent(command)}`)
  }

  // Marketplace reviews
  async addReview(agentId: string, data: { rating: number; reviewText?: string }) {
    return this.request<{ ok: boolean }>(`/marketplace/${agentId}/review`, { method: 'POST', body: JSON.stringify(data) })
  }
  async getReviews(agentId: string) {
    return this.request<any[]>(`/marketplace/${agentId}/reviews`)
  }

  // Delete message
  async deleteMessage(messageId: string) {
    return this.request<{ ok: boolean }>(`/messages/${messageId}`, { method: 'DELETE' })
  }

  // Transcribe voice message
  async transcribeMessage(messageId: string) {
    return this.request<{ transcription: string }>(`/messages/${messageId}/transcribe`, { method: 'POST' })
  }

  // Batch operations
  async batchForward(messageIds: string[], targetChatId: string) {
    return this.request<{ count: number }>('/messages/batch/forward', { method: 'POST', body: JSON.stringify({ messageIds, targetChatId }) })
  }

  // Onboarding
  async completeOnboarding() {
    return this.request<{ ok: boolean }>('/auth/onboarding-complete', { method: 'POST' })
  }

  // Meeting summary
  async getMeetingSummary(chatId: string, messageLimit?: number) {
    return this.request<{ summary: string | null }>('/ai/tools/meeting-summary', { method: 'POST', body: JSON.stringify({ chatId, messageLimit }) }, { silent: true })
  }

  // Contact context
  async getContactContext(chatId: string) {
    return this.request<{ context: string | null; lastInteraction?: string }>('/ai/tools/contact-context', { method: 'POST', body: JSON.stringify({ chatId }) }, { silent: true })
  }

  // Proactive Nudges — morning briefing
  async getNudges() {
    return this.request<{
      nudges: Array<{ chatId: string; chatName: string; type: string; text: string; priority: string }>
      summary: string | null
    }>('/ai/tools/nudges', { method: 'POST' }, { silent: true })
  }

  // Person Context — relationship intelligence
  async getPersonContext(chatId: string) {
    return this.request<{
      person: {
        name: string
        username?: string
        communicationStyle: string
        avgResponseTime: string
        activeHours: string
        sharedTopics: string[]
        unresolvedItems: string[]
        moodTrend: string
        moodNote: string
        totalMessages: number
      } | null
    }>('/ai/tools/person-context', { method: 'POST', body: JSON.stringify({ chatId }) }, { silent: true })
  }

  // Tone Advisor — check message tone
  async checkTone(chatId: string, text: string) {
    return this.request<{ needsWarning: boolean; warning?: string; suggestion?: string }>('/ai/tools/tone-check', { method: 'POST', body: JSON.stringify({ chatId, text }) }, { silent: true })
  }

  // Conversation Simulation (v2: persona-based with branching + confidence)
  async simulateChat(chatId: string, userMessage: string, history?: Array<{ role: string; content: string }>, branching?: boolean) {
    return this.request<{
      response: string
      personName: string
      confidence?: number
      branches?: Array<{ response: string; probability: number; label: string }>
      innerMonologue?: string
      hasPersona?: boolean
    }>('/ai/tools/simulate', { method: 'POST', body: JSON.stringify({ chatId, userMessage, history, branching }) }, { silent: true })
  }

  // Strategic Mission Plan — get strategies before mission launch
  async getMissionPlan(chatId: string, goal: string) {
    return this.request<{
      context: { personName: string; relationshipType: string; mood: string; communicationStyle: string; persona: any | null }
      strategies: Array<{
        id: string; name: string; description: string; draftMessage: string
        simulatedResponse: string; successRate: string; confidence: number
        recommended: boolean; pastExperience: string | null
      }>
      lessonsFromPast: string | null
    }>('/ai/tools/mission-plan', { method: 'POST', body: JSON.stringify({ chatId, goal }) }, { silent: true })
  }

  // Set active goal for tone advisor
  async setGoal(chatId: string, goal: string, strategy: string) {
    return this.request<{ ok: boolean }>('/ai/tools/set-goal', { method: 'POST', body: JSON.stringify({ chatId, goal, strategy }) })
  }

  // Mood check for family/friend chats
  async checkMood(chatId: string) {
    return this.request<{ mood: string; note: string | null; confidence: number }>('/ai/tools/mood-check', { method: 'POST', body: JSON.stringify({ chatId }) }, { silent: true })
  }

  // Persona Profile — get/extract digital twin profile
  async getPersonaProfile(chatId: string) {
    return this.request<{
      persona: {
        name: string
        linguistic: { avgMessageLength: string; emojiUsage: string; language: string; formality: number; signaturePatterns: string[] }
        behavioral: { agreeableness: number; directness: number; humor: string; decisionSpeed: string; conflictStyle: string }
        currentState: { recentMood: string; activeTopics: string[]; pendingExpectations: string[] }
        dynamics: { relationshipType: string; powerDynamic: string; sensitiveTopics: string[] }
      } | null
      cached: boolean
    }>('/ai/tools/persona', { method: 'POST', body: JSON.stringify({ chatId }) }, { silent: true })
  }
}

export const api = new ApiClient()
