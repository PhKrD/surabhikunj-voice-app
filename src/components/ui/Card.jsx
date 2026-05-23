import { cn } from '@/lib/utils'

export default function Card({ children, className, ...props }) {
  return (
    <div
      className={cn(
        'bg-white rounded-2xl border border-slate-100 shadow-sm',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className }) {
  return (
    <div className={cn('px-5 pt-5 pb-3', className)}>
      {children}
    </div>
  )
}

export function CardBody({ children, className }) {
  return (
    <div className={cn('px-5 pb-5', className)}>
      {children}
    </div>
  )
}
