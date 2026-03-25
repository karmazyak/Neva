import { Database } from 'bun:sqlite'
import { existsSync } from 'fs'

const dbPath = process.env.DATABASE_URL || './data/mlsendger.db'
if (!existsSync(dbPath)) {
  console.error('Database not found. Run migrate.ts first.')
  process.exit(1)
}

const db = new Database(dbPath)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = OFF') // Temp disable for cleanup

// ========== CLEANUP ==========
console.log('Cleaning up existing agents, configs, aliases, channels...')
db.exec('DELETE FROM agent_command_aliases')
db.exec('DELETE FROM agent_configs')
db.exec('DELETE FROM agent_schedules')
db.exec('DELETE FROM triggers')
db.exec('DELETE FROM agents')

// Clean up demo channels and their messages/members
const demoChannels = db.prepare("SELECT id FROM chats WHERE type = 'channel'").all() as { id: string }[]
for (const ch of demoChannels) {
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(ch.id)
  db.prepare('DELETE FROM chat_members WHERE chat_id = ?').run(ch.id)
}
db.exec("DELETE FROM chats WHERE type = 'channel'")

// Delete Arseny Kirsanov and all related data
const arseny = db.prepare("SELECT id FROM users WHERE username = 'arseny' OR display_name LIKE '%Arseny%' OR display_name LIKE '%Арсений%'").get() as { id: string } | undefined
if (arseny) {
  console.log('Removing Arseny Kirsanov...')
  const arsenyChats = db.prepare("SELECT chat_id FROM chat_members WHERE user_id = ?").all(arseny.id) as { chat_id: string }[]
  for (const ch of arsenyChats) {
    db.prepare('DELETE FROM messages WHERE chat_id = ?').run(ch.chat_id)
    db.prepare('DELETE FROM chat_members WHERE chat_id = ?').run(ch.chat_id)
    db.prepare('DELETE FROM chats WHERE id = ?').run(ch.chat_id)
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(arseny.id)
}

// Clean up Alex's private chats for fresh demo conversation
const alexPrivateChats = db.prepare(`
  SELECT c.id FROM chats c
  JOIN chat_members cm ON c.id = cm.chat_id
  WHERE c.type = 'private' AND cm.user_id IN (
    SELECT id FROM users WHERE username = 'alex'
  )
`).all() as { id: string }[]
for (const ch of alexPrivateChats) {
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(ch.id)
  db.prepare('DELETE FROM chat_members WHERE chat_id = ?').run(ch.id)
  db.prepare('DELETE FROM chats WHERE id = ?').run(ch.id)
}

// Clean up group chats
const groupChats = db.prepare("SELECT id FROM chats WHERE type = 'group'").all() as { id: string }[]
for (const ch of groupChats) {
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(ch.id)
  db.prepare('DELETE FROM chat_members WHERE chat_id = ?').run(ch.id)
}
db.exec("DELETE FROM chats WHERE type = 'group'")

// ========== FIND USERS ==========
const ivan = db.prepare('SELECT id FROM users WHERE username = ?').get('ivan') as { id: string } | undefined
const alex = db.prepare('SELECT id FROM users WHERE username = ?').get('alex') as { id: string } | undefined

if (!ivan) {
  console.error('User "ivan" not found. Create test accounts first.')
  process.exit(1)
}
if (!alex) {
  console.error('User "alex" not found. Create test accounts first.')
  process.exit(1)
}

const ivanId = ivan.id
const alexId = alex.id

// ========== CREATE AGENTS ==========
console.log('Creating demo agents...')

const agentIds = {
  scribe: crypto.randomUUID(),
  replyAssistant: crypto.randomUUID(),
  dialogSummary: crypto.randomUUID(),
  newsRadar: crypto.randomUUID(),
  imageBot: crypto.randomUUID(),
}

const insertAgent = db.prepare(`
  INSERT INTO agents (id, owner_id, name, description, avatar, system_prompt, model, tools, modes, temperature, max_tokens, is_public, rating, downloads, featured, category, skill_settings, created_at)
  VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
`)

insertAgent.run(
  agentIds.scribe, ivanId, 'Scribe',
  'Автоматически транскрибирует голосовые сообщения',
  'Ты — сервис транскрипции. Точно и аккуратно преобразуй аудио в текст.',
  'openai/gpt-4o-mini',
  JSON.stringify(['stt']),
  JSON.stringify(['command']),
  0.3, 2048, 0, 0, 0, 0, 'Assistant',
  JSON.stringify({ stt: { language: 'auto' } })
)

insertAgent.run(
  agentIds.replyAssistant, ivanId, 'Reply Assistant',
  'Предлагает варианты ответов на сообщения',
  'Ты — ассистент для чата. Когда пользователь вызывает /reply, предложи 3 коротких варианта ответа на последнее сообщение собеседника. Варианты должны быть разными по тону: дружелюбный, деловой, краткий. Отвечай на языке диалога. Разделяй варианты через ---',
  'openai/gpt-4o',
  JSON.stringify(['text_reply']),
  JSON.stringify(['command', 'auto']),
  0.7, 2048, 0, 0, 0, 0, 'Assistant',
  JSON.stringify({ text_reply: { variants: 3 } })
)

insertAgent.run(
  agentIds.dialogSummary, alexId, 'Dialog Summary',
  'Суммаризирует диалоги и выделяет главное',
  'Ты — аналитик диалогов. Выдели ключевые темы, решения, action items. Отвечай на языке диалога. Будь кратким.',
  'openai/gpt-4o-mini',
  JSON.stringify(['summarize']),
  JSON.stringify(['command']),
  0.3, 2048, 1, 4.5, 12, 1, 'Assistant',
  JSON.stringify({ summarize: { maxMessages: 50 } })
)

insertAgent.run(
  agentIds.newsRadar, ivanId, 'News Radar',
  'Мониторит каналы и присылает дайджест важных новостей',
  'Ты — новостной аналитик. Получаешь сообщения из каналов. Твоя задача: выбрать 3-5 самых важных/интересных новостей, кратко пересказать каждую (2-3 предложения), добавить emoji по теме. Формат:\n\n📰 Дайджест каналов\n\n🔹 Заголовок — краткое описание\n\n В конце: общий вывод в 1 предложение.',
  'openai/gpt-4o',
  JSON.stringify(['summarize']),
  JSON.stringify(['background']),
  0.7, 4096, 0, 0, 0, 0, 'Assistant',
  JSON.stringify({ summarize: { maxMessages: 50 } })
)

// Image Bot — generates images from text prompts
insertAgent.run(
  agentIds.imageBot, ivanId, 'Artisan',
  'Генерирует изображения по текстовому описанию',
  'Generate images from text descriptions. Create vivid, detailed images based on the user prompt.',
  'openai/gpt-4o',
  JSON.stringify(['image_generate']),
  JSON.stringify(['command']),
  0.7, 2048, 0, 0, 0, 0, 'Creative',
  JSON.stringify({})
)

console.log('Ivan: 4 agents, Alex: 1 public agent (Dialog Summary)')

// ========== CREATE DEFAULT PIPELINES ==========
console.log('Creating default pipelines...')

const insertTrigger = db.prepare(`
  INSERT INTO triggers (id, user_id, name, event, condition, action, output_mode, enabled, chat_id, method, is_default, agent_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, unixepoch())
`)

// Scribe: on_audio → pass_content → /transcribe → ghost (enabled)
insertTrigger.run(
  crypto.randomUUID(), ivanId, 'Auto-transcribe audio',
  'on_audio', JSON.stringify({}),
  JSON.stringify({ type: 'stt', skillCommand: '/transcribe' }),
  'ghost', 1, 'pass_content', agentIds.scribe
)

// Reply Assistant: on_message → last_n_messages → /reply → ghost (disabled)
insertTrigger.run(
  crypto.randomUUID(), ivanId, 'Smart reply suggestions',
  'on_message', JSON.stringify({}),
  JSON.stringify({ type: 'skill', skillCommand: '/reply' }),
  'ghost', 0, 'last_n_messages', agentIds.replyAssistant
)

// News Radar: on_schedule → collect_from_channels → /summarize → normal (enabled)
// Note: sourceChats will be set after channels are created below

console.log('Default pipelines created for Scribe and Reply Assistant')

// ========== CREATE DEMO CHANNELS ==========
console.log('Creating demo channels...')

const channelIds = {
  techNews: crypto.randomUUID(),
  startupDigest: crypto.randomUUID(),
}

const insertChat = db.prepare('INSERT INTO chats (id, type, name, description, created_at) VALUES (?, ?, ?, ?, unixepoch())')
insertChat.run(channelIds.techNews, 'channel', 'Tech & AI News', 'Последние новости технологий и искусственного интеллекта')
insertChat.run(channelIds.startupDigest, 'channel', 'Startup Digest', 'Новости стартапов, фандрейзинг, запуски продуктов')

const insertMember = db.prepare('INSERT INTO chat_members (id, chat_id, user_id, role, joined_at) VALUES (?, ?, ?, ?, unixepoch())')
// ivan = admin of both channels
insertMember.run(crypto.randomUUID(), channelIds.techNews, ivanId, 'admin')
insertMember.run(crypto.randomUUID(), channelIds.startupDigest, ivanId, 'admin')
// alex = viewer of both
insertMember.run(crypto.randomUUID(), channelIds.techNews, alexId, 'viewer')
insertMember.run(crypto.randomUUID(), channelIds.startupDigest, alexId, 'viewer')

// News Radar default pipeline (needs channel IDs)
db.prepare(`
  INSERT INTO triggers (id, user_id, name, event, condition, action, output_mode, enabled, chat_id, method, is_default, agent_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, unixepoch())
`).run(
  crypto.randomUUID(), ivanId, 'Daily news digest',
  'on_schedule',
  JSON.stringify({ cronExpression: '0 8 * * *', sourceChats: [channelIds.techNews, channelIds.startupDigest] }),
  JSON.stringify({ type: 'skill', skillCommand: '/summarize' }),
  'normal', 1, 'collect_from_channels', agentIds.newsRadar
)

console.log('News Radar pipeline created with channel sources')

// ========== CREATE CHANNEL POSTS ==========
console.log('Seeding channel posts...')

const now = Math.floor(Date.now() / 1000)
const hour = 3600
const insertMessage = db.prepare(
  'INSERT INTO messages (id, chat_id, sender_id, content, type, status, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
)

// Tech & AI News — 6 detailed posts
const techPosts = [
  { offset: -24 * hour, text: `🟢 NVIDIA Blackwell Ultra — новый GPU для AI-инференса

NVIDIA представила Blackwell Ultra — процессор нового поколения с 1.4 трлн транзисторов. Ключевые характеристики: производительность на инференсе в 2x выше предшественника B200, поддержка FP4-вычислений, 288 ГБ HBM3e памяти с пропускной способностью 12 ТБ/с.

Jensen Huang заявил, что один сервер на Blackwell Ultra заменит 30 серверов на A100 для задач LLM-инференса. Энергоэффективность улучшена на 40%.

Первые поставки OEM-партнёрам начнутся в Q3 2026. Цена одного чипа оценивается в $40-50K. AWS, Azure и GCP уже зарезервировали крупные партии.` },

  { offset: -20 * hour, text: `🔵 Anthropic привлекла $2B при оценке $61B

Anthropic закрыла очередной раунд финансирования на $2 млрд. Среди инвесторов — Lightspeed Venture Partners, Spark Capital и Salesforce Ventures. Оценка компании выросла с $18B до $61B за последний год.

Средства пойдут на масштабирование инфраструктуры Claude (в 3 раза больше GPU-кластеров к концу года), разработку собственных AI-чипов совместно с Amazon, и расширение команды safety research до 200+ человек.

CEO Dario Amodei заявил, что Claude обрабатывает уже 500M+ запросов в день, а выручка компании достигла $2B ARR.` },

  { offset: -16 * hour, text: `🍎 Apple интегрирует собственную LLM в iOS 19

По данным Bloomberg, Apple планирует встроить compact LLM (3 ГБ) напрямую в iOS 19 и macOS 16. Модель будет работать полностью на устройстве через Neural Engine, без отправки данных в облако.

Основные сценарии: офлайн-Siri с пониманием контекста экрана, умные ответы в iMessage, суммаризация писем и документов, генерация текста в Notes. Apple подчёркивает полную приватность — все вычисления локальные.

Разработчики получат доступ через новый API — CoreIntelligence Framework. Презентация ожидается на WWDC в июне.` },

  { offset: -12 * hour, text: `🔴 Meta выпустила Llama 4 Scout — open-source модель с 10M контекстом

Meta AI опубликовала Llama 4 Scout — модель на архитектуре Mixture-of-Experts с 109B параметрами (17B активных). Главная фишка — контекстное окно в 10 миллионов токенов, что позволяет обрабатывать целые кодовые базы и книги за один запрос.

Бенчмарки: обходит GPT-4o на MMLU (89.3%), HumanEval (94.1%) и математических задачах. При этом стоимость инференса в 5x ниже за счёт MoE-архитектуры.

Модель полностью open-source (Apache 2.0), веса доступны на Hugging Face. Meta также выложила training recipe и датасеты для fine-tuning.` },

  { offset: -8 * hour, text: `⚖️ EU AI Act 2.0 — новые правила для AI-компаний в Европе

Европарламент утвердил расширенную версию AI Act. Ключевые изменения:

• Обязательная сертификация всех foundation models с >10B параметров
• Штрафы до 7% глобального оборота за нарушения (ранее 6%)
• Requirement на раскрытие training data для моделей, работающих в ЕС
• Запрет на использование AI для social scoring, emotion recognition в рабочих пространствах
• Новые правила для AI-агентов: обязательная маркировка автоматических действий

Компании получают 18 месяцев на compliance. OpenAI, Google и Anthropic уже создали европейские compliance-команды.` },

  { offset: -2 * hour, text: `🧪 Stanford: прорыв в синтетических данных для обучения LLM

Исследователи Stanford HAI опубликовали метод DPO-Synth, который решает проблему "model collapse" при обучении на синтетических данных.

Суть: вместо наивной генерации синтетического текста, метод использует DPO (Direct Preference Optimization) для фильтрации — модель-ученик сама ранжирует сгенерированные примеры, отбирая только те, что улучшают её способности.

Результат: модель 7B, обученная на 100% синтетических данных через DPO-Synth, показала +3.2% на MMLU по сравнению с обучением на реальных данных. Это первый случай, когда синтетические данные превзошли реальные без деградации.

Потенциал: снижение стоимости обучения LLM на 90%, решение проблемы нехватки качественных данных.` },
]

for (const post of techPosts) {
  insertMessage.run(
    crypto.randomUUID(),
    channelIds.techNews,
    ivanId,
    post.text,
    'text',
    'sent',
    'normal',
    now + post.offset
  )
}

// Startup Digest — 5 detailed posts
const startupPosts = [
  { offset: -22 * hour, text: `💰 Cursor привлёк $400M в Series B при оценке $9B

AI-редактор кода Cursor закрыл раунд Series B на $400M. Лид-инвестор — Thrive Capital, участвовали a16z и Stripe. Оценка компании выросла с $2.5B до $9B за 6 месяцев.

Метрики: 2M+ активных разработчиков ежедневно, $300M ARR (рост 15x за год). Средний чек $20/мес на пользователя. Retention 95% на 6 месяцев.

CEO Michael Truell заявил, что 40% разработчиков Fortune 500 уже используют Cursor. Средства пойдут на собственную модель для кода и расширение в enterprise-сегмент.` },

  { offset: -18 * hour, text: `🎨 Figma приобретает Diagram за $180M — AI-генерация UI

Figma объявила о покупке стартапа Diagram за $180M. Diagram разработал технологию генерации готовых UI-компонентов из текстового описания — "дизайн по промпту".

Технология будет интегрирована в Figma как "Figma AI Design". Пользователь описывает экран текстом ("форма регистрации с OAuth-кнопками и валидацией"), а система генерирует готовый дизайн с правильными отступами, типографикой и цветовой схемой проекта.

Beta-тест показал: время создания мокапов сокращается с 2 часов до 5 минут. Функция появится для всех пользователей Figma Professional и Enterprise в Q2 2026.` },

  { offset: -10 * hour, text: `📋 Linear привлёк $50M при оценке $1B — AI для управления проектами

Linear, инструмент для трекинга задач, привлёк $50M в раунде, возглавленном Accel. Оценка достигла $1B.

Ключевая фича нового релиза — AI Sprint Planner: система анализирует историю спринтов, скорость команды и зависимости между задачами, после чего автоматически формирует оптимальный план спринта. Также добавлена AI-приоритизация: задачи ранжируются по impact и urgency на основе контекста проекта.

Метрики: 15K+ команд, включая Vercel, Ramp, Cash App. Revenue $40M ARR. Основатели Karri Saarinen и Tuomas Artman (экс-Airbnb, Uber) планируют удвоить команду до 120 человек.` },

  { offset: -4 * hour, text: `🌊 Windsurf запускает AI-агента для full-cycle разработки

Стартап Windsurf (экс-Codeium) представил AI-агента, который берёт на себя полный цикл разработки: от бизнес-требований до деплоя в продакшен.

Как работает: PM описывает фичу в Jira/Linear → агент декомпозирует задачу → пишет код с тестами → создаёт PR → проходит CI/CD → деплоит в staging. Человек нужен только для code review и финального approve.

Enterprise beta показала: время delivery фичи сокращается с 5 дней до 8 часов. Агент корректно обрабатывает 73% задач без человеческих правок. Стоимость: $500/мес за команду до 10 разработчиков.` },

  { offset: -1 * hour, text: `▲ Vercel запускает v0 2.0 — full-stack приложения из промпта

Vercel анонсировал v0 2.0 — следующее поколение AI-генератора приложений. Теперь v0 создаёт не только UI, но и полный бэкенд: базу данных (Postgres через Neon), аутентификацию (NextAuth), API-роуты и Server Actions.

Пример: промпт "SaaS-dashboard для аналитики с графиками, таблицами и экспортом в CSV" генерирует рабочее приложение на Next.js 15 + Tailwind + Recharts + Drizzle ORM за 2 минуты.

v0 2.0 доступен для всех пользователей Vercel Pro ($20/мес). За первую неделю beta создано 500K+ приложений. Vercel также объявил v0 API для интеграции в CI/CD пайплайны.` },
]

for (const post of startupPosts) {
  insertMessage.run(
    crypto.randomUUID(),
    channelIds.startupDigest,
    ivanId,
    post.text,
    'text',
    'sent',
    'normal',
    now + post.offset
  )
}

// ========== CREATE DEMO CHAT WITH ALEX ==========
console.log('Creating demo conversation with Alex...')

const alexChatId = crypto.randomUUID()
insertChat.run(alexChatId, 'private', 'Alex', null)
insertMember.run(crypto.randomUUID(), alexChatId, ivanId, 'member')
insertMember.run(crypto.randomUUID(), alexChatId, alexId, 'member')

const alexConversation = [
  { offset: -6 * hour, sender: alexId, text: 'Привет! Ты видел что Cursor $400M поднял?' },
  { offset: -6 * hour + 120, sender: ivanId, text: 'Да, видел в канале. $9B оценка, это безумие' },
  { offset: -6 * hour + 240, sender: alexId, text: 'Ну они реально хороший продукт сделали. Я сам на них перешёл с VSCode' },
  { offset: -5 * hour, sender: ivanId, text: 'Я тоже. Tab-автокомплит просто магия' },
  { offset: -5 * hour + 180, sender: alexId, text: 'А ты что думаешь про Windsurf? Они заявляют что от требований до деплоя без человека' },
  { offset: -4 * hour, sender: ivanId, text: 'Пока рано говорить. 73% задач без правок — звучит красиво, но на реальных проектах будет сложнее' },
  { offset: -4 * hour + 120, sender: alexId, text: 'Согласен. Но тренд понятен — AI-агенты заменят junior разработчиков через 2-3 года' },
  { offset: -3 * hour, sender: ivanId, text: 'Не заменят, а изменят роль. Джуны будут больше ревьюить и тестить, чем писать с нуля' },
  { offset: -3 * hour + 300, sender: alexId, text: 'Кстати, ты видел что Apple свою LLM в iOS встраивает? 3 гига модель прям на телефоне' },
  { offset: -2 * hour, sender: ivanId, text: 'Да, офлайн Siri — это сильно. Privacy-first подход, без облака' },
  { offset: -2 * hour + 60, sender: alexId, text: 'Neural Engine на M-чипах для этого и делался. Наконец-то используют его по полной' },
  { offset: -1 * hour, sender: ivanId, text: 'Как думаешь, стоит нам AI-фичи в наш проект добавлять?' },
  { offset: -50 * 60, sender: alexId, text: 'Однозначно. Можно начать с суммаризации чатов и умных ответов. Простые вещи но полезные' },
  { offset: -40 * 60, sender: ivanId, text: 'Я уже прототип сделал с OpenRouter. /reply генерирует варианты ответов, /summarize делает сводку' },
  { offset: -30 * 60, sender: alexId, text: 'Круто! А по каналам новости можно собирать? Типа дайджест утром' },
  { offset: -20 * 60, sender: ivanId, text: 'Да, News Radar бот уже умеет. Собирает из каналов и делает структурированный дайджест' },
  { offset: -10 * 60, sender: alexId, text: 'Покажешь как работает? Хочу себе такое настроить' },
]

for (const msg of alexConversation) {
  insertMessage.run(
    crypto.randomUUID(),
    alexChatId,
    msg.sender,
    msg.text,
    'text',
    'sent',
    'normal',
    now + msg.offset
  )
}

// ========== CREATE NEWS RADAR BOT CHAT ==========
console.log('Creating News Radar bot chat...')

const newsRadarChatId = crypto.randomUUID()
insertChat.run(newsRadarChatId, 'private', 'News Radar', null)
insertMember.run(crypto.randomUUID(), newsRadarChatId, ivanId, 'admin')

// Add a welcome message from the "bot"
insertMessage.run(
  crypto.randomUUID(),
  newsRadarChatId,
  ivanId,
  '🤖 News Radar подключён!\n\nЯ буду собирать новости из каналов Tech & AI News и Startup Digest и присылать тебе дайджест.\n\nРасписание: ежедневно в 08:00\nКаналы: Tech & AI News, Startup Digest\n\nЧтобы получить дайджест прямо сейчас — зайди в My Robots → News Radar → Schedule → Run Now',
  'text',
  'sent',
  'normal',
  now - 24 * hour
)

// ========== CREATE SCHEDULE FOR NEWS RADAR ==========
console.log('Creating schedule for News Radar...')

db.prepare(`
  INSERT INTO agent_schedules (id, agent_id, user_id, cron_expression, task_type, config, enabled, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 1, unixepoch())
`).run(
  crypto.randomUUID(),
  agentIds.newsRadar,
  ivanId,
  '0 8 * * *',
  'digest',
  JSON.stringify({
    sourceChats: [channelIds.techNews, channelIds.startupDigest],
    targetChatId: newsRadarChatId,
    maxMessages: 50,
  })
)

// ========== CREATE GROUP CHAT ==========
console.log('Creating Team Chat...')
const teamChatId = crypto.randomUUID()
db.prepare('INSERT INTO chats (id, type, name, description, created_at) VALUES (?, ?, ?, ?, unixepoch())').run(
  teamChatId, 'group', 'Team Chat', 'Рабочий чат команды'
)
insertMember.run(crypto.randomUUID(), teamChatId, ivanId, 'admin')
insertMember.run(crypto.randomUUID(), teamChatId, alexId, 'member')

db.exec('PRAGMA foreign_keys = ON')
db.close()

console.log('')
console.log('=== Seed complete! ===')
console.log(`Ivan: 4 agents (Scribe, Reply Assistant, News Radar, Artisan)`)
console.log(`Alex: 1 public agent (Dialog Summary) — featured, 4.5 rating, 12 downloads`)
console.log(`Channels: Tech & AI News (${techPosts.length} posts), Startup Digest (${startupPosts.length} posts)`)
console.log(`Chats: Alex (${alexConversation.length} messages), News Radar bot, Team Chat`)
console.log(`Schedule: News Radar daily at 08:00 → delivers to News Radar chat`)
console.log('')
console.log('Login: ivan / 123456')
