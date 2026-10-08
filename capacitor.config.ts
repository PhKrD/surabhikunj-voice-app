import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.surabhikunj.voice',
  appName: 'VOICE',
  webDir: 'dist',
  plugins: {
    CapacitorUpdater: {
      // Self-hosted manual mode: download/apply is controlled from JS
      // (src/lib/liveUpdate.js) using bundles on Supabase Storage.
      autoUpdate: false,
      // If a new bundle never reaches its first render (and so never calls
      // notifyAppReady), roll back to the previous bundle after this long.
      appReadyTimeout: 15000,
    },
    SplashScreen: {
      // Hidden by the app as soon as the first screen renders; the auto-hide
      // is only a safety net so a failed start never leaves it up forever.
      launchShowDuration: 4000,
      launchAutoHide: true,
      backgroundColor: '#6845e0',
      showSpinner: false,
    },
    PushNotifications: {
      // Show heads-up notification with sound/badge when received in foreground.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
}

export default config
