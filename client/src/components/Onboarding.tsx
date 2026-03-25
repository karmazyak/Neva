import { useState } from 'react'
import { Sparkles, Bot, Store, ArrowRight, Check, Fingerprint, Zap, Target, Brain, Shield, Heart, Rocket, MessageSquare, Eye, Theater } from 'lucide-react'
import { api } from '../lib/api'
import NevaLogo from './NevaLogo'

interface OnboardingProps {
  onComplete: () => void
}

const STEPS = [
  {
    icon: null,
    title: 'Welcome to Neva 2.0',
    description: 'Твой AI-мессенджер стал умнее. Встречай новый уровень — стратегический советник для работы, эмпатичный компаньон для личных чатов.',
    color: 'text-accent',
    isLogo: true,
    details: null,
  },
  {
    icon: Brain,
    title: 'Context AI Panel',
    description: 'Открой панель "Контекст" в любом чате — AI покажет главное в реальном времени.',
    color: 'text-accent',
    isLogo: false,
    details: [
      { emoji: '💬', text: 'Темы, решения, задачи — анализируются автоматически' },
      { emoji: '💡', text: 'Next Best Action — AI подскажет следующий шаг и подготовит черновик' },
      { emoji: '⚠️', text: 'Предупреждение о рисках — обнаружит эскалацию, уход от темы, пропущенные обещания' },
      { emoji: '🎉', text: 'Праздники — подсветит позитивные моменты, которые стоит отметить' },
    ],
  },
  {
    icon: Theater,
    title: 'Persona Profiler & Simulation',
    description: 'AI строит поведенческую модель каждого контакта по его сообщениям.',
    color: 'text-purple-400',
    isLogo: false,
    details: [
      { emoji: '🧠', text: 'Цифровой двойник — стиль, юмор, конфликтные паттерны, настроение' },
      { emoji: '🔮', text: '"А что если я скажу..." — симулируй реакцию собеседника до отправки' },
      { emoji: '🌿', text: 'Ветвление — смотри 2-3 возможных ответа с вероятностями' },
      { emoji: '💭', text: 'Внутренний монолог — загляни в то, что собеседник подумает' },
    ],
  },
  {
    icon: Rocket,
    title: 'Strategic Missions',
    description: 'Поставь цель — AI спланирует подход с несколькими стратегиями.',
    color: 'text-purple-400',
    isLogo: false,
    details: [
      { emoji: '🎯', text: 'Задай цель → AI генерирует 3 стратегии с готовыми сообщениями' },
      { emoji: '🤖', text: 'Каждая стратегия симулируется — видишь вероятный ответ и шанс успеха' },
      { emoji: '📋', text: 'Выбери стратегию → AI выполняет пошагово с адаптивным перепланированием' },
      { emoji: '📚', text: 'Учится на прошлых миссиях — становится умнее с каждой попыткой' },
    ],
  },
  {
    icon: Shield,
    title: 'Smart Tone Advisor',
    description: 'AI страхует тебя перед отправкой сообщения.',
    color: 'text-amber-400',
    isLogo: false,
    details: [
      { emoji: '🛡️', text: 'Предупредит, если тон слишком резкий для контекста' },
      { emoji: '🎯', text: 'Учитывает цели — предупредит, если сообщение противоречит активной стратегии' },
      { emoji: '✨', text: 'Смягчение в один тап — AI перепишет с правильным тоном' },
      { emoji: '🔄', text: 'Калиброван по отношениям — свободно с друзьями, аккуратно с клиентами' },
    ],
  },
  {
    icon: Heart,
    title: 'Relationship Care',
    description: 'Для семьи и друзей AI переключается в режим эмпатии.',
    color: 'text-pink-400',
    isLogo: false,
    details: [
      { emoji: '💛', text: 'Мягкие напоминания — "Ты давно не писал маме"' },
      { emoji: '🟡', text: 'Радар настроения — индикатор, когда кто-то кажется расстроенным' },
      { emoji: '📌', text: 'Личная память — запоминает планы, события, здоровье, питомцев' },
      { emoji: '🫂', text: 'Эмпатичные ответы — тёплые и личные, не корпоративные' },
    ],
  },
  {
    icon: Zap,
    title: 'AI Autopilot & Briefing',
    description: 'Пусть AI ведёт переписки и держит тебя в курсе.',
    color: 'text-accent',
    isLogo: false,
    details: [
      { emoji: '☕', text: 'Утренний брифинг — что требует внимания по всем чатам' },
      { emoji: '🤖', text: 'Автопилот — AI отправляет сообщения и ведёт переговоры за тебя' },
      { emoji: '👻', text: 'Ghost-слой — черновики AI видны только тебе, невидимы для собеседника' },
      { emoji: '📊', text: 'Статистика и поиск по всем перепискам' },
    ],
  },
  {
    icon: Fingerprint,
    title: 'Your Writing Style',
    description: 'Neva изучает как ты пишешь и адаптирует все AI-ответы под твой стиль.',
    color: 'text-accent',
    isLogo: false,
    details: [
      { emoji: '✍️', text: 'Учится после 30 сообщений — фразы, эмодзи, формальность' },
      { emoji: '🎭', text: 'AI пишет как ты — никто не заметит разницу' },
      { emoji: '⚙️', text: 'Загляни в "Мой стиль" в Профиле — посмотри что AI выучил' },
    ],
  },
  {
    icon: Eye,
    title: 'Privacy & Control',
    description: 'Ты всегда контролируешь. Каждое AI-действие логируется и прозрачно.',
    color: 'text-accent',
    isLogo: false,
    details: [
      { emoji: '🔒', text: 'Сквозное шифрование сообщений AES-256-GCM' },
      { emoji: '📋', text: 'Полный аудит-лог — смотри каждое AI-действие в Настройках' },
      { emoji: '🚫', text: 'Исключи любой чат из доступа AI' },
      { emoji: '🎚️', text: 'Включай/выключай AI в любой момент из Настроек' },
    ],
  },
  {
    icon: null,
    title: 'С чего начать?',
    description: 'Три простых шага, чтобы увидеть силу Neva:',
    color: 'text-accent',
    isLogo: true,
    isActionStep: true,
    details: [
      { emoji: '1️⃣', text: 'Открой AI Assistant и нажми ☕ "Брифинг" — узнай, кому стоит написать' },
      { emoji: '2️⃣', text: 'Зайди в любой чат и нажми "Контекст" — увидишь AI-анализ диалога' },
      { emoji: '3️⃣', text: 'Попробуй 🚀 "Миссию" — задай цель, AI построит стратегию переговоров' },
    ],
  },
]

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0)

  const handleComplete = async () => {
    try { await api.completeOnboarding() } catch {}
    onComplete()
  }

  const isLast = step === STEPS.length - 1
  const current = STEPS[step]

  return (
    <div className="fixed inset-0 bg-bg-primary z-[200] flex items-center justify-center overflow-y-auto">
      {/* Ambient glow */}
      <div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full opacity-[0.05] pointer-events-none"
        style={{ background: 'radial-gradient(circle, #2cc4c4 0%, transparent 70%)' }}
      />

      <div className="max-w-md w-full mx-4 py-8 relative z-10">
        {/* Step dots */}
        <div className="flex justify-center gap-1.5 mb-8">
          {STEPS.map((_, i) => (
            <div key={i} className={`rounded-full transition-all duration-300 ${
              i === step ? 'w-5 h-2 bg-accent' : i < step ? 'w-2 h-2 bg-accent/50' : 'w-2 h-2 bg-bg-input'
            }`} />
          ))}
        </div>

        <div className="text-center fade-in" key={step}>
          <div className={`w-16 h-16 rounded-[18px] flex items-center justify-center mx-auto mb-5 ${
            current.isLogo ? 'neva-gradient shadow-[0_0_40px_rgba(44,196,196,0.3)]' : 'bg-bg-secondary border border-[rgba(255,255,255,0.07)]'
          }`}>
            {current.isLogo
              ? <NevaLogo size={36} animated />
              : current.icon && <current.icon size={28} className={current.color} />
            }
          </div>
          <h2 className="text-xl font-bold text-text-primary mb-2">{current.title}</h2>
          <p className="text-text-secondary text-sm leading-relaxed mb-5">{current.description}</p>
          {'isActionStep' in current && current.isActionStep && (
            <div className="bg-accent/5 border border-accent/20 rounded-xl px-4 py-3 mb-4">
              <p className="text-xs text-accent font-medium">AI начнёт учиться с первых сообщений — чем больше диалогов, тем точнее советы</p>
            </div>
          )}

          {/* Feature details */}
          {current.details && (
            <div className="text-left space-y-2 mb-6">
              {current.details.map((item, i) => (
                <div key={i} className="flex items-start gap-2.5 bg-bg-secondary/50 border border-border/50 rounded-xl px-3.5 py-2.5">
                  <span className="text-base flex-shrink-0 mt-0.5">{item.emoji}</span>
                  <span className="text-sm text-text-primary leading-snug">{item.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-center gap-3">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="px-5 py-2.5 rounded-xl bg-bg-input text-text-secondary hover:text-text-primary transition-colors text-sm"
            >
              Назад
            </button>
          )}
          <button
            onClick={isLast ? handleComplete : () => setStep(step + 1)}
            className="px-7 py-2.5 rounded-xl neva-gradient text-white font-medium transition-opacity hover:opacity-90 flex items-center gap-2 text-sm shadow-[0_4px_20px_rgba(44,196,196,0.3)]"
          >
            {isLast ? <><Check size={16} /> Поехали!</> : <>Далее <ArrowRight size={16} /></>}
          </button>
        </div>

        {!isLast && (
          <button
            onClick={handleComplete}
            className="block mx-auto mt-4 text-xs text-text-secondary hover:text-text-primary transition-colors"
          >
            Пропустить
          </button>
        )}

        {/* Step counter */}
        <div className="text-center mt-4 text-[11px] text-text-secondary">
          {step + 1} / {STEPS.length}
        </div>
      </div>
    </div>
  )
}
