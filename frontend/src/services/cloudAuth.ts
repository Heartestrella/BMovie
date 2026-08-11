import { registerPlugin } from '@capacitor/core'

export type CloudAuthProvider = 'quark' | 'baidu' | 'aliyun' | 'cmcc' | 'bilibili' | 'netease'

interface CloudAuthApi {
  login(options: { provider: CloudAuthProvider }): Promise<{ credential: string; credentialType: 'cookie' | 'refresh_token' | 'authorization' }>
  restore(options: { provider: CloudAuthProvider }): Promise<{ credential: string; credentialType: 'cookie' | 'refresh_token' | 'authorization' }>
}

export const CloudAuth = registerPlugin<CloudAuthApi>('CloudAuth')
