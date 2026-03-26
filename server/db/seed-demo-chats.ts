/**
 * Seed realistic demo conversations for ivan account.
 * Run: bun server/db/seed-demo-chats.ts
 */
import { Database } from 'bun:sqlite'
import { randomUUID } from 'crypto'

const dbPath = process.env.DATABASE_URL || './data/mlsendger.db'
const db = new Database(dbPath)

const ivanId = db.prepare('SELECT id FROM users WHERE username = ?').get('ivan') as { id: string } | undefined
if (!ivanId) { console.error('ivan not found'); process.exit(1) }
const userId = ivanId.id

// Get encryption key — we'll store plaintext for demo (encrypt function not available here easily)
// Actually let's check if messages are already encrypted
const sampleMsg = db.prepare('SELECT content FROM messages LIMIT 1').get() as { content: string } | undefined
const isEncrypted = sampleMsg?.content?.startsWith('enc:')
console.log('Messages encrypted:', isEncrypted)

// Helper: insert message
function addMsg(chatId: string, senderId: string, content: string, minutesAgo: number) {
  const id = randomUUID()
  const createdAt = Math.floor((Date.now() - minutesAgo * 60 * 1000) / 1000)
  // Store as plaintext — the app will handle display
  db.prepare(`INSERT OR IGNORE INTO messages (id, chat_id, sender_id, content, type, status, visibility, created_at)
    VALUES (?, ?, ?, ?, 'text', 'sent', 'normal', ?)`).run(id, chatId, senderId, content, createdAt)
}

// Clear old demo messages (keep only real user messages)
const demoChatIds = ['chat-mama-real', 'chat-masha-real', 'chat-lesha-real', 'chat-boss-real']
for (const chatId of demoChatIds) {
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId)
}

console.log('Cleared old messages')

// ═══ 1. МАМА (family) — день рождения через 3 дня ═══
const mamaId = 'u-mama'
const mamaChatId = 'chat-mama-real'

addMsg(mamaChatId, mamaId, 'Сынок, привет! Как у тебя дела на работе?', 4320) // 3 дня назад
addMsg(mamaChatId, userId, 'Привет мам! Всё нормально, много работы но справляюсь', 4300)
addMsg(mamaChatId, mamaId, 'Молодец! Не забывай отдыхать. Кстати, у меня день рождения через неделю, ты помнишь? 😊', 4280)
addMsg(mamaChatId, userId, 'Конечно помню мам! Уже думаю над подарком 🎁', 4260)
addMsg(mamaChatId, mamaId, 'Ой не надо ничего дорогого, главное чтобы ты приехал!', 4240)
addMsg(mamaChatId, userId, 'Обязательно приеду! ❤️', 4220)
addMsg(mamaChatId, mamaId, 'Я пирог испеку, твой любимый с вишней 🍒', 2880) // 2 дня назад
addMsg(mamaChatId, userId, 'Ммм, уже жду не могу!', 2860)
addMsg(mamaChatId, mamaId, 'Как погода у вас? У нас похолодало, я тёплый шарф достала', 1440) // 1 день назад
addMsg(mamaChatId, userId, 'У нас тоже прохладно. Ты тепло одевайся!', 1420)
addMsg(mamaChatId, mamaId, 'Хорошо хорошо. Позвони когда будет время, хочу голос твой услышать 💕', 1400)

// ═══ 2. МАША ❤️ (friend/подруга) — болеет ═══
const mashaId = 'u-masha'
const mashaChatId = 'chat-masha-real'

addMsg(mashaChatId, mashaId, 'Приветик! Ты на выходных что делаешь?', 5760) // 4 дня назад
addMsg(mashaChatId, userId, 'Привет! Пока не знаю, может погуляем?', 5740)
addMsg(mashaChatId, mashaId, 'Давай! Только я что-то начинаю заболевать 🤒', 5720)
addMsg(mashaChatId, userId, 'Ой нет( Что случилось?', 5700)
addMsg(mashaChatId, mashaId, 'Горло болит и температура немного. Простуда наверное', 5680)
addMsg(mashaChatId, userId, 'Лечись! Чай с мёдом и лимоном, отдыхай побольше', 5660)
addMsg(mashaChatId, mashaId, 'Спасибо 🥺 Буду лечиться', 5640)
addMsg(mashaChatId, mashaId, 'Ещё хуже стало, температура 38.5 😞', 2880) // 2 дня назад
addMsg(mashaChatId, userId, 'Маш, может врача вызвать?', 2860)
addMsg(mashaChatId, mashaId, 'Вызвала уже, сказал ОРВИ, лежу дома', 2840)
addMsg(mashaChatId, userId, 'Выздоравливай! Может тебе что-нибудь привезти?', 2820)
addMsg(mashaChatId, mashaId, 'Не надо, у меня всё есть. Просто скучно лежать одной 😔', 2800)

// ═══ 3. ЛЁХА (friend) — смешная история, ждёт ответа ═══
const leshaId = 'u-lesha'
const leshaChatId = 'chat-lesha-real'

addMsg(leshaChatId, leshaId, 'Братан привет!', 1440) // 1 день назад
addMsg(leshaChatId, userId, 'Здарова! Как сам?', 1420)
addMsg(leshaChatId, leshaId, 'Слушай, я тебе должен рассказать что вчера произошло 😂😂😂', 1400)
addMsg(leshaChatId, userId, 'Давай рассказывай!', 1380)
addMsg(leshaChatId, leshaId, 'Короче я пошёл в новый барбершоп возле дома. Сажусь в кресло, мастер спрашивает "что делаем?"', 1360)
addMsg(leshaChatId, leshaId, 'Я говорю "покороче сверху, по бокам машинкой"', 1358)
addMsg(leshaChatId, leshaId, 'Он кивает, берёт машинку... и БРЕЕТ МНЕ ПОЛГОЛОВЫ НАЛЫСО', 1356)
addMsg(leshaChatId, leshaId, 'Оказывается он подумал я сказал "под ноль" 💀💀💀', 1354)
addMsg(leshaChatId, leshaId, 'Теперь хожу как призывник 2006 года выпуска', 1352)
addMsg(leshaChatId, leshaId, 'Фотку скинуть? 😂', 300) // 5 часов назад
addMsg(leshaChatId, leshaId, 'Ты там жив вообще? 😅', 120) // 2 часа назад

// ═══ 4. АНДРЕЙ ПЕТРОВ (work/начальник) — для миссии повышения ═══
const bossId = 'u-boss'
const bossChatId = 'chat-boss-real'

addMsg(bossChatId, bossId, 'Иван, добрый день. Посмотрел твой отчёт по проекту, неплохо.', 10080) // 7 дней назад
addMsg(bossChatId, userId, 'Спасибо, Андрей Сергеевич! Старался сделать максимально подробно.', 10060)
addMsg(bossChatId, bossId, 'Да, видно что поработал. Клиент тоже доволен.', 10040)
addMsg(bossChatId, userId, 'Рад слышать! Если будут правки — сразу возьмусь.', 10020)
addMsg(bossChatId, bossId, 'На следующей неделе начинаем новый проект с МаркетПро. Ты будешь лидом.', 7200) // 5 дней назад
addMsg(bossChatId, userId, 'Отлично! Спасибо за доверие. Какой бюджет и сроки?', 7180)
addMsg(bossChatId, bossId, 'Бюджет обсудим на планёрке. Сроки — 3 месяца. Команда 4 человека.', 7160)
addMsg(bossChatId, userId, 'Понял, подготовлю предварительный план к понедельнику.', 7140)
addMsg(bossChatId, bossId, 'Хорошо. И ещё — квартальный ревью через 2 недели, подготовь свои результаты.', 4320) // 3 дня назад
addMsg(bossChatId, userId, 'Сделаю! У меня как раз есть что показать по последним проектам.', 4300)
addMsg(bossChatId, bossId, 'Жду. Если есть вопросы по МаркетПро — пиши.', 4280)
addMsg(bossChatId, userId, 'Хорошо, спасибо!', 4260)

// ═══ Update relationship types ═══
db.prepare('UPDATE chat_members SET relationship_type = ? WHERE chat_id = ? AND user_id = ?').run('family', mamaChatId, userId)
db.prepare('UPDATE chat_members SET relationship_type = ? WHERE chat_id = ? AND user_id = ?').run('friend', mashaChatId, userId)
db.prepare('UPDATE chat_members SET relationship_type = ? WHERE chat_id = ? AND user_id = ?').run('friend', leshaChatId, userId)
db.prepare('UPDATE chat_members SET relationship_type = ? WHERE chat_id = ? AND user_id = ?').run('work', bossChatId, userId)

// ═══ Update proactive actions ═══
db.prepare('DELETE FROM proactive_actions WHERE user_id = ?').run(userId)

db.prepare(`INSERT INTO proactive_actions (id, user_id, chat_id, type, trigger, title, body, draft_message, status, created_at)
  VALUES (?, ?, ?, 'suggestion', 'silence', ?, ?, ?, 'pending', unixepoch())`).run(
  randomUUID(), userId, mamaChatId,
  'У мамы скоро день рождения 🎂',
  'Мама упоминала день рождения в переписке. Через 3 дня! Не забудь поздравить.',
  'Мамочка, с наступающим! 🎂❤️ Уже считаю дни!'
)

db.prepare(`INSERT INTO proactive_actions (id, user_id, chat_id, type, trigger, title, body, draft_message, status, created_at)
  VALUES (?, ?, ?, 'suggestion', 'silence', ?, ?, ?, 'pending', unixepoch())`).run(
  randomUUID(), userId, mashaChatId,
  'Маша болеет уже 2 дня 💛',
  'Маша писала что температура 38.5 и ОРВИ. Может, стоит проверить как она?',
  'Маш, привет! Как ты? Выздоравливаешь? 💛'
)

db.prepare(`INSERT INTO proactive_actions (id, user_id, chat_id, type, trigger, title, body, draft_message, status, created_at)
  VALUES (?, ?, ?, 'suggestion', 'burst', ?, ?, ?, 'pending', unixepoch())`).run(
  randomUUID(), userId, leshaChatId,
  'Лёха ждёт ответа 😅',
  'Лёха написал смешную историю и 2 раза спросил "ты жив?". Ответь!',
  'Хахаха братан 😂😂😂 Извини, не видел! Скидывай фотку!'
)

// ═══ Update goals ═══
db.prepare('DELETE FROM user_goals WHERE user_id = ?').run(userId)

db.prepare(`INSERT INTO user_goals (id, user_id, chat_id, goal, mode, status, strategy, progress, progress_notes, autonomy_level, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'strategic', 'active', NULL, 0, '[]', 'semi', unixepoch(), unixepoch())`).run(
  randomUUID(), userId, bossChatId,
  'Попросить повышение зарплаты на квартальном ревью'
)

db.prepare(`INSERT INTO user_goals (id, user_id, chat_id, goal, mode, status, progress, progress_notes, autonomy_level, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'care', 'active', 0, '[]', 'semi', unixepoch(), unixepoch())`).run(
  randomUUID(), userId, mamaChatId,
  'Не забыть про день рождения мамы и приехать'
)

console.log('✅ Demo chats seeded for ivan!')
console.log('   Мама: день рождения через 3 дня')
console.log('   Маша: болеет ОРВИ')
console.log('   Лёха: смешная история, ждёт ответа')
console.log('   Андрей Петров: начальник, для миссии повышения')
console.log('   3 proactive actions created')
console.log('   2 goals created')

db.close()
