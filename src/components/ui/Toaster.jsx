import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import useToastStore from '@/store/toastStore'
import { cn } from '@/lib/utils'

const variantMap = {
  success: {
    icon: CheckCircle2,
    card: 'border-tulasi-200 bg-tulasi-50',
    iconWrap: 'bg-tulasi-100 text-tulasi-700',
    title: 'text-tulasi-900',
    desc: 'text-tulasi-700',
  },
  error: {
    icon: AlertCircle,
    card: 'border-red-200 bg-red-50',
    iconWrap: 'bg-red-100 text-red-700',
    title: 'text-red-900',
    desc: 'text-red-700',
  },
  info: {
    icon: Info,
    card: 'border-slate-200 bg-white',
    iconWrap: 'bg-slate-100 text-slate-700',
    title: 'text-slate-900',
    desc: 'text-slate-600',
  },
}

function ToastItem({ toast }) {
  const removeToast = useToastStore((s) => s.removeToast)
  const variant = variantMap[toast.variant] ?? variantMap.info
  const Icon = variant.icon

  const handleAction = async () => {
    if (typeof toast.action === 'function') {
      await toast.action()
    }
    removeToast(toast.id)
  }

  useEffect(() => {
    const id = setTimeout(() => {
      removeToast(toast.id)
    }, toast.duration ?? 3200)
    return () => clearTimeout(id)
  }, [toast.id, toast.duration, removeToast])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.18 }}
      className={cn('w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl border shadow-lg p-3', variant.card)}
    >
      <div className="flex items-start gap-2.5">
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', variant.iconWrap)}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn('text-sm font-semibold', variant.title)}>{toast.title}</p>
          {toast.description ? (
            <p className={cn('text-xs mt-0.5 leading-relaxed', variant.desc)}>{toast.description}</p>
          ) : null}
          {toast.actionLabel ? (
            <button
              onClick={handleAction}
              className="mt-1.5 text-xs font-semibold text-saffron-700 hover:text-saffron-800"
            >
              {toast.actionLabel}
            </button>
          ) : null}
        </div>
        <button
          onClick={() => removeToast(toast.id)}
          className="p-1 rounded-md text-slate-400 hover:text-slate-600"
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
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <ToastItem toast={toast} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  )
}
