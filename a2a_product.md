# Personal Agent Network — Product Spec v2 (Realistic)

---

## Что мы строим

AI-мессенджер Neva, в котором у каждого пользователя есть персональный AI-агент. Агент анализирует переписки и накапливает знания о контактах: кто они, чем занимаются, что любят, в каком настроении.

Сейчас эти знания работают **внутри одного аккаунта**. Следующий шаг: агенты начинают **координировать действия между пользователями** — находить взаимовыгодные точки соприкосновения.

Два контекста:
1. **Relationship Care** — личные отношения: найти с кем потусить, что подарить, кого поддержать
2. **Strategy Adviser** — профессиональный нетворкинг: найти специалиста, партнёра, ментора

**Ключевое отличие от LinkedIn/Tinder/бизнес-клубов:** мэтчинг на основе реального поведения в переписках, а не самодекларации.

**Ключевое отличие от Clay/Dex/Monica CRM:** те работают внутри одного аккаунта. Мы — cross-user: "Ваня ищет дизайнера" → агент находит Петю через сеть контактов.

---

## Текущая архитектура (что уже есть)

### Данные на каждого контакта (`contact_intelligence`)
- `persona` — поведенческий + лингвистический профиль (directness, humor, emotionalReactivity, formality, signaturePatterns)
- `theirStyle` — как контакт пишет (лексика, эмодзи, структура)
- `myStyleForThem` — как НАШ пользователь пишет конкретно этому контакту
- `moodHistory` — последние 30 записей настроения с таймстемпами
- `communicationBaseline` — статистические нормы (длина сообщений, частота эмодзи, caps)
- `relationshipType` — family / friend / work / client / acquaintance

### Долгосрочная память (`contact_memory`)
- Факты: life_event, plan, person, date, health, preference, work
- Экспирация: планы 30д, предпочтения 90д, даты — никогда

### Knowledge Graph (`contact_knowledge_graph`)
- Сущности (люди, места, организации) и связи между ними
- Извлекаются из переписок LLM-моделью

### Анализ настроения (mood-detector)
- Rule-based предфильтр (эмодзи, пунктуация, капс, ключевые слова) → LLM только когда неоднозначно
- Baseline-aware: сравнивает с нормой конкретного контакта
- Тренд за 7 дней: improving / stable / declining / volatile

### Проактивный движок (proactive-engine)
- Каждые 15 минут, rule-based триггеры: тишина 7д, неотвеченное 24ч, burst 3+ сообщений, застой цели, падение настроения, upcoming date
- Генерирует nudges в `proactiveActions` таблицу

### Модели (через OpenRouter)
- Claude 3.5 Sonnet — reasoning (планирование, персона-экстракция)
- GPT-4o Mini — генерация (ответы, оценки, саммари)
- Claude 3 Haiku — классификация (mood, простые задачи)
- Complexity-aware routing: простые сообщения → Haiku, стандартные → Mini, эмоциональные → Sonnet

---

## Архитектурное решение: почему НЕ A2A Protocol

Google A2A Protocol (2025) — открытый стандарт для коммуникации между агентами разных систем (JSON-RPC 2.0, Agent Cards, Task lifecycle). Он решает проблему **распределённых гетерогенных агентов**.

У нас **все агенты на одном сервере**. "Агент Вани" и "Агент Пети" — это один и тот же код, обращающийся к разным данным в одной БД. Поэтому:

- **Не нужен** транспортный протокол (HTTP/SSE между агентами)
- **Не нужны** Agent Cards (мы знаем capabilities каждого агента — они одинаковые)
- **Нужны** правила доступа к данным между пользовательскими контекстами

**Наш подход:** внутренние сервисные функции с access control, а не межсервисный протокол. Если когда-нибудь появятся внешние агенты — обернём в A2A.

---

## Новая система: Банк потребностей и возможностей

### Суть

Централизованное хранилище, куда попадают **потребности** ("нужен дизайнер", "хочу в бар") и **возможности** ("умею верстать", "свободен в субботу"). Система ищет совпадения через семантический поиск.

### Как потребность попадает в банк

**Путь 1 — Явный запрос:**
Пользователь пишет агенту: "Найди мне дизайнера для лендинга". Агент создаёт запись немедленно.

**Путь 2 — Детектирование из переписки:**
Пользователь пишет другу: "Блин, не могу найти нормального стоматолога". Агент распознаёт паттерн → спрашивает: "Похоже ты ищешь стоматолога. Поискать среди знакомых?" → Только после подтверждения создаёт запись.

**Правило: детектированные потребности НИКОГДА не публикуются без подтверждения пользователя.**

### Детектирование потребностей (intent detection)

**Подход:** zero-shot structured extraction через GPT-4o Mini. Не требует файн-тюнинга.

**Когда вызывается:** при каждом вызове `/context` (уже есть 5-мин кеш) — добавляем в prompt extraction задачу:

```
Из последних сообщений извлеки, если есть:
- need: {description, category: professional|social|care, urgency: now|this_week|whenever}
- offer: {description, category: professional|social|hobby}
Верни JSON или null если ничего не обнаружено.
```

**Оптимизация:** Добавить rule-based предфильтр (по аналогии с mood-detector) — ключевые слова и паттерны:
- "ищу", "нужен", "не могу найти", "посоветуйте", "кто знает" → возможная потребность
- "могу помочь", "умею", "свободен", "делаю" → возможное предложение

LLM вызывается **только** когда предфильтр сработал. Экономия ~80% вызовов (как с mood-detector).

### Структура данных

```sql
-- Потребности
CREATE TABLE needs (
  id INTEGER PRIMARY KEY,
  userId INTEGER NOT NULL,
  chatId INTEGER,              -- откуда детектировано (null если явный запрос)
  description TEXT NOT NULL,    -- "дизайнер для лендинга, бюджет 50к"
  embedding BLOB,              -- вектор для семантического поиска
  category TEXT NOT NULL,       -- professional | social | care
  urgency TEXT DEFAULT 'whenever', -- now | this_week | whenever
  source TEXT NOT NULL,         -- explicit | detected
  visibility TEXT DEFAULT 'friends', -- friends | friends_of_friends | network
  status TEXT DEFAULT 'active', -- active | matched | expired | cancelled
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  expiresAt TEXT               -- auto: now=3д, this_week=7д, whenever=30д
);

-- Возможности (offers)
CREATE TABLE offers (
  id INTEGER PRIMARY KEY,
  userId INTEGER NOT NULL,
  description TEXT NOT NULL,    -- "React-разработка", "свободен по субботам"
  embedding BLOB,              -- вектор для семантического поиска
  category TEXT NOT NULL,       -- professional | social | hobby
  source TEXT NOT NULL,         -- explicit | detected
  availability TEXT DEFAULT 'available', -- available | busy
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT
);

-- История мэтчей
CREATE TABLE matches (
  id INTEGER PRIMARY KEY,
  needId INTEGER NOT NULL,
  offerId INTEGER NOT NULL,
  requesterId INTEGER NOT NULL,  -- кто ищет
  providerId INTEGER NOT NULL,   -- кого нашли
  similarityScore REAL,          -- cosine similarity
  socialDistance INTEGER,         -- 1=друг, 2=друг друга
  mutualContactId INTEGER,       -- через кого связаны
  status TEXT DEFAULT 'proposed', -- proposed | accepted | declined | completed
  requesterRating INTEGER,       -- 1-5 после завершения
  providerRating INTEGER,        -- 1-5 после завершения
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  completedAt TEXT
);
```

### Семантический поиск: embeddings

**Исследование показывает:** для нашего масштаба (тысячи записей) НЕ нужен vector DB.

**Выбор модели:**

| Вариант | Размерность | Стоимость | Скорость | Рекомендация |
|---------|-------------|-----------|----------|--------------|
| `all-MiniLM-L6-v2` (локально) | 384 | Бесплатно | 5-14K sent/sec CPU | MVP — минимальная задержка, 0 стоимость |
| OpenAI `text-embedding-3-small` | 1536 | $0.02/1M tokens | API call | Production — лучше качество, мультиязычность |

**Имплементация MVP:** OpenAI `text-embedding-3-small` через API (уже используем OpenRouter, добавить embedding endpoint тривиально).

**Поиск:** brute-force cosine similarity в application code:
```typescript
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

При 10K записей это ~1ms. Vector DB понадобится только при 100K+ записей.

---

## Социальный граф и радиус поиска

### Построение графа

Граф строится **из существующих данных** — таблица `chats` уже содержит все связи:
- Если User A и User B в одном чате → они связаны (distance = 1)
- Если User A связан с User B, и User B связан с User C → distance = 2 (друг друга)

```typescript
// Прямые контакты (distance=1)
async function getDirectContacts(userId: number): Promise<number[]> {
  // SELECT DISTINCT otherUserId FROM chatMembers
  // WHERE chatId IN (SELECT chatId FROM chatMembers WHERE userId = ?)
}

// Друзья друзей (distance=2)
async function getFriendsOfFriends(userId: number): Promise<{userId: number, via: number}[]> {
  // Для каждого directContact → их directContacts, исключая userId и уже known
}
```

### Радиус поиска (visibility)

| Уровень | Кто видит | Типичное использование |
|---------|-----------|----------------------|
| **friends** | Прямые контакты (есть общий чат) | "Кто свободен в бар?", "Что подарить Маше?" |
| **friends_of_friends** | 2-й круг | "Ищу дизайнера", "Нужен стоматолог" |
| **network** | Все пользователи системы | "Ищу CTO в стартап" |

Детектированные потребности → всегда `friends` по умолчанию. Расширить может только пользователь явно.

---

## Система доверия (Trust Score)

### Упрощённая модель (без cross-account анализа переписок)

Оригинальный документ предлагал анализировать переписки ДРУГИХ пользователей для верификации. Это:
1. Privacy nightmare — читаем чужие сообщения
2. Технически сложно — cross-account NLP pipeline
3. Юридически рискованно

**Реалистичная альтернатива — 3 компонента:**

| Компонент | Вес | Что измеряет | Откуда данные |
|-----------|-----|-------------|---------------|
| **История мэтчей** | 50% | Предыдущие мэтчи прошли успешно | Средний рейтинг из `matches.requesterRating` + `providerRating` |
| **Активность в системе** | 30% | Человек реально использует мессенджер | Кол-во сообщений, длительность использования, response rate |
| **Социальная дистанция** | 20% | Чем ближе — тем больше доверие | 1=друг, 2=друг друга, 3=сеть |

**Формула:**
```typescript
function calculateTrustScore(userId: number, fromUserId: number): number {
  const matchAvg = getAverageMatchRating(userId);  // 0-5, default 2.5
  const activity = getActivityScore(userId);         // 0-5
  const distance = getSocialDistance(userId, fromUserId); // 1-3

  const distanceScore = distance === 1 ? 5 : distance === 2 ? 3 : 1;

  return (matchAvg * 0.5) + (activity * 0.3) + (distanceScore * 0.2);
  // Результат: 0-5, показываем как звёзды
}
```

**Нет данных о мэтчах?** Новые пользователи получают baseline = 2.5 (нейтральный). Trust растёт с каждым успешным мэтчем.

**Будущее улучшение (Phase 2+):** Добавить explicit endorsements — "Рекомендую Петю как дизайнера" (кнопка в профиле). Это opt-in замена для "анализа чужих переписок".

---

## Координация между агентами (внутренний протокол)

### Почему не "A2A обмен инсайтами"

Оригинальный документ описывал сложный протокол InsightRequest → Safety Check → InsightResponse. На практике это:

1. **Все данные в одной БД** — "агент B проверяет безопасность" = одна функция с access rules
2. **"Мудрецы" с 5 критериями** = набор if/else правил доступа к полям

### Что реально нужно: Consent-based Access Control

Когда агент User A хочет данные о User B, система проверяет:

```typescript
interface AccessRule {
  dataType: 'availability' | 'interests' | 'mood_abstract' | 'mood_detail' |
            'wishes' | 'facts' | 'expertise';
  minRelationship: 'acquaintance' | 'friend' | 'close';
  requiresConsent: boolean;  // нужно ли спрашивать User B
}

const ACCESS_RULES: AccessRule[] = [
  // Всем: общие интересы (из persona.activeTopics)
  { dataType: 'interests', minRelationship: 'acquaintance', requiresConsent: false },

  // Друзьям: доступность (но с запросом согласия)
  { dataType: 'availability', minRelationship: 'friend', requiresConsent: true },

  // Друзьям: абстрактное настроение ("ему сейчас непросто")
  { dataType: 'mood_abstract', minRelationship: 'friend', requiresConsent: false },

  // Близким: конкретные факты ("хотел кофемолку")
  { dataType: 'facts', minRelationship: 'close', requiresConsent: false },

  // Близким: желания из памяти
  { dataType: 'wishes', minRelationship: 'close', requiresConsent: false },

  // Всем (при matching): экспертиза
  { dataType: 'expertise', minRelationship: 'acquaintance', requiresConsent: true },
];
```

### Определение уровня отношений

Используем **существующие данные** из `contact_intelligence`:

```typescript
function getRelationshipLevel(userId: number, contactId: number): 'acquaintance' | 'friend' | 'close' {
  const intel = getContactIntel(userId, contactId);

  // Уже есть relationshipType: family/friend/work/client/acquaintance
  if (intel?.relationshipType === 'family') return 'close';
  if (intel?.relationshipType === 'friend') return 'friend'; // можно уточнить по активности
  if (intel?.relationshipType === 'work' || intel?.relationshipType === 'client') return 'friend';
  return 'acquaintance';
}
```

**Важно:** relationship определяется ОТ User A К User B. Это уже есть в `contact_intelligence` — не нужен новый "Bond Level". Просто формализуем маппинг существующего `relationshipType` → уровень доступа.

### Механизм согласия (consent)

Когда `requiresConsent: true`, система отправляет **push-уведомление** через существующий WebSocket:

```typescript
// Пример: "Ваня зовёт в бар, идёшь?"
interface ConsentRequest {
  id: string;
  fromUserId: number;
  toUserId: number;
  dataType: string;
  context: string;        // "приглашение в бар сегодня"
  expiresAt: string;      // 24 часа
}

// Ответ приходит через WebSocket
interface ConsentResponse {
  requestId: string;
  approved: boolean;
  message?: string;       // "Давай!" или "Не сегодня"
}
```

Таблица `consent_requests` хранит историю для аудита и прозрачности.

---

## Механика мэтчинга

### Пошаговый процесс

```
Шаг 1: ПОЯВЛЕНИЕ ПОТРЕБНОСТИ
  Явный запрос или детектирование + подтверждение
  → запись в таблице needs + embedding вектор
        ↓
Шаг 2: ПОИСК КАНДИДАТОВ
  Cosine similarity между need.embedding и offers[].embedding
  + фильтр по category
  + фильтр по visibility (social graph distance)
  + порог similarity > 0.7
  → список кандидатов, отсортированный по score
        ↓
Шаг 3: ЗАПРОС СОГЛАСИЯ
  Каждому кандидату — push через WebSocket:
  "Знакомый [общего друга] ищет [description]. Предложить тебя?"
  Кандидат: согласиться / отказаться / уточнить
  Таймаут: 24 часа
        ↓
Шаг 4: РАНЖИРОВАНИЕ
  Кандидаты, которые согласились:
  finalScore = similarity × 0.4 + trustScore × 0.3 + (1/distance) × 0.3
        ↓
Шаг 5: ПРЕЗЕНТАЦИЯ
  Пользователю — карточки с фактами:
  - Имя (если friends) или "Знакомый [общего друга]" (если friends_of_friends)
  - Что предлагает
  - Через кого связаны
  - Trust score (звёзды)
  - Кнопка "Написать"
        ↓
Шаг 6: ЗНАКОМСТВО
  "Написать" → агент генерирует первое сообщение
  в стиле пользователя (уже есть в style system)
        ↓
Шаг 7: ОБРАТНАЯ СВЯЗЬ
  Через 7 дней (или по завершении):
  "Как прошло? (1-5)" обоим участникам
  → обновление trust score
```

### Scoring формула

```typescript
interface MatchCandidate {
  userId: number;
  offerId: number;
  similarity: number;      // cosine similarity embeddings (0-1)
  trustScore: number;      // 0-5
  socialDistance: number;   // 1, 2, или 3
  mutualContactId?: number;
}

function rankCandidates(candidates: MatchCandidate[]): MatchCandidate[] {
  return candidates
    .map(c => ({
      ...c,
      finalScore:
        c.similarity * 0.4 +
        (c.trustScore / 5) * 0.3 +
        (1 / c.socialDistance) * 0.3
    }))
    .sort((a, b) => b.finalScore - a.finalScore);
}
```

---

## Детальные сценарии

### Сценарий 1: "Найди мне специалиста" (Strategy, явный запрос)

**Ваня:** "Найди дизайнера для лендинга, бюджет до 50к"

**Что происходит:**
1. Агент создаёт need: `{description: "дизайнер для лендинга, бюджет 50к", category: "professional", visibility: "friends_of_friends"}`
2. Embedding через OpenAI `text-embedding-3-small`
3. Cosine similarity с offers в радиусе friends_of_friends
4. Найден Петя (через Машу): offer "веб-дизайн, UI/UX" — similarity 0.85
5. Push Пете: "Знакомый Маши ищет дизайнера для лендинга, бюджет 50к. Предложить тебя?"
6. Петя: "Да, но свободен через неделю"

**Результат Ване:**
```
Найден кандидат:

Петя (через Машу)
  Предлагает: веб-дизайн, UI/UX
  Доступность: свободен через неделю
  Trust: ★★★☆☆ (новый пользователь, 1 успешный мэтч)

  [Написать через Машу]  [Написать напрямую]
```

**Отличие от v1:** Нет "3 лендинга за год" и "Маша и Серёжа его благодарили" — это требовало бы cross-account анализа переписок. Показываем только то, что знаем: offer description + trust score + social path.

---

### Сценарий 2: "Агент нашёл потребность" (детектирование)

**Ваня пишет другу:** "Блин, опять эта бухгалтерия, каждый квартал мучаюсь, нужен нормальный бухгалтер"

**Что происходит:**
1. Rule-based предфильтр: "нужен" + "бухгалтер" → потенциальная потребность
2. GPT-4o Mini подтверждает: `{need: {description: "бухгалтер", category: "professional", urgency: "whenever"}}`
3. Nudge Ване (через существующий proactive engine):

```
Похоже, ты ищешь бухгалтера.
Поискать среди знакомых?

[Да, поищи]  [Нет, не надо]
```

4. Только после "Да" → создаётся need в банке

**Интеграция:** Детектирование встраивается в существующий `/context` endpoint (уже имеет 5-мин кеш). Nudge генерируется через `proactiveActions` (уже есть WebSocket push).

---

### Сценарий 3: "Кто свободен потусить?" (Relationship Care)

**Ваня:** "Кто свободен сегодня вечером? Хочу в бар"

**Что происходит:**
1. Агент определяет друзей с `relationshipType` = friend/family (не acquaintance для бара)
2. Каждому другу → consent request через WebSocket:
   - "Ваня зовёт в бар сегодня вечером. Идёшь?"
3. Друзья отвечают в приложении (кнопки: Давай! / Не сегодня / Уточнить)
4. Агент Вани собирает ответы (таймаут 2 часа для срочных):

```
Петя — давай! 🍺
Маша — не сегодня
Саша — не ответил

[Написать Пете]
```

**Про Сашу:** В v1 предлагалось, что "агент Саши решает не беспокоить (плохое настроение)". Это опасная территория — агент решает за пользователя. **Реалистичнее:** Саша получает уведомление как все, сам решает отвечать или нет. Если не ответил в таймаут — "не ответил".

**Будущее улучшение:** Пользователь может настроить "не беспокоить по вечерам" или "автоотклонять приглашения когда busy". Это explicit opt-in, не агент-гадалка.

---

### Сценарий 4: "Что подарить" (Relationship Care)

**Контекст:** У Маши ДР через 5 дней (из `contact_memory`, category: date).

**Что происходит:**
1. Proactive engine срабатывает на триггер `upcoming_date` (уже есть)
2. Nudge Ване: "У Маши ДР через 5 дней!"
3. Ваня: "Что подарить?"
4. Агент Вани смотрит **свои данные о Маше** (не данные агента Маши!):
   - `contact_memory`: preference — "увлекается керамикой", "ходит на мастер-классы"
   - `persona.activeTopics`: ["керамика", "лепка"]
5. GPT-4o Mini генерирует идеи на основе этих фактов:

```
У Маши ДР через 5 дней!

Из того что ты знаешь о Маше:
- Увлекается керамикой, ходит на мастер-классы

Идеи:
  📚 Книга по керамике
  🎨 Сертификат на мастер-класс
  🏺 Набор инструментов/глазурей

[Подробнее]  [Написать Маше]
```

**Отличие от v1:** Не запрашиваем данные у "агента Маши". Используем то, что агент Вани **уже знает** о Маше из их переписок. Это и проще, и не нарушает privacy.

**Будущее (с consent):** Маша может opt-in в "wishlist mode" — явно сказать агенту что хочет. Тогда близкие друзья (close) могут запросить wishlist. Но это Phase 2+.

---

### Сценарий 5: "Защита от мошенников" (Safety Alert)

**Контекст:** Бабушке пишет незнакомый номер с финансовым давлением.

**Что происходит:**
1. Rule-based детектор (расширение mood-detector):
   - Незнакомый контакт (нет в истории)
   - Финансовые ключевые слова (деньги, перевод, счёт, карта)
   - Давление (срочно, сейчас, немедленно)
   - Манипуляция (ваш внук, беда, помогите)
2. При срабатывании 3+ сигналов → alert

**Два варианта реализации:**

**Вариант A (простой, Phase 1):** Alert самой бабушке:
```
⚠️ Подозрительное сообщение

Незнакомый контакт просит перевести деньги.
Будь осторожна — это может быть мошенничество.

[Заблокировать]  [Это знакомый]
```

**Вариант B (с cross-user, Phase 2):** Alert доверенному контакту.
Бабушка заранее настраивает: "В случае подозрительной активности — уведомить внука".
Это explicit opt-in, не автоматика. Внук получает:
```
⚠️ Подозрительная активность у бабушки

Незнакомый контакт, возможно мошенничество.

[Позвонить бабушке]
```

**Не раскрывается:** содержание переписки, сумма, детали.

---

## Что НЕ делаем (и почему)

| Фича из v1 | Почему не делаем | Альтернатива |
|-------------|-----------------|--------------|
| Cross-account анализ переписок для Trust Score | Privacy violation, юридические риски | Trust = match history + activity + social distance |
| Bond Level с автоматическим расчётом из 8 сигналов | Over-engineering, уже есть `relationshipType` | Маппинг relationshipType → access level |
| "Агент решает не беспокоить" (сценарий с Сашей) | Агент не должен решать за пользователя | Пользователь сам настраивает DND/автоотклонение |
| Автоматические действия агентом (бронирование) | Слишком рискованно, нет интеграций | Предлагать, не делать |
| 5-критериальная оценка безопасности инсайтов | Это просто access control rules | Таблица AccessRule с 3 полями |
| InsightRequest/InsightResponse протокол | Все на одном сервере | Внутренние функции с проверкой прав |

---

## Прозрачность и контроль

Каждый пользователь может:
- **Видеть** свои active needs и offers
- **Видеть** кто запрашивал consent и что он ответил (таблица `consent_requests`)
- **Отменить** любую need/offer
- **Настроить** автоответы на consent requests ("всегда отклонять от незнакомых")
- **Удалить** свои offers и needs из банка

**НЕ видит:** чьи потребности привели к мэтчу (видит только результат: "тебя предлагают как дизайнера")

---

## Новые API Endpoints

| Endpoint | Метод | Что делает | LLM вызовы |
|----------|-------|-----------|-------------|
| `/api/ai/tools/needs` | POST | Создать потребность (explicit) | 1 (embedding) |
| `/api/ai/tools/needs` | GET | Список своих потребностей | 0 |
| `/api/ai/tools/offers` | POST | Создать возможность | 1 (embedding) |
| `/api/ai/tools/offers` | GET | Список своих возможностей | 0 |
| `/api/ai/tools/match` | POST | Запустить поиск по потребности | 1 (embedding) + 0 (cosine similarity in code) |
| `/api/ai/tools/consent` | POST | Ответить на consent request | 0 |
| `/api/ai/tools/consent` | GET | Список pending consent requests | 0 |
| `/api/ai/tools/match-feedback` | POST | Оценка после мэтча (1-5) | 0 |
| `/api/ai/tools/trust-score/:userId` | GET | Trust score пользователя | 0 |

**Модификация существующих:**
- `/context` — добавить intent detection (need/offer extraction) в существующий prompt
- Proactive engine — добавить триггер `detected_need` (потребность найдена в переписке)

---

## Roadmap

### Phase 1: Foundations (2-3 недели)
- [ ] DB таблицы: needs, offers, matches, consent_requests
- [ ] Embedding pipeline (OpenAI text-embedding-3-small)
- [ ] Cosine similarity matching в app code
- [ ] Social graph traversal (friends, friends_of_friends из chatMembers)
- [ ] API endpoints: needs CRUD, offers CRUD, match trigger
- [ ] Consent flow через WebSocket (переиспользуем infra из proactive engine)
- [ ] Trust score v1 (match history + activity + distance)
- [ ] UI: экран "Мои потребности / возможности"

### Phase 2: Smart Detection (1-2 недели)
- [ ] Rule-based предфильтр для intent detection (ключевые слова)
- [ ] Zero-shot extraction через GPT-4o Mini в `/context`
- [ ] Новый proactive trigger: `detected_need`
- [ ] UI: nudge "Похоже ты ищешь X. Поискать?"

### Phase 3: Relationship Care (1-2 недели)
- [ ] "Кто свободен?" — массовый consent request с таймаутом
- [ ] "Что подарить?" — подарки из собственных данных о контакте
- [ ] Fraud detection alerts (расширение mood-detector)
- [ ] UI: карточки мэтчей с trust score и social path

### Phase 4: Polish & Scale (ongoing)
- [ ] Explicit endorsements ("Рекомендую Петю как дизайнера")
- [ ] Wishlist mode (opt-in для подарков)
- [ ] Trusted contacts для safety alerts
- [ ] Auto-expire stale needs/offers
- [ ] Match quality analytics

---

## Технический стек (что добавляется)

| Компонент | Технология | Причина |
|-----------|-----------|---------|
| Embeddings | OpenAI `text-embedding-3-small` через API | Мультиязычность (ру/en), качество, простота интеграции |
| Vector search | Brute-force cosine similarity в TypeScript | Масштаб <10K записей, не нужен vector DB |
| Consent transport | Существующий WebSocket | Уже есть infra для push-уведомлений |
| Intent detection | GPT-4o Mini (zero-shot structured extraction) | Уже используется для analysis/generation |
| Trust computation | Application code | Простая формула, не нужен ML |
| Social graph | SQL queries на chatMembers | Данные уже есть |

**Ничего нового не устанавливается.** Всё работает на существующем стеке: Bun + Hono + SQLite + OpenRouter + WebSocket.
