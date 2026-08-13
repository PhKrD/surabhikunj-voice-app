import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.surabhikunj.voice',
  appName: 'VOICE',
  webDir: 'dist',
  plugins: {
    CapacitorUpdater: {
      // Self-hosted manual mode: we control download/apply from JS using
      // bundles hosted on Supabase Storage. No paid Capgo cloud needed.
      autoUpdate: false,
    },
    PushNotifications: {
      // Show heads-up notification with sound/badge when received in foreground.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
}

export default config
