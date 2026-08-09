import { registerPlugin } from '@capacitor/core'

export type CloudAuthProvider = 'quark' | 'baidu' | 'aliyun' | 'bilibili'

interface CloudAuthApi {
  login(options: { provider: CloudAuthProvider }): Promise<{ credential: string; credentialType: 'cookie' | 'refresh_token' }>
}

export const CloudAuth = registerPlugin<CloudAuthApi>('CloudAuth')
