# /tech-researcher — A2A Network: Техническое исследование

## Контекст

Прочитай сначала `scripts/qa-reports/a2a-product-vision.md` — там результат продуктового анализа A2A фичей мессенджера Neva.

Наш стек:
- **Backend:** Hono + Bun + SQLite (better-sqlite3 через Drizzle ORM)
- **Frontend:** React + Vite + TypeScript + Tailwind + shadcn/ui
- **AI:** OpenRouter → Claude 3.5 Sonnet (reasoning) + GPT-4o-mini (generation)
- **Real-time:** WebSocket (custom, не Socket.io)
- **Embeddings:** text-embedding-3-small через OpenRouter
- **A2A Protocol:** JSON-RPC 2.0 (частично реализован)

### Текущая архитектура A2A
Файлы:
- `server/a2a/agent-dialog.ts` — lifecycle диалогов, smart context analysis, autonomy rules
- `server/a2a/agent-skills-internal.ts` — handleWhosFree, handleGetInterests, handleMatchProposal
- `server/a2a/types.ts` — типы
- `server/routes/agent-dialogs.ts` — REST endpoints
- `server/routes/network.ts` — needs/offers/matching CRUD

### Что уже реализовано
- Agent Dialog с состояниями (pending → auto_approved/approved/denied/expired)
- Autonomy rules по relationship level × dialog type
- Smart context analysis (LLM анализирует переписку перед авто-ответом)
- Embedding-based matching needs↔offers
- Trust scoring (social distance + relationship level)
- WebSocket streaming результатов
- Consent flow (legacy + new dialogs)

### Известные проблемы
- A2A skills в executor.ts — стабы, не реализованы полностью
- Два параллельных consent-системы (legacy consentRequests + agent dialogs)
- «Кто свободен?» не показывает результаты в UI
- Matching работает только по прямому запросу, нет proactive matching
- Нет group coordination (только 1-to-1 dialogs)

## Задачи исследования

### 1. Архитектура real-time group coordination
Исследуй как реализовать:
- Групповые A2A запросы (пригласить 5 человек → собрать ответы → показать кто может)
- Voting/polling через agent dialogs
- Cascade invitations (если Маша не может, предложить Олю)
- State machine для multi-party координации
- Как это ложится на текущий WebSocket + agent_dialogs

### 2. Proactive matching engine
Исследуй:
- Как сделать matching не по запросу, а proactive (агент замечает в переписке "мне бы дизайнера найти" → автоматически ищет в сети)
- NER extraction из сообщений для обнаружения needs
- Trigger-based matching vs periodic scan
- Privacy implications — как матчить не раскрывая данные до consent
- Можно ли использовать существующий proactive-engine.ts для этого

### 3. Context-aware availability
Исследуй:
- Как определить "свободен ли человек" без прямого вопроса
- Сигналы: время последнего сообщения, mood, active topics, calendar integration (будущее)
- Confidence scoring для availability prediction
- Trade-off: точность vs privacy (анализировать переписку для определения занятости)

### 4. Knowledge graph для matching
Исследуй:
- Как построить social knowledge graph из contact_memory + contact_intelligence
- Запросы типа "кто из моих друзей разбирается в ML?" без embeddings-поиска
- Graph traversal для friends-of-friends recommendations
- Хранение: расширить SQLite vs отдельный graph store
- Как обновлять граф инкрементально

### 5. A2A Protocol completeness
Исследуй:
- Текущий executor.ts и что нужно для полноценного A2A
- Межсерверное взаимодействие (когда пользователи на разных инстансах)
- Agent Card spec compliance
- Security: аутентификация A2A запросов, rate limiting
- Какие skills нужно реализовать для MVP

### 6. Оптимизация LLM вызовов
Исследуй:
- Текущий cost per A2A operation (сколько LLM calls на "Кто свободен?" с 10 друзьями)
- Можно ли batch-ить context analysis для группы друзей
- Caching стратегии (availability не меняется каждую минуту)
- Fallback на rule-based когда LLM недоступен
- Latency budget: пользователь ждёт макс 5-10 сек

## Формат ответа

Сохрани результат в `scripts/qa-reports/a2a-tech-research.md`:
1. Для каждого вопроса: findings, рекомендуемый подход, trade-offs
2. Architecture Decision Records (ADR) для ключевых решений
3. Предлагаемые изменения в схеме БД (конкретные SQL/Drizzle миграции)
4. Оценка сложности каждого компонента (S/M/L/XL)
5. Рекомендуемый порядок реализации
6. Открытые вопросы для продукта

## Важно
- Читай существующий код (server/a2a/, server/routes/network.ts, server/ai/) перед тем как предлагать решения
- Предлагай решения которые РАСШИРЯЮТ существующую архитектуру, а не заменяют
- Учитывай SQLite ограничения (single writer, no full-text по-дефолту)
- Бюджет на LLM ограничен — оптимизируй вызовы
- НЕ пиши код, только исследование и рекомендации
