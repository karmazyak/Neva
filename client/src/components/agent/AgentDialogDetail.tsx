import { useEffect } from 'react'
import {
  ArrowLeft, X, Bot, Check, XIcon, Clock, Zap, MessageSquare,
  Users, CheckCircle, XCircle,
} from 'lucide-react'
import { useAgentDialogStore, type DialogMessage } from '../../stores/agentDialogStore'
import { useAuthStore } from '../../stores/authStore'

interface Props {
  dialogId: string
  onBack: () => void
  onClose: () => void
}

export default function AgentDialogDetail({ dialogId, onBack, onClose }: Props) {
  const { selectedDialog, loadDialog, respondToDialog } = useAgentDialogStore()
  const currentUser = useAuthStore(s => s.user)

  useEffect(() => {
    loadDialog(dialogId)
  }, [dialogId])

  if (!selectedDialog) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <Clock className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  const { dialog, messages } = selectedDialog
  const isParentDialog = dialog.initiatorUserId === dialog.targetUserId
  const isMyRequest = dialog.initiatorUserId === currentUser?.id
  // Only show approve/decline if: dialog is pending AND user is the target (not the initiator) AND not a parent grouping dialog
  const showActions = dialog.status === 'pending' && !isParentDialog && !isMyRequest

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-white/10">
        <button onClick={onBack} className="text-gray-400 hover:text-white">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Bot className="w-4 h-4 text-purple-400" />
            {isParentDialog ? 'Кто свободен?' : 'Диалог агентов'}
          </h3>
          <p className="text-xs text-gray-400">
            {isParentDialog
              ? `Опрос ${(dialog.contextData as any)?.friendsAsked || 0} друзей`
              : `${dialog.initiatorName} → ${dialog.targetName}`
            }
          </p>
        </div>
        <StatusBadge status={dialog.status} isParent={isParentDialog} />
        <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* For parent whos_free dialogs, show a nice summary */}
        {isParentDialog && (dialog.contextData as any)?.context && (
          <div className="bg-purple-500/10 rounded-xl px-3 py-2 mb-2">
            <p className="text-sm text-purple-200">
              «{(dialog.contextData as any).context}»
            </p>
          </div>
        )}

        {messages.map((msg: DialogMessage) => (
          <WhosFreeResultBubble
            key={msg.id}
            message={msg}
            isParent={isParentDialog}
            initiatorName={dialog.initiatorName}
            targetName={dialog.targetName}
          />
        ))}

        {dialog.status === 'auto_approved' && !isParentDialog && (
          <div className="flex items-center gap-2 text-xs text-green-400/70 px-2">
            <Zap className="w-3 h-3" />
            Автоматически одобрено (настройки автономии)
          </div>
        )}
      </div>

      {/* Action buttons — only for pending dialogs where the user is the target */}
      {showActions && (
        <div className="p-4 border-t border-white/10 space-y-2">
          <p className="text-xs text-gray-400 mb-2">Ваш агент ждёт вашего решения:</p>
          <div className="flex gap-2">
            <button
              onClick={() => respondToDialog(dialogId, true)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 transition text-sm font-medium"
            >
              <Check className="w-4 h-4" />
              Одобрить
            </button>
            <button
              onClick={() => respondToDialog(dialogId, false)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition text-sm font-medium"
            >
              <XIcon className="w-4 h-4" />
              Отклонить
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Message Bubble (smart: detects whos_free results) ─────────────────────────

function WhosFreeResultBubble({
  message,
  isParent,
  initiatorName,
  targetName,
}: {
  message: DialogMessage
  isParent: boolean
  initiatorName: string
  targetName: string
}) {
  const isInitiator = message.agentRole === 'initiator'
  const content = message.content

  // For parent whos_free dialogs, parse result lines like "Коля: ✅ свободен (авто)"
  if (isParent && message.agentRole === 'target') {
    const isAvailable = content.includes('✅')
    const isDeclined = content.includes('❌')

    if (isAvailable || isDeclined) {
      return (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
          isAvailable ? 'bg-green-500/10' : 'bg-red-500/10'
        }`}>
          {isAvailable
            ? <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
            : <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          }
          <p className={`text-sm ${isAvailable ? 'text-green-300' : 'text-red-300'}`}>
            {content}
          </p>
          <span className="text-[10px] opacity-40 ml-auto flex-shrink-0">
            {new Date(message.createdAt).toLocaleTimeString('ru-RU', {
              hour: '2-digit', minute: '2-digit',
            })}
          </span>
        </div>
      )
    }
  }

  // Default bubble for other messages
  const agentName = isInitiator ? initiatorName : targetName

  return (
    <div className={`flex ${isInitiator ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[85%] rounded-xl px-3 py-2 ${
          isInitiator
            ? 'bg-white/5 text-gray-200 rounded-tl-sm'
            : 'bg-purple-500/15 text-purple-100 rounded-tr-sm'
        }`}
      >
        <div className="flex items-center gap-1.5 mb-1">
          <Bot className={`w-3 h-3 ${isInitiator ? 'text-blue-400' : 'text-purple-400'}`} />
          <span className="text-[10px] font-medium opacity-60">
            Агент {agentName}
          </span>
        </div>
        <p className="text-sm leading-relaxed">{content}</p>
        <div className="text-[10px] opacity-40 mt-1 text-right">
          {new Date(message.createdAt).toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  )
}

// ── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, isParent }: { status: string; isParent?: boolean }) {
  const configs: Record<string, { label: string; className: string }> = {
    pending: { label: 'Ожидает', className: 'bg-yellow-500/20 text-yellow-400' },
    auto_approved: { label: 'Авто', className: 'bg-green-500/20 text-green-400' },
    approved: { label: isParent ? 'Завершён' : 'Одобрен', className: 'bg-green-500/20 text-green-400' },
    denied: { label: 'Отклонён', className: 'bg-red-500/20 text-red-400' },
    expired: { label: 'Истёк', className: 'bg-gray-500/20 text-gray-400' },
    cancelled: { label: 'Отменён', className: 'bg-gray-500/20 text-gray-400' },
  }
  const conf = configs[status] || configs.pending

  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full ${conf.className}`}>
      {conf.label}
    </span>
  )
}
