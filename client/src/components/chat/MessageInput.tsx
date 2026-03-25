import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { Send, Paperclip, Image, FileText, Video, X, Loader2, Bot, Store, Mic, Square, Sparkles, Clock, CornerUpLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAgentStore } from '../../stores/agentStore'
import { useChatStore } from '../../stores/chatStore'
import TextTransformBar from './TextTransformBar'
import ToneAdvisor from './ToneAdvisor'
import SchedulePicker from './SchedulePicker'
import CreditConfirmDialog from './CreditConfirmDialog'

interface MediaFile {
  file: File
  preview: string
  type: 'image' | 'video' | 'file'
}

interface ReplyingTo {
  id: string
  senderName: string
  content: string
  type: string
}

interface MessageInputProps {
  onSend: (content: string, type?: string, metadata?: Record<string, any>) => void
  onTyping: () => void
  onEditMessage?: (messageId: string, content: string) => Promise<void>
  chatId?: string
  isChannel?: boolean
  canPost?: boolean
  replyingTo?: ReplyingTo | null
  onCancelReply?: () => void
}

const MAX_MEDIA_FILES = 10

const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp']
const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv']

function getFileMediaType(file: File): 'image' | 'video' | 'file' {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  if (imageExts.includes(ext)) return 'image'
  if (videoExts.includes(ext)) return 'video'
  return 'file'
}

const MessageInput = forwardRef<{ insertText: (text: string) => void; setEditMode: (msgId: string, content: string) => void; setReplyMode: (msg: ReplyingTo) => void; clearReply: () => void }, MessageInputProps>(
  function MessageInput({ onSend, onTyping, onEditMessage, chatId, isChannel, canPost = true, replyingTo, onCancelReply }, ref) {
  const [text, setText] = useState('')
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [showSkillMenu, setShowSkillMenu] = useState(false)
  const [showTransformBar, setShowTransformBar] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [pendingMedia, setPendingMedia] = useState<MediaFile[]>([])
  const [showSchedulePicker, setShowSchedulePicker] = useState(false)
  const [showMentionMenu, setShowMentionMenu] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [creditConfirm, setCreditConfirm] = useState<{ skillName: string; cost: number; balance: number; command: string; prompt: string } | null>(null)
  const { mySkills, loadMySkills } = useAgentStore()
  const { chats } = useChatStore()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const typingTimeout = useRef<ReturnType<typeof setTimeout>>()
  const navigate = useNavigate()

  // Get chat members for @mention autocomplete
  const currentChat = chats.find(c => c.id === chatId)
  const chatMembers = (currentChat?.members || []) as { userId: string; username: string; displayName: string }[]

  const filteredMembers = chatMembers.filter(m =>
    !mentionFilter || m.username?.toLowerCase().includes(mentionFilter.toLowerCase()) ||
    m.displayName?.toLowerCase().includes(mentionFilter.toLowerCase())
  ).slice(0, 5)

  // Listen for dropped files from ChatWindow
  useEffect(() => {
    const handler = (e: Event) => {
      const files = (e as CustomEvent).detail as FileList
      if (files) addMediaFiles(files)
    }
    window.addEventListener('dropfiles', handler)
    return () => window.removeEventListener('dropfiles', handler)
  }, [pendingMedia])

  // Expose insertText and setEditMode for parent component
  useImperativeHandle(ref, () => ({
    insertText: (value: string) => {
      setText(value)
      setTimeout(() => inputRef.current?.focus(), 50)
    },
    setEditMode: (msgId: string, content: string) => {
      setEditingMessageId(msgId)
      setText(content)
      setTimeout(() => inputRef.current?.focus(), 50)
    },
    setReplyMode: (_msg: ReplyingTo) => {
      setTimeout(() => inputRef.current?.focus(), 50)
    },
    clearReply: () => {},
  }))

  // Load user's available skills on mount
  useEffect(() => {
    loadMySkills()
  }, [])

  // Clean up preview URLs on unmount
  useEffect(() => {
    return () => {
      pendingMedia.forEach((m) => URL.revokeObjectURL(m.preview))
    }
  }, [pendingMedia])

  // Filter skills based on typed command
  const getFilteredSkills = () => {
    if (!text.startsWith('/')) return mySkills
    const typed = text.toLowerCase()
    return mySkills.filter(s => {
      const cmd = (s.customCommand || s.command).toLowerCase()
      return cmd.startsWith(typed)
    })
  }

  // Detect / command input for autocomplete
  useEffect(() => {
    if (text === '/') {
      setShowSkillMenu(true)
    } else if (text.startsWith('/') && !text.includes(' ')) {
      setShowSkillMenu(true)
    } else if (!text.startsWith('/')) {
      setShowSkillMenu(false)
    }
  }, [text])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setText(val)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 150) + 'px'
    if (typingTimeout.current) clearTimeout(typingTimeout.current)
    typingTimeout.current = setTimeout(onTyping, 500)

    // @mention detection
    const cursorPos = el.selectionStart || 0
    const textBeforeCursor = val.slice(0, cursorPos)
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/)
    if (mentionMatch && chatMembers.length > 0) {
      setShowMentionMenu(true)
      setMentionFilter(mentionMatch[1])
    } else {
      setShowMentionMenu(false)
    }
  }

  const handleSend = async () => {
    const hasText = text.trim().length > 0
    const hasMedia = pendingMedia.length > 0

    if ((!hasText && !hasMedia) || executing) return

    // Hide transform bar on send
    setShowTransformBar(false)

    // Check if it's a / command → execute skill (hidden from chat partner)
    if (hasText && !hasMedia) {
      const slashMatch = text.trim().match(/^\/(\w+)\s+(.+)/s)
      if (slashMatch && chatId) {
        const [, command, prompt] = slashMatch
        const fullCmd = `/${command}`
        const skill = mySkills.find(s =>
          (s.customCommand || s.command) === fullCmd || s.command === fullCmd
        )
        if (skill) {
          // Show credit confirmation before executing
          try {
            const estimate = await api.estimateSkillCost(fullCmd)
            const balanceRes = await api.getBalance()
            setCreditConfirm({ skillName: estimate.skillName, cost: estimate.cost, balance: balanceRes.balance, command: fullCmd, prompt: prompt.trim() })
            setText('')
            setShowSkillMenu(false)
          } catch {
            // If estimate fails, execute directly
            setExecuting(true)
            setText('')
            setShowSkillMenu(false)
            try { await api.executeSkill({ chatId, command: fullCmd, prompt: prompt.trim() }) } catch {}
            setExecuting(false)
          }
          return
        }
      }

      // Also handle commands without arguments
      const slashOnly = text.trim().match(/^\/(\w+)$/)
      if (slashOnly && chatId) {
        const fullCmd = `/${slashOnly[1]}`
        const skill = mySkills.find(s =>
          (s.customCommand || s.command) === fullCmd || s.command === fullCmd
        )
        if (skill) {
          try {
            const estimate = await api.estimateSkillCost(fullCmd)
            const balanceRes = await api.getBalance()
            setCreditConfirm({ skillName: estimate.skillName, cost: estimate.cost, balance: balanceRes.balance, command: fullCmd, prompt: '' })
            setText('')
            setShowSkillMenu(false)
          } catch {
            setExecuting(true)
            setText('')
            setShowSkillMenu(false)
            try { await api.executeSkill({ chatId, command: fullCmd, prompt: '' }) } catch {}
            setExecuting(false)
          }
          return
        }
      }
    }

    // Edit mode: update existing message
    if (editingMessageId && onEditMessage) {
      try {
        await onEditMessage(editingMessageId, text.trim())
      } catch (err: any) {
        console.error('Edit error:', err)
      }
      setEditingMessageId(null)
      setText('')
      if (inputRef.current) inputRef.current.style.height = 'auto'
      return
    }

    // Has media files — upload and send
    if (hasMedia) {
      setExecuting(true)
      try {
        const token = localStorage.getItem('token')

        // Upload all files
        const uploadResults: { url: string; type: string; filename: string; size: number }[] = []

        if (pendingMedia.length === 1) {
          // Single file upload
          const formData = new FormData()
          formData.append('file', pendingMedia[0].file)
          const res = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData,
          })
          if (!res.ok) {
            const err = await res.json()
            throw new Error(err.error || 'Upload failed')
          }
          const data = await res.json()
          uploadResults.push(data)
        } else {
          // Batch upload
          const formData = new FormData()
          pendingMedia.forEach((m) => formData.append('files', m.file))
          const res = await fetch('/api/upload/batch', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData,
          })
          if (!res.ok) {
            const err = await res.json()
            throw new Error(err.error || 'Upload failed')
          }
          const data = await res.json()
          uploadResults.push(...data.files)
        }

        if (uploadResults.length === 0) throw new Error('No files uploaded successfully')

        // Send as media_group or single media message
        if (uploadResults.length === 1 && !hasText) {
          // Single media, no caption — send as image/video/file
          onSend(uploadResults[0].url, uploadResults[0].type)
        } else {
          // Multiple media or media with caption — send as media_group
          const media = uploadResults.map((r) => ({
            url: r.url,
            type: r.type,
            filename: r.filename,
            size: r.size,
          }))
          onSend(text.trim(), 'media_group', { media })
        }

        // Clean up
        pendingMedia.forEach((m) => URL.revokeObjectURL(m.preview))
        setPendingMedia([])
        setText('')
      } catch (err: any) {
        alert(`Upload error: ${err.message}`)
      } finally {
        setExecuting(false)
      }
      return
    }

    // Normal text message
    onSend(text.trim())
    setText('')
    setShowSkillMenu(false)
    onCancelReply?.()
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const insertSkillCommand = (skill: typeof mySkills[0]) => {
    setText((skill.customCommand || skill.command) + ' ')
    setShowSkillMenu(false)
    inputRef.current?.focus()
  }

  const handleTransform = (newText: string) => {
    setText(newText)
    inputRef.current?.focus()
  }

  // Audio recording
  const [recording, setRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<ReturnType<typeof setInterval>>()

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // Detect supported mimeType (Safari doesn't support audio/webm)
      const mimeTypes = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', '']
      const supportedMime = mimeTypes.find(m => !m || MediaRecorder.isTypeSupported(m)) || ''
      const ext = supportedMime.includes('mp4') ? 'mp4'
        : supportedMime.includes('ogg') ? 'ogg'
        : supportedMime.includes('wav') ? 'wav'
        : supportedMime.includes('webm') ? 'webm'
        : 'm4a'

      const options = supportedMime ? { mimeType: supportedMime } : undefined
      const mediaRecorder = new MediaRecorder(stream, options)
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const actualType = mediaRecorder.mimeType || supportedMime || 'audio/mp4'
        const blob = new Blob(chunksRef.current, { type: actualType })
        await uploadAudioBlob(blob, ext)
      }

      mediaRecorder.start()
      setRecording(true)
      setRecordingTime(0)
      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000)
    } catch (err) {
      console.error('Microphone access denied:', err)
      alert('Для голосовых сообщений нужен доступ к микрофону')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setRecording(false)
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
  }

  const uploadAudioBlob = async (blob: Blob, ext = 'webm') => {
    setExecuting(true)
    try {
      const formData = new FormData()
      formData.append('file', blob, `voice_${Date.now()}.${ext}`)

      const token = localStorage.getItem('token')
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Upload failed')
      }

      const data = await res.json()
      onSend(data.url, 'voice', { duration: recordingTime })
    } catch (err: any) {
      alert(`Upload error: ${err.message}`)
    } finally {
      setExecuting(false)
    }
  }

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadType, setUploadType] = useState<'image' | 'video' | 'file'>('image')

  const addMediaFiles = (files: FileList) => {
    const remaining = MAX_MEDIA_FILES - pendingMedia.length
    if (remaining <= 0) {
      alert(`Maximum ${MAX_MEDIA_FILES} files per message`)
      return
    }

    const newFiles: MediaFile[] = []
    const count = Math.min(files.length, remaining)

    for (let i = 0; i < count; i++) {
      const file = files[i]
      const mediaType = getFileMediaType(file)
      const preview = mediaType === 'image' || mediaType === 'video'
        ? URL.createObjectURL(file)
        : ''
      newFiles.push({ file, preview, type: mediaType })
    }

    setPendingMedia((prev) => [...prev, ...newFiles])

    if (files.length > remaining) {
      alert(`Only ${remaining} more file(s) allowed. ${files.length - remaining} file(s) skipped.`)
    }
  }

  const removeMediaFile = (index: number) => {
    setPendingMedia((prev) => {
      const removed = prev[index]
      if (removed.preview) URL.revokeObjectURL(removed.preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setShowAttachMenu(false)
    addMediaFiles(files)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const attachOptions = [
    {
      icon: Image, label: 'Фото', color: 'text-accent bg-accent/10',
      onClick: () => { setUploadType('image'); setTimeout(() => fileInputRef.current?.click(), 10) },
    },
    {
      icon: Video, label: 'Видео', color: 'text-accent bg-accent/10',
      onClick: () => { setUploadType('video'); setTimeout(() => fileInputRef.current?.click(), 10) },
    },
    {
      icon: FileText, label: 'Документ', color: 'text-accent bg-accent/10',
      onClick: () => { setUploadType('file'); setTimeout(() => fileInputRef.current?.click(), 10) },
    },
  ]

  const getAccept = () => {
    if (uploadType === 'image') return 'image/*'
    if (uploadType === 'video') return 'video/*'
    return '*'
  }

  // Channel: viewers can't post
  if (isChannel && !canPost) {
    return (
      <div className="px-4 py-3 bg-bg-secondary border-t border-border text-center">
        <span className="text-text-secondary text-sm">Только администраторы могут писать в этом канале</span>
      </div>
    )
  }

  const filteredSkills = getFilteredSkills()
  const hasContent = text.trim().length > 0 || pendingMedia.length > 0

  return (
    <div className="relative">
      {/* Tone Advisor — ambient AI hint */}
      {chatId && text.trim().length > 20 && !text.startsWith('/') && !executing && !recording && !showTransformBar && (
        <ToneAdvisor
          chatId={chatId}
          text={text}
          onApplySuggestion={(newText) => {
            setText(newText)
            inputRef.current?.focus()
          }}
        />
      )}

      {/* Text Transform Bar — AI rewrite before sending */}
      {showTransformBar && text.trim().length > 0 && !showSkillMenu && !executing && !recording && (
        <TextTransformBar
          text={text}
          onTransform={handleTransform}
          onClose={() => setShowTransformBar(false)}
          chatId={chatId}
        />
      )}

      {/* Skill autocomplete popup */}
      {showSkillMenu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowSkillMenu(false)} />
          <div className="absolute bottom-full left-0 right-0 mx-4 mb-2 bg-bg-secondary border border-border rounded-xl shadow-xl z-40 overflow-hidden fade-in">
            <div className="px-4 py-2 border-b border-border/50">
              <span className="text-xs text-text-secondary">Навыки агентов — скрыты от собеседника</span>
            </div>
            {filteredSkills.length > 0 ? (
              filteredSkills.map((skill) => (
                <button
                  key={`${skill.agentId}-${skill.id}`}
                  onClick={() => insertSkillCommand(skill)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover transition-colors"
                >
                  <span className="text-lg">{skill.icon}</span>
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-accent">
                        {skill.customCommand || skill.command}
                      </span>
                      <span className="text-sm text-text-primary">{skill.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Bot size={10} className="text-text-secondary" />
                      <span className="text-[11px] text-text-secondary">{skill.agentName}</span>
                      <span className="text-[11px] text-text-secondary/50">·</span>
                      <span className="text-[11px] text-text-secondary">{skill.description}</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-text-secondary bg-bg-input px-1.5 py-0.5 rounded">
                    {skill.cost} cr
                  </span>
                </button>
              ))
            ) : (
              <div className="px-4 py-4 text-center">
                <p className="text-text-secondary text-sm mb-2">
                  {mySkills.length === 0
                    ? 'Нет установленных агентов'
                    : 'Команда не найдена'}
                </p>
                {mySkills.length === 0 && (
                  <button
                    onClick={() => { setShowSkillMenu(false); navigate('/store') }}
                    className="inline-flex items-center gap-1.5 text-accent text-sm hover:underline"
                  >
                    <Store size={14} />
                    Установить роботов из Магазина
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Attachment menu */}
      {showAttachMenu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowAttachMenu(false)} />
          <div className="absolute bottom-full left-4 mb-2 bg-bg-secondary border border-border rounded-xl shadow-xl z-40 overflow-hidden fade-in w-52">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
              <span className="text-sm font-medium text-text-primary">Прикрепить</span>
              <button onClick={() => setShowAttachMenu(false)} className="text-text-secondary hover:text-text-primary">
                <X size={16} />
              </button>
            </div>
            {attachOptions.map((opt) => (
              <button
                key={opt.label}
                onClick={opt.onClick}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover transition-colors"
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${opt.color}`}>
                  <opt.icon size={16} />
                </div>
                <span className="text-sm text-text-primary">{opt.label}</span>
              </button>
            ))}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={getAccept()}
              multiple={uploadType !== 'file'}
              onChange={handleFileSelect}
            />
          </div>
        </>
      )}

      {/* @Mention autocomplete */}
      {showMentionMenu && filteredMembers.length > 0 && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowMentionMenu(false)} />
          <div className="absolute bottom-full left-0 right-0 mx-4 mb-2 bg-bg-secondary border border-border rounded-xl shadow-xl z-40 overflow-hidden fade-in">
            <div className="px-4 py-1.5 border-b border-border/50">
              <span className="text-xs text-text-secondary">Упомянуть участника</span>
            </div>
            {filteredMembers.map((member) => (
              <button
                key={member.userId}
                onClick={() => {
                  // Replace @partial with @username
                  const cursorPos = inputRef.current?.selectionStart || text.length
                  const before = text.slice(0, cursorPos).replace(/@\w*$/, `@${member.username} `)
                  const after = text.slice(cursorPos)
                  setText(before + after)
                  setShowMentionMenu(false)
                  inputRef.current?.focus()
                }}
                className="w-full flex items-center gap-3 px-4 py-2 hover:bg-bg-hover transition-colors"
              >
                <div className="w-7 h-7 rounded-full bg-accent/30 flex items-center justify-center text-accent text-xs font-bold">
                  {member.displayName?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="text-left">
                  <span className="text-sm text-text-primary">{member.displayName}</span>
                  <span className="text-xs text-text-secondary ml-2">@{member.username}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Schedule picker */}
      {showSchedulePicker && (
        <SchedulePicker
          onSchedule={async (date) => {
            if (chatId && text.trim()) {
              try {
                await api.scheduleMessage({ chatId, content: text.trim(), sendAt: date.toISOString() })
                setText('')
                setShowSchedulePicker(false)
              } catch (err: any) {
                alert(`Schedule error: ${err?.message}`)
              }
            }
          }}
          onClose={() => setShowSchedulePicker(false)}
        />
      )}

      {/* Credit confirmation dialog */}
      {creditConfirm && (
        <CreditConfirmDialog
          skillName={creditConfirm.skillName}
          cost={creditConfirm.cost}
          balance={creditConfirm.balance}
          onConfirm={async () => {
            if (!chatId) return
            setCreditConfirm(null)
            setExecuting(true)
            try {
              await api.executeSkill({ chatId, command: creditConfirm.command, prompt: creditConfirm.prompt })
            } catch (err: any) {
              console.error('Skill error:', err)
            }
            setExecuting(false)
          }}
          onCancel={() => setCreditConfirm(null)}
        />
      )}

      {/* Executing indicator */}
      {executing && (
        <div className="absolute bottom-full left-0 right-0 mx-4 mb-2 bg-accent/10 border border-accent/20 rounded-xl px-4 py-2.5 flex items-center gap-2 fade-in">
          <Loader2 size={16} className="text-accent animate-spin" />
          <span className="text-sm text-accent">
            {pendingMedia.length > 0 ? `Загрузка ${pendingMedia.length} файл(ов)...` : 'Выполнение навыка...'}
          </span>
        </div>
      )}

      {/* Recording indicator */}
      {recording && (
        <div className="absolute bottom-full left-0 right-0 mx-4 mb-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 flex items-center gap-2 fade-in">
          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          <span className="text-sm text-red-400 font-medium">Запись {formatTime(recordingTime)}</span>
          <button onClick={stopRecording} className="ml-auto p-1.5 bg-red-500/20 rounded-full hover:bg-red-500/30 transition-colors">
            <Square size={14} className="text-red-400" />
          </button>
        </div>
      )}

      {/* Reply preview banner */}
      {replyingTo && !editingMessageId && (
        <div className="flex items-center gap-2 px-4 py-2 bg-accent/5 border-t border-accent/30">
          <CornerUpLeft size={14} className="text-accent flex-shrink-0" />
          <div className="flex-1 min-w-0 border-l-2 border-accent pl-2">
            <div className="text-xs font-semibold text-accent truncate">{replyingTo.senderName}</div>
            <div className="text-xs text-text-secondary truncate">
              {replyingTo.type === 'image' ? '📷 Фото'
                : replyingTo.type === 'video' ? '🎬 Видео'
                : replyingTo.type === 'voice' ? '🎤 Голосовое сообщение'
                : replyingTo.type === 'file' ? '📎 Файл'
                : replyingTo.type === 'media_group' ? '🖼 Медиа'
                : replyingTo.content}
            </div>
          </div>
          <button
            onClick={onCancelReply}
            className="text-text-secondary hover:text-text-primary flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Edit mode banner */}
      {editingMessageId && (
        <div className="flex items-center gap-2 px-4 py-2 bg-accent/10 border-t border-accent/30">
          <Sparkles size={14} className="text-accent" />
          <span className="text-xs text-accent font-medium flex-1">Редактирование</span>
          <button
            onClick={() => { setEditingMessageId(null); setText('') }}
            className="text-text-secondary hover:text-text-primary"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Media preview strip */}
      {pendingMedia.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-bg-secondary border-t border-border overflow-x-auto">
          {pendingMedia.map((media, i) => (
            <div key={i} className="relative flex-shrink-0 group">
              {media.type === 'image' ? (
                <img
                  src={media.preview}
                  alt=""
                  className="w-16 h-16 object-cover rounded-lg border border-border"
                />
              ) : media.type === 'video' ? (
                <div className="w-16 h-16 rounded-lg border border-border bg-bg-input flex items-center justify-center relative overflow-hidden">
                  <video src={media.preview} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <Video size={16} className="text-white" />
                  </div>
                </div>
              ) : (
                <div className="w-16 h-16 rounded-lg border border-border bg-bg-input flex flex-col items-center justify-center gap-1">
                  <FileText size={16} className="text-text-secondary" />
                  <span className="text-[9px] text-text-secondary truncate max-w-[56px]">
                    {media.file.name.split('.').pop()}
                  </span>
                </div>
              )}
              <button
                onClick={() => removeMediaFile(i)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={10} className="text-white" />
              </button>
            </div>
          ))}
          <span className="text-[11px] text-text-secondary flex-shrink-0">
            {pendingMedia.length}/{MAX_MEDIA_FILES}
          </span>
        </div>
      )}

      <div className="flex items-end gap-2 px-4 py-3 bg-bg-secondary border-t border-border">
        <button
          onClick={() => setShowAttachMenu(!showAttachMenu)}
          className={`p-2 transition-colors flex-shrink-0 self-end rounded-full ${
            showAttachMenu ? 'text-accent bg-accent/10' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <Paperclip size={22} />
        </button>

        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={
              executing ? 'Выполнение...'
                : pendingMedia.length > 0 ? 'Добавить подпись...'
                : mySkills.length > 0 ? 'Сообщение (/ для навыков)'
                : 'Сообщение'
            }
            rows={1}
            disabled={executing || recording}
            className="w-full bg-bg-input rounded-2xl px-4 py-2.5 pr-10 text-text-primary placeholder:text-text-secondary focus:outline-none resize-none text-[15px] leading-[1.35] max-h-[150px] disabled:opacity-50"
          />
          {/* AI Transform toggle — inside textarea area */}
          {text.trim().length > 2 && !text.startsWith('/') && !executing && !recording && (
            <button
              onClick={() => setShowTransformBar(!showTransformBar)}
              className={`absolute right-2 bottom-2 p-1.5 rounded-full transition-all ${
                showTransformBar
                  ? 'text-accent bg-accent/15'
                  : 'text-text-secondary hover:text-accent hover:bg-accent/10'
              }`}
              title="AI переписать"
            >
              <Sparkles size={16} />
            </button>
          )}
        </div>

        {hasContent ? (
          <div className="flex items-center gap-1 self-end">
            {/* Schedule button */}
            {text.trim().length > 0 && !pendingMedia.length && (
              <button
                onClick={() => setShowSchedulePicker(!showSchedulePicker)}
                className={`p-2 rounded-full transition-colors ${showSchedulePicker ? 'text-accent bg-accent/10' : 'text-text-secondary hover:text-text-primary'}`}
                title="Отложить сообщение"
              >
                <Clock size={18} />
              </button>
            )}
            <button
              onClick={handleSend}
              disabled={executing}
              className="p-2.5 neva-gradient rounded-full text-white transition-opacity hover:opacity-90 disabled:opacity-30 flex-shrink-0 shadow-[0_2px_12px_rgba(44,196,196,0.35)]"
            >
              <Send size={20} />
            </button>
          </div>
        ) : (
          <button
            onClick={recording ? stopRecording : startRecording}
            disabled={executing}
            className={`p-2.5 rounded-full transition-opacity disabled:opacity-30 flex-shrink-0 self-end ${
              recording ? 'bg-red-500 hover:opacity-90 text-white' : 'neva-gradient hover:opacity-90 text-white shadow-[0_2px_12px_rgba(44,196,196,0.35)]'
            }`}
          >
            {recording ? <Square size={20} /> : <Mic size={20} />}
          </button>
        )}
      </div>
    </div>
  )
})

export default MessageInput
