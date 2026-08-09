import localforage from 'localforage'

export type PlayerMode = 'internal' | 'external'

export interface PlayerSettings {
  defaultMode: PlayerMode
  autoDanmaku: boolean
}

const STORAGE_KEY = 'bmovie-player-settings'
const defaults: PlayerSettings = { defaultMode: 'internal', autoDanmaku: false }

export async function loadPlayerSettings(): Promise<PlayerSettings> {
  const stored = await localforage.getItem<Partial<PlayerSettings>>(STORAGE_KEY)
  return {
    ...defaults,
    ...stored,
    defaultMode: stored?.defaultMode === 'external' ? 'external' : 'internal',
    autoDanmaku: stored?.autoDanmaku === true,
  }
}

export async function savePlayerSettings(settings: Partial<PlayerSettings>) {
  const current = await loadPlayerSettings()
  await localforage.setItem(STORAGE_KEY, { ...current, ...settings })
}
