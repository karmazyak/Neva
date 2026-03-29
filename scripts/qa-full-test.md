# Full QA Test Plan — Neva Messenger

## Credentials & Setup
- Dev login: ivan / 123456
- Client: http://localhost:5173
- Server: http://localhost:3000
- WebSocket: ws://localhost:3000/ws

## Phase 0: Setup Test Accounts

Register 3 additional test accounts via API:
```
POST /api/auth/register — { username: "qa_alice", password: "test123", displayName: "Alice QA" }
POST /api/auth/register — { username: "qa_bob", password: "test123", displayName: "Bob QA" }
POST /api/auth/register — { username: "qa_carol", password: "test123", displayName: "Carol QA" }
```

Then from the `ivan` account, create private chats with each of them.
Send 10–15 realistic messages in each chat (alternating sides — use `/api/messages` with different auth tokens) to build up message history for ML functions to work on. Messages should include:
- Casual conversation (emotions, plans, questions)
- Work-related discussion
- Messages with emoji, caps, ellipsis (for mood detection testing)

---

## Phase 1: Screen-by-Screen UI/UX Testing

For EVERY screen below, open it in the browser preview, take a screenshot, check for:
- Layout breakage, overflow, cut-off text
- Missing translations / placeholder text
- Broken buttons or non-functional interactions
- Console errors (JS exceptions, failed network requests)
- Mobile responsiveness (resize to 375px width)

### Screens to test:
1. **Login** (`/login`) — login form, validation, error states
2. **Register** (`/register`) — registration form, validation
3. **Chats** (`/`) — chat list, folders, search, unread badges, last message preview
4. **Chat conversation** — open a chat, scroll history, send message, reactions, pin, forward, edit, delete
5. **Profile** (`/profile`) — avatar, status, settings
6. **My Robots** (`/robots`) — agent list, create/edit/delete agent, assign to chat
7. **Robot Store** (`/store`) — browse, filter, install agent, reviews
8. **AI Chat** (`/ai-chat`) — direct AI conversation, function calling
9. **Saved Messages** (`/saved`) — save/unsave, list
10. **Relationships** (`/relationships`) — contact cards, mood radar, relationship info
11. **Network Sheet** — needs, offers, matching UI
12. **Context Panel** (slide-out in chat) — person context, mood, memory, goals

**UX/UI bugs found → FIX IMMEDIATELY in code.** Log what you fixed.

---

## Phase 2: ML Functions Deep Testing

For each ML function below, call the API endpoint directly, inspect the response, and evaluate quality. Log issues.

### 2.1 Persona Profiler
```
POST /api/ai/tools/persona — { chatId: <chat_with_alice> }
```
- Does it return a valid PersonaProfile with linguistic + behavioral fields?
- Are signaturePatterns and currentState populated?
- Test with a chat that has <5 messages — does it handle gracefully?

### 2.2 Mood Detection
```
POST /api/ai/tools/mood-check — { chatId: <chat_id> }
```
- Send a sad message ("всё плохо, устал, ничего не получается") → check mood
- Send a happy message ("ура! получилось! 🎉🎉🎉") → check mood
- Send an ambiguous message ("ну ок") → check if needsLLM triggers
- Check mood trend after several messages

### 2.3 Tone Check
```
POST /api/ai/tools/tone-check — { chatId: <chat_id>, message: "..." }
```
Test with:
- Appropriate message for context → should return no warning
- Aggressive message to a friend → should warn
- Formal message in casual chat → should suggest adjustment
- Message conflicting with active goal → should flag goalConflict

### 2.4 Simulation ("What if I say X")
```
POST /api/ai/tools/simulate — { chatId: <chat_id>, message: "..." }
```
- Does it return 3 branching variants?
- Are variants distinct and realistic?
- Does persona influence the simulated responses?

### 2.5 Person Context (Relationship Intelligence)
```
POST /api/ai/tools/person-context — { chatId: <chat_id> }
```
- Does it return relationship type, topics, dynamics?
- Are personalMemory facts extracted and persisted to DB?
- Check `contact_memory` table for new entries after call

### 2.6 Contact Intelligence (Unified Store)
- After running persona + mood + person-context, check `contact_intelligence` table
- Is data populated: persona JSON, theirStyle, myStyleForThem, moodHistory?
- Is LRU cache working (second call faster)?

### 2.7 Long-Term Memory
```
POST /api/ai/tools/person-context — { chatId: <chat_id> }
```
- Send messages mentioning: birthday, job change, health issue, travel plans
- Call person-context → check if facts extracted
- Check expiration rules: plan=30d, health=60d, life_event=never
- Call again — should NOT re-extract same facts

### 2.8 Style Analysis
```
POST /api/ai/style/analyze — { chatId: <chat_id> }
```
- Does it return StyleProfile with tone, formality, emoji patterns?
- Per-contact style (myStyleForThem) vs global — are they different?
- Check BOT_BLACKLIST — generate a reply and verify banned phrases are absent

### 2.9 Message Generation (Ghost Mode)
```
POST /api/agents/skill — { command: "/reply", chatId: <chat_id> }
```
- Does ghost mode return 3 variants?
- Are replies styled to match user's writing style for that contact?
- Is active goal context injected?
- Is memory context used?

### 2.10 Style Reply (Write as Someone)
```
POST /api/agents/skill — { command: "/style <contact_name>", chatId: <chat_id> }
```
- Does it resolve contact by name?
- Are generated messages in the contact's style?
- Confidence badge present?

### 2.11 Transform
```
POST /api/ai/tools/transform — { message: "...", style: "formal" }
POST /api/ai/tools/transform — { message: "...", style: "casual" }
POST /api/ai/tools/transform — { message: "...", style: "shorter" }
```
- Does each transformation actually change the style?
- Is meaning preserved?

### 2.12 Briefing
```
POST /api/ai/tools/briefing — { chatId: <chat_id> }
```
- Returns ≤2 sentences?
- Captures key topics from recent messages?

### 2.13 Context (Real-time Chat Analysis)
```
POST /api/ai/tools/context — { chatId: <chat_id> }
```
- Returns topics, decisions, actions, mood, nextAction?
- 5-min cache working? (second call instant)

### 2.14 Proactive Engine & Nudges
- Create conditions: leave a message unanswered for 24h+ (adjust timestamps in DB if needed)
- Force refresh: `POST /api/ai/tools/nudges — { forceRefresh: true }`
- Check: are nudges generated for silence, unanswered, mood triggers?
- Check dedup: same trigger shouldn't fire twice in 24h
- Check WebSocket push: does online user receive nudge notification?

### 2.15 Goals
```
POST /api/goals — { chatId: <chat_id>, goal: "Получить приглашение на вечеринку", strategy: "casual" }
```
- Is goal injected into reply generation context?
- Does tone-check flag goal conflicts?
- Does goal_stall trigger fire after 48h inactivity?
- Mission planner: does it create a plan with steps + abort conditions?

### 2.16 AI Chat (Direct Assistant)
```
POST /api/ai/chat/chat — { message: "Помоги составить план...", mode: "autopilot" }
```
- Test autopilot mode — does it execute tools autonomously?
- Test mission planning mode
- Does function calling work (tool iteration)?
- Rate limiting working?

### 2.17 Network Matching
```
POST /api/network/needs — { description: "Ищу дизайнера для лого" }
POST /api/network/offers — { description: "Делаю логотипы" } (from another account)
POST /api/network/match/<needId>
```
- Does matching find relevant offers?
- Consent flow working?
- Trust score calculation reasonable?

### 2.18 Agent Dialogs (A2A)
- Check agent-to-agent dialog creation
- Autonomy rules working?
- Internal skills (whos-free, interest collection, match proposals)

---

## Phase 3: Autopilot / Background Agent Testing

### 3.1 Agent Assignment
- Create an agent with auto-reply enabled
- Assign it to a chat with qa_bob
- Send messages from qa_bob → verify agent responds automatically
- Check: typing delay present? Style matching? Goal injection?

### 3.2 Triggers
- Create trigger: on_message → agent_reply
- Create trigger: on_audio → stt (speech-to-text)
- Create trigger: on_keyword "help" → skill execution
- Send matching messages → verify triggers fire

### 3.3 Pipelines
- Create a multi-step pipeline on an agent
- Verify execution order and data passing

### 3.4 Scheduled Tasks
- Create agent schedule (e.g., send daily briefing)
- Manual run → verify execution

---

## Output Format

### Report 1: ML Issues for ML Engineer (`ml-issues.md`)
For each ML function, report:
- **Function name**
- **Issue**: What's wrong
- **Severity**: critical / major / minor
- **Expected vs Actual**: What should happen vs what happens
- **Reproduction**: Exact API call + response snippet
- **Suggestion**: How to improve

### Report 2: UX/UI Fixes Applied (`ux-fixes-applied.md`)
For each fix:
- **Screen**
- **Issue**: What was broken
- **Fix**: What file(s) changed and how
- **Before/After**: Screenshots if visual

### Report 3: Test Results Summary (`qa-summary.md`)
- Total tests run
- Passed / Failed / Skipped
- Critical blockers
- Overall health score (1-10)

Save all reports to `scripts/qa-reports/` directory.
