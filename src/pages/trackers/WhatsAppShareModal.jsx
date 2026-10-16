import { useState, useEffect } from 'react'
import { Send } from 'lucide-react'
import Button from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
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
    <Dialog
      open
      onClose={onClose}
      title={title}
      description="Edit the message — add remarks, fix a value, or change the wording — before sharing."
      className="sm:max-w-lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} className="w-full sm:w-auto">Cancel</Button>
          <Button icon={Send} onClick={handleShare} className="w-full sm:w-auto">Share on WhatsApp</Button>
        </>
      }
    >
      <textarea
        rows={14}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        aria-label="Message"
        className="w-full font-mono text-sm leading-relaxed"
      />
    </Dialog>
  )
}
