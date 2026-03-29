# A2A Network: Technical Research Report

> Version 1.0, 2026-03-29. Researcher: Claude Opus 4.6.
> Covers all 6 research tasks from `scripts/a2a-tech-research.md`.

---

## Table of Contents

1. [Real-Time Group Coordination Architecture](#1-real-time-group-coordination-architecture)
2. [Proactive Matching Engine](#2-proactive-matching-engine)
3. [Context-Aware Availability](#3-context-aware-availability)
4. [Knowledge Graph for Matching](#4-knowledge-graph-for-matching)
5. [A2A Protocol Completeness](#5-a2a-protocol-completeness)
6. [LLM Call Optimization](#6-llm-call-optimization)
7. [Architecture Decision Records](#7-architecture-decision-records)
8. [Proposed DB Schema Changes](#8-proposed-db-schema-changes)
9. [Implementation Roadmap](#9-implementation-roadmap)
10. [Open Questions for Product](#10-open-questions-for-product)

---

## 1. Real-Time Group Coordination Architecture

### 1.1. Current State

The existing system already has a parent-child dialog pattern for "Who's Free?" (`server/a2a/agent-skills-internal.ts`, lines 28-95):

- `handleWhosFree()` creates a **parent dialog** (self-referencing, `targetUserId = initiatorUserId`, status `approved` meaning "tracking")
- For each friend, it creates a **child dialog** linked via `parentDialogId`
- Auto-resolved children immediately stream `partialResult` via WebSocket to the initiator
- `handleWhosFreeChildResponse()` (lines 101-169) aggregates child responses and checks `allResolved`

**Key finding:** The parent-child pattern is solid but **only supports 1-to-1 request-response**. There is no concept of multi-round coordination (voting, cascading, follow-up).

### 1.2. State Machine for Multi-Party Coordination

**Recommended approach:** Extend the existing `agentDialogs` table with a new `type` enum and add a `groupCoordination` table for tracking multi-party state.

**Proposed state machine for group coordination:**

```
INTENT_PARSED → TARGETING → POLLING → AGGREGATING → COORDINATING → COMPLETED
                                                          ↓
                                                     CANCELLED
```

States:
- **INTENT_PARSED** — NLP parsed the user's request into structured intent
- **TARGETING** — Smart targeting selected subset of friends
- **POLLING** — Child dialogs created, waiting for responses
- **AGGREGATING** — Enough responses received, generating summary
- **COORDINATING** — Follow-up phase (choosing venue, time, etc.)
- **COMPLETED** — Group created or action taken

**How it maps to current code:**

The parent dialog (`contextData.isParent === true`) already tracks state implicitly. Recommendation: add an explicit `phase` field to `contextData` JSON rather than adding a new column. This avoids a migration for what is essentially workflow metadata.

```typescript
// contextData for group coordination parent dialog
interface GroupCoordinationContext {
  isParent: true
  phase: 'targeting' | 'polling' | 'aggregating' | 'coordinating' | 'completed'
  intent: ParsedIntent  // from NLP
  selectedFriends: string[]  // smart targeting result
  responses: Record<string, { available: boolean; message?: string; auto: boolean; respondedAt: number }>
  coordinationOptions?: CoordinationOption[]  // venue/time options
  votes?: Record<string, string>  // userId -> optionId
}
```

### 1.3. Voting/Polling Through Agent Dialogs

**Approach:** Reuse `agentDialogs` with a new type `group_poll`.

Each poll option becomes a child dialog message, not a separate dialog. The parent dialog tracks votes in `contextData.votes`.

**Flow:**
1. Initiator creates parent dialog with `type: 'group_poll'`, `contextData: { options: [...], question: "..." }`
2. For each participant: create child dialog with `type: 'group_poll'`
3. Child dialog's `contextData` includes the options
4. Response = `resultData: { selectedOption: "option_id" }`
5. Parent aggregates in `handleGroupPollChildResponse()`

**WebSocket events (extend existing patterns):**
```typescript
// New events (same shape as existing agent_dialog_update)
{ type: 'agent_dialog_update', dialogId: parentId, partialResult: { friendId, friendName, vote: "option_id" } }
{ type: 'agent_dialog_update', dialogId: parentId, status: 'poll_complete', summary: { winner: "...", votes: {...} } }
```

**Complexity:** M (Medium) — reuses existing dialog infrastructure, new handler function similar to `handleWhosFreeChildResponse`.

### 1.4. Cascade Invitations

**Problem:** If Masha declines, offer to Olya instead.

**Approach:** Add a `fallbackQueue` to parent dialog's `contextData`:

```typescript
interface CascadeContext extends GroupCoordinationContext {
  targetCount: number  // how many people we want
  confirmedCount: number
  fallbackQueue: string[]  // ordered list of backup friends
  askedSet: Set<string>  // already asked
}
```

When a child dialog resolves as `denied` and `confirmedCount < targetCount`:
1. Pop next friend from `fallbackQueue`
2. Create new child dialog
3. Continue polling

**Implementation:** Add a `checkCascade()` call inside `handleWhosFreeChildResponse()` after line 169. If `denied && fallbackQueue.length > 0`, create new child dialog.

**Complexity:** S (Small) — ~50 lines of new code in `agent-skills-internal.ts`.

### 1.5. WebSocket Scalability for Group Events

**Current state (`server/ws.ts`):**
- `sendToUser()` (line 412) iterates over user's WebSocket connections (max 5 per user, line 20)
- Rate limit: 30 messages/second per connection (line 36-37)
- No batching — each `partialResult` is a separate `ws.send()` call

**Finding:** For a "Who's Free?" with 10 friends, the initiator receives up to ~20 WebSocket events (10 partial results + status updates). With 50 friends, ~100 events. This is **well within the rate limit** (30/sec) since responses are spread over minutes/hours.

**Recommendation:** No batching needed for MVP. For Phase 2, consider:
- Debounce partial results: buffer for 500ms, send batch
- Use `ws.cork()` (already used in `broadcastToChat`, line 372) for atomic multi-message sends

**Complexity:** S — no changes needed for MVP.

---

## 2. Proactive Matching Engine

### 2.1. Current Proactive Engine Analysis

The proactive engine (`server/ai/proactive-engine.ts`) runs every 15 minutes via `scheduler.ts` (line 30-34). It already supports 9 trigger types including `detected_need` (line 29). However, `detected_need` is **defined but never triggered** — there is no code path that creates this trigger.

**Current trigger detection is fully rule-based** (no LLM for detection). Only one LLM call per triggered action to generate the notification text (`generateAction()`, line 371).

### 2.2. Implicit Need Detection from Messages

**Recommended approach:** Add need detection as a new trigger in `scanUserTriggers()`.

**Two-tier detection strategy:**

**Tier 1: Rule-based keyword detection (zero LLM cost)**
```typescript
const NEED_PATTERNS = [
  /(?:(?:не )?знаешь|подскажи|посоветуй|ищу|нужен|нужна|нужно)\s+(.{5,50})/i,
  /кто.{0,20}(?:разбирается|умеет|может|знает|занимается)/i,
  /(?:где найти|как найти|кто может)\s+(.{5,50})/i,
  /(?:нет (?:хорошего|нормального|толкового))\s+(.{5,30})/i,
]
```

Scan the last N messages from each chat. If pattern matches, create `detected_need` trigger. The existing `generateAction()` will produce the nudge text.

**Tier 2: LLM classification for ambiguous cases (optional, Phase 2)**
Only when rule-based detection is uncertain. Use `classification` model (Haiku, ~$0.0001/call).

**Integration point:** Add after the BURST TRIGGER block in `scanUserTriggers()` (after line 217):

```typescript
// ── DETECTED NEED TRIGGER ──
if (isPersonal) {
  for (const msg of recentMsgs.filter(m => m.senderId !== userId)) {
    try {
      const text = await decrypt(msg.content)
      for (const pattern of NEED_PATTERNS) {
        if (pattern.test(text)) {
          triggers.push({
            userId, chatId: chat.chatId, chatName,
            type: 'detected_need',
            context: `В переписке с ${chatName} обнаружена потребность: "${text.slice(0, 100)}"`,
          })
          break // one trigger per chat per scan
        }
      }
    } catch {}
  }
}
```

### 2.3. Trigger-Based vs Periodic Scan

| Approach | Latency | LLM Cost | Complexity |
|---|---|---|---|
| **Periodic scan (current)** | Up to 15 min delay | 0 for detection | Already implemented |
| **Event-driven (on message)** | Real-time | 0 (rule-based) | S — add to `quickProactiveCheck()` |
| **Hybrid** | Real-time for burst/need, 15min for rest | 0 | M — best option |

**Recommendation:** Hybrid. Add need detection to `quickProactiveCheck()` (line 319) for real-time detection, keep periodic scan for silence/mood/goal_stall triggers.

### 2.4. Privacy: Matching Without Revealing Data

**Critical finding:** The product vision document (section 3.2) explicitly states: "implicit needs/offers НИКОГДА не шарятся без explicit consent."

**Proposed privacy flow:**
1. **Detection** — Agent detects need from User A's conversation (stored locally as `source: 'detected'` in `needs` table)
2. **Nudge** — Shows nudge ONLY to User A: "Noticed you're looking for X. Search your network?"
3. **Explicit consent** — User A clicks "Search" (converts implicit need to explicit search)
4. **Matching** — Standard matching flow using `findMatchingOffers()` from `server/ai/matching.ts`
5. **Provider consent** — Provider's agent asks for consent via `handleMatchProposal()`

**Key:** The `needs.source` field already supports `'detected'` vs `'explicit'` (schema line 422). Detected needs should NEVER be visible to others or used in matching until user converts them.

### 2.5. Cost Analysis

- Need detection (rule-based): **$0** per scan
- Nudge generation (if triggered): **~$0.001** per nudge (1 Haiku call, ~200 tokens)
- Expected triggers per 15-min scan with 100 users: ~5-10 detected needs
- Monthly cost estimate: ~$1-3 for need detection nudges

**Complexity:** M (Medium) for rule-based Tier 1, L (Large) for LLM-based Tier 2.

---

## 3. Context-Aware Availability

### 3.1. Current Availability Signals

The system already gathers rich context in `analyzeUserContext()` (`server/a2a/agent-dialog.ts`, lines 88-195):

1. **Recent messages** — last 15 messages across all chats (lines 98-111), decrypted
2. **Mood history** — from `contact_intelligence.moodHistory` (lines 126-138)
3. **Active goals** — from `userGoals` (lines 141-145)
4. **LLM decision** — classification model determines approve/deny/ask (lines 147-184)

**Problem:** This is called per-friend inside `createDialog()`. For "Who's Free?" with 10 friends, that is **10 independent LLM calls** analyzing the same friend's context.

### 3.2. Availability Signals Without Direct Question

**Signal sources already in the system:**

| Signal | Source | Confidence | Privacy Cost |
|---|---|---|---|
| Last message time | `messages.createdAt` | High | Low — only timing, not content |
| Online status | `users.online`, `users.lastSeen` | High | Low |
| Mood | `contactIntelligence.moodHistory` | Medium | Medium — derived from messages |
| Active topics | `contactIntelligence.persona.currentState.activeTopics` | Low | Medium |
| Communication baseline | `contactIntelligence.communicationBaseline` | Medium | Low — statistical |
| Active goals | `userGoals` (if shared) | Medium | High — requires consent |

**New signals to add (no new data collection needed):**

1. **Activity recency score:** `score = 1 - min(hoursSinceLastMessage / 24, 1)`. Already computable from `messages.createdAt`.

2. **Typical activity hours:** From `communicationBaseline`, extend with `activeHours: number[]` (24-element array, message frequency per hour). Compare current hour to typical pattern.

3. **Response latency:** Average time between receiving and replying to messages. Already partially tracked in `communicationBaseline.avgResponseTimeMs` (currently TODO, line 308 of contact-intelligence.ts).

### 3.3. Confidence Scoring for Availability Prediction

**Proposed formula (rule-based, no LLM):**

```typescript
function predictAvailability(userId: string, targetUserId: string, chatId: string): {
  score: number  // 0-1
  confidence: number  // 0-1
  signals: string[]
} {
  let score = 0.5  // neutral baseline
  let confidence = 0.3  // low confidence without data
  const signals: string[] = []

  // Signal 1: Online status (weight: 0.3)
  if (isUserOnline(targetUserId)) {
    score += 0.3
    confidence += 0.2
    signals.push('online now')
  }

  // Signal 2: Recent activity (weight: 0.2)
  const lastMsgHours = getHoursSinceLastMessage(targetUserId)
  if (lastMsgHours < 1) { score += 0.2; signals.push('active in last hour') }
  else if (lastMsgHours < 4) { score += 0.1; signals.push('active recently') }
  else if (lastMsgHours > 24) { score -= 0.1; signals.push('inactive 24h+') }

  // Signal 3: Mood (weight: 0.15)
  const mood = getLatestMood(userId, chatId)
  if (mood) {
    confidence += 0.1
    if (['stressed', 'busy', 'tired'].includes(mood.mood)) {
      score -= 0.15; signals.push(`mood: ${mood.mood}`)
    }
    if (['happy', 'relaxed', 'good'].includes(mood.mood)) {
      score += 0.1; signals.push(`mood: ${mood.mood}`)
    }
  }

  // Signal 4: Time of day (weight: 0.1)
  const hour = new Date().getHours()
  if (hour >= 23 || hour < 7) { score -= 0.2; signals.push('late/early hours') }

  // Signal 5: Unanswered messages (weight: 0.1)
  // If they have many unanswered messages, probably busy
  const unanswered = getUnansweredCount(targetUserId)
  if (unanswered > 5) { score -= 0.1; signals.push('many unanswered messages') }

  return { score: Math.max(0, Math.min(1, score)), confidence: Math.min(1, confidence), signals }
}
```

**Trade-off decision:** Rule-based scoring is ~0ms latency and $0 LLM cost. Accuracy is lower but sufficient for "soft" predictions. LLM-based analysis (current `analyzeUserContext()`) remains as the authoritative decision for actual auto-approve/deny.

### 3.4. Privacy Trade-Off

**Key principle from product vision:** "Не показывать, что агент читает переписки."

**Recommendation:**
- **Availability prediction** (rule-based): OK to use timing/online data. Do NOT expose which signals were used.
- **Auto-approve/deny** (LLM): Current implementation reads last 15 messages. This is acceptable because the agent acts on BEHALF of the user, not exposing data to others.
- **UI display:** Show confidence as "Скорее всего свободен" / "Возможно занят" without explaining why.

**Complexity:** M — new `predictAvailability()` function + integration with smart targeting.

---

## 4. Knowledge Graph for Matching

### 4.1. Current Knowledge Graph State

Table `contactKnowledgeGraph` (`schema.ts`, lines 390-410) already exists with:
- `entities`: Array of `{ id, name, type, attributes }` where type includes `person`, `interest`, `work`, `event`, etc.
- `relations`: Array of `{ from, to, type, confidence, firstMentioned, lastMentioned }`

**Critical finding:** This table is per-user-per-contact-per-chat. It stores entities mentioned in conversations but **there is no cross-user graph**. User A's knowledge about Contact B is separate from User C's knowledge about Contact B.

### 4.2. Building a Social Knowledge Graph

**Challenge:** To answer "Who among my friends knows ML?" we need:
1. Aggregate facts across `contact_memory` and `contactKnowledgeGraph` tables
2. Query by entity type + keywords across multiple contacts
3. Optionally traverse friends-of-friends

**Option A: SQLite JSON queries (recommended for MVP)**

SQLite supports `json_each()` and `json_extract()`. We can query the knowledge graph without a separate graph store:

```sql
-- Find contacts with 'interest' entity matching 'ML' or 'machine learning'
SELECT DISTINCT ci.contact_id, u.display_name, je.value->>'name' as interest
FROM contact_knowledge_graph ci,
     json_each(ci.entities) je
JOIN users u ON ci.contact_id = u.id
WHERE ci.user_id = ?
  AND je.value->>'type' = 'interest'
  AND (je.value->>'name' LIKE '%ML%' OR je.value->>'name' LIKE '%machine learning%')
```

**Also query `contact_memory` for work/preference facts:**

```sql
SELECT DISTINCT cm.contact_id, u.display_name, cm.fact
FROM contact_memory cm
JOIN users u ON cm.contact_id = u.id
WHERE cm.user_id = ?
  AND cm.is_active = 1
  AND cm.category IN ('work', 'preference')
  AND (cm.fact LIKE '%ML%' OR cm.fact LIKE '%machine learning%')
```

**Option B: Separate graph table (recommended for Phase 2)**

For friends-of-friends traversal and efficient graph queries, add a dedicated `social_graph_edges` table:

```typescript
export const socialGraphEdges = sqliteTable('social_graph_edges', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  fromUserId: text('from_user_id').notNull().references(() => users.id),
  toUserId: text('to_user_id').notNull().references(() => users.id),
  edgeType: text('edge_type', { enum: ['knows', 'has_skill', 'has_interest', 'works_at', 'lives_in'] }).notNull(),
  label: text('label').notNull(),  // "React developer", "photography", "Google"
  confidence: real('confidence').default(0.7),
  source: text('source', { enum: ['explicit', 'detected', 'inferred'] }).notNull().default('detected'),
  lastConfirmedAt: integer('last_confirmed_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})
```

### 4.3. Graph Traversal for Friends-of-Friends

**Current state:** `getFriendsOfFriends()` in `server/ai/matching.ts` (lines 30-47) already does 2-hop traversal via `getDirectContacts()` calls. It is O(n * m) where n = direct contacts, m = their contacts.

**Performance concern:** For a user with 50 contacts, each having 50 contacts, this is 50 * 50 = 2500 DB queries (each `getDirectContacts()` is 1 query). This is slow.

**Optimization:** Replace iterative queries with a single SQL query:

```sql
-- 2-hop contacts in one query
SELECT DISTINCT cm2.user_id, cm1.user_id as via
FROM chat_members cm1
JOIN chat_members cm2 ON cm1.chat_id = cm2.chat_id
WHERE cm1.user_id IN (
  SELECT DISTINCT cm0.user_id
  FROM chat_members cm0
  WHERE cm0.chat_id IN (
    SELECT chat_id FROM chat_members WHERE user_id = ?
  ) AND cm0.user_id != ?
)
AND cm2.user_id != ?
AND cm2.user_id NOT IN (
  SELECT user_id FROM chat_members
  WHERE chat_id IN (SELECT chat_id FROM chat_members WHERE user_id = ?)
)
```

This reduces 2500 queries to 1 query. For SQLite, this is under 10ms even with 10K users.

### 4.4. Incremental Graph Updates

**Trigger points (already exist):**
1. `runIncrementalAnalysis()` in `contact-intelligence.ts` (line 372) — updates persona including `activeTopics`
2. `extractNewFacts()` in `memory-manager.ts` (line 81) — extracts facts with categories

**Proposal:** After `persistFacts()` completes, also update `socialGraphEdges`:
- `category: 'work'` fact "works as designer" → edge `(contactId, -, has_skill, "designer")`
- `category: 'preference'` fact "loves photography" → edge `(contactId, -, has_interest, "photography")`

This is a synchronous side-effect, no additional LLM calls.

### 4.5. SQLite vs Separate Graph Store

| Approach | Pros | Cons |
|---|---|---|
| **SQLite JSON queries** | No new dependency, existing schema | Slow for large graphs (>10K edges), no native graph traversal |
| **SQLite with edge table** | Fast indexed queries, no new dependency | Still no native graph ops, need manual BFS |
| **Separate graph DB (Neo4j/etc)** | Native graph traversal, efficient for 3+ hops | New dependency, operational overhead, overkill for <1K users |

**Decision: SQLite with edge table (Option B).** Reasoning:
- Current user base is small (<1K users)
- 2-hop traversal is sufficient for MVP
- No new infrastructure needed
- Can migrate to graph DB later if needed

**Complexity:** M (Medium) for Option A (JSON queries), L (Large) for Option B (edge table + incremental updates).

---

## 5. A2A Protocol Completeness

### 5.1. Current Executor State

The file `server/a2a/types.ts` defines the full JSON-RPC 2.0 and A2A spec types (AgentCard, Task, Message, Artifact, etc.) but there is **no executor.ts file** in the current checked-out code. The research brief mentions "A2A skills в executor.ts — стабы" but this file appears to have been removed or renamed.

**What exists instead:**
- `server/a2a/agent-dialog.ts` — the actual dialog lifecycle (create, respond, cancel, expire)
- `server/a2a/agent-skills-internal.ts` — the skill handlers (whos_free, get_interests, match_proposal, consent)

These are **internal skills** operating within a single server instance. They do NOT implement the A2A JSON-RPC protocol for inter-server communication.

### 5.2. Inter-Server Communication Gap

**Current architecture:** All users are on one server. Agent dialogs are direct DB operations + WebSocket notifications within the same process.

**For multi-instance A2A:**
1. Need an HTTP endpoint that accepts JSON-RPC requests per A2A spec
2. Agent Card must be served at `/.well-known/agent.json`
3. Authentication: mutual TLS or API key per remote instance
4. Task lifecycle: map `agentDialogs` statuses to A2A `TaskState`

**Status mapping:**
| agentDialogs.status | A2A TaskState |
|---|---|
| `pending` | `input-required` |
| `auto_approved` | `completed` |
| `approved` | `completed` |
| `denied` | `completed` (with rejection result) |
| `expired` | `failed` |
| `cancelled` | `canceled` |

### 5.3. Agent Card Spec Compliance

Current codebase has `AgentCard` type defined (`types.ts`, lines 5-18) but **no endpoint serves it**.

**Minimal Agent Card for Neva:**
```json
{
  "name": "Neva Personal Agent",
  "description": "Personal AI agent for social coordination",
  "url": "https://neva.app/.well-known/agent.json",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true
  },
  "skills": [
    { "id": "whos_free", "name": "Who's Free?", "description": "Check availability of contacts", "inputModes": ["text"], "outputModes": ["text", "data"] },
    { "id": "get_interests", "name": "Get Interests", "description": "Query contact interests", "inputModes": ["text"], "outputModes": ["data"] },
    { "id": "match_proposal", "name": "Match Proposal", "description": "Propose a need-offer match", "inputModes": ["data"], "outputModes": ["data"] }
  ],
  "securitySchemes": {
    "apiKey": { "type": "apiKey", "in": "header", "name": "X-Agent-Key" }
  }
}
```

### 5.4. Security for A2A Requests

**Current:** `a2aApps` table (`schema.ts`, lines 516-523) stores API key hashes and permissions. This is ready for use.

**Needed:**
1. Rate limiting per remote agent (use existing `WS_RATE_LIMIT` pattern from `ws.ts`)
2. Request signing (HMAC-SHA256 of request body with shared secret)
3. IP allowlisting (optional, stored in `a2aApps.permissions`)

### 5.5. MVP Skills Needed

For the product vision's MVP (weeks 1-2):
1. **whos_free** — Already implemented, needs group coordination extension
2. **match_proposal** — Already implemented
3. **group_poll** — New, needed for "collaborative decision" (Section 4.1 of product vision)
4. **create_group** — New, needed for "create group from respondents" user story

**Not needed for MVP:**
- `care_chain` (Phase 3)
- `gift_coordinator` (Phase 3)
- `knowledge_routing` (Phase 3)

**Complexity:** M (Medium) for Agent Card endpoint + basic JSON-RPC handler. XL for full inter-server protocol.

---

## 6. LLM Call Optimization

### 6.1. Current Cost Per "Who's Free?" Operation

**Scenario:** User asks "Who's Free?" with 10 friends.

| Step | LLM Calls | Model | Est. Cost per Call | Total |
|---|---|---|---|---|
| Smart context analysis per friend (auto_approve/auto_deny) | Up to 10 | classification (Haiku) | ~$0.0003 | $0.003 |
| Friends requiring manual response | 0 | - | - | $0 |
| Total | **Up to 10** | | | **~$0.003** |

**Finding:** `analyzeUserContext()` uses the `classification` model (Haiku, line 148 of agent-dialog.ts), which is cheap. Cost is acceptable.

**But latency is the issue:** 10 sequential LLM calls in `handleWhosFree()` (the `for` loop at line 60 of agent-skills-internal.ts uses `await createDialog()` sequentially). Each call is ~500-1000ms. **Total: 5-10 seconds.**

### 6.2. Batch Context Analysis

**Optimization 1: Parallelize child dialog creation**

Replace the sequential `for` loop with `Promise.all()`:

```typescript
// Current (sequential):
for (const friendId of friends) {
  const result = await createDialog({ ... })
  // ...
}

// Proposed (parallel):
const results = await Promise.all(friends.map(friendId =>
  createDialog({ ... }).then(result => ({ friendId, result }))
))
```

**Caveat:** SQLite is single-writer. Parallel LLM calls are fine, but parallel DB writes need care. Solution: LLM calls in parallel, DB writes sequential. The LLM call is 99% of the latency.

**Expected improvement:** 10 friends: 5-10s -> 1-2s (bounded by slowest LLM call).

**Optimization 2: Batch LLM call for context analysis**

Instead of 10 separate `analyzeUserContext()` calls, create ONE combined prompt:

```
Analyze availability of these 10 people based on their recent context:
1. Маша: [recent messages, mood, goals]
2. Петя: [recent messages, mood, goals]
...
Return JSON: [{ "name": "Маша", "decision": "approve", "response": "..." }, ...]
```

**Trade-offs:**
- Pro: 1 LLM call instead of 10 (10x faster, 3-5x cheaper due to shared system prompt tokens)
- Con: Larger prompt = higher per-token cost, risk of partial failure, context window limits
- Con: If one friend's analysis fails, all fail

**Recommendation:** Parallel individual calls for MVP (Optimization 1). Batch call for Phase 2 when user base grows.

### 6.3. Caching Strategies

**Observation:** Availability doesn't change every minute. If Masha was analyzed as "busy" 5 minutes ago, she's probably still busy.

**Proposed cache:**

```typescript
// In-memory cache for recent availability decisions
const availabilityCache = new Map<string, { decision: string; response: string; at: number }>()
const AVAILABILITY_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

function getCachedAvailability(targetUserId: string): { decision: string; response: string } | null {
  const key = targetUserId
  const cached = availabilityCache.get(key)
  if (cached && Date.now() - cached.at < AVAILABILITY_CACHE_TTL) {
    return { decision: cached.decision, response: cached.response }
  }
  return null
}
```

**Integration:** Check cache before calling `analyzeUserContext()` in `createDialog()` (line 233 of agent-dialog.ts).

**Savings:** If User A and User B both ask "Who's Free?" within 5 minutes, friend analysis results are reused. With 3 overlapping requests, saves ~60% of LLM calls.

### 6.4. Rule-Based Fallback

**When LLM is unavailable (timeout, API error):**

The current code already has a fallback in `analyzeUserContext()` (line 192): returns `{ decision: 'ask', response: 'Не удалось проанализировать контекст.' }`.

**Improved fallback using rule-based availability prediction:**

```typescript
// If LLM fails, use rule-based scoring
function ruleBasedAvailability(targetUserId: string, dialogType: DialogType): { decision: string; response: string } {
  const online = isUserOnline(targetUserId)
  const hour = new Date().getHours()
  const isLateNight = hour >= 23 || hour < 7

  if (isLateNight) return { decision: 'deny', response: 'Сейчас ночь, лучше спросить утром.' }
  if (online) return { decision: 'approve', response: 'Пользователь онлайн.' }
  return { decision: 'ask', response: 'Не удалось определить доступность автоматически.' }
}
```

### 6.5. Latency Budget Analysis

**User expectation:** Response within 5-10 seconds.

| Phase | Latency | Notes |
|---|---|---|
| NLP intent parsing | ~500ms | 1 classification call |
| Smart targeting | ~50ms | Rule-based, DB queries |
| Child dialog creation (parallel) | ~1-2s | LLM calls in parallel |
| First result streaming | ~1.5-3s | Fastest auto-resolve |
| All results | Minutes to hours | Depends on friend response time |

**Total time to first visible result:** ~2-4 seconds. **Within budget.**

**Complexity:** S for parallelization, M for batching, S for caching.

---

## 7. Architecture Decision Records

### ADR-001: Group Coordination via Extended Agent Dialogs

**Status:** Proposed

**Context:** Need multi-party coordination (voting, cascading invites, group formation) for "Let's Gather" feature.

**Decision:** Extend existing `agentDialogs` with new `type` values and store coordination state in `contextData` JSON rather than adding new columns.

**Consequences:**
- (+) No DB migration needed for state tracking
- (+) Reuses existing dialog infrastructure, WebSocket events, and autonomy rules
- (-) `contextData` JSON is not queryable without `json_extract()`
- (-) Complex workflows stored in untyped JSON require careful validation

### ADR-002: Rule-Based Need Detection in Proactive Engine

**Status:** Proposed

**Context:** Want to detect implicit needs from conversations ("I'm looking for a dentist") without additional LLM cost.

**Decision:** Use regex pattern matching for Tier 1 detection within existing `scanUserTriggers()`. Add LLM classification as optional Tier 2 for ambiguous cases in Phase 2.

**Consequences:**
- (+) Zero additional LLM cost for detection
- (+) Real-time via `quickProactiveCheck()` integration
- (-) Lower recall than LLM-based NER — will miss indirect expressions ("my tooth has been hurting")
- (-) Russian language regex patterns need maintenance

### ADR-003: SQLite Edge Table for Social Knowledge Graph

**Status:** Proposed

**Context:** Need to answer queries like "who among my friends knows ML?" efficiently.

**Decision:** Add a `social_graph_edges` table in SQLite with indexed `edgeType` and `label` columns. Populate incrementally from `persistFacts()` in memory-manager.

**Consequences:**
- (+) No new dependencies
- (+) Indexed SQL queries are fast for 2-hop traversal
- (-) 3+ hop traversal requires recursive CTE (supported in SQLite but slower)
- (-) Graph updates are eventually consistent (populated on fact extraction)

### ADR-004: Parallel LLM Calls for Group Availability

**Status:** Proposed

**Context:** Sequential LLM calls in `handleWhosFree()` cause 5-10s latency with 10 friends.

**Decision:** Parallelize LLM calls with `Promise.all()`, keep DB writes sequential. Add 5-minute availability cache.

**Consequences:**
- (+) Latency drops from 5-10s to 1-2s
- (+) Cache reduces redundant calls across overlapping requests
- (-) SQLite single-writer constraint means DB writes are still sequential
- (-) Parallel LLM calls increase momentary API rate usage

---

## 8. Proposed DB Schema Changes

### 8.1. Extended Dialog Types (Migration 1)

```typescript
// Extend agentDialogs.type enum
export const agentDialogs = sqliteTable('agent_dialogs', {
  // ... existing columns ...
  type: text('type', { enum: [
    'whos_free',
    'get_interests',
    'match_proposal',
    'consent',
    // NEW types:
    'group_poll',        // voting/polling
    'group_gather',      // "let's gather" coordination
    'care_chain',        // mood-based care coordination
    'gift_coordination', // birthday gift coordination
    'knowledge_query',   // expert/skill lookup
  ] }).notNull(),
})
```

**Note:** SQLite doesn't enforce enum constraints — the `enum` in Drizzle is purely TypeScript-level. No actual migration needed, just update the type definition.

### 8.2. Extend Autonomy Rules for New Dialog Types

```typescript
// Extend agentAutonomyRules.dialogType enum
export const agentAutonomyRules = sqliteTable('agent_autonomy_rules', {
  // ... existing columns ...
  dialogType: text('dialog_type', { enum: [
    'whos_free', 'get_interests', 'match_proposal', 'consent',
    'group_poll', 'group_gather', 'care_chain', 'gift_coordination', 'knowledge_query',
    '*',  // wildcard
  ] }).notNull(),
})
```

### 8.3. Social Graph Edges (Migration 2 — New Table)

```typescript
export const socialGraphEdges = sqliteTable('social_graph_edges', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // Who this knowledge is about
  subjectUserId: text('subject_user_id').notNull().references(() => users.id),
  // What kind of edge
  edgeType: text('edge_type', { enum: [
    'has_skill', 'has_interest', 'works_at', 'lives_in',
    'speaks_language', 'has_hobby', 'expert_in',
  ] }).notNull(),
  // The value
  label: text('label').notNull(),
  // Normalized label for search (lowercase, trimmed)
  labelNormalized: text('label_normalized').notNull(),
  // Embedding for semantic search (optional, populated lazily)
  embedding: text('embedding', { mode: 'json' }).$type<number[]>(),
  // Provenance
  sourceUserId: text('source_user_id').notNull().references(() => users.id),  // who observed this
  sourceChatId: text('source_chat_id').references(() => chats.id),
  sourceType: text('source_type', { enum: ['explicit', 'detected', 'inferred'] }).notNull().default('detected'),
  confidence: real('confidence').default(0.7),
  // Timestamps
  lastConfirmedAt: integer('last_confirmed_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})

// Indexes for common queries
// CREATE INDEX idx_social_graph_subject ON social_graph_edges(subject_user_id, edge_type);
// CREATE INDEX idx_social_graph_label ON social_graph_edges(label_normalized);
// CREATE INDEX idx_social_graph_source ON social_graph_edges(source_user_id);
```

### 8.4. Detected Needs Tracking (Extension to `needs` table)

No new table needed. The existing `needs` table already has `source: 'detected'`. Add:

```typescript
// Extend needs table with detection metadata
export const needs = sqliteTable('needs', {
  // ... existing columns ...
  // NEW: detection provenance
  detectedFromChatId: text('detected_from_chat_id'),
  detectedConfidence: real('detected_confidence'),
  userAcknowledged: integer('user_acknowledged', { mode: 'boolean' }).default(false),
})
```

### 8.5. Group Coordination Sessions (Optional — Phase 2)

```typescript
export const groupSessions = sqliteTable('group_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  initiatorUserId: text('initiator_user_id').notNull().references(() => users.id),
  parentDialogId: text('parent_dialog_id').notNull().references(() => agentDialogs.id),
  type: text('type', { enum: ['gather', 'poll', 'gift'] }).notNull(),
  phase: text('phase', { enum: ['targeting', 'polling', 'aggregating', 'coordinating', 'completed', 'cancelled'] }).notNull().default('targeting'),
  intent: text('intent', { mode: 'json' }).$type<{
    description: string
    activityType: 'leisure' | 'help' | 'support' | 'work'
    timePreference: string | null
    groupSize: number | null
    mood: string | null
  }>(),
  selectedFriends: text('selected_friends', { mode: 'json' }).$type<string[]>().default([]),
  responses: text('responses', { mode: 'json' }).$type<Record<string, {
    available: boolean
    message?: string
    auto: boolean
    respondedAt: number
    timeConstraint?: string
  }>>().default({}),
  summary: text('summary'),  // AI-generated summary
  resultGroupChatId: text('result_group_chat_id'),  // created group chat
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})
```

---

## 9. Implementation Roadmap

### Phase 1: MVP Core (Week 1-2) — Complexity: L

| Component | Complexity | Dependencies | Description |
|---|---|---|---|
| NLP intent parsing | S | None | Add `parseGatherIntent()` function using classification model. Single LLM call: "Хочу в бар вечером" -> `{ activity: 'leisure', time: 'today_evening', groupSize: 4, mood: 'fun' }` |
| Smart targeting | M | NLP intent | `selectBestFriends(userId, intent)`: filter by relationship type, mood, topic relevance, denial history. Rule-based scoring, no LLM. |
| Parallel dialog creation | S | None | Replace sequential `for` loop in `handleWhosFree()` with `Promise.all()` |
| Availability cache | S | None | 5-minute in-memory cache for `analyzeUserContext()` results |
| Group session tracking | M | NLP intent | `groupSessions` table or extended `contextData` in parent dialog |
| "Create group" endpoint | S | Group session | New POST endpoint that creates a chat with confirmed participants |
| Rate limiting | S | None | 1 "whos_free" per 6 hours per user, check in `handleWhosFree()` |

### Phase 2: Proactive Detection + Knowledge Graph (Week 3-4) — Complexity: L

| Component | Complexity | Dependencies | Description |
|---|---|---|---|
| Rule-based need detection | M | None | Regex patterns in `scanUserTriggers()` + `quickProactiveCheck()` |
| Social graph edge table | M | Migration | New table + incremental population from `persistFacts()` |
| Graph-based skill search | M | Edge table | `findExpertsInNetwork(userId, query)` using label search + embedding similarity |
| NLP search endpoint | M | Graph search | Replace NetworkSheet form with single text input -> parsed search -> graph + embedding results |
| Availability prediction | M | None | `predictAvailability()` rule-based function |
| Batch context analysis | M | Parallel dialogs | Optional: batch LLM call for N friends at once |

### Phase 3: Advanced Coordination (Week 5-8) — Complexity: XL

| Component | Complexity | Dependencies | Description |
|---|---|---|---|
| Voting/polling | M | Group sessions | `group_poll` dialog type, vote aggregation |
| Cascade invitations | S | Group sessions | Fallback queue when someone declines |
| Care chain | L | Mood detection | `care_chain` dialog type, privacy-preserving nudges |
| Gift coordinator | L | Memory, dates | `gift_coordination` dialog type, multi-party expense tracking |
| Knowledge routing | M | Graph search | "Expert nearby" detection from conversation patterns |

### Phase 4: Protocol + Federation (Week 9+) — Complexity: XL

| Component | Complexity | Dependencies | Description |
|---|---|---|---|
| Agent Card endpoint | S | None | Serve `/.well-known/agent.json` |
| JSON-RPC handler | L | Agent Card | Accept remote A2A requests, map to internal dialog system |
| Inter-server auth | M | JSON-RPC | API key + HMAC signing |
| Offline agent queue | M | JSON-RPC | Store-and-forward for offline users, push notifications |

---

## 10. Open Questions for Product

1. **Smart targeting transparency:** Should the user see WHY we selected 4 friends out of 15? ("Маша — обычно свободна по вечерам; Коля — давно не общались") Or is this creepy?

2. **Detected need consent:** When the agent detects "looking for a dentist" from a message, what is the UX for the nudge? In-chat suggestion? Separate notification? Tab badge?

3. **Cascade invitation limit:** If the first 5 friends decline, should we ask 5 more? Where is the spam threshold? Product vision says "3-5 smart targeting" but cascading could extend beyond.

4. **Availability confidence display:** Should we show "Probably free" vs "Probably busy" predictions BEFORE sending the actual request? This could help the user decide who to include but might create false expectations.

5. **Group creation flow:** After "Who's Free?" completes, is "Create Group" one-tap or does the user select which confirmed friends to include? What about friends who said "only after 8" — do they get added with a note?

6. **Offline agents:** 37% of messages are to offline users (based on `store-and-forward` code in `ws.ts`). For A2A, if a friend is offline, should their agent still auto-respond based on cached context? Or wait until they come online?

7. **Knowledge graph consent:** If User A's agent learns that Contact B is a photographer (from B's messages to A), can this information be used when User C searches for photographers? The fact was derived from A-B conversation but is about B. Who owns this data?

8. **Rate limiting for detected needs:** If a user mentions "looking for a job" 5 times across different chats over a week, should the agent create 5 nudges or 1? Current dedup is per-chatId within 24h — cross-chat dedup is needed.

9. **Voting quorum:** For group polls, what percentage of responses is needed to conclude? All participants? Majority? Configurable?

10. **Dialect state machine:** The `contextData.phase` approach (ADR-001) means the state is embedded in JSON and not queryable. Is it worth adding a `phase` column to `agentDialogs` for easier monitoring/debugging? Trade-off: cleaner schema vs migration cost.

---

## Appendix: File Reference

| File | Key Functions / Lines | Relevance |
|---|---|---|
| `server/a2a/agent-dialog.ts` | `createDialog()` L199, `analyzeUserContext()` L88, `getAutonomyAction()` L44 | Core dialog lifecycle |
| `server/a2a/agent-skills-internal.ts` | `handleWhosFree()` L28, `handleWhosFreeChildResponse()` L101, `handleMatchProposal()` L273 | Skill handlers to extend |
| `server/a2a/types.ts` | Full A2A spec types | Protocol compliance reference |
| `server/routes/agent-dialogs.ts` | REST endpoints for dialogs | API layer to extend |
| `server/routes/network.ts` | Needs/Offers CRUD, matching, whos-free | Network features to enhance |
| `server/ai/proactive-engine.ts` | `scanUserTriggers()` L129, `quickProactiveCheck()` L319, trigger types L29 | Need detection integration point |
| `server/ai/contact-intelligence.ts` | `getContactIntel()` L69, `getMoodTrend()` L210, `runIncrementalAnalysis()` L372 | Availability signals |
| `server/ai/memory-manager.ts` | `extractNewFacts()` L81, `persistFacts()` L149 | Graph population trigger |
| `server/ai/matching.ts` | `getDirectContacts()` L10, `getFriendsOfFriends()` L30, `findMatchingOffers()` L111 | Graph traversal optimization |
| `server/ai/embeddings.ts` | `generateEmbedding()` L17, `cosineSimilarity()` L85 | Semantic matching for knowledge search |
| `server/ws.ts` | `sendToUser()` L412, `isUserOnline()` L407, connection management | WebSocket scalability analysis |
| `server/db/schema.ts` | All table definitions | Schema extension reference |
| `server/scheduler.ts` | `startScheduler()` L16, proactive scan interval L30 | Background processing |
