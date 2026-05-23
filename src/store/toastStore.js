import { create } from 'zustand'

const DEFAULT_DURATION = 3200

const useToastStore = create((set) => ({
  toasts: [],

  addToast: ({
    title,
    description = '',
    variant = 'info',
    duration = DEFAULT_DURATION,
    actionLabel,
    action,
  }) => {
    const id = crypto.randomUUID()
    set((state) => ({
      toasts: [...state.toasts, { id, title, description, variant, duration, actionLabel, action }],
    }))
    return id
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }))
  },

  success: (title, description = '', opts = {}) => {
    set((state) => ({
      toasts: [
        ...state.toasts,
        {
          id: crypto.randomUUID(),
          title,
          description,
          variant: 'success',
          duration: opts.duration ?? DEFAULT_DURATION,
          actionLabel: opts.actionLabel,
          action: opts.action,
        },
      ],
    }))
  },

  error: (title, description = '', opts = {}) => {
    set((state) => ({
      toasts: [
        ...state.toasts,
        {
          id: crypto.randomUUID(),
          title,
          description,
          variant: 'error',
          duration: opts.duration ?? DEFAULT_DURATION,
          actionLabel: opts.actionLabel,
          action: opts.action,
        },
      ],
    }))
  },

  info: (title, description = '', opts = {}) => {
    set((state) => ({
      toasts: [
        ...state.toasts,
        {
          id: crypto.randomUUID(),
          title,
          description,
          variant: 'info',
          duration: opts.duration ?? DEFAULT_DURATION,
          actionLabel: opts.actionLabel,
          action: opts.action,
        },
      ],
    }))
  },
}))

export default useToastStore
