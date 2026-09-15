import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, FileSpreadsheet, FileText, FileType, Check } from 'lucide-react'
import Button from '@/components/ui/Button'
import useToastStore from '@/store/toastStore'
import { cn } from '@/lib/utils'
import { buildExport } from '@/lib/trackerExport'
import { shareFile, deliveryMessage } from '@/lib/fileShare'
import { tap, success as hapticSuccess, error as hapticError } from '@/lib/haptics'

const FORMATS = [
  { key: 'xlsx', label: 'Excel', hint: '.xlsx spreadsheet', icon: FileSpreadsheet, tone: 'text-tulasi-600' },
  { key: 'pdf', label: 'PDF', hint: 'Print-ready document', icon: FileType, tone: 'text-red-500' },
  { key: 'csv', label: 'CSV', hint: 'Plain data', icon: FileText, tone: 'text-blue-500' },
]

/**
 * Export dropdown for a Sadhana sheet.
 *
 * @param {() => Promise<object>|object} getExportData  Resolves to
 *   { sections, title, rangeLabel, includeSummary }. Called on demand so
 *   the (potentially expensive) data fetch only happens on an actual tap.
 */
export default function ExportMenu({
  getExportData,
  label = 'Export',
  disabled = false,
  size = 'sm',
  variant = 'secondary',
  align = 'right',
  className,
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(null)
  const [done, setDone] = useState(null)
  const wrapRef = useRef(null)
  const toastSuccess = useToastStore((s) => s.success)
  const toastError = useToastStore((s) => s.error)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const run = async (fmt) => {
    if (busy) return
    setBusy(fmt)
    try {
      const payload = await getExportData()
      if (!payload?.sections?.length) {
        toastError('Nothing to export', 'There is no Sadhana data in this range yet.')
        hapticError()
        return
      }
      const { blob, filename, mime } = await buildExport({ ...payload, format: fmt })
      const result = await shareFile({ blob, filename, mime, title: payload.title })
      if (result !== 'cancelled') {
        setDone(fmt)
        setTimeout(() => setDone(null), 1800)
        hapticSuccess()
        toastSuccess('Export ready', deliveryMessage(result, filename))
      }
      setOpen(false)
    } catch (e) {
      hapticError()
      toastError('Export failed', e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <Button
        size={size}
        variant={variant}
        icon={done ? Check : Download}
        loading={!!busy}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className={cn(
              'absolute z-40 mt-2 w-60 origin-top rounded-2xl border border-[var(--border-color)]',
              'bg-[var(--surface)] shadow-xl overflow-hidden p-1.5',
              align === 'right' ? 'right-0' : 'left-0'
            )}
          >
            {FORMATS.map((f, i) => (
              <motion.button
                key={f.key}
                role="menuitem"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.035 }}
                onClick={() => { tap(); run(f.key) }}
                disabled={!!busy}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left',
                  'transition-colors hover:bg-[var(--surface-muted)] disabled:opacity-50',
                  'active:scale-[0.98]'
                )}
              >
                <f.icon className={cn('w-5 h-5 flex-shrink-0', f.tone)} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-primary-token">{f.label}</span>
                  <span className="block text-[11px] text-muted-token">{f.hint}</span>
                </span>
                {busy === f.key && (
                  <motion.span
                    className="w-1.5 h-1.5 rounded-full bg-saffron-500"
                    animate={{ scale: [1, 1.6, 1] }}
                    transition={{ repeat: Infinity, duration: 0.9 }}
                  />
                )}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
