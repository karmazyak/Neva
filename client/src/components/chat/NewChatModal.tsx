import { useState } from 'react'
import { X, Search, UserPlus, Users, Megaphone, ArrowRight, Check } from 'lucide-react'
import { api } from '../../lib/api'
import { useChatStore } from '../../stores/chatStore'

interface NewChatModalProps {
  onClose: () => void
}

type Step = 'type' | 'search' | 'group-setup'

export default function NewChatModal({ onClose }: NewChatModalProps) {
  const [step, setStep] = useState<Step>('type')
  const [chatType, setChatType] = useState<'private' | 'group' | 'channel'>('private')
  const [search, setSearch] = useState('')
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedUsers, setSelectedUsers] = useState<any[]>([])
  const [groupName, setGroupName] = useState('')
  const [groupDescription, setGroupDescription] = useState('')
  const { createChat, setActiveChat } = useChatStore()

  const handleSearch = async (q: string) => {
    setSearch(q)
    const cleanQ = q.startsWith('@') ? q.slice(1) : q
    if (cleanQ.length < 2) {
      setUsers([])
      return
    }
    setLoading(true)
    try {
      const results = await api.searchUsers(cleanQ)
      setUsers(results)
    } catch {
      setUsers([])
    } finally {
      setLoading(false)
    }
  }

  const handleSelectUser = async (user: any) => {
    if (chatType === 'private') {
      // Create private chat immediately
      try {
        const chatId = await createChat([user.id])
        setActiveChat(chatId)
        onClose()
      } catch (err) {
        console.error('Failed to create chat:', err)
      }
    } else {
      // Add to selection for group/channel
      if (selectedUsers.find(u => u.id === user.id)) {
        setSelectedUsers(prev => prev.filter(u => u.id !== user.id))
      } else {
        setSelectedUsers(prev => [...prev, user])
      }
    }
  }

  const handleNextStep = () => {
    if (chatType === 'private') {
      setStep('search')
    } else {
      setStep('search')
    }
  }

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedUsers.length === 0) return
    try {
      const chatId = await createChat(
        selectedUsers.map(u => u.id),
        chatType,
        groupName
      )
      setActiveChat(chatId)
      onClose()
    } catch (err) {
      console.error('Failed to create group:', err)
    }
  }

  const handleProceedToSetup = () => {
    if (selectedUsers.length === 0) return
    setStep('group-setup')
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-bg-secondary rounded-2xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">
            {step === 'type' ? 'New Conversation' :
             step === 'group-setup' ? `${chatType === 'channel' ? 'New Channel' : 'New Group'}` :
             chatType === 'private' ? 'New Chat' :
             `Select Members`}
          </h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={22} />
          </button>
        </div>

        {/* Step: Choose type */}
        {step === 'type' && (
          <div className="p-4 space-y-2">
            <button
              onClick={() => { setChatType('private'); setStep('search') }}
              className="w-full flex items-center gap-4 p-4 rounded-xl bg-bg-input hover:bg-bg-hover transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
                <UserPlus size={20} className="text-accent" />
              </div>
              <div className="flex-1 text-left">
                <div className="text-text-primary font-medium">Private Chat</div>
                <div className="text-text-secondary text-xs">One-on-one conversation</div>
              </div>
              <ArrowRight size={18} className="text-text-secondary" />
            </button>

            <button
              onClick={() => { setChatType('group'); setStep('search') }}
              className="w-full flex items-center gap-4 p-4 rounded-xl bg-bg-input hover:bg-bg-hover transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-purple-400/20 flex items-center justify-center">
                <Users size={20} className="text-purple-400" />
              </div>
              <div className="flex-1 text-left">
                <div className="text-text-primary font-medium">Group</div>
                <div className="text-text-secondary text-xs">Chat with multiple people</div>
              </div>
              <ArrowRight size={18} className="text-text-secondary" />
            </button>

            <button
              onClick={() => { setChatType('channel'); setStep('search') }}
              className="w-full flex items-center gap-4 p-4 rounded-xl bg-bg-input hover:bg-bg-hover transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-blue-400/20 flex items-center justify-center">
                <Megaphone size={20} className="text-blue-400" />
              </div>
              <div className="flex-1 text-left">
                <div className="text-text-primary font-medium">Channel</div>
                <div className="text-text-secondary text-xs">Broadcast to subscribers (only admins post)</div>
              </div>
              <ArrowRight size={18} className="text-text-secondary" />
            </button>
          </div>
        )}

        {/* Step: Search users */}
        {step === 'search' && (
          <>
            {/* Selected users (for group/channel) */}
            {chatType !== 'private' && selectedUsers.length > 0 && (
              <div className="px-4 pt-3 flex gap-2 flex-wrap">
                {selectedUsers.map(u => (
                  <button
                    key={u.id}
                    onClick={() => setSelectedUsers(prev => prev.filter(x => x.id !== u.id))}
                    className="flex items-center gap-1.5 bg-accent/20 text-accent rounded-full px-3 py-1 text-xs"
                  >
                    {u.displayName}
                    <X size={12} />
                  </button>
                ))}
              </div>
            )}

            {/* Search */}
            <div className="p-4">
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  type="text"
                  placeholder="Search users..."
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="w-full bg-bg-input rounded-lg pl-10 pr-4 py-2.5 text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent"
                  autoFocus
                />
              </div>
            </div>

            {/* Results */}
            <div className="max-h-[300px] overflow-y-auto pb-4">
              {loading && (
                <div className="text-center text-text-secondary py-4 text-sm">Searching...</div>
              )}

              {!loading && search.length >= 2 && users.length === 0 && (
                <div className="text-center text-text-secondary py-4 text-sm">No users found</div>
              )}

              {users.map((u) => {
                const isSelected = selectedUsers.some(s => s.id === u.id)
                return (
                  <button
                    key={u.id}
                    onClick={() => handleSelectUser(u)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors"
                  >
                    <div className="w-10 h-10 rounded-full bg-accent/30 flex items-center justify-center text-accent font-bold">
                      {u.displayName?.[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="text-text-primary font-medium">{u.displayName}</div>
                      <div className="text-text-secondary text-sm">@{u.username}</div>
                    </div>
                    {chatType !== 'private' && isSelected && (
                      <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center">
                        <Check size={14} className="text-white" />
                      </div>
                    )}
                    {u.online && !isSelected && (
                      <div className="w-3 h-3 bg-green-online rounded-full" />
                    )}
                  </button>
                )
              })}

              {search.length < 2 && selectedUsers.length === 0 && (
                <div className="text-center text-text-secondary py-8">
                  <UserPlus size={40} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Type a username to {chatType === 'private' ? 'start chatting' : 'add members'}</p>
                </div>
              )}
            </div>

            {/* Next button for group/channel */}
            {chatType !== 'private' && (
              <div className="px-4 pb-4">
                <button
                  onClick={handleProceedToSetup}
                  disabled={selectedUsers.length === 0}
                  className="w-full bg-accent hover:bg-accent-hover text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-30 transition-colors"
                >
                  Next ({selectedUsers.length} selected)
                </button>
              </div>
            )}
          </>
        )}

        {/* Step: Group/Channel setup */}
        {step === 'group-setup' && (
          <div className="p-4 space-y-4">
            <div>
              <label className="text-text-secondary text-sm mb-1 block">
                {chatType === 'channel' ? 'Channel' : 'Group'} Name
              </label>
              <input
                type="text"
                placeholder={chatType === 'channel' ? 'My Channel' : 'Group Name'}
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
                autoFocus
              />
            </div>

            <div>
              <label className="text-text-secondary text-sm mb-1 block">Description (optional)</label>
              <input
                type="text"
                placeholder="What is this about?"
                value={groupDescription}
                onChange={(e) => setGroupDescription(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent text-sm"
              />
            </div>

            <div>
              <p className="text-text-secondary text-xs mb-2">
                {selectedUsers.length} member{selectedUsers.length > 1 ? 's' : ''} selected
                {chatType === 'channel' && ' (will be viewers)'}
              </p>
              <div className="flex flex-wrap gap-2">
                {selectedUsers.map(u => (
                  <span key={u.id} className="bg-bg-input text-text-primary text-xs px-2.5 py-1 rounded-full">
                    {u.displayName}
                  </span>
                ))}
              </div>
            </div>

            <button
              onClick={handleCreateGroup}
              disabled={!groupName.trim()}
              className="w-full bg-accent hover:bg-accent-hover text-white py-3 rounded-lg font-medium disabled:opacity-30 transition-colors"
            >
              Create {chatType === 'channel' ? 'Channel' : 'Group'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
