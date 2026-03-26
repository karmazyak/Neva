import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'

/**
 * GuidedTour — replaces the slide-based onboarding with an in-context tour.
 *
 * Instead of 10 slides that users skip, pulsating beacons appear on actual
 * UI elements, guiding users through features step by step.
 *
 * Flow:
 * 1. morning_briefing — pulse on MorningBriefing card in chat list
 * 2. ai_tab — pulse on AI tab in bottom navigation
 * 3. briefing_button — pulse on "Брифинг" button in AI Chat
 * 4. mission_button — pulse on "Миссия" button in AI Chat
 * 5. context_button — pulse on context panel button in chat header
 *
 * Each step completes when user clicks the pulsing element.
 */

export type TourStep =
  | 'morning_briefing'
  | 'ai_tab'
  | 'briefing_button'
  | 'mission_button'
  | 'context_button'
  | 'completed'

const TOUR_STEPS: TourStep[] = [
  'morning_briefing',
  'ai_tab',
  'briefing_button',
  'mission_button',
  'context_button',
  'completed',
]

const TOUR_TOOLTIPS: Record<string, { text: string; position?: 'top' | 'bottom' | 'left' | 'right' }> = {
  morning_briefing: { text: 'AI покажет, кому стоит написать', position: 'bottom' },
  ai_tab: { text: 'Здесь живёт AI Assistant', position: 'top' },
  briefing_button: { text: 'Начни с утреннего брифинга', position: 'bottom' },
  mission_button: { text: 'Запусти стратегическую миссию', position: 'bottom' },
  context_button: { text: 'AI-анализ этого чата', position: 'bottom' },
}

const STORAGE_KEY = 'neva_guided_tour'

interface TourState {
  currentStep: TourStep
  isActive: boolean
}

interface TourContextType {
  currentStep: TourStep
  isActive: boolean
  isStepActive: (step: TourStep) => boolean
  completeStep: (step: TourStep) => void
  startTour: () => void
  skipTour: () => void
  getTooltip: (step: TourStep) => { text: string; position?: string } | null
}

const TourContext = createContext<TourContextType>({
  currentStep: 'completed',
  isActive: false,
  isStepActive: () => false,
  completeStep: () => {},
  startTour: () => {},
  skipTour: () => {},
  getTooltip: () => null,
})

export function useTour() {
  return useContext(TourContext)
}

function loadTourState(): TourState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return JSON.parse(stored)
  } catch {}
  return { currentStep: 'morning_briefing', isActive: true }
}

function saveTourState(state: TourState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function TourProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TourState>(() => loadTourState())

  useEffect(() => {
    saveTourState(state)
  }, [state])

  const isStepActive = useCallback((step: TourStep) => {
    return state.isActive && state.currentStep === step
  }, [state.currentStep, state.isActive])

  const completeStep = useCallback((step: TourStep) => {
    setState(prev => {
      if (prev.currentStep !== step) return prev
      const currentIndex = TOUR_STEPS.indexOf(step)
      const nextStep = TOUR_STEPS[currentIndex + 1] || 'completed'
      return {
        currentStep: nextStep,
        isActive: nextStep !== 'completed',
      }
    })
  }, [])

  const startTour = useCallback(() => {
    setState({ currentStep: 'morning_briefing', isActive: true })
  }, [])

  const skipTour = useCallback(() => {
    setState({ currentStep: 'completed', isActive: false })
  }, [])

  const getTooltip = useCallback((step: TourStep) => {
    if (!state.isActive || state.currentStep !== step) return null
    return TOUR_TOOLTIPS[step] || null
  }, [state.currentStep, state.isActive])

  return (
    <TourContext.Provider value={{
      currentStep: state.currentStep,
      isActive: state.isActive,
      isStepActive,
      completeStep,
      startTour,
      skipTour,
      getTooltip,
    }}>
      {children}
    </TourContext.Provider>
  )
}

/**
 * PulseBeacon — a pulsating dot that wraps any element to draw attention.
 * Renders the pulse only when its tour step is active.
 */
interface PulseBeaconProps {
  step: TourStep
  children: ReactNode
  className?: string
  onClick?: () => void
}

export function PulseBeacon({ step, children, className = '', onClick }: PulseBeaconProps) {
  const { isStepActive, completeStep, getTooltip } = useTour()

  if (!isStepActive(step)) {
    return <>{children}</>
  }

  const tooltip = getTooltip(step)

  const handleClick = () => {
    completeStep(step)
    onClick?.()
  }

  return (
    <div className={`relative ${className}`} onClick={handleClick}>
      {children}
      {/* Pulsating ring */}
      <div className="absolute -inset-1 rounded-xl border-2 border-accent animate-pulse pointer-events-none z-10" />
      {/* Pulsating dot */}
      <div className="absolute -top-1 -right-1 z-20 pointer-events-none">
        <span className="relative flex h-3.5 w-3.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
          <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-accent" />
        </span>
      </div>
      {/* Tooltip */}
      {tooltip && (
        <div className={`absolute z-30 pointer-events-none whitespace-nowrap ${
          tooltip.position === 'top' ? 'bottom-full left-1/2 -translate-x-1/2 mb-2' :
          tooltip.position === 'left' ? 'right-full top-1/2 -translate-y-1/2 mr-2' :
          tooltip.position === 'right' ? 'left-full top-1/2 -translate-y-1/2 ml-2' :
          'top-full left-1/2 -translate-x-1/2 mt-2'
        }`}>
          <div className="bg-bg-primary border border-accent/30 rounded-lg px-3 py-1.5 shadow-lg">
            <span className="text-xs text-text-primary font-medium">{tooltip.text}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * TourProgress — floating indicator showing tour progress.
 * Allows skipping the tour.
 */
export function TourProgress() {
  const { isActive, currentStep, skipTour } = useTour()

  if (!isActive || currentStep === 'completed') return null

  const stepIndex = TOUR_STEPS.indexOf(currentStep)
  const totalSteps = TOUR_STEPS.length - 1 // exclude 'completed'

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] fade-in">
      <div className="bg-bg-secondary/95 backdrop-blur-sm border border-accent/20 rounded-full px-4 py-2 shadow-lg flex items-center gap-3">
        <div className="flex gap-1">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i < stepIndex ? 'w-4 bg-accent' :
                i === stepIndex ? 'w-6 bg-accent animate-pulse' :
                'w-4 bg-bg-input'
              }`}
            />
          ))}
        </div>
        <span className="text-[11px] text-text-secondary">{stepIndex + 1}/{totalSteps}</span>
        <button
          onClick={skipTour}
          className="text-[11px] text-text-secondary hover:text-text-primary transition-colors"
        >
          Пропустить
        </button>
      </div>
    </div>
  )
}

/**
 * Reset and restart tour (called from Profile)
 */
export function resetTour() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentStep: 'morning_briefing', isActive: true }))
}
