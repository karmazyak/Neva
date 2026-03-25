import { Upload } from 'lucide-react'

export default function DropZoneOverlay() {
  return (
    <div className="absolute inset-0 z-50 bg-bg-primary/90 backdrop-blur-sm flex items-center justify-center pointer-events-none">
      <div className="flex flex-col items-center gap-4 p-8 border-2 border-dashed border-accent rounded-2xl">
        <Upload size={48} className="text-accent" />
        <p className="text-lg font-medium text-text-primary">Перетащите файлы сюда</p>
        <p className="text-sm text-text-secondary">Фото, видео, документы</p>
      </div>
    </div>
  )
}
