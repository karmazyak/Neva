import { useState, useEffect } from 'react'
import { Link, Star, Loader2, Sparkles } from 'lucide-react'
import { api } from '../../lib/api'

interface Props {
  chatId: string
  contactName: string
}

export default function NetworkSection({ chatId, contactName }: Props) {
  const [offers, setOffers] = useState<any[]>([])
  const [trust, setTrust] = useState<{ trustScore: number; stars: number; socialDistance: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [contactId, setContactId] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [chatId])

  const loadData = async () => {
    setLoading(true)
    try {
      // Get contact user ID from chat members
      const summary = await api.getContactSummary(chatId)
      const cId = (summary as any)?.contact?.userId
      if (!cId) { setLoading(false); return }
      setContactId(cId)

      const [offersRes, trustRes] = await Promise.all([
        api.getUserOffers(cId).catch(() => ({ offers: [] })),
        api.getTrustScore(cId).catch(() => null),
      ])
      setOffers(offersRes.offers || [])
      setTrust(trustRes)
    } catch {} finally { setLoading(false) }
  }

  if (loading) {
    return (
      <section className="bg-bg-secondary rounded-xl p-4 border border-border">
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <Loader2 size={12} className="animate-spin" /> Загружаю сеть...
        </div>
      </section>
    )
  }

  if (offers.length === 0 && !trust) return null

  return (
    <section className="bg-bg-secondary rounded-xl p-4 border border-border space-y-3">
      <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
        <Link size={16} className="text-cyan-400" />
        Сеть
      </h3>

      {/* Trust score */}
      {trust && (
        <div className="flex items-center gap-3 bg-bg-hover rounded-lg px-3 py-2.5">
          <div className="flex-1">
            <div className="text-xs text-text-secondary">Доверие</div>
            <div className="flex items-center gap-1 mt-0.5">
              {[1, 2, 3, 4, 5].map(s => (
                <Star key={s} size={12} className={s <= trust.stars ? 'text-amber-400 fill-amber-400' : 'text-text-secondary/30'} />
              ))}
              <span className="text-xs text-text-secondary ml-1">{trust.trustScore.toFixed(1)}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-text-secondary">Дистанция</div>
            <div className="text-sm text-text-primary font-medium">
              {trust.socialDistance === 1 ? 'Прямой контакт' : trust.socialDistance === 2 ? 'Через друга' : 'Сеть'}
            </div>
          </div>
        </div>
      )}

      {/* Offers */}
      {offers.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs text-text-secondary font-medium">Навыки {contactName}</div>
          {offers.map((offer: any) => (
            <div key={offer.id} className="text-sm text-text-primary bg-bg-hover rounded-lg px-3 py-2 flex items-center gap-2">
              <Sparkles size={12} className="text-emerald-400 flex-shrink-0" />
              <span className="flex-1">{offer.description}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                offer.availability === 'available' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-bg-input text-text-secondary'
              }`}>
                {offer.availability === 'available' ? 'Доступен' : 'Занят'}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
