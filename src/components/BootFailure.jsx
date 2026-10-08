// Shown only if the app code itself cannot load (e.g. a corrupted update).
// Reloading lets the native updater fall back to the last good bundle.
export default function BootFailure() {
  return (
    <div className="min-h-svh flex items-center justify-center p-6 bg-[var(--surface-app)]">
      <div className="max-w-sm text-center space-y-4">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">The app couldn&apos;t start</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Please check your internet connection and try again.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="h-12 px-6 rounded-2xl bg-[var(--color-primary)] text-white font-semibold"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
