# Neva Messenger — Claude Code Instructions

## Dev Login Credentials
- **Username:** ivan
- **Password:** 123456

## Project Structure
- `client/` — React frontend (Vite + TypeScript)
- `server/` — Hono backend (Bun runtime)

## Dev Servers
- Client: `npm run dev` on port 5173
- Server: `bun run dev` on port 3000
- launch.json configs: `mlsendger-client`, `mlsendger-server`

## Key Systems
- **Strategic Advisor** — mission planning, persona profiler, simulation (server/ai/)
- **Relationship Care** — nudges, mood radar, personal memory, tone advisor (server/ai/, server/routes/ai-tools.ts)
- **GuidedTour** — in-context onboarding with pulsating beacons (client/src/components/GuidedTour.tsx)

## Deploy
- Production URL: check deployment scripts in package.json

---

## ML/AI Architecture (as of 2026-03-27)

### Model Router (`server/ai/model-router.ts`)
All LLM calls go through OpenRouter (`server/ai/openrouter.ts`). Model selection by task:

| TaskType | Model | Temp | MaxTokens | Use Case |
|---|---|---|---|---|
| `planning` | claude-3.5-sonnet | 0.4 | 4096 | Mission planning |
| `replanning` | claude-3.5-sonnet | 0.3 | 2048 | Mid-mission adaptation |
| `persona_extraction` | claude-3.5-sonnet | 0.3 | 2048 | Deep persona analysis |
| `evaluation` | gpt-4o-mini | 0.2 | 512 | Scoring, tone advice |
| `simulation` | gpt-4o-mini | 0.7 | 500 | "What-if" responses |
| `generation` | gpt-4o-mini | 0.7 | 1024 | Message drafting |
| `classification` | gpt-4o-mini | 0.1 | 50 | Mood, relationship type |
| `analysis` | gpt-4o-mini | 0.3 | 1024 | Summarization, nudges |

**Cost strategy:** Sonnet for reasoning (plans, personas). Mini for everything else.

### Core AI Modules

#### Contact Intelligence (`server/ai/contact-intelligence.ts`)
Unified persistent store replacing fragmented in-memory caches. DB table `contact_intelligence` with LRU cache (100 entries, 30 min).

**Stores per contact:** persona (behavioral+linguistic JSON), theirStyle (writing style JSON), myStyleForThem (how USER writes to this specific contact), moodHistory (last 30 entries with timestamps), relationshipType.

**Key functions:**
- `getContactIntel(userId, chatId)` — DB read + LRU cache
- `getOrBuildContactIntel(...)` — checks freshness, runs incremental analysis if stale (>50 msgs or >7 days)
- `runIncrementalAnalysis(...)` — single LLM call updates persona + style + mood at once
- `recordMood(...)` — appends to persistent moodHistory
- `getMoodTrend(userId, chatId)` — 7-day sliding window: `{current, trend: improving|stable|declining|volatile, significantChange}`
- `analyzeMyStyleForContact(userId, chatId)` — reuses style/analyzer.ts filtered by chatId, stores in myStyleForThem
- `getPersonaFromIntel(...)` — backward-compat wrapper for persona-profiler consumers

#### Persona Profiler (`server/ai/persona-profiler.ts`)
Builds "digital twin" of contacts. Two stages: extraction (claude-3.5-sonnet) → simulation (gpt-4o-mini).

**PersonaProfile type:** linguistic (msgLength, emoji, formality, signaturePatterns), behavioral (agreeableness, directness, emotionalReactivity, humor, conflictStyle), currentState (recentMood, activeTopics, pendingExpectations), dynamics (relationshipType, powerDynamic, sensitiveTopics).

**Integration:** `getCachedPersona()` checks in-memory Map first, then falls through to contact-intelligence DB. Writes persist to both.

#### Long-Term Memory (`server/ai/memory-manager.ts`)
Persistent fact extraction about contacts. DB table `contact_memory`.

**Fact categories:** life_event, plan, person, date, health, preference, work.
**Expiration:** plan=30d, health=60d, preference/work=90d, life_event/person/date=never.

**Key functions:**
- `getActiveMemories(userId, chatId)` — active + non-expired, limit 20
- `extractNewFacts(...)` — LLM (analysis model) extracts ONLY new facts given existing ones
- `persistFacts(...)` — bulk insert with simple dedup
- `getMemoryPromptBlock(userId, chatId)` — formats facts for prompt injection
- `deactivateStale(...)` — marks expired facts as inactive

**Triggered:** on `/person-context` calls (persists extracted personalMemory) + inside `runIncrementalAnalysis()`.

#### Mood Detector (`server/ai/mood-detector.ts`)
Rule-based pre-filter — NO LLM calls. Checks: emoji sentiment, punctuation density (!!!, ???, ...), message length drops, ALL CAPS, negative/positive keyword patterns.

Returns `{needsLLM: boolean, hintMood, signals[]}`. LLM is called only when signals are ambiguous.

#### Goals (`server/ai/goals.ts`)
Standalone module (no circular deps on routes). Reads from `userGoals` table.
- `getActiveGoal(userId, chatId)` — returns `{goal, strategy, chatId}` or null
- `getAllActiveGoals(userId)` — all active goals for briefing

#### Style System (`server/ai/style/`)
- `analyzer.ts` — analyzes 200 messages → StyleProfile (tone, formality, emoji, commonPhrases, fewShotExamples, styleInstruction). Accepts optional `chatId` for per-contact analysis.
- `cache.ts` — DB persistence via `styleProfiles` table. Reanalysis: 30+ days AND 200+ new messages.
- `generator.ts` — generates styled replies. BOT_BLACKLIST (30 phrases: "кстати", "на самом деле", etc.) removed from output.
- `presets.ts` — 5 hardcoded styles: casual_friendly, business_concise, ironic_witty, warm_empathetic, laconic_reserved.

#### Mission Planner (`server/ai/mission-planner.ts`)
- `generateMissionPlan()` — claude-3.5-sonnet creates plan with success criteria, abort conditions, steps
- `evaluateMissionProgress()` — gpt-4o-mini scores progress 0-100% after each response
- `replanMission()` — claude-3.5-sonnet adapts plan when blocked

### Proactive Engine (`server/ai/proactive-engine.ts`)
Background scanner, runs every 15 min. Rule-based triggers (NO LLM for detection):

| Trigger | Condition | Priority |
|---|---|---|
| `silence` | 7+ days no messages (family/friend) | low |
| `unanswered` | Contact's msg unanswered 24h+ | medium |
| `burst` | 3+ msgs from contact in 2h, no reply | high |
| `goal_stall` | Active goal not updated 48h+ | medium |
| `mood` | getMoodTrend() shows declining + significantChange | high |

One gpt-4o-mini call per triggered action to generate title/body/draftMessage. Dedup: 24h window per (userId, chatId, trigger).

`runProactiveScanForUser(userId)` — exported for force-refresh from `/nudges?forceRefresh=true`.

### API Endpoints (`server/routes/ai-tools.ts`)

Route prefix: `/api/ai/tools`

| Endpoint | What it does | Context injected |
|---|---|---|
| `POST /tone-check` | Check if draft message tone is appropriate | chat history + relationship + goal + persona sensitive topics + **memory** + **mood** |
| `POST /simulate` | "What if I say X" — simulates contact response | persona profile + chat history. Branching mode: 3 variants |
| `POST /persona` | Extract/retrieve persona profile | Persists to contact-intelligence DB |
| `POST /mood-check` | Detect contact's mood | Checks: contact-intelligence DB → persona cache → LLM |
| `POST /person-context` | Full relationship intelligence | Persists extracted personalMemory facts to `contact_memory` table |
| `POST /nudges` | Get proactive suggestions | **DB reader only** (reads from `proactiveActions` table, 0 LLM calls). Optional `forceRefresh: true` |
| `POST /context` | Real-time chat analysis | 5-min cache, includes topics/decisions/actions/mood/nextAction |
| `POST /transform` | Rewrite message (formal/casual/shorter/etc) | Simple single LLM call |
| `POST /analyze` | Summarize/translate/reply suggestions | Uses persona for family/friend chats |
| `POST /briefing` | Ultra-brief chat summary | 2 sentences max |

### Skills (`server/ai/skills/`)

#### text-reply (`/reply`)
Ghost mode: 3 variants with action buttons. Normal mode: single reply.
**Context injected:** per-contact style (myStyleForThem → global fallback) + memory + active goal + contact mood.

#### style-reply (`/style`)
Write in someone else's style. Resolves by name/preset, generates 3 variants with confidence badge.

### Data Flow Diagrams

**Message arrives → auto-reply:**
```
incoming msg → engine.ts processAgentResponse()
  → load per-contact style (myStyleForThem → global fallback)
  → load active goal (goalBlock injection)
  → generate reply → typing delay → send
```

**User opens chat context:**
```
/person-context → extract persona + personalMemory (Sonnet)
  → persist facts to contact_memory DB
  → persist persona to contact_intelligence DB
  → return enriched profile + persistedMemories
```

**Tone checking (real-time):**
```
user types (debounce 2s) → /tone-check
  → load: chat context + relationship + goal + persona.sensitiveTopics + memoryPromptBlock + currentMood
  → GPT-4o Mini evaluates
  → returns: needsWarning + suggestion + goalConflict
```

**Proactive nudges (background):**
```
every 15 min → proactive-engine scans all users
  → rule-based triggers (silence, unanswered, burst, goal_stall, mood)
  → dedup 24h window
  → 1 GPT-4o Mini call per trigger → save to proactiveActions DB
  → WebSocket push to online user
```

### DB Tables (AI-related)

| Table | Purpose | Key fields |
|---|---|---|
| `contact_intelligence` | Unified persona+style+mood per contact | persona JSON, theirStyle JSON, myStyleForThem JSON, moodHistory JSON, relationshipType |
| `contact_memory` | Long-term facts about contacts | fact, category, confidence, expiresAt, isActive |
| `style_profiles` | User's own global writing style | profile JSON, messageCount, context='global' |
| `user_goals` | Strategic/care goals | goal, strategy, progress, mode, autonomyLevel |
| `proactive_actions` | Generated nudges/suggestions | trigger, title, body, draftMessage, status, priority |
| `mission_history` | Completed mission logs | goal, strategy, result, lessonsLearned |

### Key Design Decisions
1. **Sonnet for reasoning, Mini for generation** — cost optimization
2. **Incremental analysis** — don't re-extract everything, delta on new messages
3. **Per-contact user style** — "how I write to mom" ≠ "how I write to boss"
4. **Memory accumulates, never re-extracted** — facts persist and expire by category
5. **Rule-based mood pre-filter** — LLM only when ambiguous (saves ~80% of mood-check calls)
6. **Proactive engine is sole nudge generator** — /nudges is a pure DB reader (0 LLM overhead)
7. **BOT_BLACKLIST** — 30 AI-revealing phrases automatically removed from generated text
