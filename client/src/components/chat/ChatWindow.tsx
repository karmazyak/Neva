import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import { Share2, X } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useChatStore } from '../../stores/chatStore'
import { useAuthStore } from '../../stores/authStore'
import { useWebSocket } from '../../hooks/useWebSocket'
import { api } from '../../lib/api'
import MessageBubble from './MessageBubble'
import MessageInput from './MessageInput'
import ChatHeader from './ChatHeader'
import AgentToggle from '../agents/AgentToggle'
import MessageActions from './MessageActions'
import MessageContextMenu from './MessageContextMenu'
import ForwardModal from './ForwardModal'
import SearchBar from './SearchBar'
import PinnedBar from './PinnedBar'
import DropZoneOverlay from './DropZoneOverlay'
import ContactContextCard from './ContactContextCard'
import MeetingSummary from './MeetingSummary'
import DisappearTimerModal from './DisappearTimerModal'

interface ChatWindowProps {
  chatId: string
  onBack: () => void
  contextPanelOpen?: boolean
  onToggleContextPanel?: () => void
}

const ChatWindow = forwardRef(function ChatWindow({ chatId, onBack, contextPanelOpen, onToggleContextPanel }: ChatWindowProps, ref: any) {
  const { messages, chats, addMessage, typingUsers, ghostLayerEnabled, toggleGhostLayer } = useChatStore()
  const { user } = useAuthStore()
  const token = localStorage.getItem('token')
  const { sendTyping, sendRead } = useWebSocket(token)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [showAgentPanel, setShowAgentPanel] = useState(false)
  const [hasAgent, setHasAgent] = useState(false)
  const inputRef = useRef<{ insertText: (text: string) => void; setEditMode: (msgId: string, content: string) => void; setReplyMode: (msg: { id: string; senderName: string; content: string; type: string }) => void; clearReply: () => void } | null>(null)
  const [replyingTo, setReplyingTo] = useState<{ id: string; senderName: string; content: string; type: string } | null>(null)
  const [messageActionState, setMessageActionState] = useState<{ text: string; position: { x: number; y: number } } | null>(null)
  const [tgMenuState, setTgMenuState] = useState<{ id: string; text: string; isOwn: boolean; position: { x: number; y: number }; messageType?: string } | null>(null)
  const [forwardingMessageIds, setForwardingMessageIds] = useState<string[]>([])
  const [selectMode, setSelectMode] = useState(false)
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set())

  useImperativeHandle(ref, () => ({
    insertText: (text: string) => inputRef.current?.insertText(text),
  }))

  // New feature states
  const [showSearch, setShowSearch] = useState(false)
  const [showMeetingSummary, setShowMeetingSummary] = useState(false)
  const [showDisappearModal, setShowDisappearModal] = useState(false)
  const [disappearTimer, setDisappearTimer] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

  const chat = chats.find((c) => c.id === chatId)
  const chatMessages = messages[chatId] || []
  const isGhostEnabled = ghostLayerEnabled[chatId] || false

  useEffect(() => {
    api.getAgentConfig(chatId).then((cfg) => setHasAgent(!!cfg)).catch(() => setHasAgent(false))
  }, [chatId, showAgentPanel])

  useEffect(() => {
    setTimeout(() => { messagesEndRef.current?.scrollIntoView() }, 100)
  }, [chatId])

  useEffect(() => { sendRead(chatId) }, [chatId, chatMessages.length, sendRead])

  useEffect(() => {
    requestAnimationFrame(() => {
      const container = messagesContainerRef.current
      if (!container) { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); return }
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150
      const lastMsg = chatMessages[chatMessages.length - 1]
      const isOwnMessage = lastMsg?.senderId === user?.id
      if (isNearBottom || isOwnMessage) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
  }, [chatMessages.length, user?.id])

  const sendMessageOptimistic = useChatStore((s) => s.sendMessageOptimistic)

  const handleSend = async (content: string, type?: string, metadata?: Record<string, any>) => {
    if (!content.trim() && type !== 'media_group') return
    try {
      // Use optimistic send for text messages
      if (type === 'text' || !type) {
        await sendMessageOptimistic(chatId, content, type || 'text', replyingTo?.id, metadata)
      } else {
        // Non-text (images, files, media_group) — standard send
        const message = await api.sendMessage({
          chatId, content, type: type || 'text', metadata,
          ...(replyingTo ? { replyToId: replyingTo.id } : {}),
        })
        addMessage(message)
      }
      setReplyingTo(null)
    } catch (err) { console.error('Failed to send message:', err) }
  }

  const handleTyping = () => { sendTyping(chatId) }

  const handleAction = (action: string, value: string) => {
    if (action === 'send') handleSend(value)
    else if (action === 'edit') inputRef.current?.insertText(value)
  }

  const handleEditMessage = (messageId: string, content: string) => { inputRef.current?.setEditMode(messageId, content) }
  const handleForwardMessage = (messageId: string) => { setForwardingMessageIds([messageId]) }

  const handleEnterSelectMode = (messageId: string) => { setSelectMode(true); setSelectedMessages(new Set([messageId])) }
  const handleToggleSelect = useCallback((messageId: string) => {
    setSelectedMessages(prev => { const next = new Set(prev); if (next.has(messageId)) next.delete(messageId); else next.add(messageId); return next })
  }, [])
  const handleExitSelectMode = () => { setSelectMode(false); setSelectedMessages(new Set()) }
  const handleBatchForward = () => { if (selectedMessages.size === 0) return; setForwardingMessageIds(Array.from(selectedMessages)); handleExitSelectMode() }

  const handleMessageContextMenu = (params: { id: string; text: string; isOwn: boolean; position: { x: number; y: number } }) => { setTgMenuState(params) }
  const handleAIAction = (text: string, position: { x: number; y: number }) => { setMessageActionState({ text, position }) }

  const handleReply = (messageId: string) => {
    const msg = chatMessages.find(m => m.id === messageId)
    if (!msg) return
    const replyData = { id: msg.id, senderName: msg.senderName, content: msg.content, type: msg.type }
    setReplyingTo(replyData)
    inputRef.current?.setReplyMode(replyData)
  }

  const handleInsertReply = (text: string) => { inputRef.current?.insertText(text) }

  const getChatContext = () => {
    return chatMessages.filter(m => m.type === 'text' && m.visibility !== 'ghost').slice(-10).map(m => `${m.senderName}: ${m.content}`).join('\n')
  }

  // Reactions handler
  const handleReaction = async (messageId: string, emoji: string) => {
    const msg = chatMessages.find(m => m.id === messageId)
    const existingReaction = msg?.reactions?.find(r => r.emoji === emoji && r.reacted)
    try {
      if (existingReaction) {
        await api.removeReaction(messageId, emoji)
      } else {
        await api.addReaction(messageId, emoji)
      }
    } catch {}
  }

  // Save handler
  const handleSaveMessage = async (messageId: string) => {
    try { await api.saveMessage(messageId, chatId) } catch {}
  }

  // Pin handler
  const handlePinMessage = async (messageId: string) => {
    try { await api.pinMessage(messageId) } catch {}
  }

  // Disappear timer
  const handleSetDisappearTimer = async (timer: number | null) => {
    try { await api.setDisappearTimer(chatId, timer); setDisappearTimer(timer) } catch {}
  }

  // Drag & drop
  const handleDragEnter = (e: React.DragEvent) => { e.preventDefault(); dragCounterRef.current++; setIsDragging(true) }
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); dragCounterRef.current--; if (dragCounterRef.current <= 0) { setIsDragging(false); dragCounterRef.current = 0 } }
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault() }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    dragCounterRef.current = 0
    const files = e.dataTransfer.files
    if (files.length > 0) {
      // Trigger file upload through MessageInput
      const event = new CustomEvent('dropfiles', { detail: files })
      window.dispatchEvent(event)
    }
  }

  // Scroll to message (for search)
  const scrollToMessage = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`)
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('bg-accent/10'); setTimeout(() => el.classList.remove('bg-accent/10'), 2000) }
  }

  const typingList = Object.entries(typingUsers)
    .filter(([key]) => key.startsWith(chatId))
    .filter(([, val]) => val.userId !== user?.id)
    .map(([, val]) => val.username)

  return (
    <div className="flex flex-col h-full relative"
      onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}>

      {isDragging && <DropZoneOverlay />}

      <ChatHeader
        chat={chat} onBack={onBack}
        onAgentToggle={() => setShowAgentPanel(!showAgentPanel)}
        typing={typingList} hasAgent={hasAgent}
        ghostLayerEnabled={isGhostEnabled}
        onGhostToggle={() => toggleGhostLayer(chatId)}
        contextPanelOpen={contextPanelOpen}
        onToggleContextPanel={onToggleContextPanel}
        onSearch={() => setShowSearch(!showSearch)}
        onMeetingSummary={() => setShowMeetingSummary(true)}
        onDisappearTimer={() => setShowDisappearModal(true)}
      />

      {showSearch && <SearchBar chatId={chatId} onClose={() => setShowSearch(false)} onResultClick={scrollToMessage} />}

      <PinnedBar chatId={chatId} onClickPinned={scrollToMessage} />

      {showAgentPanel && <AgentToggle chatId={chatId} onClose={() => setShowAgentPanel(false)} />}

      {/* Contact context for private chats — hidden */}

      {/* Messages — Virtualized for performance */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-2" style={{
        backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(82, 136, 193, 0.05) 0%, transparent 50%)',
      }}>
        {chatMessages.length === 0 && !hasAgent && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 fade-in">
            <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
              <span className="text-3xl">💬</span>
            </div>
            <p className="text-text-secondary text-sm max-w-[280px]">
              Начните общение! Совет: нажмите <strong className="text-accent">⋮</strong> → <strong className="text-accent">AI Агент</strong>, чтобы ИИ отвечал за вас.
            </p>
          </div>
        )}

        {chatMessages.length > 0 && (
          <div className="space-y-1">
            {chatMessages.map((msg, i) => {
              const prevMsg = chatMessages[i - 1]
              const showAvatar = !prevMsg || prevMsg.senderId !== msg.senderId || msg.visibility === 'ghost'
              const isOwn = msg.senderId === user?.id
              const isOptimistic = (msg as any)._optimistic
              const isFailed = msg.status === 'failed'

              return (
                <div key={msg.id} id={`msg-${msg.id}`} className={`transition-colors duration-500 ${isOptimistic && !isFailed ? 'opacity-70' : ''} ${isFailed ? 'opacity-50' : ''}`}>
                  <MessageBubble
                    message={msg} isOwn={isOwn} showAvatar={showAvatar}
                    onAction={handleAction}
                    onContextMenu={handleMessageContextMenu}
                    onAIAction={handleAIAction}
                    onReply={handleReply}
                    onEdit={handleEditMessage}
                    onForward={handleForwardMessage}
                    onReaction={handleReaction}
                    onSave={handleSaveMessage}
                    selectMode={selectMode}
                    selected={selectedMessages.has(msg.id)}
                    onToggleSelect={handleToggleSelect}
                    replyToMessage={msg.replyToId ? chatMessages.find(m => m.id === msg.replyToId) : undefined}
                    onScrollToMessage={scrollToMessage}
                  />
                  {isFailed && (
                    <div className="text-xs text-red-400 text-right pr-2 -mt-1">
                      Не отправлено. <button className="underline hover:text-red-300" onClick={() => handleSend(msg.content)}>Повторить</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {typingList.length > 0 && (
          <div className="flex items-center gap-2 py-2 px-4">
            <div className="typing-indicator flex gap-1">
              <span className="w-2 h-2 bg-text-secondary rounded-full" />
              <span className="w-2 h-2 bg-text-secondary rounded-full" />
              <span className="w-2 h-2 bg-text-secondary rounded-full" />
            </div>
            <span className="text-sm text-text-secondary">{typingList.join(', ')} печатает...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {selectMode ? (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-bg-secondary">
          <button onClick={handleExitSelectMode} className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors">
            <X size={18} /><span className="text-sm">Отмена</span>
          </button>
          <span className="text-sm text-text-secondary">{selectedMessages.size} выбрано</span>
          <button onClick={handleBatchForward} disabled={selectedMessages.size === 0}
            className="flex items-center gap-2 text-accent hover:text-accent-hover transition-colors disabled:opacity-40">
            <span className="text-sm font-medium">Переслать</span><Share2 size={16} />
          </button>
        </div>
      ) : (
        <MessageInput
          ref={inputRef} onSend={handleSend} onTyping={handleTyping}
          onEditMessage={async (messageId, content) => { await api.editMessage(messageId, content) }}
          chatId={chatId}
          isChannel={chat?.type === 'channel'}
          canPost={chat?.type !== 'channel' || chat?.myRole === 'admin'}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
        />
      )}

      {/* TG-style right-click context menu */}
      {tgMenuState && (
        <MessageContextMenu
          messageId={tgMenuState.id} messageText={tgMenuState.text} isOwn={tgMenuState.isOwn} position={tgMenuState.position} messageType={tgMenuState.messageType}
          onClose={() => setTgMenuState(null)}
          onReply={() => { handleReply(tgMenuState.id); setTgMenuState(null) }}
          onForward={() => { handleForwardMessage(tgMenuState.id); setTgMenuState(null) }}
          onEdit={() => { handleEditMessage(tgMenuState.id, tgMenuState.text); setTgMenuState(null) }}
          onSelect={() => { handleEnterSelectMode(tgMenuState.id); setTgMenuState(null) }}
          onReact={(emoji: string) => { handleReaction(tgMenuState.id, emoji); setTgMenuState(null) }}
          onPin={() => { handlePinMessage(tgMenuState.id); setTgMenuState(null) }}
          onSave={() => { handleSaveMessage(tgMenuState.id); setTgMenuState(null) }}
          onDelete={async () => {
            if (!confirm('Удалить это сообщение?')) { setTgMenuState(null); return }
            try { await api.deleteMessage(tgMenuState.id) } catch {}
            setTgMenuState(null)
          }}
        />
      )}

      {messageActionState && (
        <MessageActions messageText={messageActionState.text} position={messageActionState.position}
          onClose={() => setMessageActionState(null)} onInsertReply={handleInsertReply} chatContext={getChatContext()} chatId={chatId} />
      )}

      {forwardingMessageIds.length > 0 && (
        <ForwardModal messageIds={forwardingMessageIds} onClose={() => setForwardingMessageIds([])} />
      )}

      {showMeetingSummary && <MeetingSummary chatId={chatId} onClose={() => setShowMeetingSummary(false)} />}
      {showDisappearModal && (
        <DisappearTimerModal currentTimer={disappearTimer} onSet={handleSetDisappearTimer} onClose={() => setShowDisappearModal(false)} />
      )}
    </div>
  )
})

export default ChatWindow
