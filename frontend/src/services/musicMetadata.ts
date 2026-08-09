import { Capacitor, registerPlugin } from '@capacitor/core'
import localforage from 'localforage'
import type { MediaItem } from '../stores/media'

interface NativeHttpResult { status: number; body: string }
interface NativeHttpApi { request(options: { url: string; method?: string; body?: string; headers?: Record<string, string> }): Promise<NativeHttpResult> }
interface MusicInfoApi { probe(options: { url: string }): Promise<AudioTechnicalInfo> }

const NativeHttp = registerPlugin<NativeHttpApi>('NativeHttp')
const MusicInfo = registerPlugin<MusicInfoApi>('MusicInfo')
const ONLINE_CACHE_KEY = 'bmovie-music-online-metadata-v1'
const TECHNICAL_CACHE_KEY = 'bmovie-music-technical-metadata-v1'
const REPORTS_KEY = 'bmovie-music-lyric-reports-v1'
const CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000
const MAX_CACHE_ENTRIES = 600
export const MUSIC_METADATA_VERSION = 2

export interface AudioTechnicalInfo {
  mimeType?: string
  bitrate?: number
  sampleRate?: number
  channels?: number
  bitDepth?: number
  durationUs?: number
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  track?: string
  disc?: string
}

export interface OnlineMusicInfo {
  neteaseId: number
  title: string
  artists: string[]
  album: string
  duration: number
  artwork?: string
  publishedAt?: number
  neteaseBitrate?: number
  neteaseSampleRate?: number
  lyric?: string
  translatedLyric?: string
  fetchedAt: number
}

interface CacheEntry<T> { signature: string; savedAt: number; value: T }
interface LyricReport { path: string; neteaseId: number; reportedAt: number }

interface SearchSong {
  id: number
  name: string
  duration: number
  artists?: Array<{ name: string }>
  album?: { name?: string }
}

interface DetailSong {
  id: number
  name: string
  duration: number
  artists?: Array<{ name: string }>
  album?: { name?: string; picUrl?: string; publishTime?: number }
  sqMusic?: { bitrate?: number; sr?: number }
  hrMusic?: { bitrate?: number; sr?: number }
  hMusic?: { bitrate?: number; sr?: number }
}

export async function resolveOnlineMusic(item: MediaItem, force = false): Promise<OnlineMusicInfo | null> {
  const signature = itemSignature(item)
  const cache = await loadCache<OnlineMusicInfo>(ONLINE_CACHE_KEY)
  const cached = cache[item.path]
  const rejected = new Set((await lyricReports()).filter((report) => report.path === item.path).map((report) => report.neteaseId))
  if (!force && cached?.signature === signature && Date.now() - cached.savedAt < CACHE_MAX_AGE && !rejected.has(cached.value.neteaseId)) return cached.value

  const candidates = await searchCandidates(item)
  const ranked = candidates
    .filter((candidate) => !rejected.has(candidate.id))
    .map((candidate) => ({ candidate, score: matchScore(item, candidate) }))
    .filter((entry) => entry.score >= 72)
    .sort((a, b) => b.score - a.score)

  let fallback: OnlineMusicInfo | null = null
  for (const { candidate } of ranked.slice(0, 5)) {
    const [detail, lyrics] = await Promise.all([songDetail(candidate.id), songLyrics(candidate.id)])
    if (!detail) continue
    const quality = detail.hrMusic || detail.sqMusic || detail.hMusic
    const value: OnlineMusicInfo = {
      neteaseId: detail.id,
      title: detail.name,
      artists: detail.artists?.map((artist) => artist.name).filter(Boolean) ?? [],
      album: detail.album?.name || candidate.album?.name || '',
      duration: (detail.duration || candidate.duration || 0) / 1000,
      artwork: detail.album?.picUrl,
      publishedAt: detail.album?.publishTime,
      neteaseBitrate: quality?.bitrate,
      neteaseSampleRate: quality?.sr,
      lyric: lyrics.lyric,
      translatedLyric: lyrics.translated,
      fetchedAt: Date.now(),
    }
    fallback ??= value
    if (value.lyric?.trim()) {
      await storeCache(ONLINE_CACHE_KEY, cache, item.path, signature, value)
      return value
    }
  }
  if (fallback) await storeCache(ONLINE_CACHE_KEY, cache, item.path, signature, fallback)
  return fallback
}

export async function probeAudio(path: string, url: string, item: Pick<MediaItem, 'size' | 'modified'>, force = false): Promise<AudioTechnicalInfo | null> {
  if (!Capacitor.isNativePlatform()) return null
  const signature = `${item.size}:${item.modified}`
  const cache = await loadCache<AudioTechnicalInfo>(TECHNICAL_CACHE_KEY)
  const cached = cache[path]
  if (!force && cached?.signature === signature && Date.now() - cached.savedAt < CACHE_MAX_AGE) return cached.value
  try {
    const value = await MusicInfo.probe({ url })
    await storeCache(TECHNICAL_CACHE_KEY, cache, path, signature, value)
    return value
  } catch {
    return null
  }
}

export async function reportLyricError(path: string, neteaseId: number) {
  const reports = await lyricReports()
  if (!reports.some((report) => report.path === path && report.neteaseId === neteaseId)) {
    reports.push({ path, neteaseId, reportedAt: Date.now() })
    await localforage.setItem(REPORTS_KEY, reports.slice(-1000))
  }
  const cache = await loadCache<OnlineMusicInfo>(ONLINE_CACHE_KEY)
  delete cache[path]
  await localforage.setItem(ONLINE_CACHE_KEY, cache)
}

async function searchCandidates(item: MediaItem): Promise<SearchSong[]> {
  const artist = item.artists?.join(' ') || item.artist || ''
  const queries = [...new Set([`${item.title} ${artist}`.trim(), item.title].filter(Boolean))]
  const found = new Map<number, SearchSong>()
  for (const query of queries) {
    const url = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(query)}&type=1&offset=0&limit=10`
    const data = await requestJson<{ result?: { songs?: SearchSong[] } }>(url).catch(() => null)
    for (const song of data?.result?.songs ?? []) found.set(song.id, song)
    if (found.size >= 8) break
  }
  return [...found.values()]
}

async function songDetail(id: number): Promise<DetailSong | null> {
  const ids = encodeURIComponent(`[${id}]`)
  const data = await requestJson<{ songs?: DetailSong[] }>(`https://music.163.com/api/song/detail/?ids=${ids}`).catch(() => null)
  return data?.songs?.[0] ?? null
}

async function songLyrics(id: number): Promise<{ lyric?: string; translated?: string }> {
  const data = await requestJson<{ lrc?: { lyric?: string }; tlyric?: { lyric?: string }; nolyric?: boolean }>(`https://music.163.com/api/song/lyric?id=${id}&lv=-1&kv=-1&tv=-1`).catch(() => null)
  if (!data || data.nolyric) return {}
  return { lyric: data.lrc?.lyric, translated: data.tlyric?.lyric }
}

async function requestJson<T>(url: string): Promise<T> {
  if (Capacitor.isNativePlatform()) {
    const response = await NativeHttp.request({ url, method: 'GET' })
    if (response.status < 200 || response.status >= 300) throw new Error(`网易云请求失败 ${response.status}`)
    return JSON.parse(response.body) as T
  }
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`网易云请求失败 ${response.status}`)
  return response.json() as Promise<T>
}

function matchScore(item: MediaItem, candidate: SearchSong) {
  const localTitle = normalize(item.title)
  const remoteTitle = normalize(candidate.name)
  let score = localTitle === remoteTitle ? 100 : localTitle.includes(remoteTitle) || remoteTitle.includes(localTitle) ? 66 : tokenSimilarity(localTitle, remoteTitle) * 60
  if (item.duration && candidate.duration) {
    const delta = Math.abs(item.duration - candidate.duration / 1000)
    score += delta <= 8 ? Math.max(12, 52 - delta * 8) : delta <= 20 ? 5 : -35
  }
  const localArtists = (item.artists?.length ? item.artists : [item.artist]).filter(Boolean).map((value) => normalize(value!))
  const remoteArtists = candidate.artists?.map((artist) => normalize(artist.name)) ?? []
  if (localArtists.length && localArtists.some((artist) => remoteArtists.some((remote) => remote === artist || remote.includes(artist) || artist.includes(remote)))) score += 42
  const localAlbum = normalize(item.album || '')
  const remoteAlbum = normalize(candidate.album?.name || '')
  if (localAlbum && remoteAlbum) {
    if (localAlbum === remoteAlbum || localAlbum.includes(remoteAlbum) || remoteAlbum.includes(localAlbum)) score += 28
    else if (tokenSimilarity(localAlbum, remoteAlbum) >= .58) score += 14
  }
  return score
}

function normalize(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/(?:\[[^\]]*]|\([^)]*(?:flac|mp3|aac|bit|khz)[^)]*\))/gi, '').replace(/[^\p{L}\p{N}]+/gu, '')
}

function tokenSimilarity(left: string, right: string) {
  if (!left || !right) return 0
  const a = new Set([...left])
  const b = new Set([...right])
  const intersection = [...a].filter((value) => b.has(value)).length
  return intersection / Math.max(a.size, b.size)
}

function itemSignature(item: MediaItem) {
  return `${item.path}:${item.size}:${item.modified}`
}

async function lyricReports() {
  return (await localforage.getItem<LyricReport[]>(REPORTS_KEY)) ?? []
}

async function loadCache<T>(key: string) {
  return (await localforage.getItem<Record<string, CacheEntry<T>>>(key)) ?? {}
}

async function storeCache<T>(key: string, cache: Record<string, CacheEntry<T>>, path: string, signature: string, value: T) {
  cache[path] = { signature, savedAt: Date.now(), value }
  const entries = Object.entries(cache).sort(([, left], [, right]) => right.savedAt - left.savedAt).slice(0, MAX_CACHE_ENTRIES)
  await localforage.setItem(key, Object.fromEntries(entries))
}
