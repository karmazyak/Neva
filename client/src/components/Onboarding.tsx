import { useState } from 'react'
import { Sparkles, Bot, Store, ArrowRight, Check, Fingerprint } from 'lucide-react'
import { api } from '../lib/api'
import NevaLogo from './NevaLogo'

interface OnboardingProps {
  onComplete: () => void
}

const STEPS = [
  {
    icon: null,
    title: 'Welcome to Neva',
    description: 'An AI-first messenger where intelligence flows through every conversation.',
    color: 'text-accent',
    isLogo: true,
  },
  {
    icon: Sparkles,
    title: 'AI Features',
    description: 'Use /commands in chat to access AI skills — translate, summarize, generate images, and more. Toggle the AI layer to see suggestions only visible to you.',
    color: 'text-accent',
    isLogo: false,
  },
  {
    icon: Bot,
    title: 'Robots & Agents',
    description: 'Create custom AI agents with unique personalities and skills. Assign them to chats to auto-reply, or use them via direct AI Chat.',
    color: 'text-accent',
    isLogo: false,
  },
  {
    icon: Fingerprint,
    title: 'Your Writing Style',
    description: 'Neva learns how you write after 30 messages and adapts AI replies to match your tone, phrases, and style. Check "My Style" in your Profile anytime.',
    color: 'text-accent',
    isLogo: false,
  },
  {
    icon: Store,
    title: 'Robot Store',
    description: 'Browse and install pre-built robots from the marketplace. Each robot has unique skills and costs credits to use.',
    color: 'text-accent',
    isLogo: false,
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
    <div className="fixed inset-0 bg-bg-primary z-[200] flex items-center justify-center">
      {/* Ambient glow */}
      <div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full opacity-[0.05] pointer-events-none"
        style={{ background: 'radial-gradient(circle, #2cc4c4 0%, transparent 70%)' }}
      />

      <div className="max-w-md w-full mx-4 relative z-10">
        {/* Step dots */}
        <div className="flex justify-center gap-2 mb-10">
          {STEPS.map((_, i) => (
            <div key={i} className={`rounded-full transition-all duration-300 ${
              i === step ? 'w-5 h-2 bg-accent' : i < step ? 'w-2 h-2 bg-accent/50' : 'w-2 h-2 bg-bg-input'
            }`} />
          ))}
        </div>

        <div className="text-center fade-in" key={step}>
          <div className={`w-20 h-20 rounded-[22px] flex items-center justify-center mx-auto mb-6 ${
            current.isLogo ? 'neva-gradient shadow-[0_0_40px_rgba(44,196,196,0.3)]' : 'bg-bg-secondary border border-[rgba(255,255,255,0.07)]'
          }`}>
            {current.isLogo
              ? <NevaLogo size={44} animated />
              : current.icon && <current.icon size={36} className={current.color} />
            }
          </div>
          <h2 className="text-2xl font-bold text-text-primary mb-3">{current.title}</h2>
          <p className="text-text-secondary leading-relaxed mb-10">{current.description}</p>
        </div>

        <div className="flex justify-center gap-3">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="px-6 py-3 rounded-xl bg-bg-input text-text-secondary hover:text-text-primary transition-colors text-sm"
            >
              Back
            </button>
          )}
          <button
            onClick={isLast ? handleComplete : () => setStep(step + 1)}
            className="px-8 py-3 rounded-xl neva-gradient text-white font-medium transition-opacity hover:opacity-90 flex items-center gap-2 text-sm shadow-[0_4px_20px_rgba(44,196,196,0.3)]"
          >
            {isLast ? <><Check size={18} /> Get Started</> : <>Next <ArrowRight size={18} /></>}
          </button>
        </div>

        {!isLast && (
          <button
            onClick={handleComplete}
            className="block mx-auto mt-5 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Skip tutorial
          </button>
        )}
      </div>
    </div>
  )
}
