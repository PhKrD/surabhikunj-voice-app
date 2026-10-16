import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import useDialogStore from '@/store/dialogStore'
import { registerBackHandler } from '@/lib/backButton'
import Button from './Button'

// Open dialogs, oldest first. Escape only closes the top-most one, so a
// picker opened from inside another dialog doesn't take its parent with it.
const openStack = []

/**
 * Modal surface: a bottom sheet on phones, a centred dialog on wider
 * screens. Closes on Escape, on the backdrop, and on the Android back button.
 *
 * Rendered into document.body: a `position: fixed` element inside a
 * transformed ancestor (page transitions, other dialogs) is positioned
 * relative to that ancestor instead of the viewport.
 */
export function Dialog({ open, onClose, title, description, children, footer, className, bodyClassName, dismissible = true }) {
  const panelRef = useRef(null)
  // Callers usually pass an inline onClose. Keeping it in a ref stops the
  // open effect from re-running on every parent render — which used to move
  // focus out of whatever input the user was typing in.
  const onCloseRef = useRef(onClose)
  const dismissibleRef = useRef(dismissible)
  useEffect(() => {
    onCloseRef.current = onClose
    dismissibleRef.current = dismissible
  })

  useEffect(() => {
    if (!open) return undefined
    const token = {}
    openStack.push(token)
    const previouslyFocused = document.activeElement
    // Leave focus alone if a child (e.g. an autoFocus search box) already took it.
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus()
    const close = () => { if (dismissibleRef.current) onCloseRef.current?.() }
    const onKey = (e) => {
      if (e.key === 'Escape' && openStack[openStack.length - 1] === token) close()
    }
    document.addEventListener('keydown', onKey)
    const unregisterBack = registerBackHandler(() => { close(); return true })
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      unregisterBack()
      openStack.splice(openStack.indexOf(token), 1)
      if (openStack.length === 0) document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [open])

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center sm:p-4">
          <motion.div
            className="absolute inset-0 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={dismissible ? onClose : undefined}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            tabIndex={-1}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 380 }}
            className={cn(
              'relative w-full sm:max-w-md max-h-[90svh] flex flex-col outline-none',
              'bg-[var(--surface-elevated)] shadow-[var(--shadow-4)]',
              'rounded-t-[var(--radius-xl)] sm:rounded-[var(--radius-xl)]',
              className,
            )}
          >
            {/* Grab handle: signals "swipe/tap away" on phones. */}
            <div className="sm:hidden mx-auto mt-2.5 h-1 w-10 rounded-full bg-[var(--border-strong)]" aria-hidden="true" />
            {(title || dismissible) && (
              <div className="flex items-start justify-between gap-3 px-5 pt-4 sm:pt-5">
                <div className="min-w-0">
                  {title && <h2 className="text-title text-primary-token">{title}</h2>}
                  {description && <p className="text-caption mt-1">{description}</p>}
                </div>
                {dismissible && (
                  <button
                    onClick={onClose}
                    className="-mr-2 -mt-1 w-10 h-10 flex items-center justify-center rounded-full text-muted-token hover:bg-[var(--surface-muted)]"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            )}
            <div
              className={cn('px-5 py-4 overflow-y-auto overscroll-contain', bodyClassName)}
              style={footer ? undefined : { paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
            >
              {children}
            </div>
            {footer && (
              <div className="px-5 pt-1 pb-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2" style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}>
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** Renders whatever confirm() (src/store/dialogStore.js) has requested. Mount once. */
export function ConfirmDialogHost() {
  const request = useDialogStore((s) => s.request)
  const close = useDialogStore((s) => s.close)
  const danger = Boolean(request?.danger)

  return (
    <Dialog
      open={Boolean(request)}
      onClose={() => close(false)}
      title={
        request && (
          <span className="flex items-center gap-3">
            {danger && (
              <span className="w-10 h-10 rounded-full bg-[var(--color-danger-soft)] flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-[var(--color-danger)]" aria-hidden="true" />
              </span>
            )}
            {request.title}
          </span>
        )
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} className="w-full sm:w-auto">
            {request?.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => close(true)}
            className="w-full sm:w-auto"
            autoFocus
          >
            {request?.confirmLabel ?? (danger ? 'Delete' : 'Confirm')}
          </Button>
        </>
      }
    >
      {request?.message && <p className="text-body text-secondary-token">{request.message}</p>}
    </Dialog>
  )
}
