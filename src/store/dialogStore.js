import { create } from 'zustand'

// Promise-based confirmation dialog, replacing window.confirm(): the native
// one looks out of place in the app and cannot be styled or made
// destructive-red. Usage:
//
//   if (!(await confirm({ title: 'Delete event?', danger: true }))) return
//
// One dialog at a time; a second request while one is open replaces it and
// the first resolves as cancelled.
const useDialogStore = create((set, get) => ({
  request: null,

  open: (options) =>
    new Promise((resolve) => {
      get().request?.resolve(false)
      set({ request: { ...options, resolve } })
    }),

  close: (result) => {
    const { request } = get()
    if (!request) return
    request.resolve(result)
    set({ request: null })
  },
}))

/**
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.message]
 * @param {string} [options.confirmLabel]  default "Confirm" ("Delete" when danger)
 * @param {string} [options.cancelLabel]   default "Cancel"
 * @param {boolean} [options.danger]       red confirm button for destructive actions
 * @returns {Promise<boolean>}
 */
export function confirm(options) {
  return useDialogStore.getState().open(typeof options === 'string' ? { title: options } : options)
}

export default useDialogStore
