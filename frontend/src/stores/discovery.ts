import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { Capacitor, registerPlugin } from '@capacitor/core'
import localforage from 'localforage'
import { CloudAuth } from '../services/cloudAuth'
import type { MediaItem, MediaWork } from './media'

interface NativeHttpResult { status: number; body: string }
interface NativeHttpApi { request(options: { url: string; method?: string; headers?: Record<string, string> }): Promise<NativeHttpResult> }
const NativeHttp = registerPlugin<NativeHttpApi>('NativeHttp')

export interface BiliAccount {
  mid: number
  name: string
  face?: string
  cookie: string
  syncedAt?: number
}

export interface BiliFollow {
  seasonId: number
  mediaId?: number
  title: string
  cover?: string
  summary?: string
  badge?: string
  areas?: string
  latest?: string
  progress?: string
  url?: string
  rating?: number
}

export interface BiliSearchResult {
  seasonId: number
  title: string
  cover?: string
  summary?: string
  areas?: string
  latest?: string
}

export interface BiliEpisode {
  id: number
  cid: number
  title: string
  longTitle?: string
  cover?: string
  url?: string
  index: number
  duration?: number
}

interface BiliVideoSearchResult {
  bvid: string
  title: string
  play: number
}

export interface BiliSource {
  id: string
  title: string
  cover?: string
  summary?: string
  seasonId?: number
  episodes: BiliEpisode[]
}

export interface DanmakuComment {
  time: number
  mode: number
  color: number
  text: string
}

export interface DanmakuBinding {
  targetPath: string
  sourceId: string
  sourceTitle: string
  episodeTitle: string
  cid: number
  comments: DanmakuComment[]
  fetchedAt: number
  version?: number
  workIdentity?: string
  season?: number
  episode?: number
}

const ACCOUNT_KEY = 'bmovie-bilibili-account-v1'
const FOLLOW_KEY = 'bmovie-bilibili-following-v1'
const DANMAKU_KEY = 'bmovie-danmaku-bindings-v1'
const DANMAKU_VERSION = 2

export const useDiscoveryStore = defineStore('discovery', () => {
  const account = ref<BiliAccount | null>(null)
  const follows = ref<BiliFollow[]>([])
  const bindings = ref<DanmakuBinding[]>([])
  const loaded = ref(false)
  const syncing = ref(false)
  const error = ref('')
  const connected = computed(() => Boolean(account.value?.mid && account.value.cookie))
  let loadRequest: Promise<void> | undefined
  const autoMatchRequests = new Map<string, Promise<DanmakuBinding | null>>()

  async function load() {
    if (loaded.value) return
    if (!loadRequest) loadRequest = (async () => {
      const [savedAccount, savedFollows, savedBindings] = await Promise.all([
        localforage.getItem<BiliAccount>(ACCOUNT_KEY),
        localforage.getItem<BiliFollow[]>(FOLLOW_KEY),
        localforage.getItem<DanmakuBinding[]>(DANMAKU_KEY),
      ])
      account.value = savedAccount ?? null
      follows.value = savedFollows ?? []
      bindings.value = savedBindings ?? []
      loaded.value = true
    })()
    try { await loadRequest } finally { loadRequest = undefined }
  }

  async function login() {
    if (Capacitor.getPlatform() !== 'android') throw new Error('B站账号绑定目前仅支持安卓版')
    const result = await CloudAuth.login({ provider: 'bilibili' })
    const profile = await fetchProfile(result.credential)
    account.value = { ...profile, cookie: result.credential }
    await localforage.setItem(ACCOUNT_KEY, plain(account.value))
    await syncFollowing()
  }

  async function verify() {
    await load()
    if (!account.value?.cookie) return false
    try {
      const profile = await fetchProfile(account.value.cookie)
      account.value = { ...account.value, ...profile }
      await localforage.setItem(ACCOUNT_KEY, plain(account.value))
      return true
    } catch {
      return false
    }
  }

  async function logout() {
    account.value = null
    follows.value = []
    await Promise.all([localforage.removeItem(ACCOUNT_KEY), localforage.removeItem(FOLLOW_KEY)])
  }

  async function syncFollowing() {
    await load()
    if (!account.value) throw new Error('请先绑定哔哩哔哩账号')
    syncing.value = true
    error.value = ''
    try {
      const collected: BiliFollow[] = []
      let page = 1
      let total = Number.MAX_SAFE_INTEGER
      while (collected.length < total && page <= 40) {
        const params = new URLSearchParams({ vmid: String(account.value.mid), type: '1', pn: String(page), ps: '50', follow_status: '0' })
        const payload = await biliJson(`/x/space/bangumi/follow/list?${params}`, account.value.cookie)
        const data = payload.data ?? payload.result
        const list = Array.isArray(data?.list) ? data.list : []
        total = Number(data?.total ?? list.length)
        collected.push(...list.map(mapFollow).filter((item: BiliFollow) => item.seasonId))
        if (!list.length) break
        page += 1
      }
      follows.value = uniqueBy(collected, (item) => item.seasonId)
      account.value.syncedAt = Date.now()
      await Promise.all([
        localforage.setItem(FOLLOW_KEY, plain(follows.value)),
        localforage.setItem(ACCOUNT_KEY, plain(account.value)),
      ])
    } catch (reason) {
      error.value = errorMessage(reason)
      throw reason
    } finally {
      syncing.value = false
    }
  }

  async function search(query: string): Promise<BiliSearchResult[]> {
    const value = query.trim()
    if (!value) return []
    const direct = parseDirectInput(value)
    if (direct) {
      const source = await resolveSource(value)
      return source.seasonId ? [{ seasonId: source.seasonId, title: source.title, cover: source.cover, summary: source.summary }] : []
    }
    const params = new URLSearchParams({ search_type: 'media_bangumi', keyword: value })
    const payload = await biliJson(`/x/web-interface/search/type?${params}`, account.value?.cookie)
    return (Array.isArray(payload.data?.result) ? payload.data.result : []).map((entry: any) => ({
      seasonId: Number(entry.season_id),
      title: stripHtml(entry.title),
      cover: imageUrl(entry.cover),
      summary: stripHtml(entry.desc || entry.cv || ''),
      areas: entry.areas,
      latest: entry.index_show,
    })).filter((entry: BiliSearchResult) => entry.seasonId)
  }

  async function resolveSource(input: string | number): Promise<BiliSource> {
    const direct = typeof input === 'number' ? { kind: 'season', value: String(input) } : parseDirectInput(input.trim())
    if (!direct) throw new Error('请输入 B 站番剧链接、BV 号、EP/SS 号或 CID')
    if (direct.kind === 'cid') {
      return { id: `cid:${direct.value}`, title: `CID ${direct.value}`, episodes: [{ id: 0, cid: Number(direct.value), title: '弹幕轨道', index: 1 }] }
    }
    if (direct.kind === 'bvid') return resolveVideo(direct.value)
    const key = direct.kind === 'episode' ? `ep_id=${direct.value}` : `season_id=${direct.value}`
    const payload = await biliJson(`/pgc/view/web/season?${key}`, account.value?.cookie)
    const data = payload.result ?? payload.data
    if (!data) throw new Error(payload.message || '没有找到番剧信息')
    return {
      id: `season:${data.season_id}`,
      seasonId: Number(data.season_id),
      title: data.season_title || data.title || '未命名番剧',
      cover: imageUrl(data.cover),
      summary: data.evaluate || data.subtitle,
      episodes: (Array.isArray(data.episodes) ? data.episodes : []).map((episode: any, index: number) => ({
        id: Number(episode.id ?? episode.ep_id ?? 0),
        cid: Number(episode.cid),
        title: String(episode.title ?? index + 1),
        longTitle: episode.long_title || episode.share_copy,
        cover: imageUrl(episode.cover),
        url: episode.share_url || (episode.id ? `https://www.bilibili.com/bangumi/play/ep${episode.id}` : undefined),
        index: index + 1,
        duration: Number(episode.duration) || undefined,
      })).filter((episode: BiliEpisode) => episode.cid),
    }
  }

  async function resolveVideo(bvid: string): Promise<BiliSource> {
    const payload = await biliJson(`/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, account.value?.cookie)
    const data = payload.data
    if (!data) throw new Error(payload.message || '没有找到视频')
    return {
      id: `bvid:${data.bvid}`,
      title: data.title || data.bvid,
      cover: imageUrl(data.pic),
      summary: data.desc,
      episodes: (Array.isArray(data.pages) ? data.pages : []).map((page: any, index: number) => ({
        id: Number(page.page ?? index + 1),
        cid: Number(page.cid),
        title: String(page.page ?? index + 1),
        longTitle: page.part,
        cover: imageUrl(data.pic),
        url: `https://www.bilibili.com/video/${data.bvid}?p=${page.page ?? index + 1}`,
        index: index + 1,
        duration: Number(page.duration) || undefined,
      })).filter((episode: BiliEpisode) => episode.cid),
    }
  }

  async function fetchDanmaku(cid: number) {
    if (!Number.isFinite(cid) || cid <= 0) throw new Error('无效的弹幕 CID')
    const response = await request(`https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`, account.value?.cookie)
    if (response.status < 200 || response.status >= 300) throw new Error(`弹幕请求失败（${response.status}）`)
    const rows = [...response.body.matchAll(/<d\s+p="([^"]*)">([\s\S]*?)<\/d>/g)]
    if (!rows.length && response.body.includes('<d ')) throw new Error('弹幕数据解析失败')
    return rows.map((row) => {
      const values = row[1].split(',')
      return {
        time: Math.max(0, Math.round(Number(values[0]) * 1000)),
        mode: Number(values[1]) || 1,
        color: Number(values[3]) || 0xffffff,
        text: decodeXmlText(row[2]).trim(),
      }
    }).filter((comment) => comment.text && comment.time >= 0)
      .sort((left, right) => left.time - right.time)
      .slice(0, 3000)
  }

  async function bindDanmaku(
    targetPath: string,
    source: BiliSource,
    episode: BiliEpisode,
    context?: Pick<DanmakuBinding, 'workIdentity' | 'season' | 'episode'>,
  ) {
    await load()
    if (!targetPath) throw new Error('请先选择要绑定的视频')
    const comments = await fetchDanmaku(episode.cid)
    const binding: DanmakuBinding = {
      targetPath,
      sourceId: source.id,
      sourceTitle: source.title,
      episodeTitle: episode.longTitle || `第 ${episode.title} 集`,
      cid: episode.cid,
      comments,
      fetchedAt: Date.now(),
      version: DANMAKU_VERSION,
      ...context,
    }
    bindings.value = [binding, ...bindings.value.filter((entry) => entry.targetPath !== targetPath)]
    await localforage.setItem(DANMAKU_KEY, plain(bindings.value))
    return binding
  }

  async function removeBinding(targetPath: string) {
    bindings.value = bindings.value.filter((entry) => entry.targetPath !== targetPath)
    await localforage.setItem(DANMAKU_KEY, plain(bindings.value))
  }

  function bindingForPath(path: string) {
    return bindings.value.find((entry) => entry.targetPath === path)
  }

  function bindingForMedia(item: MediaItem, work: MediaWork) {
    const exact = bindingForPath(item.path)
    if (exact) return exact
    const season = item.season ?? 1
    const episode = item.episode
    if (!episode) return undefined
    return bindings.value.find((entry) => {
      if (entry.workIdentity === work.identity && (entry.season ?? 1) === season && entry.episode === episode) return true
      const boundItem = work.items.find((candidate) => candidate.path === entry.targetPath)
      return boundItem?.episode === episode && (boundItem.season ?? 1) === season
    })
  }

  async function prepareDanmaku(item: MediaItem, work: MediaWork) {
    await load()
    const reusable = bindingForMedia(item, work)
    if (!reusable) {
      const knownSource = await bindFromKnownSource(item, work)
      return knownSource ?? autoMatchDanmaku(item, work)
    }

    let comments = reusable.comments
    if (reusable.version !== DANMAKU_VERSION) {
      try {
        comments = await fetchDanmaku(reusable.cid)
      } catch {
        // An existing cache is still preferable when B站 is temporarily unavailable.
      }
    }
    const binding: DanmakuBinding = {
      ...reusable,
      targetPath: item.path,
      comments,
      fetchedAt: reusable.version === DANMAKU_VERSION ? reusable.fetchedAt : Date.now(),
      version: DANMAKU_VERSION,
      workIdentity: work.identity,
      season: item.season ?? 1,
      episode: item.episode,
    }
    bindings.value = [binding, ...bindings.value.filter((entry) => entry.targetPath !== item.path)]
    await localforage.setItem(DANMAKU_KEY, plain(bindings.value))
    return binding
  }

  async function bindFromKnownSource(item: MediaItem, work: MediaWork) {
    if (!item.episode) return null
    const season = item.season ?? 1
    const known = uniqueBy(bindings.value.filter((entry) => {
      if (entry.workIdentity === work.identity) return (entry.season ?? 1) === season
      const boundItem = work.items.find((candidate) => candidate.path === entry.targetPath)
      return Boolean(boundItem && (boundItem.season ?? 1) === season)
    }), (entry) => entry.sourceId)

    for (const binding of known) {
      try {
        const input = binding.sourceId.startsWith('season:')
          ? Number(binding.sourceId.slice('season:'.length))
          : binding.sourceId
        const source = await resolveSource(input)
        if (!sourceMatchesSeason(source, season, work)) continue
        const episode = matchEpisode(source.episodes, item.episode)
        if (!episode) continue
        return await bindDanmaku(item.path, source, episode, {
          workIdentity: work.identity,
          season,
          episode: item.episode,
        })
      } catch {
        // A stale source may have been removed; normal search remains available.
      }
    }
    return null
  }

  async function autoMatchDanmaku(item: MediaItem, work: MediaWork): Promise<DanmakuBinding | null> {
    await load()
    const existing = bindingForPath(item.path)
    if (existing) return existing
    if (work.category !== 'tv' || !item.episode) return null
    const episodeNumber = item.episode
    const pending = autoMatchRequests.get(item.path)
    if (pending) return pending

    const request = (async () => {
      const season = Math.max(1, item.season ?? 1)
      // Search only by the work's names. Season and episode are structural
      // constraints and are applied after resolving the returned sources.
      const queries = workSearchTitles(work)
      const candidates: BiliSearchResult[] = []
      for (const query of queries) {
        try {
          candidates.push(...await search(query))
        } catch {
          // A fallback query can still succeed when one search wording is unavailable.
        }
      }

      const ranked = uniqueBy(candidates, (candidate) => candidate.seasonId)
        .map((candidate) => ({ candidate, score: sourceMatchScore(candidate.title, work, season) }))
        .filter((entry) => entry.score >= 25)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5)

      for (const { candidate } of ranked) {
        try {
          const source = await resolveSource(candidate.seasonId)
          if (!sourceMatchesSeason(source, season, work)) continue
          const episode = matchEpisode(source.episodes, episodeNumber)
          if (!episode) continue
          return await bindDanmaku(item.path, source, episode, {
            workIdentity: work.identity,
            season,
            episode: episodeNumber,
          })
        } catch {
          // Try the next ranked source without interrupting playback.
        }
      }
      return await autoMatchVideoDanmaku(item, work, season, episodeNumber)
    })()
    autoMatchRequests.set(item.path, request)
    try {
      return await request
    } finally {
      autoMatchRequests.delete(item.path)
    }
  }

  async function autoMatchVideoDanmaku(item: MediaItem, work: MediaWork, season: number, episodeNumber: number) {
    const queries = workSearchTitles(work)
    if (!queries.length) return null
    let results: BiliVideoSearchResult[] = []
    for (const query of queries) {
      try {
        results.push(...await searchVideos(query))
      } catch {
        // Continue with aliases when one title cannot be searched.
      }
    }

    const ranked = uniqueBy(results, (candidate) => candidate.bvid)
      .map((candidate) => ({ candidate, score: videoSearchScore(candidate, work, season, episodeNumber) }))
      .filter((entry) => entry.score >= 35)
      .sort((left, right) => right.score - left.score)
      .slice(0, 7)
    const resolved: Array<{ source: BiliSource; episode: BiliEpisode; score: number }> = []
    for (const entry of ranked) {
      try {
        const source = await resolveVideo(entry.candidate.bvid)
        if (season > 1 && titleSeason(source.title) !== season) continue
        const episode = videoEpisodeForSource(source, entry.candidate.title, episodeNumber)
        if (!episode) continue
        const durationScore = episodeDurationScore(episode.duration, item.duration || (item.runtime ? item.runtime * 60 : undefined))
        if (durationScore < 0) continue
        resolved.push({ source, episode, score: entry.score + durationScore })
      } catch {
        // Removed videos and inaccessible uploads are skipped.
      }
    }
    resolved.sort((left, right) => right.score - left.score)
    for (const candidate of resolved) {
      try {
        return await bindDanmaku(item.path, candidate.source, candidate.episode, {
          workIdentity: work.identity,
          season,
          episode: episodeNumber,
        })
      } catch {
        // A source can resolve successfully but have an unavailable danmaku track.
      }
    }
    return null
  }

  async function searchVideos(query: string): Promise<BiliVideoSearchResult[]> {
    const params = new URLSearchParams({ search_type: 'video', keyword: query, order: 'totalrank', page: '1' })
    const payload = await biliJson(`/x/web-interface/search/type?${params}`, account.value?.cookie)
    return (Array.isArray(payload.data?.result) ? payload.data.result : []).map((entry: any) => ({
      bvid: String(entry.bvid || ''),
      title: stripHtml(entry.title || ''),
      play: Number(entry.play) || 0,
    })).filter((entry: BiliVideoSearchResult) => entry.bvid)
  }

  return {
    account, follows, bindings, loaded, syncing, error, connected,
    load, login, verify, logout, syncFollowing, search, resolveSource, fetchDanmaku, bindDanmaku, removeBinding,
    bindingForPath, bindingForMedia, prepareDanmaku, autoMatchDanmaku,
  }
})

function matchEpisode(episodes: BiliEpisode[], episodeNumber: number) {
  const exact = episodes.find((episode) => numericEpisodeTitle(episode.title) === episodeNumber)
  if (exact) return exact
  const byIndex = episodes.find((episode) => episode.index === episodeNumber)
  if (byIndex) return byIndex
  return episodes[episodeNumber - 1]
}

function videoEpisodeForSource(source: BiliSource, searchTitle: string, episodeNumber: number) {
  const range = titleEpisodeRange(searchTitle)
  const total = searchTitle.match(/全\s*(\d{1,3})\s*(?:话|集|期)/)?.[1]
  if (range || total) return matchEpisode(source.episodes, episodeNumber)
  if (titleEpisodeNumbers(searchTitle).includes(episodeNumber)) return source.episodes[0]
  return matchEpisode(source.episodes, episodeNumber)
}

function videoSearchScore(candidate: BiliVideoSearchResult, work: MediaWork, season: number, episodeNumber: number) {
  let score = sourceMatchScore(candidate.title, work, season)
  const range = titleEpisodeRange(candidate.title)
  const numbers = titleEpisodeNumbers(candidate.title)
  const total = Number(candidate.title.match(/全\s*(\d{1,3})\s*(?:话|集|期)/)?.[1])
  if (range && episodeNumber >= range[0] && episodeNumber <= range[1]) score += 24
  else if (numbers.includes(episodeNumber)) score += 34
  else if (total >= episodeNumber) score += 18
  else if (numbers.length) score -= 65
  if (candidate.play > 0) score += Math.min(10, Math.log10(candidate.play + 1) * 1.5)
  return score
}

function titleEpisodeRange(value: string): [number, number] | undefined {
  const match = value.match(/(?:^|\D)(\d{1,3})\s*[-~～至到]\s*(\d{1,3})\s*(?:话|集|期)?/)
  if (!match) return undefined
  const start = Number(match[1])
  const end = Number(match[2])
  return start > 0 && end >= start ? [start, end] : undefined
}

function titleEpisodeNumbers(value: string) {
  const withoutRange = value.replace(/\d{1,3}\s*[-~～至到]\s*\d{1,3}\s*(?:话|集|期)?/g, ' ')
  const matches = [
    ...withoutRange.matchAll(/第\s*0*(\d{1,3})\s*(?:话|集|期)/g),
    ...withoutRange.matchAll(/(?:^|[\s【\[(#_-])0*(\d{1,3})(?!\s*(?:月|年|p|k|fps))(?=$|[\s】\])#_-])/gi),
    ...withoutRange.matchAll(/(?:^|\D)0*(\d{1,3})\s*(?:话|集|期)/g),
  ]
  return [...new Set(matches.map((match) => Number(match[1])).filter((value) => value > 0))]
}

function episodeDurationScore(sourceDuration?: number, targetDuration?: number) {
  if (!sourceDuration || !targetDuration) return 0
  const difference = Math.abs(sourceDuration - targetDuration) / targetDuration
  if (difference > 0.38) return -1
  return Math.max(0, 38 - difference * 100)
}

function numericEpisodeTitle(value: string) {
  const normalized = value.trim()
  if (/^\d+(?:\.0+)?$/.test(normalized)) return Number.parseInt(normalized, 10)
  const match = normalized.match(/^(?:第\s*)?(\d+)\s*(?:话|集|期)$/)
  return match ? Number.parseInt(match[1], 10) : undefined
}

function sourceMatchesSeason(source: BiliSource, season: number, work: MediaWork) {
  const score = sourceMatchScore(source.title, work, season)
  const detected = titleSeason(source.title)
  return score >= 25 && (detected === undefined || detected === season)
}

function workSearchTitles(work: MediaWork) {
  return uniqueBy(
    [work.title, work.originalTitle ?? '']
      .map((title) => stripSeasonLabel(title).replace(/\s+/g, ' ').trim())
      .filter(Boolean),
    (title) => normalizeMatchTitle(title),
  )
}

function sourceMatchScore(sourceTitle: string, work: MediaWork, season: number) {
  const source = normalizeMatchTitle(stripSeasonLabel(sourceTitle))
  const titles = [work.title, work.originalTitle ?? '']
    .map((title) => normalizeMatchTitle(stripSeasonLabel(title)))
    .filter(Boolean)
  let score = 0
  for (const title of titles) {
    if (source === title) score = Math.max(score, 80)
    else if (source.includes(title) || title.includes(source)) score = Math.max(score, 55)
    else score = Math.max(score, tokenSimilarity(source, title) * 45)
  }
  const detected = titleSeason(sourceTitle)
  if (detected === season) score += 35
  else if (detected !== undefined) score -= 55
  else if (season === 1) score += 8
  return score
}

function titleSeason(value: string) {
  const chinese = value.match(/第\s*([一二三四五六七八九十两\d]+)\s*(?:季|期)/)
  if (chinese) return parseSeasonNumber(chinese[1])
  const english = value.match(/(?:\bseason\s*|\bS\s*)0*(\d+)/i)
  if (english) return Number.parseInt(english[1], 10)
  const ordinal = value.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i)
  return ordinal ? Number.parseInt(ordinal[1], 10) : undefined
}

function stripSeasonLabel(value: string) {
  return value
    .replace(/第\s*[一二三四五六七八九十两\d]+\s*(?:季|期)/g, ' ')
    .replace(/(?:\bseason\s*|\bS\s*)0*\d+/gi, ' ')
    .replace(/\b\d+(?:st|nd|rd|th)\s+season\b/gi, ' ')
}

function parseSeasonNumber(value: string) {
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10)
  const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (value === '十') return 10
  if (value.includes('十')) {
    const [tens, units] = value.split('十')
    return (digits[tens] || 1) * 10 + (digits[units] || 0)
  }
  return digits[value]
}

function normalizeMatchTitle(value: string) {
  return stripHtml(value).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function tokenSimilarity(left: string, right: string) {
  if (!left || !right) return 0
  const shorter = left.length <= right.length ? left : right
  const longer = left.length > right.length ? left : right
  let matched = 0
  for (const char of new Set(shorter)) if (longer.includes(char)) matched += 1
  return matched / Math.max(new Set(shorter).size, 1)
}

async function fetchProfile(cookie: string) {
  const payload = await biliJson('/x/web-interface/nav', cookie)
  if (!payload.data?.isLogin || !payload.data?.mid) throw new Error('没有检测到有效的哔哩哔哩登录状态')
  return { mid: Number(payload.data.mid), name: payload.data.uname || `UID ${payload.data.mid}`, face: imageUrl(payload.data.face) }
}

async function biliJson(path: string, cookie?: string) {
  const response = await request(`https://api.bilibili.com${path}`, cookie)
  let payload: any
  try { payload = JSON.parse(response.body) } catch { throw new Error('B站返回了无法解析的数据') }
  if (response.status < 200 || response.status >= 300 || payload.code !== 0) throw new Error(payload.message || `B站请求失败（${response.status}）`)
  return payload
}

async function request(url: string, cookie?: string) {
  const headers: Record<string, string> = {}
  if (cookie) headers.Cookie = cookie
  if (Capacitor.getPlatform() === 'android') return NativeHttp.request({ url, method: 'GET', headers })
  const response = await fetch(url, { headers, credentials: 'include' })
  return { status: response.status, body: await response.text() }
}

function parseDirectInput(input: string): { kind: 'season' | 'episode' | 'bvid' | 'cid'; value: string } | null {
  const bvid = input.match(/BV[0-9A-Za-z]{10}/i)
  if (bvid) return { kind: 'bvid', value: bvid[0] }
  const episode = input.match(/(?:^|\/)ep(\d+)/i)
  if (episode) return { kind: 'episode', value: episode[1] }
  const season = input.match(/(?:^|\/)ss(\d+)/i)
  if (season) return { kind: 'season', value: season[1] }
  const explicitCid = input.match(/(?:cid\s*[:=]?\s*)(\d+)/i)
  if (explicitCid) return { kind: 'cid', value: explicitCid[1] }
  if (/^\d{5,}$/.test(input)) return { kind: 'cid', value: input }
  return null
}

function mapFollow(entry: any): BiliFollow {
  return {
    seasonId: Number(entry.season_id), mediaId: Number(entry.media_id) || undefined,
    title: stripHtml(entry.title || ''), cover: imageUrl(entry.cover), summary: stripHtml(entry.evaluate || entry.summary || ''),
    badge: entry.badge || entry.badge_info?.text, areas: entry.areas, latest: entry.new_ep?.index_show || entry.new_ep?.index,
    progress: entry.progress, url: entry.url, rating: Number(entry.rating?.score) || undefined,
  }
}

function imageUrl(value?: string) {
  if (value?.startsWith('//')) return `https:${value}`
  return value?.replace(/^http:\/\//i, 'https://')
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim()
}

function decodeXmlText(value: string) {
  const textarea = document.createElement('textarea')
  textarea.innerHTML = value
  return textarea.value
}

function uniqueBy<T>(items: T[], key: (item: T) => string | number) {
  const seen = new Set<string | number>()
  return items.filter((item) => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true })
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason)
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
