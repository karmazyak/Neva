# ML Endpoint QA Test Results

**Date:** 2026-03-29
**Server:** http://localhost:3000
**User:** ivan (userId: 8d38f195-6f75-41c4-b462-7da780b8668b)
**Chats tested:** Bob QA (77ce0612), Carol QA (73fa0e9e)

---

## Test Results

### 1. Persona Profiler - POST /api/ai/tools/persona

#### 1a. Bob Chat
- **Status:** 200 OK
- **Response:** Full PersonaProfile with linguistic, behavioral, currentState, dynamics fields. Persona extracted from 7 messages.
- **Quality:** GOOD
- **Details:** Correctly identified Bob as casual (formality 0.3), high agreeableness (0.8), playful humor. Active topics match chat content (work promotion, birthday, ML model issues). Signature patterns detected ("Было бы супер!", "Не, просто", "Кстати").
- **Issues:**
  - `relationshipType: "other"` -- should be "friend" based on casual tone and social topics. The person-context endpoint correctly identifies it as "friend", but persona profiler returns "other".

#### 1b. Carol Chat
- **Status:** 200 OK
- **Response:** Full PersonaProfile extracted from 7 messages.
- **Quality:** GOOD
- **Details:** Correctly identified as more formal (0.6), high directness (0.9), low emotionalReactivity (0.3), no humor. Topics match (API, ML model, competitor analysis).
- **Issues:**
  - `relationshipType: "other"` -- should be "work" or "colleague". Same issue as Bob.

### 2. Mood Detection - POST /api/ai/tools/mood-check

#### 2a. Bob Chat
- **Status:** 200 OK
- **Response:** `{"mood":"happy","note":"positive but slightly anxious","confidence":70}`
- **Quality:** GOOD
- **Details:** Accurate assessment -- Bob got a promotion (happy) but has ML project deadline issues (slightly anxious).

#### 2b. Carol Chat
- **Status:** 200 OK
- **Response:** `{"mood":"normal","note":"matter-of-fact, slightly fatigued","confidence":70}`
- **Quality:** GOOD
- **Details:** Accurate -- Carol is sick but maintains professional demeanor.

### 3. Tone Check - POST /api/ai/tools/tone-check

#### 3a. Appropriate message ("Привет, как дела?")
- **Status:** 200 OK
- **Response:** `{"needsWarning":false,"warning":"","suggestion":"","goalConflict":false}`
- **Quality:** GOOD
- **Details:** Correctly identified as appropriate for casual chat.

#### 3b. Aggressive message ("Ты вообще тупой? Сколько можно косячить!")
- **Status:** 200 OK
- **Response:** `{"needsWarning":true,"warning":"Тон слишком резкий и может обидеть Боба.","suggestion":"Может, стоит сказать: 'Давай обсудим, что можно улучшить?'","goalConflict":false}`
- **Quality:** GOOD
- **Details:** Correctly flagged aggressive tone, provided constructive alternative suggestion. References contact by name.

#### 3c. Formal in casual chat ("Уважаемый коллега, прошу предоставить отчёт")
- **Status:** 200 OK
- **Response:** `{"needsWarning":false}`
- **Quality:** POOR
- **Details:** Did NOT flag overly formal tone in a casual friend chat. Sending "Dear colleague, please provide the report" to a friend named Bob who uses emoji and casual language should trigger a warning about tone mismatch.
- **Issues:**
  - MAJOR: Tone checker does not detect formality mismatch relative to chat relationship/style. Only catches obviously aggressive/negative tones.

### 4. Simulation - POST /api/ai/tools/simulate

- **Status:** 200 OK
- **Response:** `{"response":"Сложно... не хочу переносить, уже всё запланировано... Но если есть причины, давай обсудим! Кстати, что тебя беспокоит?","personName":"Bob QA","confidence":80,"innerMonologue":"Не, просто не хочется переносить, но нужно учесть мнение Ивана.","hasPersona":true}`
- **Quality:** GOOD
- **Details:** Simulated response matches Bob's personality: uses ellipsis (consistent with Bob's style), reluctant but diplomatic (matches agreeableness 0.8, conflictStyle "diplomatic"). Inner monologue adds insight. Confidence 80% is reasonable.

### 5. Person Context - POST /api/ai/tools/person-context

#### 5a. Bob Chat
- **Status:** 200 OK
- **Response:** Rich profile with relationshipType "friend", communication style, mood trend "improving", personal memory facts (birthday date, promotion, ML project issues).
- **Quality:** GOOD
- **Details:** Memory extraction works well -- captured specific facts (birthday at bar on Nevsky at 7pm, April 5). `persistedMemories` array confirms DB persistence works. `totalMessages: 15`, `aiAssistedMessages: 0`.

#### 5b. Carol Chat
- **Status:** 200 OK
- **Response:** Profile with relationshipType "work", unresolved items (pagination, role checks, competitor response), mood trend "stable".
- **Quality:** ACCEPTABLE
- **Details:** Good extraction of work context and unresolved items. Personal memory captured illness and recovery timeline.
- **Issues:**
  - `persistedMemories` is empty array `[]` while `personalMemory` has 2 items. Memory persistence may have failed silently for Carol.
  - `personalMemory` items are plain strings, not objects with `text/when/category` like Bob's. Inconsistent format.

### 6. Context - POST /api/ai/tools/context

- **Status:** 200 OK
- **Response:** `{"result":{"topics":[],"decisions":[],"actions":[],"mood":"neutral"},"type":"analysis","cached":false}`
- **Quality:** POOR
- **Details:** Returned empty arrays for topics, decisions, and actions despite Bob chat having 15 messages about work promotion, birthday party, ML project issues. Mood "neutral" contradicts mood-check result of "happy".
- **Issues:**
  - MAJOR: Context analysis returns empty results. The chat clearly has active topics (birthday, promotion, ML model) but none are extracted. This endpoint appears broken or not analyzing messages correctly.

### 7. Briefing - POST /api/ai/tools/briefing

#### 7a. Bob Chat
- **Status:** 200 OK
- **Response:** "Боб сообщил Ивану о повышении до тимлида и пригласил его на день рождения 5 апреля в баре на Невском. Иван предложил помощь с проектом и уточнил, нужен ли подарок для празднования."
- **Quality:** GOOD
- **Details:** Concise 2-sentence summary covering the key events. Captures both threads (promotion + birthday).

#### 7b. Carol Chat
- **Status:** 200 OK
- **Response:** Summary covers API review issues (role checks, pagination) and Carol's review feedback.
- **Quality:** GOOD
- **Details:** Accurate technical summary, correctly captures the work dynamic.

### 8. Transform - POST /api/ai/tools/transform

#### 8a. Casual to Formal
- **Status:** 200 OK
- **Input:** "Привет как дела чё делаешь"
- **Output:** "Здравствуйте, как у Вас дела? Чем Вы занимаетесь?"
- **Quality:** GOOD
- **Details:** Proper formalization: "Привет" -> "Здравствуйте", "чё делаешь" -> "Чем Вы занимаетесь?". Maintained Russian language.

#### 8b. Formal to Casual
- **Status:** 200 OK
- **Input:** "Добрый день, хотел бы уточнить статус задачи"
- **Output:** "Привет! Хотел бы узнать, как дела с задачей?"
- **Quality:** ACCEPTABLE
- **Details:** Partially casualized: "Добрый день" -> "Привет!". But "Хотел бы узнать" is still somewhat formal for truly casual speech. Could be more casual (e.g., "Слушай, что там с задачей?").
- **Issues:**
  - MINOR: Casual transform could be more aggressive in casualizing tone. Still retains formal constructions.

### 9. Nudges - POST /api/ai/tools/nudges

- **Status:** 200 OK
- **Response:** 9 nudges returned with `forceRefresh: true`. Types: goal_stall (2), unanswered (7).
- **Quality:** ACCEPTABLE
- **Details:** Nudges generated for multiple chats. Each has title, body text, draftMessage, priority, chatId.
- **Issues:**
  - MAJOR: Fraud chat (chat-fraud-demo) generated a nudge: "Ваш шанс на iPhone 15 Pro все еще актуален!" with draft "Привет! Надеюсь, у вас все в порядке. Вы уже видели наше сообщение о выигрыше iPhone 15 Pro?" -- The proactive engine generated a nudge encouraging the user to respond to a scam chat. This is a safety issue.
  - MINOR: Two duplicate nudges for "Коля" chat (both `unanswered` type, both suggesting to reply). Dedup should prevent this.
  - MINOR: Two duplicate nudges for "Андрей Петров" (boss) chat, same `unanswered` type.
  - MINOR: Draft message for Маша says "Извини, что не ответила" (feminine) instead of "не ответил" (masculine). Gender mismatch for user Ivan.

### 10. Goals - POST/GET /api/goals

#### 10a. Create Goal
- **Status:** 201 Created
- **Response:** Goal created with id, mode "strategic", status "active", progress 0.
- **Quality:** GOOD
- **Details:** All fields populated correctly. chatId linked to Bob chat.

#### 10b. GET Goals
- **Status:** 200 OK
- **Response:** 3 goals returned (1 newly created + 2 pre-existing demo goals).
- **Quality:** GOOD
- **Details:** Correct filtering (only active/in_progress). Pre-existing goals have progress notes with timestamps.

### 11. Style Analysis - POST /api/ai/style/analyze

- **Status:** 200 OK
- **Response:** Full StyleProfile for Bob with tone, formality, emoji frequency, common phrases, few-shot examples, and style instruction.
- **Quality:** GOOD
- **Details:** Analyzed 7 messages. Confidence "low" is honest given small sample. Detected Russian language, casual formality, rare emoji usage. Few-shot examples are real message pairs from the chat. Style instruction is actionable.
- **Issues:**
  - MINOR: Confidence "low" with 7 messages is correct, but the profile still looks comprehensive. Consider showing a warning to users when confidence is low.

### 12. Reply Generation - POST /api/agents/skill (/reply)

- **Status:** 200 OK
- **Response:** `{"ok":true,"messageId":"2abc1e83-4390-48c6-9813-55b6683a6775","skill":"Text Reply","cost":1}`
- **Quality:** ACCEPTABLE
- **Details:** Reply was generated and saved as a message. Response only returns messageId, not the actual reply text. This means the client needs a separate fetch to see the reply content.
- **Issues:**
  - MINOR: Response does not include the generated reply text, only a messageId. For QA purposes, the actual content cannot be verified from the API response alone.

---

## Summary

| Metric | Count |
|--------|-------|
| **Total tests** | 18 |
| **Good** | 12 |
| **Acceptable** | 4 |
| **Poor** | 2 |
| **Error** | 0 |

**Pass rate (Good + Acceptable):** 16/18 (89%)

---

## Issues for ML Engineer

### Critical

1. **Nudge generated for scam/fraud chat** (Test 9)
   - The proactive engine generated an `unanswered` nudge for `chat-fraud-demo` (a known scam chat), encouraging the user to reply to the scammer. The nudge text promotes the scam content ("iPhone 15 Pro").
   - **Impact:** Safety risk. Users could be encouraged to engage with scammers.
   - **Fix:** Add a blacklist/flag mechanism for scam-detected chats to exclude them from proactive nudge generation.

### Major

2. **Context analysis returns empty results** (Test 6)
   - `/context` endpoint returns empty topics/decisions/actions arrays for a chat with 15 substantive messages. Other endpoints (briefing, person-context) correctly extract rich information from the same chat.
   - **Impact:** The real-time context panel in the UI would show nothing useful.
   - **Fix:** Investigate why the context analysis LLM call returns empty or why messages are not being passed to it correctly.

3. **Tone checker misses formality mismatch** (Test 3c)
   - Sending a formal business-style message ("Уважаемый коллега, прошу предоставить отчёт") to a casual friend chat does not trigger a tone warning.
   - **Impact:** Users won't be warned when their message tone doesn't match the relationship style.
   - **Fix:** Add formality-vs-relationship check. Compare message formality against `persona.linguistic.formality` and `dynamics.relationshipType` to flag mismatches.

4. **Persona profiler returns wrong relationshipType** (Tests 1a, 1b)
   - Both Bob and Carol return `relationshipType: "other"` instead of "friend" and "work" respectively. The person-context endpoint correctly classifies them.
   - **Impact:** Any downstream logic relying on persona's relationshipType will malfunction.
   - **Fix:** Align persona profiler's relationship classification with person-context's logic, or have persona profiler read from the same source.

### Minor

5. **Nudge dedup failure** (Test 9)
   - Two nudges for Коля (same chat, same trigger type `unanswered`) and two for Андрей Петров (same). The 24h dedup window should prevent duplicates per (userId, chatId, trigger).
   - **Fix:** Check dedup logic in proactive-engine.ts -- may need to also dedup by chatId+trigger in the DB query.

6. **Person-context memory format inconsistency** (Test 5b)
   - Bob's `personalMemory` returns objects `{text, when, category}`. Carol's returns plain strings. The `persistedMemories` for Carol is empty despite `personalMemory` having items.
   - **Fix:** Normalize personalMemory format. Investigate why Carol's memories failed to persist.

7. **Gender mismatch in nudge draft** (Test 9)
   - Draft for Маша chat uses feminine verb form ("не ответила") for user Ivan (male).
   - **Fix:** Pass user gender context to the nudge generation prompt.

8. **Casual transform not aggressive enough** (Test 8b)
   - "Formal to casual" still retains semi-formal constructions ("Хотел бы узнать").
   - **Fix:** Update casual transform prompt to push for more colloquial output.

9. **Reply generation response lacks content** (Test 12)
   - `/reply` skill returns only `{ok, messageId}` without the generated text.
   - **Fix:** Consider including the reply text in the response for transparency and debugging.
