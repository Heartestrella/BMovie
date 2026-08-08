import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import localforage from 'localforage'

export interface LibrarySource {
  path: string
  enabled: boolean
}

const STORAGE_KEY = 'bmovie-library-sources'
const RESCAN_KEY = 'bmovie-library-needs-rescan'

export const useLibrarySourcesStore = defineStore('library-sources', () => {
  const sources = ref<LibrarySource[]>([])
  const loaded = ref(false)
  const needsRescan = ref(false)
  const enabledSources = computed(() => sources.value.filter((source) => source.enabled))

  async function load() {
    if (loaded.value) return
    sources.value = (await localforage.getItem<LibrarySource[]>(STORAGE_KEY)) ?? []
    needsRescan.value = (await localforage.getItem<boolean>(RESCAN_KEY)) ?? false
    loaded.value = true
  }

  async function save() {
    await localforage.setItem(STORAGE_KEY, JSON.parse(JSON.stringify(sources.value)))
  }

  async function markDirty() {
    needsRescan.value = true
    await localforage.setItem(RESCAN_KEY, true)
  }

  async function markScanned() {
    needsRescan.value = false
    await localforage.setItem(RESCAN_KEY, false)
  }

  async function add(path: string) {
    const normalized = normalizePath(path)
    if (!normalized || normalized === '/' || sources.value.some((source) => source.path === normalized)) return false
    sources.value.push({ path: normalized, enabled: true })
    await save()
    await markDirty()
    return true
  }

  async function remove(path: string) {
    sources.value = sources.value.filter((source) => source.path !== path)
    await save()
    await markDirty()
  }

  async function toggle(path: string) {
    const source = sources.value.find((entry) => entry.path === path)
    if (source) source.enabled = !source.enabled
    await save()
    await markDirty()
  }

  return { sources, enabledSources, loaded, needsRescan, load, add, remove, toggle, markDirty, markScanned }
})

function normalizePath(path: string) {
  const cleaned = `/${path}`.replace(/\/{2,}/g, '/').replace(/\/$/, '')
  return cleaned || '/'
}
