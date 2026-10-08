import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import useToastStore from '@/store/toastStore'
import { cn } from '@/lib/utils'

const variantMap = {
  success: { icon: CheckCircle2, chip: 'bg-[var(--color-success-soft)] text-[var(--color-success)]' },
  error: { icon: AlertCircle, chip: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]' },
  info: { icon: Info, chip: 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]' },
}

function ToastItem({ toast }) {
  const removeToast = useToastStore((s) => s.removeToast)
  const variant = variantMap[toast.variant] ?? variantMap.info
  const Icon = variant.icon

  const handleAction = async () => {
    if (typeof toast.action === 'function') await toast.action()
    removeToast(toast.id)
  }

  useEffect(() => {
    // Errors stay a little longer: they usually need reading.
    const ms = toast.duration ?? (toast.variant === 'error' ? 5000 : 3200)
    const id = setTimeout(() => removeToast(toast.id), ms)
    return () => clearTimeout(id)
  }, [toast.id, toast.duration, toast.variant, removeToast])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.18 }}
      role={toast.variant === 'error' ? 'alert' : 'status'}
      className="w-[min(24rem,calc(100vw-2rem))] rounded-[var(--radius-lg)] bg-[var(--surface-elevated)] border border-[var(--border-color)] shadow-[var(--shadow-3)] p-3"
    >
      <div className="flex items-start gap-3">
        <div className={cn('w-9 h-9 rounded-[var(--radius-sm)] flex items-center justify-center flex-shrink-0', variant.chip)}>
          <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-sm font-semibold text-primary-token">{toast.title}</p>
          {toast.description ? <p className="text-caption mt-0.5">{toast.description}</p> : null}
          {toast.actionLabel ? (
            <button onClick={handleAction} className="mt-1.5 text-sm font-semibold text-[var(--color-primary)]">
              {toast.actionLabel}
            </button>
          ) : null}
        </div>
        <button
          onClick={() => removeToast(toast.id)}
          className="-mr-1 -mt-1 w-8 h-8 flex items-center justify-center rounded-full text-muted-token hover:bg-[var(--surface-muted)]"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  )
}

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  return (
    <div
      className="fixed inset-x-0 top-0 z-[100] flex flex-col items-center sm:items-end gap-2 px-4 pointer-events-none"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
      aria-live="polite"
    >
      <AnimatePresence>
        {toasts.slice(-3).map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <ToastItem toast={toast} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  )
}
