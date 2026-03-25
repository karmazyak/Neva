import { useState } from 'react'

const EMOJI_CATEGORIES: Record<string, string[]> = {
  'Smileys': ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝'],
  'Gestures': ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤙', '👋', '🤚', '✋', '🖖', '👏', '🙌', '🤝', '🙏', '💪', '🫡'],
  'Hearts': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '❤️‍🔥', '💕', '💗', '💖'],
  'Objects': ['🔥', '⭐', '🎉', '🎊', '💯', '✅', '❌', '⚡', '💡', '🚀', '🎯', '🏆', '📌', '🔔', '💎'],
}

interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  onClose: () => void
}

export default function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [activeCategory, setActiveCategory] = useState('Smileys')

  return (
    <>
      <div className="fixed inset-0 z-[98]" onClick={onClose} />
      <div className="z-[99] bg-bg-secondary border border-border rounded-xl shadow-2xl w-[280px] overflow-hidden fade-in">
        <div className="flex border-b border-border overflow-x-auto">
          {Object.keys(EMOJI_CATEGORIES).map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-2 text-xs whitespace-nowrap transition-colors ${
                activeCategory === cat ? 'text-accent border-b-2 border-accent' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5 p-2 max-h-[200px] overflow-y-auto">
          {EMOJI_CATEGORIES[activeCategory]?.map((emoji) => (
            <button
              key={emoji}
              onClick={() => { onSelect(emoji); onClose() }}
              className="text-xl p-1 hover:bg-bg-hover rounded transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
