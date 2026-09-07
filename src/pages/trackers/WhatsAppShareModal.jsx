import { useState, useEffect } from 'react'
import { X, Send } from 'lucide-react'
import Button from '@/components/ui/Button'
import { shareToWhatsApp } from '@/lib/whatsapp'

// Generic editable-message-before-sharing modal. The caller resolves the
// template into `initialMessage` (via lib/trackerWhatsapp.js); the user can
// freely edit wording, add/remove lines, or add remarks before it's shared —
// nothing is ever sent without their review.
export default function WhatsAppShareModal({ title = 'Share Report', initialMessage, onClose }) {
  const [message, setMessage] = useState(initialMessage ?? '')

  useEffect(() => { setMessage(initialMessage ?? '') }, [initialMessage])

  const handleShare = () => {
    shareToWhatsApp({ message })
    onClose?.()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] flex flex-col bg-[var(--surface)] rounded-3xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <p className="text-sm font-bold text-primary-token">{title}</p>
          <button onClick={onClose} className="p-1.5 rounded-xl text-muted-token hover:text-secondary-token hover:bg-[var(--surface-muted)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <p className="text-xs text-muted-token">
            Edit the message below — add remarks, fix a value, or change the wording — before sharing.
          </p>
          <textarea
            rows={14}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full px-3 py-3 rounded-2xl border border-[var(--border-color)] bg-[var(--surface-muted)] text-sm text-primary-token font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-saffron-300"
          />
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-[var(--border-color)]">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button icon={Send} onClick={handleShare} className="flex-1">Share on WhatsApp</Button>
        </div>
      </div>
    </div>
  )
}
