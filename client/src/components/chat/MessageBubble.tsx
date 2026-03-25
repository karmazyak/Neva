import { Check, CheckCheck, Bot, Eye, Play, Pause, Download, Share2, Pencil, Sparkles, SmilePlus, Bookmark, Pin, Timer, X } from 'lucide-react'
import { useState, useRef, useEffect, useCallback } from 'react'
import { renderMarkdown } from '../../lib/markdown'
import VoicePlayer from './VoicePlayer'

interface Action {
  label: string
  action: 'send' | 'edit'
  value: string
}

interface MediaItem {
  url: string
  type: 'image' | 'video' | 'file'
  filename?: string
  size?: number
}

export interface Reaction {
  emoji: string
  count: number
  userIds: string[]
  reacted: boolean
}

interface MessageBubbleProps {
  message: {
    id: string
    content: string
    type: string
    senderId: string
    senderName: string
    senderAvatar: string | null
    status: string
    visibility?: string
    metadata?: Record<string, any>
    editedAt?: string
    forwardedFrom?: { chatId: string; chatName: string; senderName: string }
    createdAt: string
    reactions?: Reaction[]
    pinned?: boolean
    saved?: boolean
  }
  isOwn: boolean
  showAvatar: boolean
  onAction?: (action: string, value: string) => void
  onContextMenu?: (params: { id: string; text: string; isOwn: boolean; position: { x: number; y: number }; messageType?: string }) => void
  onAIAction?: (messageText: string, position: { x: number; y: number }) => void
  onReply?: (messageId: string) => void
  onEdit?: (messageId: string, content: string) => void
  onForward?: (messageId: string) => void
  onReaction?: (messageId: string, emoji: string) => void
  onSave?: (messageId: string) => void
  selectMode?: boolean
  selected?: boolean
  onToggleSelect?: (messageId: string) => void
  highlightTerms?: string
}

const AUDIO_EXTS = ['.webm', '.ogg', '.mp3', '.wav', '.m4a', '.aac']
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.avi', '.mkv']

function isAudioUrl(url: string) {
  const lower = url.toLowerCase()
  return AUDIO_EXTS.some(ext => lower.endsWith(ext)) || lower.includes('audio')
}

function isImageUrl(url: string) {
  const lower = url.toLowerCase()
  return IMAGE_EXTS.some(ext => lower.endsWith(ext))
}

function isVideoUrl(url: string) {
  const lower = url.toLowerCase()
  return VIDEO_EXTS.some(ext => lower.endsWith(ext))
}

function AudioPlayer({ src }: { src: string }) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTime = () => {
      if (audio.duration) setProgress(audio.currentTime / audio.duration)
    }
    const onMeta = () => setDuration(audio.duration || 0)
    const onEnd = () => { setPlaying(false); setProgress(0) }

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('ended', onEnd)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('ended', onEnd)
    }
  }, [])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) { audio.pause() } else { audio.play() }
    setPlaying(!playing)
  }

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    if (!audio || !audio.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    audio.currentTime = pct * audio.duration
  }

  const fmt = (s: number) => {
    if (!s || !isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  return (
    <div className="flex items-center gap-2 min-w-[200px] max-w-[280px]">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        onClick={toggle}
        className="w-9 h-9 rounded-full bg-accent flex items-center justify-center flex-shrink-0 hover:bg-accent-hover transition-colors"
      >
        {playing ? <Pause size={16} className="text-white" /> : <Play size={16} className="text-white ml-0.5" />}
      </button>
      <div className="flex-1 flex flex-col gap-0.5">
        <div
          className="h-1.5 bg-white/20 rounded-full cursor-pointer relative overflow-hidden"
          onClick={seek}
        >
          <div
            className="absolute inset-y-0 left-0 bg-accent rounded-full transition-[width] duration-100"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <span className="text-[10px] text-text-secondary">{fmt(duration)}</span>
      </div>
    </div>
  )
}

function VideoPlayer({ src }: { src: string }) {
  return (
    <video
      src={src}
      controls
      preload="metadata"
      className="rounded-lg max-w-full max-h-[400px]"
      style={{ minWidth: '200px' }}
    />
  )
}

function MediaGrid({ media }: { media: MediaItem[] }) {
  const count = media.length

  const gridClass =
    count === 1 ? 'grid-cols-1'
    : count === 2 ? 'grid-cols-2'
    : count === 3 ? 'grid-cols-2'
    : 'grid-cols-2'

  return (
    <div className={`grid ${gridClass} gap-1 rounded-lg overflow-hidden`}>
      {media.map((item, i) => {
        // For 3 items, first item spans full width
        const spanFull = count === 3 && i === 0

        return (
          <div
            key={i}
            className={`relative overflow-hidden ${spanFull ? 'col-span-2' : ''}`}
            style={{ minHeight: count === 1 ? undefined : '120px', maxHeight: '300px' }}
          >
            {item.type === 'video' ? (
              <video
                src={item.url}
                controls
                preload="metadata"
                className="w-full h-full object-cover"
              />
            ) : (
              <img
                src={item.url}
                alt=""
                className="w-full h-full object-cover cursor-pointer"
                style={{ minHeight: count === 1 ? undefined : '120px' }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥']

export default function MessageBubble({ message, isOwn, showAvatar, onAction, onContextMenu, onAIAction, onReply, onEdit, onForward, onReaction, onSave, selectMode, selected, onToggleSelect, highlightTerms }: MessageBubbleProps) {
  const [showQuickReactions, setShowQuickReactions] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  const isGhost = message.visibility === 'ghost'
  const agentName = message.metadata?.agentName
  const actions = message.metadata?.actions as Action[] | undefined

  const handleContextMenu = (e: React.MouseEvent) => {
    if (isGhost) return
    e.preventDefault()
    onContextMenu?.({ id: message.id, text: message.content, isOwn, position: { x: e.clientX, y: e.clientY }, messageType: message.type })
  }

  // Long press for mobile → TG menu
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>()
  const handleTouchStart = (e: React.TouchEvent) => {
    if (isGhost) return
    const touch = e.touches[0]
    longPressTimer.current = setTimeout(() => {
      onContextMenu?.({ id: message.id, text: message.content, isOwn, position: { x: touch.clientX, y: touch.clientY }, messageType: message.type })
    }, 500)
  }
  const handleTouchEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
  }

  // Render message content based on type
  const renderContent = () => {
    // Media group: multiple images/videos with optional caption
    if (message.type === 'media_group') {
      const media = (message.metadata?.media || []) as MediaItem[]
      return (
        <div>
          {media.length > 0 && (
            <div className="max-w-sm">
              <MediaGrid media={media} />
            </div>
          )}
          {message.content && (
            <p className="text-text-primary whitespace-pre-wrap break-words text-[15px] leading-[1.35] mt-1.5">
              {message.content}
            </p>
          )}
        </div>
      )
    }

    // Video message
    if (message.type === 'video' || (message.type === 'file' && isVideoUrl(message.content))) {
      return (
        <div className="max-w-sm">
          <VideoPlayer src={message.content} />
        </div>
      )
    }

    // Image message
    if (message.type === 'image' || (message.type === 'file' && isImageUrl(message.content))) {
      return (
        <>
          <div className="max-w-sm">
            {imageError ? (
              <p className="text-text-primary whitespace-pre-wrap break-words">{message.content}</p>
            ) : (
              <img
                src={message.content}
                alt="Shared image"
                className="rounded-lg max-w-full cursor-zoom-in"
                onError={() => setImageError(true)}
                onClick={() => setLightboxSrc(message.content)}
              />
            )}
          </div>
          {lightboxSrc && (
            <div
              className="fixed inset-0 z-[999] bg-black/90 flex items-center justify-center"
              onClick={() => setLightboxSrc(null)}
            >
              <button
                className="absolute top-4 right-4 text-white/70 hover:text-white"
                onClick={() => setLightboxSrc(null)}
              >
                <X size={32} />
              </button>
              <img
                src={lightboxSrc}
                alt="Full size"
                className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain"
                onClick={e => e.stopPropagation()}
              />
            </div>
          )}
        </>
      )
    }

    // Voice message (type 'voice' or audio file)
    if (message.type === 'voice' || (message.type === 'file' && isAudioUrl(message.content))) {
      return (
        <VoicePlayer
          src={message.content}
          messageId={message.id}
          duration={message.metadata?.duration}
          isOwn={isOwn}
          existingTranscription={message.metadata?.transcription}
        />
      )
    }

    // Generic file
    if (message.type === 'file') {
      return (
        <a
          href={message.content}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-accent hover:underline text-[15px]"
        >
          <Download size={16} />
          {message.content.split('/').pop() || 'File'}
        </a>
      )
    }

    // Text message (default) — with markdown rendering
    const rendered = renderMarkdown(message.content)

    // Highlight search terms if provided
    if (highlightTerms) {
      return (
        <p className="text-text-primary whitespace-pre-wrap break-words text-[15px] leading-[1.35]">
          {rendered}
        </p>
      )
    }

    return (
      <p className="text-text-primary whitespace-pre-wrap break-words text-[15px] leading-[1.35]">
        {rendered}
      </p>
    )
  }

  if (isGhost) {
    return (
      <div className="flex justify-start message-enter px-2">
        <div className="max-w-[85%] w-full">
          <div className="rounded-2xl px-3 py-2 bg-accent/5 border border-dashed border-accent/30 backdrop-blur-sm">
            {/* Ghost header */}
            <div className="flex items-center gap-1.5 mb-1">
              <Bot size={12} className="text-accent" />
              <span className="text-[11px] font-medium text-accent">
                {agentName || 'AI Agent'}
              </span>
              <span className="text-[10px] text-text-secondary ml-auto flex items-center gap-1">
                <Eye size={10} />
                Only you can see this
              </span>
            </div>

            {/* Content */}
            {renderContent()}

            {/* Action buttons */}
            {actions && actions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-accent/20">
                {actions.map((act, i) => (
                  <button
                    key={i}
                    onClick={() => onAction?.(act.action, act.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      act.action === 'edit'
                        ? 'bg-bg-input text-text-secondary hover:text-text-primary hover:bg-bg-hover border border-border'
                        : 'bg-accent/15 text-accent hover:bg-accent/25'
                    }`}
                  >
                    {act.action === 'send' ? `💬 ${act.label}` : `✏️ ${act.label}`}
                  </button>
                ))}
              </div>
            )}

            {/* Time */}
            <div className="flex items-center gap-1 mt-0.5 justify-end">
              <span className="text-[10px] text-text-time">{time}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`flex ${isOwn ? 'justify-end' : 'justify-start'} message-enter items-end ${selectMode ? 'cursor-pointer' : ''} ${selected ? 'bg-accent/10 -mx-4 px-4 rounded-lg' : ''}`}
      onContextMenu={selectMode ? undefined : handleContextMenu}
      onTouchStart={selectMode ? undefined : handleTouchStart}
      onTouchEnd={selectMode ? undefined : handleTouchEnd}
      onTouchMove={selectMode ? undefined : handleTouchEnd}
      onClick={selectMode ? () => onToggleSelect?.(message.id) : undefined}
    >
      {/* Select checkbox */}
      {selectMode && (
        <div className="flex-shrink-0 self-center mr-2">
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
            selected
              ? 'bg-accent border-accent'
              : 'border-text-secondary/40 bg-transparent'
          }`}>
            {selected && (
              <Check size={12} className="text-white" />
            )}
          </div>
        </div>
      )}

      <div className={`flex gap-2 max-w-[75%] ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Avatar */}
        {!isOwn && (
          <div className="w-8 h-8 flex-shrink-0 self-end">
            {showAvatar && (
              <div className="w-8 h-8 rounded-full bg-accent/30 flex items-center justify-center text-accent text-xs font-bold">
                {message.senderName?.[0]?.toUpperCase()}
              </div>
            )}
          </div>
        )}

        {/* Bubble */}
        <div
          className={`rounded-2xl px-3 py-2 group relative ${
            isOwn
              ? 'bg-bg-bubble-own rounded-br-sm'
              : 'bg-bg-bubble-other rounded-bl-sm'
          }`}
        >
          {/* Forwarded header */}
          {message.forwardedFrom && (
            <div className="flex items-center gap-1 mb-1 text-[11px] text-text-secondary border-l-2 border-accent/40 pl-2">
              <Share2 size={10} className="text-accent" />
              <span>Forwarded from <strong className="text-accent">{message.forwardedFrom.senderName}</strong></span>
            </div>
          )}

          {/* Sender name for group chats */}
          {!isOwn && showAvatar && !message.forwardedFrom && (
            <div className="text-xs font-semibold text-accent mb-0.5">
              {message.senderName}
            </div>
          )}

          {/* Quick action buttons (left side, visible on hover) */}
          {!isGhost && !selectMode && (
            <div className="absolute top-1 left-0 -translate-x-full pr-1 hidden group-hover:flex gap-0.5">
              {onReaction && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowQuickReactions(!showQuickReactions) }}
                  className="p-1 rounded bg-bg-secondary/80 text-text-secondary hover:text-accent transition-colors"
                  title="React"
                >
                  <SmilePlus size={12} />
                </button>
              )}
              {message.type === 'text' && onAIAction && (
                <button
                  onClick={(e) => { e.stopPropagation(); onAIAction(message.content, { x: e.clientX, y: e.clientY }) }}
                  className="p-1 rounded bg-bg-secondary/80 text-text-secondary hover:text-accent transition-colors"
                  title="AI Actions"
                >
                  <Sparkles size={12} />
                </button>
              )}
              {onReply && (
                <button
                  onClick={(e) => { e.stopPropagation(); onReply(message.id) }}
                  className="p-1 rounded bg-bg-secondary/80 text-text-secondary hover:text-accent transition-colors"
                  title="Reply"
                >
                  <Share2 size={12} className="scale-x-[-1]" />
                </button>
              )}
              {isOwn && onEdit && message.type === 'text' && (
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(message.id, message.content) }}
                  className="p-1 rounded bg-bg-secondary/80 text-text-secondary hover:text-accent transition-colors"
                  title="Edit"
                >
                  <Pencil size={12} />
                </button>
              )}
              {onForward && (
                <button
                  onClick={(e) => { e.stopPropagation(); onForward(message.id) }}
                  className="p-1 rounded bg-bg-secondary/80 text-text-secondary hover:text-accent transition-colors"
                  title="Forward"
                >
                  <Share2 size={12} />
                </button>
              )}
            </div>
          )}

          {/* Content */}
          {renderContent()}

          {/* Reactions display */}
          {message.reactions && message.reactions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {message.reactions.map((r) => (
                <button
                  key={r.emoji}
                  onClick={(e) => { e.stopPropagation(); onReaction?.(message.id, r.emoji) }}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs transition-colors ${
                    r.reacted
                      ? 'bg-accent/20 border border-accent/40'
                      : 'bg-white/5 border border-white/10 hover:bg-white/10'
                  }`}
                >
                  <span>{r.emoji}</span>
                  <span className={r.reacted ? 'text-accent font-medium' : 'text-text-secondary'}>{r.count}</span>
                </button>
              ))}
              <button
                onClick={(e) => { e.stopPropagation(); setShowQuickReactions(!showQuickReactions) }}
                className="flex items-center px-1.5 py-0.5 rounded-full text-xs bg-white/5 border border-white/10 hover:bg-white/10 text-text-secondary transition-colors"
              >
                <SmilePlus size={12} />
              </button>
            </div>
          )}

          {/* Quick reactions popup */}
          {showQuickReactions && (
            <>
              <div className="fixed inset-0 z-[98]" onClick={() => setShowQuickReactions(false)} />
              <div className="absolute bottom-full mb-1 left-0 z-[99] flex gap-1 bg-bg-secondary border border-border rounded-full px-2 py-1 shadow-xl fade-in">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={(e) => { e.stopPropagation(); onReaction?.(message.id, emoji); setShowQuickReactions(false) }}
                    className="text-lg hover:scale-125 transition-transform p-0.5"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Time + edited + status + indicators */}
          <div className={`flex items-center gap-1 mt-0.5 ${isOwn ? 'justify-end' : 'justify-start'}`}>
            {message.pinned && <Pin size={10} className="text-accent" />}
            {message.saved && <Bookmark size={10} className="text-yellow-400" />}
            {message.metadata?.expiresAt && <Timer size={10} className="text-orange-400" />}
            {message.editedAt && (
              <span className="text-[10px] text-text-time italic">edited</span>
            )}
            <span className="text-[11px] text-text-time">{time}</span>
            {isOwn && (
              <span className="text-text-time">
                {message.status === 'read' ? (
                  <CheckCheck size={14} className="text-accent" />
                ) : (
                  <Check size={14} />
                )}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
