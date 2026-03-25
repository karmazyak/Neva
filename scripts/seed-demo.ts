/**
 * Seed script: creates demo users, chats, and realistic conversations
 * Run: bun run scripts/seed-demo.ts
 */
import { db, schema } from '../server/db'
import { eq, and } from 'drizzle-orm'
import { hashSync } from 'bcryptjs'

const PASSWORD = hashSync('TestPass1234', 10)

// Our main user
const MAIN_USER_ID = '55d82d7d-a46e-4b9a-b58d-ef1620a720dc'

// ── Create users ──
const users = [
  { id: 'u-maria', username: 'maria', displayName: 'Мария Петрова', email: 'maria@demo.com', bio: 'Дизайнер, UX/UI' },
  { id: 'u-dmitry', username: 'dmitry', displayName: 'Дмитрий Козлов', email: 'dmitry@demo.com', bio: 'Клиент, CEO TechStart' },
  { id: 'u-anna', username: 'anna', displayName: 'Анна Сидорова', email: 'anna@demo.com', bio: 'Менеджер проектов' },
  { id: 'u-sergey', username: 'sergey', displayName: 'Сергей Волков', email: 'sergey@demo.com', bio: 'Backend разработчик' },
  { id: 'u-elena', username: 'elena', displayName: 'Елена Новикова', email: 'elena@demo.com', bio: 'HR директор' },
]

for (const u of users) {
  const exists = db.select().from(schema.users).where(eq(schema.users.id, u.id)).get()
  if (!exists) {
    db.insert(schema.users).values({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      email: u.email,
      passwordHash: PASSWORD,
      bio: u.bio,
      online: Math.random() > 0.5,
    }).run()
    console.log(`Created user: ${u.displayName}`)
  }
}

// ── Helper: create chat and add messages ──
function createChat(chatId: string, type: 'private' | 'group', name: string | null, memberIds: string[]) {
  const exists = db.select().from(schema.chats).where(eq(schema.chats.id, chatId)).get()
  if (exists) {
    console.log(`Chat ${chatId} already exists, skipping`)
    return
  }

  db.insert(schema.chats).values({ id: chatId, type, name }).run()
  for (const uid of memberIds) {
    db.insert(schema.chatMembers).values({
      chatId, userId: uid, role: uid === MAIN_USER_ID ? 'admin' : 'member',
    }).run()
  }
  console.log(`Created chat: ${name || chatId}`)
}

function addMessage(chatId: string, senderId: string, content: string, minutesAgo: number) {
  const createdAt = new Date(Date.now() - minutesAgo * 60 * 1000)
  db.insert(schema.messages).values({
    chatId,
    senderId,
    content,
    type: 'text',
    status: 'sent',
    visibility: 'normal',
    createdAt,
  }).run()
}

// ── Chat 1: Мария (дизайнер) — рабочая переписка ──
createChat('chat-maria', 'private', null, [MAIN_USER_ID, 'u-maria'])

addMessage('chat-maria', 'u-maria', 'Привет! Я закончила макеты для лендинга. Скинуть в Figma?', 1440)
addMessage('chat-maria', MAIN_USER_ID, 'Да, скинь ссылку пожалуйста', 1430)
addMessage('chat-maria', 'u-maria', 'https://figma.com/file/landing-v2 — вот, посмотри. Там 3 варианта главного экрана', 1420)
addMessage('chat-maria', MAIN_USER_ID, 'Посмотрел, мне нравится вариант 2. Но нужно поменять цвет кнопки на синий', 1200)
addMessage('chat-maria', 'u-maria', 'Хорошо, поменяю. Кстати, мне нужен текст для блока "О нас". Можешь прислать до пятницы?', 1190)
addMessage('chat-maria', MAIN_USER_ID, 'Обещаю прислать текст до пятницы вечера', 1180)
addMessage('chat-maria', 'u-maria', 'Супер! И ещё — нужно решить по иконкам. Я предлагаю Phosphor Icons, они легче чем Font Awesome', 600)
addMessage('chat-maria', MAIN_USER_ID, 'Давай Phosphor, согласен. Когда будет финальная версия?', 590)
addMessage('chat-maria', 'u-maria', 'Если текст будет в пятницу, то финал в понедельник утром. Договорились?', 580)
addMessage('chat-maria', MAIN_USER_ID, 'Договорились! Жду понедельник', 570)

// ── Chat 2: Дмитрий (клиент) — переговоры о проекте ──
createChat('chat-dmitry', 'private', null, [MAIN_USER_ID, 'u-dmitry'])

addMessage('chat-dmitry', 'u-dmitry', 'Добрый день! Мы обсудили ваше предложение на совете директоров', 2880)
addMessage('chat-dmitry', MAIN_USER_ID, 'Здравствуйте, Дмитрий! Какое решение?', 2870)
addMessage('chat-dmitry', 'u-dmitry', 'В целом нам нравится, но бюджет $15,000 за MVP — это дороговато. Можно $12,000?', 2860)
addMessage('chat-dmitry', MAIN_USER_ID, 'Понимаю. За $12,000 мы можем сделать базовый функционал без мобильной версии. Полный MVP — $14,000, это наш минимум', 2850)
addMessage('chat-dmitry', 'u-dmitry', 'А что входит в базовый за $12k?', 2840)
addMessage('chat-dmitry', MAIN_USER_ID, 'Веб-приложение, авторизация, основной дашборд, API для интеграции. Без мобилки и без push-уведомлений', 2830)
addMessage('chat-dmitry', 'u-dmitry', 'Хм, push-уведомления нам важны. Давайте $13,500 с push-ами но без мобилки?', 720)
addMessage('chat-dmitry', MAIN_USER_ID, '$13,500 с push — договорились. Я подготовлю обновлённое КП до среды', 710)
addMessage('chat-dmitry', 'u-dmitry', 'Отлично. Жду КП. И ещё вопрос — когда можете начать?', 700)
addMessage('chat-dmitry', MAIN_USER_ID, 'Можем стартовать через 2 недели, после подписания договора', 690)
addMessage('chat-dmitry', 'u-dmitry', 'Хорошо. Кстати, у нас ещё есть задача по аналитике — дашборд для отдела продаж. Это отдельный проект. Можете оценить?', 300)
addMessage('chat-dmitry', MAIN_USER_ID, 'Конечно, пришлите ТЗ и я оценю в течение пары дней', 290)
addMessage('chat-dmitry', 'u-dmitry', 'Хорошо, ТЗ пришлю завтра. Спасибо!', 280)

// ── Chat 3: Анна (менеджер) — рабочие задачи ──
createChat('chat-anna', 'private', null, [MAIN_USER_ID, 'u-anna'])

addMessage('chat-anna', 'u-anna', 'Привет! По спринту: у нас 3 задачи в бэклоге. Нужно распределить до конца дня', 480)
addMessage('chat-anna', MAIN_USER_ID, 'Привет, давай. Что за задачи?', 475)
addMessage('chat-anna', 'u-anna', '1) Фикс бага с авторизацией (критический)\n2) Новая страница настроек\n3) Интеграция с Stripe', 470)
addMessage('chat-anna', MAIN_USER_ID, 'Баг возьму на себя, его нужно сегодня закрыть. Настройки отдай Сергею, Stripe — на следующий спринт', 465)
addMessage('chat-anna', 'u-anna', 'Ок, записала. Только Stripe нельзя двигать — клиент просил до конца месяца', 460)
addMessage('chat-anna', MAIN_USER_ID, 'Тогда Stripe начну после бага, параллельно с Сергеем. Должны успеть', 455)
addMessage('chat-anna', 'u-anna', 'Супер. Кстати, не забудь — завтра стендап в 10:00, а в 14:00 ретро', 450)
addMessage('chat-anna', MAIN_USER_ID, 'Буду на обоих. Спасибо!', 445)
addMessage('chat-anna', 'u-anna', 'И ещё — Елена просила тебя заполнить self-review до пятницы. Ссылка в почте', 120)
addMessage('chat-anna', MAIN_USER_ID, 'Ой, совсем забыл. Заполню сегодня вечером, обещаю', 115)

// ── Chat 4: Сергей (разработчик) — техническое обсуждение ──
createChat('chat-sergey', 'private', null, [MAIN_USER_ID, 'u-sergey'])

addMessage('chat-sergey', 'u-sergey', 'Слушай, я нашёл баг в API — при одновременных запросах race condition на обновлении баланса', 360)
addMessage('chat-sergey', MAIN_USER_ID, 'Блин, серьёзно. Какой endpoint?', 355)
addMessage('chat-sergey', 'u-sergey', 'POST /api/billing/charge — если два запроса приходят одновременно, баланс может уйти в минус', 350)
addMessage('chat-sergey', MAIN_USER_ID, 'Нужно добавить транзакцию с SELECT FOR UPDATE. Или оптимистичную блокировку', 345)
addMessage('chat-sergey', 'u-sergey', 'Я уже начал фиксить. Сделал через SERIALIZABLE транзакцию. Можешь зарёвьюить PR #47?', 340)
addMessage('chat-sergey', MAIN_USER_ID, 'Посмотрю сегодня вечером. А тесты написал?', 335)
addMessage('chat-sergey', 'u-sergey', 'Да, добавил concurrent test. 100 параллельных запросов — баланс корректный', 330)
addMessage('chat-sergey', MAIN_USER_ID, 'Красава. Посмотрю и замержу', 325)

// ── Chat 5: Елена (HR) — performance review ──
createChat('chat-elena', 'private', null, [MAIN_USER_ID, 'u-elena'])

addMessage('chat-elena', 'u-elena', 'Добрый день! Напоминаю про квартальный review. Self-assessment нужен до пятницы', 1800)
addMessage('chat-elena', MAIN_USER_ID, 'Добрый день, Елена. Да, Анна мне тоже напомнила. Заполню обязательно', 1790)
addMessage('chat-elena', 'u-elena', 'Отлично. И ещё — у нас открыта вакансия Senior Frontend. Может порекомендуешь кого-то? Бонус 50,000 руб за рекомендацию', 1780)
addMessage('chat-elena', MAIN_USER_ID, 'О, интересно. У меня есть знакомый, Андрей. Он сейчас в Яндексе но хочет уйти. Скину его резюме', 1770)
addMessage('chat-elena', 'u-elena', 'Было бы супер! Жду резюме. Почта для отправки: hr@company.com', 1760)
addMessage('chat-elena', MAIN_USER_ID, 'Хорошо, отправлю на этой неделе', 1750)

// ── Chat 6: Групповой чат — Команда проекта ──
createChat('chat-team', 'group', 'Команда Проекта', [MAIN_USER_ID, 'u-anna', 'u-sergey', 'u-maria'])

addMessage('chat-team', 'u-anna', 'Всем привет! Дедлайн релиза — 28 марта. Все помнят?', 240)
addMessage('chat-team', 'u-sergey', 'Помню. Backend готов на 90%. Осталось фикс биллинга и тесты', 235)
addMessage('chat-team', 'u-maria', 'Дизайн тоже почти готов. Жду текст от тебя', 230)
addMessage('chat-team', MAIN_USER_ID, 'Текст будет в пятницу. По фронту — основные страницы готовы, осталась интеграция со Stripe', 225)
addMessage('chat-team', 'u-anna', 'Ок, давайте созвонимся в четверг и посмотрим где мы. 16:00 подходит всем?', 220)
addMessage('chat-team', 'u-sergey', 'Мне ок', 218)
addMessage('chat-team', 'u-maria', 'Подходит!', 216)
addMessage('chat-team', MAIN_USER_ID, 'Буду', 214)
addMessage('chat-team', 'u-anna', 'Отлично, отправлю приглашение в календарь', 210)

console.log('\n✅ Demo data seeded successfully!')
console.log('Login: testuser / TestPass1234')
