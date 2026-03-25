/**
 * Seed realistic Russian messenger conversations for style testing.
 * 5 distinct characters with authentic texting patterns.
 * Run after seed-demo.ts: bun run server/db/seed-realistic-chats.ts
 */
import { Database } from 'bun:sqlite'
import { existsSync } from 'fs'

const dbPath = process.env.DATABASE_URL || './data/mlsendger.db'
if (!existsSync(dbPath)) {
  console.error('Database not found. Run migrate.ts first.')
  process.exit(1)
}

const db = new Database(dbPath)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = OFF')

// Find ivan (our main user)
const ivan = db.prepare('SELECT id FROM users WHERE username = ?').get('ivan') as { id: string } | undefined
if (!ivan) { console.error('User "ivan" not found.'); process.exit(1) }
const ivanId = ivan.id

const now = Math.floor(Date.now() / 1000)
const min = 60
const hour = 3600
const day = 86400

// ========== CREATE REALISTIC USERS ==========
console.log('Creating realistic users...')

const users = [
  { id: 'u-lesha', username: 'lesha_k', displayName: 'Лёха', email: 'lesha@test.dev', bio: 'фронтенд, react, пивко' },
  { id: 'u-masha', username: 'mashunya', displayName: 'Маша ❤️', email: 'masha@test.dev', bio: null },
  { id: 'u-boss', username: 'a.petrov', displayName: 'Андрей Петров', email: 'petrov@company.ru', bio: 'CTO' },
  { id: 'u-mama', username: 'irina_m', displayName: 'Мама', email: 'mama@test.dev', bio: null },
  { id: 'u-kolya', username: 'kolyan228', displayName: 'Коля', email: 'kolya@test.dev', bio: 'сарказм — мой второй язык' },
]

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (id, username, display_name, email, password_hash, avatar, bio, online, created_at)
  VALUES (?, ?, ?, ?, '$2b$10$placeholder', NULL, ?, 1, unixepoch())
`)

for (const u of users) {
  insertUser.run(u.id, u.username, u.displayName, u.email, u.bio)
}

// ========== CREATE CHATS ==========
console.log('Creating realistic chats...')

const chatIds = {
  lesha: 'chat-lesha-real',
  masha: 'chat-masha-real',
  boss: 'chat-boss-real',
  mama: 'chat-mama-real',
  kolya: 'chat-kolya-real',
}

const insertChat = db.prepare('INSERT OR IGNORE INTO chats (id, type, name, created_at) VALUES (?, ?, ?, unixepoch())')
const insertMember = db.prepare('INSERT OR IGNORE INTO chat_members (id, chat_id, user_id, role, joined_at) VALUES (?, ?, ?, ?, unixepoch())')

for (const [key, chatId] of Object.entries(chatIds)) {
  const userId = `u-${key}`
  const user = users.find(u => u.id === userId)
  insertChat.run(chatId, 'private', user?.displayName || key)
  insertMember.run(crypto.randomUUID(), chatId, ivanId, 'member')
  insertMember.run(crypto.randomUUID(), chatId, userId, 'member')
}

// ========== SEED MESSAGES ==========
const insertMsg = db.prepare(
  'INSERT INTO messages (id, chat_id, sender_id, content, type, status, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
)

function seed(chatId: string, messages: Array<{ s: string; t: string; offset: number }>) {
  for (const msg of messages) {
    insertMsg.run(crypto.randomUUID(), chatId, msg.s, msg.t, 'text', 'sent', 'normal', now + msg.offset)
  }
}

const I = ivanId // shorthand

// ==========================================
// 1. ЛЁХА — лучший друг, casual, сленг
// Фронтендер, любит пиво, играет в доту,
// пишет строчными, без точек, с опечатками
// ==========================================
console.log('Seeding Лёха (casual friend)...')

seed(chatIds.lesha, [
  { s: 'u-lesha', t: 'ееее бро', offset: -3 * day },
  { s: 'u-lesha', t: 'го вечером в бар? сегодня пятницааа', offset: -3 * day + 5 },
  { s: I, t: 'го, а кто будет', offset: -3 * day + 2 * min },
  { s: 'u-lesha', t: 'димон саня и вроде макс подтянется', offset: -3 * day + 3 * min },
  { s: 'u-lesha', t: 'в крафтовую на малой бронной', offset: -3 * day + 3 * min + 10 },
  { s: I, t: 'ааа ту что открылась недавно?', offset: -3 * day + 5 * min },
  { s: 'u-lesha', t: 'да да, там ipa огонь реально', offset: -3 * day + 6 * min },
  { s: I, t: 'в 8 норм?', offset: -3 * day + 8 * min },
  { s: 'u-lesha', t: 'збс', offset: -3 * day + 8 * min + 30 },

  { s: 'u-lesha', t: 'слуш ты в реакте 19 разобрался уже?', offset: -2 * day },
  { s: I, t: 'ну частично, серверные компоненты прикольные', offset: -2 * day + 4 * min },
  { s: 'u-lesha', t: 'я вчера пол дня дебажил useFormState', offset: -2 * day + 5 * min },
  { s: 'u-lesha', t: 'оказалось я просто забыл action передать ахахах', offset: -2 * day + 5 * min + 15 },
  { s: I, t: 'класика', offset: -2 * day + 7 * min },
  { s: 'u-lesha', t: 'кст ты видел курсор 400 лямов поднял?', offset: -2 * day + 10 * min },
  { s: I, t: 'видел, 9 ярдов оценка, безумие', offset: -2 * day + 12 * min },
  { s: 'u-lesha', t: 'я щас без курсора как без рук', offset: -2 * day + 13 * min },
  { s: 'u-lesha', t: 'таб комплит экономит часа 2 в день минимум', offset: -2 * day + 13 * min + 20 },

  { s: 'u-lesha', t: 'бляяя у нас на проде упало', offset: -1 * day },
  { s: I, t: 'чё случилось', offset: -1 * day + 1 * min },
  { s: 'u-lesha', t: 'ООМ на ноде, кто-то утечку памяти запустил в прод', offset: -1 * day + 2 * min },
  { s: 'u-lesha', t: 'уже час дебажу не могу найти', offset: -1 * day + 2 * min + 20 },
  { s: I, t: 'попробуй --inspect и heap snapshot сделать', offset: -1 * day + 4 * min },
  { s: 'u-lesha', t: 'о точняк спс', offset: -1 * day + 5 * min },
  { s: 'u-lesha', t: 'нашёл!! event listener не снимался при анмаунте', offset: -1 * day + 45 * min },
  { s: I, t: 'классика реакта номер 2 😅', offset: -1 * day + 47 * min },
  { s: 'u-lesha', t: 'ахахах да', offset: -1 * day + 48 * min },
  { s: 'u-lesha', t: 'лан спасибо бро выручил', offset: -1 * day + 48 * min + 10 },

  { s: 'u-lesha', t: 'ты в доту сегодня?', offset: -4 * hour },
  { s: I, t: 'не могу, работы дофига', offset: -4 * hour + 3 * min },
  { s: 'u-lesha', t: 'эх ладн', offset: -4 * hour + 4 * min },
  { s: 'u-lesha', t: 'а завтра? у нас стак собирается', offset: -4 * hour + 4 * min + 15 },
  { s: I, t: 'завтра попробую, ближе к вечеру напишу', offset: -4 * hour + 6 * min },
  { s: 'u-lesha', t: 'давай жду 👊', offset: -4 * hour + 7 * min },
])

// ==========================================
// 2. МАША — девушка, тёплая, эмодзи, голосовые
// Любит котиков, кофейни, пишет с эмодзи,
// иногда длинные сообщения, переживает за всё
// ==========================================
console.log('Seeding Маша (girlfriend)...')

seed(chatIds.masha, [
  { s: 'u-masha', t: 'доброе утро солнышко ☀️', offset: -3 * day },
  { s: I, t: 'доброе 😊 как спала?', offset: -3 * day + 10 * min },
  { s: 'u-masha', t: 'ну такое, котик всю ночь на подушке спал и мне места не оставил 😂', offset: -3 * day + 12 * min },
  { s: 'u-masha', t: 'зато он милый посмотри', offset: -3 * day + 12 * min + 10 },
  { s: I, t: 'ахах красавчик', offset: -3 * day + 15 * min },
  { s: 'u-masha', t: 'ты во сколько освободишься сегодня? хочу в ту кофейню на патриках сходить, там новый матча латте появился 🍵', offset: -3 * day + 20 * min },
  { s: I, t: 'часов в 7 думаю', offset: -3 * day + 25 * min },
  { s: 'u-masha', t: 'урааа ❤️ я тогда столик забронирую', offset: -3 * day + 26 * min },

  { s: 'u-masha', t: 'слушай а тебе нравится моя новая стрижка? а то я чёт сомневаюсь 🥺', offset: -2 * day },
  { s: I, t: 'мне очень нравится, серьёзно', offset: -2 * day + 3 * min },
  { s: 'u-masha', t: 'точно?? не просто так говоришь?', offset: -2 * day + 4 * min },
  { s: I, t: 'точно точно 😊', offset: -2 * day + 5 * min },
  { s: 'u-masha', t: 'ой ну ладно верю тебе 💕', offset: -2 * day + 6 * min },
  { s: 'u-masha', t: 'кстати посмотри какой закат сейчас', offset: -2 * day + 3 * hour },
  { s: 'u-masha', t: 'я прям стою на балконе и не могу оторваться', offset: -2 * day + 3 * hour + 30 },
  { s: I, t: 'красота 😍', offset: -2 * day + 3 * hour + 5 * min },
  { s: 'u-masha', t: 'жалко что тебя рядом нет', offset: -2 * day + 3 * hour + 6 * min },

  { s: 'u-masha', t: 'ты сегодня обедал вообще?? 😤', offset: -1 * day },
  { s: I, t: 'э ну... нет пока', offset: -1 * day + 5 * min },
  { s: 'u-masha', t: 'вань ну вот как так, уже 3 часа', offset: -1 * day + 6 * min },
  { s: 'u-masha', t: 'я тебе судочки собрала кстати, в холодильнике стоят', offset: -1 * day + 6 * min + 15 },
  { s: I, t: 'спасибо зай ❤️ пойду разогрею', offset: -1 * day + 8 * min },
  { s: 'u-masha', t: 'вот и умничка 😌', offset: -1 * day + 9 * min },

  { s: 'u-masha', t: 'ааа тут в магазине скидки на ту куртку которую я хотела 😱😱😱', offset: -6 * hour },
  { s: 'u-masha', t: '40 процентов!!!', offset: -6 * hour + 15 },
  { s: I, t: 'бери конечно', offset: -6 * hour + 2 * min },
  { s: 'u-masha', t: 'а не дорого? там всё равно 12 тысяч получается', offset: -6 * hour + 3 * min },
  { s: I, t: 'ну 12 норм же, ты давно её хотела', offset: -6 * hour + 4 * min },
  { s: 'u-masha', t: 'ладно уговорил 🥰 спасибо что поддержал ахаха', offset: -6 * hour + 5 * min },
  { s: 'u-masha', t: 'люблю тебя 💗', offset: -6 * hour + 5 * min + 10 },
  { s: I, t: 'и я тебя ❤️', offset: -6 * hour + 6 * min },
])

// ==========================================
// 3. АНДРЕЙ ПЕТРОВ — босс/CTO, полуформал
// Пишет грамотно но не супер формально,
// конкретный, по делу, иногда шутит
// ==========================================
console.log('Seeding Андрей Петров (boss)...')

seed(chatIds.boss, [
  { s: 'u-boss', t: 'Привет. Посмотрел твой PR — в целом ок, но есть пара моментов', offset: -3 * day },
  { s: I, t: 'Привет! Какие именно?', offset: -3 * day + 5 * min },
  { s: 'u-boss', t: 'В auth middleware ты хардкодишь secret. Надо через env переменную', offset: -3 * day + 7 * min },
  { s: 'u-boss', t: 'И ещё — rate limiter стоит только на /api/auth, а на /api/messages нет. Это потенциальный DDoS вектор', offset: -3 * day + 8 * min },
  { s: I, t: 'Точно, поправлю оба момента', offset: -3 * day + 10 * min },
  { s: 'u-boss', t: 'Окей. До конца дня успеешь?', offset: -3 * day + 11 * min },
  { s: I, t: 'Да, часа через 2 будет готово', offset: -3 * day + 12 * min },
  { s: 'u-boss', t: '👍', offset: -3 * day + 12 * min + 30 },

  { s: 'u-boss', t: 'Кстати, завтра созвон с инвестором в 14:00. Нужна демка мессенджера — 15 минут показать основной флоу', offset: -2 * day },
  { s: I, t: 'Понял. Покажу чаты + AI ассистент + автоответы. Этого хватит?', offset: -2 * day + 8 * min },
  { s: 'u-boss', t: 'Да, но добавь ещё пайплайны — это наша фишка', offset: -2 * day + 10 * min },
  { s: 'u-boss', t: 'Инвестор из Сколково, ему важна AI-часть', offset: -2 * day + 10 * min + 30 },
  { s: I, t: 'Ок, сделаю. Подготовлю красивый сценарий', offset: -2 * day + 15 * min },
  { s: 'u-boss', t: 'Супер. И ещё — подготовь метрики: MAU, retention, среднее время ответа. Даже если пока маленькие, покажем тренд', offset: -2 * day + 18 * min },

  { s: 'u-boss', t: 'Демка прошла хорошо. Инвестор заинтересован, просит техническую документацию', offset: -1 * day },
  { s: I, t: 'Отлично! Что именно хочет видеть?', offset: -1 * day + 3 * min },
  { s: 'u-boss', t: 'Архитектуру, стек, план масштабирования. Не надо 100 страниц — достаточно 5-7 страниц с диаграммами', offset: -1 * day + 5 * min },
  { s: I, t: 'Сделаю к среде', offset: -1 * day + 7 * min },
  { s: 'u-boss', t: 'Ко вторнику лучше) он в среду утром улетает', offset: -1 * day + 8 * min },
  { s: I, t: 'Ладно, ко вторнику', offset: -1 * day + 9 * min },
  { s: 'u-boss', t: 'Не перегружайся, главное — суть. Лучше 5 чётких страниц чем 20 размытых', offset: -1 * day + 10 * min },

  { s: 'u-boss', t: 'Ты видел что Linear $50M поднял? Мы в правильном направлении движемся', offset: -5 * hour },
  { s: I, t: 'Да, видел. AI Sprint Planner — крутая идея кстати', offset: -5 * hour + 5 * min },
  { s: 'u-boss', t: 'Нам бы тоже что-то подобное. Но сначала базу доделаем', offset: -5 * hour + 7 * min },
  { s: 'u-boss', t: 'Одно за другим. Фокус 💪', offset: -5 * hour + 7 * min + 20 },
])

// ==========================================
// 4. МАМА — формальная, заботливая, полные предложения
// Пишет как взрослый человек в мессенджере:
// с заглавными, знаками, длинными предложениями
// ==========================================
console.log('Seeding Мама (parent)...')

seed(chatIds.mama, [
  { s: 'u-mama', t: 'Ванечка, привет! Как у тебя дела?', offset: -4 * day },
  { s: I, t: 'привет мам! всё хорошо, работаю', offset: -4 * day + 30 * min },
  { s: 'u-mama', t: 'Ты не забыл что в субботу папин день рождения? Мы ждём вас с Машей к 15:00.', offset: -4 * day + 35 * min },
  { s: I, t: 'конечно помню, приедем!', offset: -4 * day + 40 * min },
  { s: 'u-mama', t: 'Очень хорошо! Я буду готовить твои любимые голубцы и шарлотку.', offset: -4 * day + 42 * min },
  { s: 'u-mama', t: 'Может вам что-нибудь привезти? Папа вчера с дачи вернулся, огурцов целый ящик!', offset: -4 * day + 43 * min },
  { s: I, t: 'ооо огурцы давай, маша обрадуется', offset: -4 * day + 50 * min },

  { s: 'u-mama', t: 'Сынок, ты нормально питаешься? Я по телевизору видела, что программисты часто едят одни бутерброды и лапшу.', offset: -2 * day },
  { s: I, t: 'мам ну я же не студент уже 😄 нормально питаюсь', offset: -2 * day + 20 * min },
  { s: 'u-mama', t: 'Ну я всё равно переживаю. Ты же мой ребёнок, хоть тебе уже 28 лет.', offset: -2 * day + 25 * min },
  { s: 'u-mama', t: 'Кстати, тётя Лена звонила, спрашивала про тебя. Говорит, у неё дочка тоже программист стала. Может познакомить вас?', offset: -2 * day + 27 * min },
  { s: I, t: 'мам, у меня маша есть 😅', offset: -2 * day + 30 * min },
  { s: 'u-mama', t: 'Ой, я в смысле по работе! Вдруг ей нужен совет или вакансия.', offset: -2 * day + 32 * min },
  { s: I, t: 'а, ну пусть напишет, помогу', offset: -2 * day + 35 * min },

  { s: 'u-mama', t: 'Ваня, папа просит тебя помочь ему с телефоном. Он опять что-то нажал и теперь не может найти фотографии.', offset: -1 * day },
  { s: I, t: 'опять? 😅 ладно, позвоню ему вечером', offset: -1 * day + 15 * min },
  { s: 'u-mama', t: 'Лучше приезжай в выходные, по телефону он ничего не понимает. Ты же знаешь папу.', offset: -1 * day + 18 * min },
  { s: I, t: 'хорошо, в воскресенье заеду', offset: -1 * day + 25 * min },
  { s: 'u-mama', t: 'Отлично! Я тогда пирогов напеку. Каких хочешь, с мясом или с капустой?', offset: -1 * day + 27 * min },
  { s: I, t: 'с мясом!! 🤤', offset: -1 * day + 30 * min },
  { s: 'u-mama', t: 'Договорились! Только не опаздывай, как в прошлый раз. Целую! 💋', offset: -1 * day + 32 * min },

  { s: 'u-mama', t: 'Сынок, я тебе переслала рецепт борща. Посмотри, когда будет время. Это бабушкин, самый вкусный.', offset: -3 * hour },
  { s: I, t: 'спс мам, посмотрю обязательно', offset: -3 * hour + 10 * min },
  { s: 'u-mama', t: 'И не забудь надеть шапку, на улице -5!', offset: -3 * hour + 12 * min },
  { s: I, t: 'мам, март на улице...', offset: -3 * hour + 15 * min },
  { s: 'u-mama', t: 'Всё равно ветер холодный! Береги себя.', offset: -3 * hour + 17 * min },
])

// ==========================================
// 5. КОЛЯ — саркастичный друг, подколки
// Любит подколоть, использует ) вместо смайлов,
// ссылки, мемы, пишет строчными
// ==========================================
console.log('Seeding Коля (sarcastic friend)...')

seed(chatIds.kolya, [
  { s: 'u-kolya', t: 'ну чё, опять сидишь код пишешь в субботу?', offset: -3 * day },
  { s: I, t: 'а ты как догадался', offset: -3 * day + 2 * min },
  { s: 'u-kolya', t: 'потому что ты всегда сидишь код пишешь в субботу)', offset: -3 * day + 3 * min },
  { s: 'u-kolya', t: 'кст мемас тебе', offset: -3 * day + 3 * min + 15 },
  { s: I, t: 'ахах жиза', offset: -3 * day + 5 * min },
  { s: 'u-kolya', t: 'го хоть погулять выйди, погода огонь', offset: -3 * day + 7 * min },
  { s: I, t: 'не могу, дедлайн в понедельник', offset: -3 * day + 9 * min },
  { s: 'u-kolya', t: 'чел ты робот что ли) дедлайн подождёт а витамин д нет', offset: -3 * day + 10 * min },
  { s: 'u-kolya', t: 'ладно работай, потом не жалуйся что спина болит', offset: -3 * day + 11 * min },

  { s: 'u-kolya', t: 'короч я вчера на свидание сходил', offset: -2 * day },
  { s: I, t: 'оу, и как?', offset: -2 * day + 3 * min },
  { s: 'u-kolya', t: 'ну как тебе сказать', offset: -2 * day + 4 * min },
  { s: 'u-kolya', t: 'она 40 минут рассказывала про свою кошку', offset: -2 * day + 4 * min + 20 },
  { s: 'u-kolya', t: 'СОРОК МИНУТ', offset: -2 * day + 4 * min + 30 },
  { s: I, t: '😂😂😂', offset: -2 * day + 5 * min },
  { s: 'u-kolya', t: 'и кошку звали Анубис. АНУБИС. это уже красный флаг', offset: -2 * day + 6 * min },
  { s: I, t: 'ну хотя бы креативная', offset: -2 * day + 7 * min },
  { s: 'u-kolya', t: 'да уж, креативная... она ещё спросила какой у меня знак зодиака и после моего ответа сказала что мы не совместимы', offset: -2 * day + 8 * min },
  { s: I, t: 'больной выстрел', offset: -2 * day + 9 * min },
  { s: 'u-kolya', t: 'зато ужин был вкусный. хоть что-то)', offset: -2 * day + 10 * min },

  { s: 'u-kolya', t: 'ты это видел?', offset: -1 * day },
  { s: I, t: 'что именно', offset: -1 * day + 2 * min },
  { s: 'u-kolya', t: 'Meta llama 4 выкатила, 10 миллионов токенов контекст', offset: -1 * day + 3 * min },
  { s: 'u-kolya', t: 'теперь можно целую кодовую базу скормить и она наверное скажет "всё переписать")', offset: -1 * day + 3 * min + 20 },
  { s: I, t: 'ахахах ну вообще полезно для больших проектов', offset: -1 * day + 5 * min },
  { s: 'u-kolya', t: 'полезно пока она не начнёт галлюцинировать на 9 миллионном токене', offset: -1 * day + 6 * min },
  { s: I, t: 'справедливо', offset: -1 * day + 7 * min },
  { s: 'u-kolya', t: 'мне кажется через год программисты будут не нужны. мы все будем prompt-инженерами. это как дворник но в ай-ти', offset: -1 * day + 8 * min },
  { s: I, t: 'слишком мрачно) я думаю просто изменится роль', offset: -1 * day + 10 * min },
  { s: 'u-kolya', t: 'ну да, изменится. с "пишет код" на "проверяет код который написала нейросеть". мощный апгрейд)', offset: -1 * day + 11 * min },

  { s: 'u-kolya', t: 'слушай а правда что маша тебя на диету посадила', offset: -2 * hour },
  { s: I, t: 'кто тебе сказал...', offset: -2 * hour + 3 * min },
  { s: 'u-kolya', t: 'лёха проболтался) говорит ты в баре сидел с водой', offset: -2 * hour + 4 * min },
  { s: I, t: 'это я за рулём был!', offset: -2 * hour + 5 * min },
  { s: 'u-kolya', t: 'ну конечно конечно))', offset: -2 * hour + 5 * min + 20 },
  { s: 'u-kolya', t: 'ладно не парься, зож это модно сейчас', offset: -2 * hour + 6 * min },
])

db.exec('PRAGMA foreign_keys = ON')
db.close()

console.log('')
console.log('=== Realistic chats seeded! ===')
console.log('5 characters with authentic Russian texting:')
console.log('  Лёха (casual friend) — 34 msgs, slang, typos, lowercase')
console.log('  Маша (girlfriend) — 32 msgs, emoji, warm, caring')
console.log('  Андрей Петров (boss) — 24 msgs, semi-formal, business')
console.log('  Мама (parent) — 26 msgs, formal, full sentences, caring')
console.log('  Коля (sarcastic) — 35 msgs, irony, ), memes')
console.log('')
console.log('Test: POST /api/ai/style/analyze { targetUserId: "u-lesha", chatId: "chat-lesha-real" }')
