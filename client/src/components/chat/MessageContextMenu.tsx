import React from 'react'
import { CornerUpLeft, Share2, Copy, Pencil, CheckSquare, Type, Pin, Bookmark, Trash2 } from 'lucide-react'

const QUICK_EMOJIS = ['❤️', '👍', '😂', '😮', '🥺', '🙈', '👀', '😡']

interface MessageContextMenuProps {
  messageId: string
  messageText: string
  messageType?: string
  isOwn: boolean
  position: { x: number; y: number }
  onClose: () => void
  onReply: () => void
  onForward: () => void
  onEdit: () => void
  onSelect: () => void
  onReact?: (emoji: string) => void
  onPin?: () => void
  onSave?: () => void
  onDelete?: () => void
}

export default function MessageContextMenu({
  messageText, messageType, isOwn, position, onClose, onReply, onForward, onEdit, onSelect, onReact, onPin, onSave, onDelete,
}: MessageContextMenuProps) {
  const selectedText = window.getSelection()?.toString()?.trim() || ''
  const isTextMessage = !messageType || messageType === 'text'

  // Calculate menu position — emoji bar + items
  const menuLeft = Math.min(position.x, window.innerWidth - 260)
  const menuTop = Math.min(position.y, window.innerHeight - 400)

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 100,
    left: menuLeft,
    top: menuTop,
  }

  const items = [
    { key: 'reply', label: 'Ответить', icon: CornerUpLeft, onClick: () => { onReply(); onClose() } },
    ...(selectedText ? [{ key: 'copy_selected', label: 'Копировать выделенное', icon: Type, onClick: () => { navigator.clipboard.writeText(selectedText); onClose() } }] : []),
    ...(isTextMessage ? [{ key: 'copy', label: 'Копировать текст', icon: Copy, onClick: () => { navigator.clipboard.writeText(messageText); onClose() } }] : []),
    ...(onPin ? [{ key: 'pin', label: 'Закрепить', icon: Pin, onClick: () => { onPin(); onClose() } }] : []),
    { key: 'forward', label: 'Переслать', icon: Share2, onClick: () => { onForward(); onClose() } },
    ...(onSave ? [{ key: 'save', label: 'Сохранить', icon: Bookmark, onClick: () => { onSave(); onClose() } }] : []),
    ...(isOwn && isTextMessage ? [{ key: 'edit', label: 'Изменить', icon: Pencil, onClick: () => { onEdit(); onClose() } }] : []),
    { key: 'select', label: 'Выбрать', icon: CheckSquare, onClick: () => { onSelect(); onClose() } },
    ...(isOwn && onDelete ? [{ key: 'delete', label: 'Удалить', icon: Trash2, danger: true, onClick: () => { onDelete(); onClose() } }] : []),
  ]

  return (
    <>
      <div className="fixed inset-0 z-[99]" onClick={onClose} />
      <div style={menuStyle} className="fade-in relative z-[100]">
        {/* Emoji quick-react bar */}
        {onReact && (
          <div className="flex items-center gap-0.5 bg-bg-secondary border border-border rounded-full shadow-2xl px-1.5 py-1 mb-1.5 w-fit">
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => { onReact(emoji); onClose() }}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-bg-hover hover:scale-125 transition-all text-lg"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {/* Context menu items */}
        <div className="bg-bg-secondary border border-border rounded-xl shadow-2xl overflow-hidden w-[210px] py-1">
          {items.map((item) => (
            <button key={item.key} onClick={item.onClick}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-bg-hover transition-colors">
              <item.icon size={15} className={`flex-shrink-0 ${(item as any).danger ? 'text-red-400' : 'text-text-secondary'}`} />
              <span className={(item as any).danger ? 'text-red-400' : 'text-text-primary'}>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
