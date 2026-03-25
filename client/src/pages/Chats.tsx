import { useEffect, useState } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import ChatList from '../components/chat/ChatList'
import ChatWindow from '../components/chat/ChatWindow'
import Sidebar from '../components/Sidebar'
import NewChatModal from '../components/chat/NewChatModal'
import ContextPanel from '../components/chat/ContextPanel'
import NevaLogo from '../components/NevaLogo'

export default function Chats() {
  const { loadChats, activeChat, setActiveChat } = useChatStore()
  const { user } = useAuthStore()
  const [showNewChat, setShowNewChat] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [contextPanelOpen, setContextPanelOpen] = useState(false)

  useEffect(() => {
    loadChats()
  }, [loadChats])

  // Close context panel when switching chats
  useEffect(() => {
    // Keep it open but let it re-analyze
  }, [activeChat])

  return (
    <div className="h-screen flex bg-bg-primary">
      {/* Sidebar menu */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Chat list - left panel */}
      <div
        className={`${
          activeChat ? 'hidden md:flex' : 'flex'
        } flex-col w-full md:w-[420px] md:min-w-[340px] border-r border-border bg-bg-secondary`}
      >
        <ChatList
          onMenuClick={() => setSidebarOpen(true)}
          onNewChat={() => setShowNewChat(true)}
        />
      </div>

      {/* Chat window - center panel */}
      <div
        className={`${
          activeChat ? 'flex' : 'hidden md:flex'
        } flex-col flex-1 bg-bg-chat min-w-0`}
      >
        {activeChat ? (
          <ChatWindow
            chatId={activeChat}
            onBack={() => setActiveChat(null)}
            contextPanelOpen={contextPanelOpen}
            onToggleContextPanel={() => setContextPanelOpen(!contextPanelOpen)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-sm mx-auto">
              <div className="w-20 h-20 neva-gradient rounded-[22px] flex items-center justify-center mx-auto mb-5 shadow-[0_0_40px_rgba(44,196,196,0.2)]">
                <NevaLogo size={44} />
              </div>
              <h2 className="text-xl text-text-primary font-semibold mb-2">Select a chat</h2>
              <p className="text-text-secondary text-sm">
                Choose a conversation from the list or start a new one.
              </p>
              <button
                onClick={() => setShowNewChat(true)}
                className="mt-5 px-6 py-2.5 rounded-xl neva-gradient text-white font-medium text-sm hover:opacity-90 transition-opacity shadow-[0_4px_20px_rgba(44,196,196,0.25)]"
              >
                Start a conversation
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Context Panel - right panel (desktop only) */}
      {contextPanelOpen && activeChat && (
        <div className="hidden md:flex flex-col w-[340px] min-w-[300px] border-l border-border bg-bg-secondary">
          <ContextPanel
            chatId={activeChat}
            onClose={() => setContextPanelOpen(false)}
          />
        </div>
      )}

      {showNewChat && (
        <NewChatModal onClose={() => setShowNewChat(false)} />
      )}
    </div>
  )
}
