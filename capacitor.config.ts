import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.bmovie.app',
  appName: 'BMovie',
  webDir: 'frontend/dist',
  server: {
    allowNavigation: ['127.0.0.1'],
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
}

export default config
