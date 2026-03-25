import { useState, useEffect } from 'react'
import { api } from '../../lib/api'

interface Folder {
  id: string
  name: string
  icon: string | null
  isDefault: boolean
}

interface FolderTabsProps {
  activeFolder: string | null
  onFolderChange: (folderId: string | null, folderName?: string) => void
}

export default function FolderTabs({ activeFolder, onFolderChange }: FolderTabsProps) {
  const [folders, setFolders] = useState<Folder[]>([])

  useEffect(() => {
    api.getFolders().then(setFolders).catch(() => {})
  }, [])

  if (folders.length === 0) return null

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border overflow-x-auto scrollbar-hide">
      {folders.map(f => (
        <button
          key={f.id}
          onClick={() => onFolderChange(f.name === 'All' ? null : f.id, f.name)}
          className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
            (f.name === 'All' && !activeFolder) || activeFolder === f.id
              ? 'bg-accent text-white'
              : 'bg-bg-input text-text-secondary hover:text-text-primary'
          }`}
        >
          {f.icon && <span>{f.icon}</span>}
          <span>{f.name}</span>
        </button>
      ))}
    </div>
  )
}
