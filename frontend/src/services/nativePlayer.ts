import { registerPlugin } from '@capacitor/core'

interface NativePlaybackOptions {
  url: string
  title: string
  position?: number
  subtitles?: NativeSubtitle[]
}

export interface NativeSubtitle {
  url: string
  label: string
  language?: string
  mimeType: string
}

interface NativePlaybackResult {
  position: number
  duration: number
}

interface NativePlayerPlugin {
  play(options: NativePlaybackOptions): Promise<NativePlaybackResult>
  playExternal(options: NativePlaybackOptions): Promise<void>
}

export const NativePlayer = registerPlugin<NativePlayerPlugin>('NativePlayer')
