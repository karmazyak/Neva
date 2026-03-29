# ML Issues for ML Engineer

**Date:** 2026-03-29
**Tested by:** Claude Code QA
**Server:** localhost:3000
**Test chats:** Bob QA (15 msgs, casual), Carol QA (15 msgs, work), + demo chats

---

## Critical

### 1. Proactive engine generates nudges for scam/fraud chat
- **Endpoint:** POST /api/ai/tools/nudges (forceRefresh: true)
- **Issue:** The `unanswered` trigger fired for `chat-fraud-demo` (a scam chat with phishing content about "iPhone 15 Pro lottery"). The nudge actively encourages the user to reply to the scammer.
- **Generated nudge:** "Ваш шанс на iPhone 15 Pro все еще актуален!" with draft reply promoting engagement with the scam.
- **Impact:** Safety risk — user could be encouraged to engage with scammers.
- **Fix:** Add a blacklist/flag mechanism for scam-detected chats. The proactive engine should check if a chat is flagged as suspicious before generating nudges. Could use the existing fraud detection (chat name starts with "+7") or add a `isSuspicious` flag to chats.

---

## Major

### 2. Context analysis returns empty results
- **Endpoint:** POST /api/ai/tools/context
- **Issue:** Returns `{"topics":[],"decisions":[],"actions":[],"mood":"neutral"}` for Bob chat with 15 substantive messages about work promotion, birthday party, and ML project.
- **Expected:** Should extract topics (birthday, promotion, ML model), decisions (meeting at bar), actions (call tomorrow).
- **Comparison:** Briefing endpoint correctly extracts all key info from same chat. Person-context also works fine.
- **Impact:** Real-time context panel in chat UI shows nothing useful.
- **Root cause likely:** Messages may not be passed correctly to the context analysis LLM call, or the prompt template doesn't extract structured data properly.

### 3. Tone checker misses formality mismatch
- **Endpoint:** POST /api/ai/tools/tone-check
- **Issue:** Sending "Уважаемый коллега, прошу предоставить отчёт" to Bob (casual friend, formality 0.3, uses emoji and slang) returns `needsWarning: false`.
- **Expected:** Should warn about tone mismatch — formal business message is inappropriate for casual friend chat.
- **Impact:** Users won't be alerted when their message tone clashes with relationship style.
- **Fix:** Add formality-vs-relationship check. Compare message formality score against `persona.linguistic.formality` and `dynamics.relationshipType`. Flag when delta > 0.4.

### 4. Persona profiler returns wrong relationshipType
- **Endpoint:** POST /api/ai/tools/persona
- **Issue:** Both Bob (casual friend) and Carol (work colleague) return `relationshipType: "other"`. The person-context endpoint correctly classifies them as "friend" and "work".
- **Impact:** Downstream features using persona's relationshipType will behave incorrectly (e.g., proactive engine trigger conditions).
- **Fix:** Align persona profiler's relationship classification with person-context's logic. Either share the classification code or have persona profiler read from the same source (contact_intelligence table).

---

## Minor

### 5. Nudge deduplication failure
- **Endpoint:** POST /api/ai/tools/nudges
- **Issue:** Two identical `unanswered` nudges for Коля chat and two for Андрей Петров chat. The 24h dedup window should prevent this.
- **Fix:** Check dedup logic in `proactive-engine.ts` — the dedup query may not correctly match by (userId, chatId, trigger) combination.

### 6. Person-context memory format inconsistency
- **Endpoint:** POST /api/ai/tools/person-context
- **Issue:** Bob's `personalMemory` returns objects `{text, when, category}`. Carol's returns plain strings. Carol's `persistedMemories` is empty despite `personalMemory` having items.
- **Fix:** Normalize personalMemory format in the extraction pipeline. Investigate why Carol's memories failed to persist to `contact_memory` table.

### 7. Gender mismatch in nudge drafts
- **Endpoint:** POST /api/ai/tools/nudges
- **Issue:** Draft for Маша chat: "Извини, что не ответила" uses feminine verb form for user Ivan (male).
- **Fix:** Pass user gender context (or name) to the nudge generation prompt. Use masculine default or infer from user profile.

### 8. Casual transform not aggressive enough
- **Endpoint:** POST /api/ai/tools/transform (style: "casual")
- **Issue:** "Добрый день, хотел бы уточнить статус задачи" → "Привет! Хотел бы узнать, как дела с задачей?" Still semi-formal.
- **Expected:** More colloquial, e.g., "Слушай, что там с задачей?"
- **Fix:** Update the casual transform prompt to explicitly request informal/colloquial output.

### 9. Reply skill response lacks generated text
- **Endpoint:** POST /api/agents/skill (/reply)
- **Issue:** Returns only `{ok: true, messageId: "..."}` without the generated reply text.
- **Impact:** Cannot verify reply quality from API alone. Client must fetch message separately.
- **Fix:** Include the generated text in the response for transparency.

---

## Summary Table

| # | Issue | Severity | Endpoint |
|---|-------|----------|----------|
| 1 | Nudges for scam chat | Critical | /nudges |
| 2 | Empty context analysis | Major | /context |
| 3 | No formality mismatch detection | Major | /tone-check |
| 4 | Wrong relationshipType in persona | Major | /persona |
| 5 | Nudge dedup failure | Minor | /nudges |
| 6 | Memory format inconsistency | Minor | /person-context |
| 7 | Gender mismatch in drafts | Minor | /nudges |
| 8 | Weak casual transform | Minor | /transform |
| 9 | Reply lacks text in response | Minor | /reply |

**Overall ML Health: 7/10** — Core functions work well (persona, mood, briefing, simulation, style, memory extraction). Main concerns: safety (scam nudges), completeness (context analysis broken), and polish (tone check, dedup).
