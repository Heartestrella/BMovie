import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { NativeSubtitle } from '../services/nativePlayer'

export type OfflineCacheStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed'

export interface OfflineCacheEntry {
  id: string
  sourcePath: string
  title: string
  fileName: string
  poster?: string
  createdAt: number
  status: OfflineCacheStatus
  downloaded: number
  total: number
  size: number
  uri?: string
  internalUri?: string
  error?: string
  subtitles: Array<NativeSubtitle & { internalUrl?: string }>
}

export interface OfflineSubtitleRequest extends NativeSubtitle {
  fileName: string
}

export interface OfflineCacheStartOptions {
  id: string
  url: string
  sourcePath: string
  title: string
  fileName: string
  poster?: string
  expectedSize: number
  subtitles: OfflineSubtitleRequest[]
}

interface OfflineCachePlugin {
  start(options: OfflineCacheStartOptions): Promise<OfflineCacheEntry>
  list(): Promise<{ items: OfflineCacheEntry[] }>
  remove(options: { id: string }): Promise<void>
}

const NativeOfflineCache = registerPlugin<OfflineCachePlugin>('OfflineCache')

export const useOfflineCacheStore = defineStore('offline-cache', () => {
  const entries = ref<OfflineCacheEntry[]>([])
  const loaded = ref(false)
  const refreshing = ref(false)
  const totalSize = computed(() => entries.value.reduce((sum, entry) => sum + (entry.size || entry.downloaded || 0), 0))
  const activeCount = computed(() => entries.value.filter((entry) => ['queued', 'downloading', 'paused'].includes(entry.status)).length)
  const completedCount = computed(() => entries.value.filter((entry) => entry.status === 'completed').length)
  let loadRequest: Promise<void> | undefined

  async function load() {
    if (loaded.value) return
    if (!loadRequest) loadRequest = refresh().finally(() => { loadRequest = undefined })
    await loadRequest
  }

  async function refresh() {
    if (!Capacitor.isNativePlatform()) {
      entries.value = []
      loaded.value = true
      return
    }
    refreshing.value = true
    try {
      const result = await NativeOfflineCache.list()
      entries.value = [...result.items].sort((a, b) => b.createdAt - a.createdAt)
      loaded.value = true
    } finally {
      refreshing.value = false
    }
  }

  async function start(options: OfflineCacheStartOptions) {
    if (!Capacitor.isNativePlatform()) throw new Error('离线缓存目前仅支持 Android 应用')
    const entry = await NativeOfflineCache.start(options)
    upsert(entry)
    return entry
  }

  async function remove(id: string) {
    if (!Capacitor.isNativePlatform()) return
    await NativeOfflineCache.remove({ id })
    entries.value = entries.value.filter((entry) => entry.id !== id)
  }

  function entryForPath(path: string) {
    return entries.value.find((entry) => entry.sourcePath === path)
  }

  function upsert(entry: OfflineCacheEntry) {
    const index = entries.value.findIndex((item) => item.id === entry.id)
    if (index >= 0) entries.value[index] = entry
    else entries.value.unshift(entry)
  }

  return { entries, loaded, refreshing, totalSize, activeCount, completedCount, load, refresh, start, remove, entryForPath }
})

export function offlineCacheId(path: string) {
  let hash = 2166136261
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `media-${(hash >>> 0).toString(36)}`
}
