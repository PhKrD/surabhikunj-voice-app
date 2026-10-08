// Debug output is for development only. Warnings and errors always go
// through, because the WebView console is what `adb logcat` shows when
// diagnosing a device in the field.
//
// `import.meta.env?.` because some modules are also loaded by node --test,
// where import.meta.env does not exist.
const DEV = Boolean(import.meta.env?.DEV)

export const logger = {
  debug: (...args) => {
    if (DEV) console.log(...args)
  },
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
}
