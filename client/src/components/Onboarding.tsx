import { Check, Sparkles, Rocket, Heart, Brain } from 'lucide-react'
import { api } from '../lib/api'
import NevaLogo from './NevaLogo'

interface OnboardingProps {
  onComplete: () => void
}

/**
 * Simplified Onboarding — single welcome screen instead of 10 slides.
 * The real onboarding happens via GuidedTour (pulsating beacons in the UI).
 * This screen just sets the context and launches the user into the guided tour.
 */
export default function Onboarding({ onComplete }: OnboardingProps) {
  const handleComplete = async () => {
    try { await api.completeOnboarding() } catch {}
    onComplete()
  }

  return (
    <div className="fixed inset-0 bg-bg-primary z-[200] flex items-center justify-center overflow-y-auto">
      {/* Ambient glow */}
      <div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full opacity-[0.05] pointer-events-none"
        style={{ background: 'radial-gradient(circle, #2cc4c4 0%, transparent 70%)' }}
      />

      <div className="max-w-md w-full mx-4 py-8 relative z-10">
        <div className="text-center fade-in">
          <div className="w-20 h-20 rounded-[22px] flex items-center justify-center mx-auto mb-6 neva-gradient shadow-[0_0_40px_rgba(44,196,196,0.3)]">
            <NevaLogo size={44} animated />
          </div>
          <h2 className="text-2xl font-bold text-text-primary mb-2">Welcome to Neva</h2>
          <p className="text-text-secondary text-sm leading-relaxed mb-8">
            AI-мессенджер, который помогает общаться умнее
          </p>

          {/* 3 key capabilities — compact */}
          <div className="space-y-2.5 mb-8 text-left">
            <div className="flex items-center gap-3 bg-bg-secondary/50 border border-border/50 rounded-xl px-4 py-3">
              <div className="p-2 rounded-lg bg-accent/10">
                <Brain size={20} className="text-accent" />
              </div>
              <div>
                <div className="text-sm font-medium text-text-primary">AI-анализ каждого чата</div>
                <div className="text-xs text-text-secondary">Темы, задачи, настроение — в реальном времени</div>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-bg-secondary/50 border border-border/50 rounded-xl px-4 py-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <Rocket size={20} className="text-purple-400" />
              </div>
              <div>
                <div className="text-sm font-medium text-text-primary">Стратегические миссии</div>
                <div className="text-xs text-text-secondary">AI спланирует переговоры и выполнит пошагово</div>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-bg-secondary/50 border border-border/50 rounded-xl px-4 py-3">
              <div className="p-2 rounded-lg bg-pink-500/10">
                <Heart size={20} className="text-pink-400" />
              </div>
              <div>
                <div className="text-sm font-medium text-text-primary">Забота о близких</div>
                <div className="text-xs text-text-secondary">Напомнит написать, заметит смену настроения</div>
              </div>
            </div>
          </div>

          {/* CTA */}
          <button
            onClick={handleComplete}
            className="w-full px-7 py-3 rounded-xl neva-gradient text-white font-medium transition-opacity hover:opacity-90 flex items-center justify-center gap-2 text-sm shadow-[0_4px_20px_rgba(44,196,196,0.3)]"
          >
            <Sparkles size={16} />
            Начать — AI покажет что делать
          </button>

          <p className="text-[11px] text-text-secondary mt-3">
            Пульсирующие точки подскажут, куда нажать
          </p>
        </div>
      </div>
    </div>
  )
}
