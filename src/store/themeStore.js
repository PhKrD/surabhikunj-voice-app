import { create } from 'zustand'

const STORAGE_KEY = 'voice.theme'

function apply(isDark) {
  const root = document.documentElement
  root.classList.toggle('dark', isDark)
}

function resolveInitial() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') return saved === 'dark'
  } catch { /* private browsing / SSR */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

const useThemeStore = create((set, get) => ({
  isDark: false,
  initialized: false,

  init: () => {
    if (get().initialized) return
    const isDark = resolveInitial()
    apply(isDark)
    set({ isDark, initialized: true })
  },

  toggle: () => {
    const isDark = !get().isDark
    apply(isDark)
    try {
      localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light')
    } catch { /* quota / private browsing */ }
    set({ isDark })
  },
}))

export default useThemeStore
