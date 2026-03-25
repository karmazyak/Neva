# Neva Messenger — Архитектурный план масштабирования

> Технический документ. Версия 1.0, 25 марта 2026.

---

## 0. Текущее состояние

| Компонент | Сейчас | Проблема |
|-----------|--------|----------|
| Runtime | Bun + Hono | Хороший выбор, оставляем |
| БД | SQLite (WAL mode) | Одно соединение на запись, нет concurrent writes |
| WebSocket | In-memory Map<userId, Set\<WS>> | Один процесс, один сервер, нет горизонтального масштабирования |
| Сообщения | INSERT → broadcastToChat → linear scan subscribers | O(N) на каждое сообщение, нет батчинга |
| Поиск | `LIKE '%query%'` по зашифрованному полю | Не работает вообще (ищем по шифротексту) |
| Подписки | chatSubscriptions: Map<chatId, Set\<userId>> | Перестраивается при каждом реконнекте |
| Шифрование | AES-256-GCM на каждое сообщение | Правильно, но ключ единый для всех (HKDF от мастер-ключа) |
| Доставка | Fire-and-forget через WS | Нет гарантии доставки, нет очереди |
| AI | In-memory conversation history | Теряется при рестарте |

**Вердикт:** Архитектура работает для 10 пользователей, но имеет 5 критических бутылочных горлышек, которые нужно устранить ДО масштабирования.

---

## 1. Критический путь: 5 бутылочных горлышек

### 1.1 SQLite — однопоточная запись

SQLite в WAL mode даёт concurrent reads, но запись всё равно сериализована через один мьютекс. При 100 сообщениях/сек мы упрёмся в write lock.

**Решение — двухфазное:**

**Фаза A (сейчас, 10-1000 юзеров):** Оптимизировать SQLite до предела.
```
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;        -- было FULL, даёт 2-5x на запись
PRAGMA cache_size = -64000;          -- 64MB page cache (было дефолт 2MB)
PRAGMA mmap_size = 268435456;        -- 256MB memory-mapped I/O
PRAGMA busy_timeout = 5000;          -- ждать 5с вместо immediate fail
PRAGMA wal_autocheckpoint = 1000;    -- checkpoint каждые 1000 страниц
```

Добавить **write batching**: собирать INSERT'ы сообщений в пачки по 10-50ms и записывать одной транзакцией. На 100 msg/s это 5-10 INSERT'ов за транзакцию вместо 100 отдельных. Выигрыш: 10-20x throughput.

**Фаза B (1000+ юзеров):** Миграция на PostgreSQL.
- Таблица `messages` с `PARTITION BY RANGE (created_at)` — помесячные партиции
- UUIDv7 для primary keys (time-ordered, нет random page splits в B-tree)
- Citus для шардирования по `conversation_id` когда один Postgres не справляется
- pg_partman для автоматического создания партиций

### 1.2 WebSocket — нет горизонтального масштабирования

Текущий broadcastToChat итерирует `chatSubscriptions.get(chatId)` — это работает только на одном процессе.

**Решение — трёхуровневое:**

**Уровень 1 (сейчас):** Одна нода, но подготовить абстракцию.
```typescript
// Вместо прямого обращения к Map, вводим PubSub интерфейс:
interface MessageBus {
  publish(channel: string, data: unknown): Promise<void>;
  subscribe(channel: string, handler: (data: unknown) => void): void;
  unsubscribe(channel: string): void;
}

// Реализация для одной ноды — просто EventEmitter:
class LocalMessageBus implements MessageBus { ... }

// Когда нужно масштабировать — заменяем на:
class RedisMessageBus implements MessageBus { ... }
```

**Уровень 2 (1K-100K юзеров):** Redis Pub/Sub как backplane.
- Каждая WS-нода подписывается на каналы `chat:{chatId}` в Redis
- Маппинг `user:{userId} → server_node_id` в Redis для directed messages
- sendToUser() сначала проверяет локальные соединения, потом шлёт через Redis

**Уровень 3 (100K+ юзеров):** NATS JetStream вместо Redis Pub/Sub.
- Redis Pub/Sub теряет сообщения если подписчик не успевает — fire-and-forget
- NATS JetStream гарантирует at-least-once delivery
- Поддержка consumer groups для балансировки нагрузки

### 1.3 Нет гарантии доставки сообщений

Текущий поток: `INSERT → ws.send() → hope for the best`.

Если клиент в момент отправки офлайн или WS пакет потерялся — сообщение доставлено не будет. Push-уведомление отправляется, но это только "будильник", а не само сообщение.

**Решение — store-and-forward (как WhatsApp/Signal):**

```
Сообщение отправлено
    ↓
INSERT в messages (status = 'sent')
    ↓
Попытка доставки через WS
    ├── Юзер онлайн → ws.send() → ждём ACK
    │   ├── ACK получен → status = 'delivered'
    │   └── Таймаут 5с → помечаем для retry
    └── Юзер офлайн → сообщение остаётся в очереди
    ↓
При реконнекте клиент запрашивает:
GET /api/messages/pending?since={lastReceivedTimestamp}
    ↓
Сервер отдаёт все недоставленные → клиент шлёт ACK
```

**Клиентский протокол:**
```json
// Клиент → Сервер (подтверждение доставки)
{ "type": "ack", "messageIds": ["msg_1", "msg_2"] }

// Сервер → Клиент (при реконнекте)
{ "type": "sync", "messages": [...], "since": "2026-03-25T10:00:00Z" }
```

### 1.4 Поиск по зашифрованным сообщениям

Текущий поиск делает `LIKE '%query%'` по `messages.content`, но контент зашифрован — `enc:v1:...`. Поиск по шифротексту бессмыслен.

**Решение — серверный поисковый индекс с отдельным шифрованием:**

**Вариант A (простой, для <10K юзеров):**
- Добавить колонку `search_tokens` — массив нормализованных токенов (lowercase, stemming)
- Токены шифруются детерминистическим методом (HMAC-SHA256 от слова + chat_id как salt)
- Поиск = вычислить HMAC от запроса и искать точное совпадение
- Работает только для exact match, не для подстрок

**Вариант B (полноценный, для >10K юзеров):**
- Meilisearch/Typesense как отдельный сервис
- Расшифрованный контент индексируется в поисковом движке
- Поисковый индекс живёт в оперативке (Meilisearch) — быстро, но требует памяти
- При рестарте поискового сервиса — переиндексация из БД

**Рекомендация:** Сначала Вариант A (нулевые зависимости), потом B.

### 1.5 N+1 запросы в loadChats()

`getChats()` сейчас:
1. `SELECT * FROM chats JOIN chat_members WHERE userId = ?` — список чатов
2. Для КАЖДОГО чата: `SELECT * FROM messages WHERE chatId = ? ORDER BY createdAt DESC LIMIT 1` — последнее сообщение
3. Для КАЖДОГО чата: `SELECT * FROM chat_members WHERE chatId = ?` — участники

При 50 чатах = 101 запрос к БД.

**Решение:**
```sql
-- Один запрос вместо 101:
SELECT
  c.*,
  m.id as last_msg_id, m.content as last_msg_content,
  m.senderId as last_msg_sender, m.createdAt as last_msg_at,
  (SELECT COUNT(*) FROM messages
   WHERE chatId = c.id AND status = 'sent' AND senderId != ?) as unread_count
FROM chats c
JOIN chat_members cm ON cm.chatId = c.id AND cm.userId = ?
LEFT JOIN messages m ON m.id = (
  SELECT id FROM messages WHERE chatId = c.id ORDER BY createdAt DESC LIMIT 1
)
ORDER BY COALESCE(m.createdAt, c.createdAt) DESC;
```

Плюс: кеширование `last_message` прямо в таблице `chats` (денормализация).

---

## 2. Протокол: от JSON к бинарному

### 2.1 Текущий протокол

```json
{"type":"new_message","message":{"id":1,"chatId":2,"content":"привет","senderId":3,"createdAt":"2026-03-25T10:00:00Z"}}
```

Размер: ~150 байт на одно сообщение. При 10K сообщений/сек = 1.5 MB/s только на JSON.

### 2.2 Переход на MessagePack

MessagePack — бинарная сериализация, совместимая с JSON-структурами. Те же объекты, но компактнее на 30-60%.

```typescript
import { encode, decode } from '@msgpack/msgpack';

// Отправка
ws.send(encode({ t: 1, m: { id: 1, c: 2, tx: "привет", s: 3 } }));

// Приём
const msg = decode(new Uint8Array(data));
```

**Сокращения полей (экономия ещё 20-30%):**
| Полное | Короткое | Описание |
|--------|----------|----------|
| type | t | Тип события (число вместо строки) |
| message | m | Тело сообщения |
| chatId | c | ID чата |
| content/text | tx | Текст |
| senderId | s | Отправитель |
| messageId | mid | ID сообщения |
| createdAt | ts | Timestamp (unix ms вместо ISO string) |

**Типы событий (числа вместо строк):**
```typescript
enum WsEvent {
  NEW_MESSAGE = 1,
  EDIT = 2,
  DELETE = 3,
  TYPING = 4,
  ACK = 5,
  SYNC = 6,
  READ = 7,
  REACTION = 8,
  STATUS = 9,
  SUBSCRIBE = 10,
  PING = 11,
  PONG = 12,
}
```

**Экономия:** 150 байт → ~60 байт на сообщение. При масштабе это x2.5 меньше трафика.

### 2.3 Версионирование протокола

Первый байт каждого бинарного сообщения — версия протокола:
```
[version: u8][msgpack payload...]
```

Позволяет обновлять протокол без разрыва старых клиентов. Клиенты, не поддерживающие новую версию, получают JSON fallback.

---

## 3. Архитектура хранения сообщений

### 3.1 Текущая схема (SQLite)

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chatId INTEGER,
  senderId INTEGER,
  content TEXT,           -- enc:v1:...
  type TEXT,
  replyToId INTEGER,
  status TEXT DEFAULT 'sent',
  visibility TEXT DEFAULT 'normal',
  metadata TEXT,          -- JSON blob
  editedAt TEXT,
  forwardedFrom INTEGER,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**Проблемы:**
- `id` — AUTOINCREMENT, при шардировании будут коллизии
- `createdAt` — TEXT формат, медленные сравнения
- Нет индекса на `(chatId, createdAt)` — основной запрос тормозит
- `metadata` — JSON blob, не индексируемый
- `status` — TEXT вместо числа

### 3.2 Оптимизированная схема

```sql
-- Немедленные изменения (SQLite-совместимые):
CREATE INDEX IF NOT EXISTS idx_messages_chat_time
  ON messages(chatId, createdAt DESC);

CREATE INDEX IF NOT EXISTS idx_messages_sender
  ON messages(senderId, createdAt DESC);

CREATE INDEX IF NOT EXISTS idx_messages_status
  ON messages(chatId, status) WHERE status = 'sent';

-- Денормализация для быстрого loadChats:
ALTER TABLE chats ADD COLUMN lastMessageId INTEGER;
ALTER TABLE chats ADD COLUMN lastMessageAt TEXT;
ALTER TABLE chats ADD COLUMN lastMessagePreview TEXT;  -- первые 100 символов

-- Триггер обновления:
CREATE TRIGGER update_chat_last_message
AFTER INSERT ON messages
BEGIN
  UPDATE chats SET
    lastMessageId = NEW.id,
    lastMessageAt = NEW.createdAt,
    lastMessagePreview = substr(NEW.content, 1, 100)
  WHERE id = NEW.chatId;
END;
```

### 3.3 Будущая схема (PostgreSQL)

```sql
CREATE TABLE messages (
  id UUID DEFAULT gen_random_uuid(),  -- UUIDv7 из приложения
  chat_id UUID NOT NULL,
  sender_id UUID NOT NULL,
  content BYTEA,                       -- шифротекст как бинарные данные
  type SMALLINT DEFAULT 0,             -- 0=text, 1=image, 2=video, 3=system, 4=file
  reply_to_id UUID,
  status SMALLINT DEFAULT 0,           -- 0=sent, 1=delivered, 2=read
  visibility SMALLINT DEFAULT 0,       -- 0=normal, 1=ghost
  metadata JSONB,
  edited_at TIMESTAMPTZ,
  forwarded_from UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Автоматические помесячные партиции через pg_partman
SELECT partman.create_parent(
  'public.messages', 'created_at', 'native', 'monthly'
);

-- Индексы (создаются на каждой партиции автоматически):
CREATE INDEX ON messages (chat_id, created_at DESC);
CREATE INDEX ON messages (sender_id, created_at DESC);
CREATE INDEX ON messages (chat_id, status) WHERE status = 0;
```

---

## 4. Connection Management

### 4.1 Текущая проблема

```typescript
// ws.ts — при каждом сообщении:
const subscribers = chatSubscriptions.get(chatId);  // Set<userId>
for (const userId of subscribers) {
  const userConns = connections.get(userId);  // Set<WebSocket>
  for (const ws of userConns) {
    ws.send(JSON.stringify(data));            // JSON.stringify на каждое соединение!
  }
}
```

**Проблема 1:** `JSON.stringify(data)` вызывается для каждого соединения, хотя данные одинаковые.
**Проблема 2:** `ws.send()` — синхронный вызов, блокирует event loop при большом числе подписчиков.

### 4.2 Оптимизация

```typescript
function broadcastToChat(chatId: number, data: unknown, excludeUserId?: number) {
  const subscribers = chatSubscriptions.get(chatId);
  if (!subscribers?.size) return;

  // Сериализуем ОДИН раз
  const payload = JSON.stringify(data);

  for (const userId of subscribers) {
    if (userId === excludeUserId) continue;
    const userConns = connections.get(userId);
    if (!userConns) continue;
    for (const ws of userConns) {
      // Bun's ws.send() с ready state проверкой
      if (ws.readyState === 1) {
        ws.send(payload);
      }
    }
  }
}
```

**Дальнейшая оптимизация — cork() для батчинга:**
```typescript
// Bun поддерживает ServerWebSocket.cork() для объединения нескольких send в один syscall
for (const ws of userConns) {
  ws.cork(() => {
    ws.send(payload);
  });
}
```

### 4.3 Connection Pooling

Ограничить количество WS-соединений на юзера (сейчас — безлимитно):
```typescript
const MAX_CONNECTIONS_PER_USER = 5;

function addConnection(userId: number, ws: WebSocket) {
  const conns = connections.get(userId) ?? new Set();
  if (conns.size >= MAX_CONNECTIONS_PER_USER) {
    // Закрыть самое старое соединение
    const oldest = conns.values().next().value;
    oldest.close(4000, 'Too many connections');
    conns.delete(oldest);
  }
  conns.add(ws);
  connections.set(userId, conns);
}
```

---

## 5. Кеширование

### 5.1 Hot Data Cache

Самые частые запросы:
1. `loadChats()` — список чатов юзера (при каждом открытии приложения)
2. `loadMessages(chatId)` — последние 50 сообщений (при переключении чата)
3. `isUserOnline(userId)` — статус (постоянно)

**Решение — LRU Cache в памяти:**
```typescript
import { LRUCache } from 'lru-cache';

const chatListCache = new LRUCache<number, Chat[]>({
  max: 10000,        // 10K юзеров
  ttl: 30_000,       // 30 секунд
});

const recentMessagesCache = new LRUCache<number, Message[]>({
  max: 5000,         // 5K чатов
  ttl: 60_000,       // 1 минута
});

// Инвалидация при новом сообщении:
function onNewMessage(chatId: number) {
  recentMessagesCache.delete(chatId);
  // Инвалидировать chatList для всех участников чата
  const members = chatSubscriptions.get(chatId);
  members?.forEach(userId => chatListCache.delete(userId));
}
```

### 5.2 При масштабировании — Redis

Когда появляется вторая нода:
```
LRU (L1, per-process) → Redis (L2, shared) → PostgreSQL (L3, persistent)
```

Паттерн read-through/write-through: запрос идёт L1 → L2 → L3, ответ кешируется обратно.

---

## 6. Клиентская архитектура

### 6.1 Виртуализация списка сообщений

Текущий ChatWindow рендерит ВСЕ загруженные сообщения. При 500 сообщениях — 500 DOM-нод.

**Решение — windowed rendering:**
```typescript
// Используем @tanstack/react-virtual:
import { useVirtualizer } from '@tanstack/react-virtual';

const virtualizer = useVirtualizer({
  count: messages.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 72,  // средняя высота сообщения
  overscan: 10,            // рендерить 10 элементов сверху и снизу viewport
});

// Рендерим только видимые:
{virtualizer.getVirtualItems().map(virtualRow => (
  <MessageBubble key={messages[virtualRow.index].id} ... />
))}
```

Результат: вместо 500 DOM-нод — ~30-40. Скролл плавный на любом количестве.

### 6.2 Оптимистичные обновления

Сейчас: отправка сообщения → ждём ответа сервера → добавляем в список.
Задержка: 50-200ms, заметна пользователю.

**Решение:**
```typescript
async function sendMessage(chatId, content) {
  const tempId = `temp_${Date.now()}`;

  // 1. Немедленно показываем в UI
  addMessage(chatId, {
    id: tempId,
    chatId,
    content,
    senderId: currentUser.id,
    status: 'sending',
    createdAt: new Date().toISOString(),
  });

  try {
    // 2. Отправляем на сервер
    const real = await api.sendMessage(chatId, content);
    // 3. Заменяем temp на реальное
    replaceMessage(chatId, tempId, real);
  } catch (err) {
    // 4. Помечаем как failed
    updateMessageStatus(chatId, tempId, 'failed');
  }
}
```

### 6.3 Incremental Sync вместо полной загрузки

Сейчас: при открытии приложения — `loadChats()` загружает ВСЁ заново.

**Решение — delta sync:**
```typescript
// Клиент хранит lastSyncTimestamp в localStorage
const lastSync = localStorage.getItem('lastSync') || '1970-01-01';

// При открытии:
GET /api/sync?since={lastSync}

// Сервер возвращает только изменения:
{
  "chats": {
    "updated": [...],   // чаты с новыми сообщениями
    "removed": [...]    // удалённые чаты
  },
  "messages": {
    "new": [...],       // новые сообщения
    "edited": [...],    // отредактированные
    "deleted": [...]    // удалённые ID
  },
  "timestamp": "2026-03-25T10:00:00Z"
}
```

---

## 7. Roadmap масштабирования

### Фаза 0: Оптимизация ядра (10-100 юзеров) ← **СЕЙЧАС**

| Задача | Сложность | Эффект |
|--------|-----------|--------|
| SQLite PRAGMA оптимизация | 1 час | 2-5x на запись |
| Индексы на messages(chatId, createdAt) | 30 мин | 10-100x на чтение истории |
| Денормализация lastMessage в chats | 2 часа | Убирает N+1 в loadChats |
| Однократная сериализация в broadcastToChat | 30 мин | -50% CPU на broadcast |
| Cork batching для WS | 30 мин | Меньше syscalls |
| Ограничение WS соединений на юзера | 30 мин | Предотвращает утечку |
| LRU cache для hot queries | 2 часа | 10x на повторные запросы |

**Итого: 1 день работы, 5-20x улучшение производительности.**

### Фаза 1: Надёжная доставка (100-1000 юзеров)

| Задача | Сложность | Эффект |
|--------|-----------|--------|
| ACK протокол для сообщений | 4 часа | Гарантированная доставка |
| Pending messages queue | 4 часа | Офлайн-доставка |
| Delta sync endpoint | 4 часа | Быстрый старт приложения |
| Оптимистичные обновления на клиенте | 3 часа | Мгновенный UI |
| MessageBus абстракция | 2 часа | Готовность к горизонтальному масштабированию |

**Итого: 2-3 дня.**

### Фаза 2: Горизонтальное масштабирование (1K-100K юзеров)

| Задача | Сложность | Эффект |
|--------|-----------|--------|
| Миграция на PostgreSQL | 2 дня | Concurrent writes, партиции |
| Redis как session store + L2 cache | 1 день | Shared state между нодами |
| Redis Pub/Sub для WS cross-node | 1 день | Несколько WS серверов |
| Виртуализация списка сообщений | 4 часа | Плавный UI при 10K+ сообщений |
| MessagePack протокол | 1 день | -50% трафика |
| Meilisearch для полнотекстового поиска | 1 день | Нормальный поиск |

**Итого: 1 неделя.**

### Фаза 3: Массовый масштаб (100K-1M+ юзеров)

| Задача | Сложность | Эффект |
|--------|-----------|--------|
| NATS JetStream вместо Redis Pub/Sub | 3 дня | At-least-once delivery |
| Citus для шардирования PostgreSQL | 3 дня | Горизонтальное масштабирование БД |
| S3 + CDN для медиа | 2 дня | Масштабируемое хранение файлов |
| Fan-out on read для каналов >1000 | 3 дня | Поддержка больших каналов |
| Binary protocol (Protobuf) | 3 дня | Максимальная компактность |
| Per-conversation encryption keys | 1 неделя | Безопасность при компрометации |

---

## 8. Принципы (как Telegram)

1. **Минимум зависимостей.** SQLite → PostgreSQL — это ОДНА замена, не 10. Каждая зависимость — потенциальная точка отказа.

2. **Протокол важнее реализации.** Если протокол клиент-сервер спроектирован правильно (версионирование, ACK, sync), бэкенд можно переписать на чём угодно.

3. **Данные важнее кода.** Схема БД и формат шифрования — это контракт на годы. Код можно переписать за неделю, миграция данных — за месяц.

4. **Сначала работает, потом быстро.** SQLite с правильными индексами и прагмами — это 50K msg/sec на записи. Для 10 юзеров этого хватит на 10 лет.

5. **Шифрование — не опция.** AES-256-GCM at-rest правильное. Но единый ключ — проблема. Roadmap к per-conversation keys.
