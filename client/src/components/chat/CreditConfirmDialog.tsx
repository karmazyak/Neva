import { Coins, X } from 'lucide-react'

interface CreditConfirmDialogProps {
  skillName: string
  cost: number
  balance: number
  onConfirm: () => void
  onCancel: () => void
}

export default function CreditConfirmDialog({ skillName, cost, balance, onConfirm, onCancel }: CreditConfirmDialogProps) {
  const canAfford = balance >= cost
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onCancel} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] bg-bg-secondary border border-border rounded-2xl shadow-2xl z-50 overflow-hidden fade-in">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Coins size={18} className="text-accent" />
          <span className="font-medium text-text-primary">Confirm Skill Usage</span>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Skill</span>
            <span className="text-text-primary font-medium">{skillName}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Cost</span>
            <span className="text-accent font-medium">{cost} credits</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Balance</span>
            <span className={canAfford ? 'text-green-400' : 'text-danger'}>{balance} credits</span>
          </div>
          {!canAfford && <p className="text-xs text-danger">Insufficient credits</p>}
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-border">
          <button onClick={onCancel} className="flex-1 px-3 py-2 rounded-lg bg-bg-input text-text-secondary text-sm hover:bg-bg-hover">Cancel</button>
          <button onClick={onConfirm} disabled={!canAfford}
            className="flex-1 px-3 py-2 rounded-lg bg-accent text-white text-sm hover:bg-accent-hover disabled:opacity-40">
            Use {cost} credits
          </button>
        </div>
      </div>
    </>
  )
}
