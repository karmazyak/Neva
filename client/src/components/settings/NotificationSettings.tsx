import { Bell, BellOff, Volume2, VolumeX } from 'lucide-react'
import { useNotificationStore } from '../../stores/notificationStore'

export default function NotificationSettings() {
  const { soundEnabled, notificationsEnabled, volume, setSoundEnabled, setNotificationsEnabled, setVolume } = useNotificationStore()

  const requestPermission = async () => {
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission()
      if (perm === 'granted') setNotificationsEnabled(true)
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
        <Bell size={16} className="text-accent" />
        Уведомления
      </h3>

      {/* Browser notifications */}
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-3">
          {notificationsEnabled ? <Bell size={18} className="text-accent" /> : <BellOff size={18} className="text-text-secondary" />}
          <div>
            <p className="text-sm text-text-primary">Уведомления в браузере</p>
            <p className="text-xs text-text-secondary">Показывать когда вкладка не активна</p>
          </div>
        </div>
        <button
          onClick={() => {
            if (!notificationsEnabled && Notification.permission !== 'granted') {
              requestPermission()
            } else {
              setNotificationsEnabled(!notificationsEnabled)
            }
          }}
          className={`relative w-11 h-6 rounded-full transition-colors ${notificationsEnabled ? 'bg-accent' : 'bg-bg-hover'}`}
        >
          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${notificationsEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {/* Sound */}
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-3">
          {soundEnabled ? <Volume2 size={18} className="text-accent" /> : <VolumeX size={18} className="text-text-secondary" />}
          <div>
            <p className="text-sm text-text-primary">Звук уведомлений</p>
            <p className="text-xs text-text-secondary">Воспроизводить звук при новых сообщениях</p>
          </div>
        </div>
        <button
          onClick={() => setSoundEnabled(!soundEnabled)}
          className={`relative w-11 h-6 rounded-full transition-colors ${soundEnabled ? 'bg-accent' : 'bg-bg-hover'}`}
        >
          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${soundEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {/* Volume slider */}
      {soundEnabled && (
        <div className="flex items-center gap-3 pl-8">
          <VolumeX size={14} className="text-text-secondary flex-shrink-0" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="flex-1 h-1 bg-bg-hover rounded-full appearance-none cursor-pointer accent-accent"
          />
          <Volume2 size={14} className="text-text-secondary flex-shrink-0" />
        </div>
      )}

      {Notification.permission === 'denied' && (
        <p className="text-xs text-red-400 pl-8">
          Уведомления заблокированы в настройках браузера. Разрешите их в настройках сайта.
        </p>
      )}
    </div>
  )
}
