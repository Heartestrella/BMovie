import { registerPlugin } from '@capacitor/core'

export type OfflineProvider = 'quark' | 'baidu'

export interface OfflineDispatchResult {
  mode: 'dispatched' | 'clipboard'
  message: string
}

interface CloudOfflineApi {
  sendMagnet(options: { provider: OfflineProvider; magnet: string }): Promise<OfflineDispatchResult>
  pickTorrent(options: { provider: OfflineProvider }): Promise<OfflineDispatchResult>
}

export const CloudOffline = registerPlugin<CloudOfflineApi>('CloudOffline')
