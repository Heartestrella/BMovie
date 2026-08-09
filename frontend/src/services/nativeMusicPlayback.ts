import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface NativeMusicTrack {
  id: string
  url: string
  title: string
  artist: string
  album: string
  artwork: string
}

export interface NativeMusicState {
  playing: boolean
  index: number
  position: number
  duration: number
  mediaId: string
}

interface NativeMusicPlaybackApi {
  setQueue(options: { tracks: NativeMusicTrack[]; index: number; position: number; autoplay: boolean }): Promise<NativeMusicState>
  play(): Promise<void>
  pause(): Promise<void>
  previous(): Promise<void>
  next(): Promise<void>
  seek(options: { position: number }): Promise<void>
  getState(): Promise<NativeMusicState>
  addListener(eventName: 'stateChanged', listener: (state: NativeMusicState) => void): Promise<PluginListenerHandle>
}

export const NativeMusicPlayback = registerPlugin<NativeMusicPlaybackApi>('MusicPlayback')
