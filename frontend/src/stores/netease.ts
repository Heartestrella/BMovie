import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { Capacitor, registerPlugin } from '@capacitor/core'
import localforage from 'localforage'
import { CloudAuth } from '../services/cloudAuth'

interface NativeHttpResult { status: number; body: string }
interface NativeHttpApi { request(options: { url: string; method?: string; headers?: Record<string, string> }): Promise<NativeHttpResult> }
const NativeHttp = registerPlugin<NativeHttpApi>('NativeHttp')
const ACCOUNT_KEY = 'bmovie-netease-account-v1'
const PLAYLIST_KEY = 'bmovie-netease-playlists-v1'
const IMPORT_KEY = 'bmovie-netease-imported-v1'
const BACKUP_KEY = 'bmovie-netease-state-backup-v1'

export interface NeteaseAccount { userId: number; nickname: string; avatarUrl?: string; cookie: string; syncedAt: number }
export interface NeteasePlaylist { id: number; name: string; coverImgUrl?: string; trackCount: number; creator?: string; updatedAt?: number }
export interface NeteaseTrack { id: number; name: string; artists: string[]; album: string; duration: number; artwork?: string }
export interface ImportedNeteasePlaylist extends NeteasePlaylist { tracks: NeteaseTrack[]; importedAt: number }

export const useNeteaseStore = defineStore('netease', () => {
  const account = ref<NeteaseAccount | null>(null)
  const playlists = ref<NeteasePlaylist[]>([])
  const imported = ref<ImportedNeteasePlaylist[]>([])
  const loaded = ref(false)
  let loadRequest: Promise<void> | undefined
  let persistRequest: Promise<void> = Promise.resolve()
  const connected = computed(() => Boolean(account.value?.cookie))

  async function load() {
    if (loaded.value) return
    if (!loadRequest) loadRequest = (async () => {
      const backup = readBackup()
      const [savedAccount, savedPlaylists, savedImported] = await Promise.all([
        localforage.getItem<NeteaseAccount>(ACCOUNT_KEY),
        localforage.getItem<NeteasePlaylist[]>(PLAYLIST_KEY),
        localforage.getItem<ImportedNeteasePlaylist[]>(IMPORT_KEY),
      ])
      account.value = savedAccount ?? backup?.account ?? null
      playlists.value = savedPlaylists ?? backup?.playlists ?? []
      imported.value = savedImported ?? backup?.imported ?? []
      if (!account.value?.cookie && Capacitor.getPlatform() === 'android') {
        try {
          const restored = await CloudAuth.restore({ provider: 'netease' })
          const profile = await accountFromCookie(restored.credential)
          account.value = profile
        } catch { /* The user can bind again if the WebView cookie has expired. */ }
      }
      await persistState()
      loaded.value = true
    })()
    try { await loadRequest } finally { loadRequest = undefined }
  }

  async function login() {
    await load()
    if (Capacitor.getPlatform() !== 'android') throw new Error('网易云账号绑定目前仅支持安卓版')
    const result = await CloudAuth.login({ provider: 'netease' })
    account.value = await accountFromCookie(result.credential)
    await persistState()
    await syncPlaylists()
  }

  async function syncPlaylists() {
    await load()
    if (!account.value) throw new Error('请先绑定网易云音乐账号')
    const data = await request<{ playlist?: Array<{ id: number; name: string; coverImgUrl?: string; trackCount?: number; creator?: { nickname?: string }; updateTime?: number }> }>(`https://music.163.com/api/user/playlist/?uid=${account.value.userId}&offset=0&limit=1000`, account.value.cookie)
    playlists.value = (data.playlist ?? []).map((item) => ({ id: item.id, name: item.name, coverImgUrl: item.coverImgUrl, trackCount: item.trackCount ?? 0, creator: item.creator?.nickname, updatedAt: item.updateTime }))
    account.value.syncedAt = Date.now()
    await persistState()
  }

  async function importPlaylist(item: NeteasePlaylist) {
    await load()
    if (!account.value) throw new Error('请先绑定网易云音乐账号')
    const data = await request<{ playlist?: { tracks?: Array<{ id: number; name: string; dt?: number; duration?: number; ar?: Array<{ name: string }>; artists?: Array<{ name: string }>; al?: { name?: string; picUrl?: string }; album?: { name?: string; picUrl?: string } }> } }>(`https://music.163.com/api/v6/playlist/detail?id=${item.id}&n=100000&s=8`, account.value.cookie)
    const tracks = (data.playlist?.tracks ?? []).map((track) => ({
      id: track.id,
      name: track.name,
      artists: (track.ar ?? track.artists ?? []).map((artist) => artist.name).filter(Boolean),
      album: track.al?.name ?? track.album?.name ?? '',
      duration: (track.dt ?? track.duration ?? 0) / 1000,
      artwork: track.al?.picUrl ?? track.album?.picUrl,
    }))
    const snapshot: ImportedNeteasePlaylist = { ...item, trackCount: tracks.length || item.trackCount, tracks, importedAt: Date.now() }
    imported.value = [snapshot, ...imported.value.filter((entry) => entry.id !== item.id)]
    await persistState()
    return snapshot
  }

  async function removeImport(id: number) {
    await load()
    imported.value = imported.value.filter((item) => item.id !== id)
    await persistState()
  }

  async function searchSongs(keyword: string) {
    const query = keyword.trim()
    if (!query) return []
    const data = await request<{ result?: { songs?: Array<{ id: number; name: string; duration?: number; artists?: Array<{ name: string }>; album?: { name?: string; picUrl?: string } }> } }>(`https://music.163.com/api/search/get/web?s=${encodeURIComponent(query)}&type=1&offset=0&limit=30`, account.value?.cookie)
    return (data.result?.songs ?? []).map((track) => ({ id: track.id, name: track.name, artists: (track.artists ?? []).map((artist) => artist.name), album: track.album?.name ?? '', duration: (track.duration ?? 0) / 1000, artwork: track.album?.picUrl })) as NeteaseTrack[]
  }

  async function playbackUrls(ids: number[]) {
    if (!account.value) throw new Error('请先绑定网易云音乐账号')
    const unique = [...new Set(ids)].slice(0, 200)
    if (!unique.length) return new Map<number, string>()
    const data = await request<{ data?: Array<{ id: number; url?: string | null; code?: number; fee?: number }> }>(`https://music.163.com/api/song/enhance/player/url?ids=${encodeURIComponent(JSON.stringify(unique))}&br=320000`, account.value.cookie)
    return new Map((data.data ?? []).filter((item): item is { id: number; url: string } => Boolean(item.url)).map((item) => [item.id, item.url.replace(/^http:\/\//, 'https://')]))
  }

  async function logout() {
    account.value = null
    playlists.value = []
    await persistState()
  }

  function persistState() {
    persistRequest = persistRequest.catch(() => undefined).then(async () => {
      const snapshot = {
        account: account.value ? { ...account.value } : null,
        playlists: playlists.value.map((item) => ({ ...item })),
        imported: imported.value.map((item) => ({ ...item, tracks: item.tracks.map((track) => ({ ...track, artists: [...track.artists] })) })),
      }
      await Promise.all([
        snapshot.account ? localforage.setItem(ACCOUNT_KEY, snapshot.account) : localforage.removeItem(ACCOUNT_KEY),
        localforage.setItem(PLAYLIST_KEY, snapshot.playlists),
        localforage.setItem(IMPORT_KEY, snapshot.imported),
      ])
      try { localStorage.setItem(BACKUP_KEY, JSON.stringify(snapshot)) }
      catch { /* IndexedDB remains the primary store when a very large playlist exceeds localStorage. */ }
    })
    return persistRequest
  }

  return { account, playlists, imported, connected, loaded, load, login, syncPlaylists, importPlaylist, removeImport, searchSongs, playbackUrls, logout }
})

function readBackup(): { account?: NeteaseAccount; playlists?: NeteasePlaylist[]; imported?: ImportedNeteasePlaylist[] } | null {
  try { return JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null') }
  catch { return null }
}

async function accountFromCookie(cookie: string): Promise<NeteaseAccount> {
  const data = await request<{ profile?: { userId?: number; nickname?: string; avatarUrl?: string }; account?: { id?: number } }>('https://music.163.com/api/nuser/account/get', cookie)
  const userId = data.profile?.userId ?? data.account?.id
  if (!userId || !data.profile?.nickname) throw new Error('没有检测到有效的网易云音乐登录状态')
  return { userId, nickname: data.profile.nickname, avatarUrl: data.profile.avatarUrl, cookie, syncedAt: Date.now() }
}

async function request<T>(url: string, cookie = ''): Promise<T> {
  const headers = cookie ? { Cookie: cookie } : undefined
  if (Capacitor.isNativePlatform()) {
    const response = await NativeHttp.request({ url, method: 'GET', headers })
    if (response.status < 200 || response.status >= 300) throw new Error(`网易云请求失败 ${response.status}`)
    return JSON.parse(response.body) as T
  }
  const response = await fetch(url, { headers, credentials: 'include' })
  if (!response.ok) throw new Error(`网易云请求失败 ${response.status}`)
  return response.json() as Promise<T>
}
