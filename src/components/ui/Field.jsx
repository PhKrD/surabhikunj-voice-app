import { forwardRef, useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Label + control + hint/error, with the accessibility wiring done once:
 * the control gets aria-invalid and aria-describedby automatically.
 */
export function FormField({ label, hint, error, required, htmlFor, className, children }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-sm font-semibold text-primary-token">
          {label}
          {required && <span className="text-[var(--color-danger)] ml-0.5" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${htmlFor}-msg`} role="alert" className="text-[0.8125rem] font-medium text-[var(--color-danger)]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-msg`} className="text-[0.8125rem] text-muted-token">{hint}</p>
      ) : null}
    </div>
  )
}

/**
 * The standard text input. `icon` renders inside on the left; type="password"
 * gets a show/hide toggle automatically.
 */
export const AppInput = forwardRef(function AppInput(
  { label, hint, error, required, icon: Icon, type = 'text', className, containerClassName, id, ...props },
  ref,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  const [revealed, setRevealed] = useState(false)
  const isPassword = type === 'password'

  return (
    <FormField label={label} hint={hint} error={error} required={required} htmlFor={inputId} className={containerClassName}>
      <div className="relative">
        {Icon && (
          <Icon
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-muted-token pointer-events-none"
            aria-hidden="true"
          />
        )}
        <input
          ref={ref}
          id={inputId}
          type={isPassword && revealed ? 'text' : type}
          required={required}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error || hint ? `${inputId}-msg` : undefined}
          className={cn(Icon && '!pl-11', isPassword && '!pr-12', className)}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-[var(--radius-sm)] text-muted-token hover:text-primary-token"
            aria-label={revealed ? 'Hide password' : 'Show password'}
          >
            {revealed ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
          </button>
        )}
      </div>
    </FormField>
  )
})

export const AppTextarea = forwardRef(function AppTextarea(
  { label, hint, error, required, className, containerClassName, id, ...props },
  ref,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <FormField label={label} hint={hint} error={error} required={required} htmlFor={inputId} className={containerClassName}>
      <textarea
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error || hint ? `${inputId}-msg` : undefined}
        className={className}
        {...props}
      />
    </FormField>
  )
})

export const AppSelect = forwardRef(function AppSelect(
  { label, hint, error, required, className, containerClassName, id, children, ...props },
  ref,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <FormField label={label} hint={hint} error={error} required={required} htmlFor={inputId} className={containerClassName}>
      <select
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error || hint ? `${inputId}-msg` : undefined}
        className={className}
        {...props}
      >
        {children}
      </select>
    </FormField>
  )
})
