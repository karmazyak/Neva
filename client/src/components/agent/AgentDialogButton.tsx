import { useState, useEffect } from 'react'
import { Bot } from 'lucide-react'
import { useAgentDialogStore } from '../../stores/agentDialogStore'
import AgentDialogPanel from './AgentDialogPanel'

export default function AgentDialogButton() {
  const { pendingCount, loadDialogs } = useAgentDialogStore()
  const [panelOpen, setPanelOpen] = useState(false)

  // Load pending count on mount
  useEffect(() => {
    loadDialogs()
  }, [])

  return (
    <>
      {/* Floating button — positioned above ProactiveCard area */}
      <button
        onClick={() => setPanelOpen(true)}
        className="fixed bottom-20 left-4 z-40 w-12 h-12 rounded-full bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-500/30 flex items-center justify-center transition-all hover:scale-105 active:scale-95"
        title="Диалоги агентов"
      >
        <Bot className="w-5 h-5" />
        {pendingCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold animate-pulse">
            {pendingCount}
          </span>
        )}
      </button>

      {/* Panel */}
      <AgentDialogPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </>
  )
}
