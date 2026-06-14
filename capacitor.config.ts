import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.surabhikunj.voice',
  appName: 'SurabhiKunj VOICE',
  webDir: 'dist',
  plugins: {
    CapacitorUpdater: {
      // Self-hosted manual mode: we control download/apply from JS using
      // bundles hosted on Supabase Storage. No paid Capgo cloud needed.
      autoUpdate: false,
    },
  },
}

export default config
