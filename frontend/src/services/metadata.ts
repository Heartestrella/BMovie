import localforage from 'localforage'
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { MediaCastMember, MediaItem } from '../stores/media'
import { currentLocale, type AppLocale } from '../i18n'

export type MetadataLocale = 'auto' | AppLocale | 'ja-JP'

interface NativeHttpResult { status: number; body: string }
interface NativeHttpApi { request(options: { url: string; method?: string; body?: string; headers?: Record<string, string> }): Promise<NativeHttpResult> }
const NativeHttp = registerPlugin<NativeHttpApi>('NativeHttp')
let nativeBangumiUnavailable = false

export interface MetadataSettings {
  tmdbEnabled: boolean
  tmdbToken: string
  bangumiEnabled: boolean
  tvmazeEnabled: boolean
  metadataLocale: MetadataLocale
}

interface ParsedFilename {
  query: string
  year?: string
  looksLikeEpisode: boolean
  season?: number
  episode?: number
}

interface ExternalEpisode {
  season?: number
  episode?: number
  title?: string
  overview?: string
  image?: string
  airdate?: string
  runtime?: number
}

interface MetadataBundle {
  base: Partial<MediaItem>
  episodes: ExternalEpisode[]
  tmdbMediaType?: 'movie' | 'tv'
  tmdbId?: number
}

export const METADATA_SETTINGS_KEY = 'bmovie-metadata-settings'
export const METADATA_VERSION = 11
const TMDB_IMAGE_BASE = 'https://images.tmdb.org/t/p'

export async function loadMetadataSettings(): Promise<MetadataSettings> {
  const saved = await localforage.getItem<Partial<MetadataSettings>>(METADATA_SETTINGS_KEY)
  const legacyToken = (await localforage.getItem<string>('tmdb-read-token')) ?? ''
  return {
    tmdbEnabled: saved?.tmdbEnabled ?? Boolean(saved?.tmdbToken || legacyToken),
    tmdbToken: saved?.tmdbToken ?? legacyToken,
    bangumiEnabled: saved?.bangumiEnabled ?? true,
    tvmazeEnabled: saved?.tvmazeEnabled ?? true,
    metadataLocale: saved?.metadataLocale ?? 'auto',
  }
}

export async function saveMetadataSettings(settings: MetadataSettings) {
  const plain = { ...settings, tmdbToken: settings.tmdbToken.trim().replace(/^Bearer\s+/i, '') }
  await localforage.setItem(METADATA_SETTINGS_KEY, plain)
  await localforage.setItem('tmdb-read-token', plain.tmdbToken)
}

export function resolveMetadataLocale(settings: Pick<MetadataSettings, 'metadataLocale'>): AppLocale | 'ja-JP' {
  return settings.metadataLocale === 'auto' ? currentLocale.value : settings.metadataLocale
}

export async function matchMetadata(item: MediaItem, settings: MetadataSettings): Promise<Partial<MediaItem> | null> {
  const parsed = parseFilename(item.title)
  const queries = metadataQueries(item, parsed)
  if (!queries.length) return null
  const locale = resolveMetadataLocale(settings)
  let primary: MetadataBundle | null = null
  if (settings.tmdbEnabled && settings.tmdbToken) {
    const key = `${settings.tmdbToken.slice(-8)}:${locale}:${queries.map(normalized).join('|')}:${parsed.year ?? ''}:${parsed.looksLikeEpisode}`
    let request = tmdbCache.get(key)
    if (!request) {
      request = searchTmdb(queries, parsed.year, settings.tmdbToken, locale, parsed.looksLikeEpisode)
      tmdbCache.set(key, request)
    }
    const bundle = await request
    if (bundle) {
      let episodes = bundle.episodes
      if (bundle.tmdbMediaType === 'tv' && bundle.tmdbId) {
        episodes = await loadTmdbSeason(bundle.tmdbId, parsed.season ?? 1, settings.tmdbToken, locale)
      }
      primary = { ...bundle, episodes }
    }
  }
  if ((locale === 'zh-CN' || locale === 'ja-JP') && settings.bangumiEnabled) {
    const bangumiQuery = queries[0]
    const bangumiKey = `${locale}:${normalized(bangumiQuery)}:${parsed.year ?? ''}:${parsed.season ?? 1}`
    let bangumiRequest = bangumiCache.get(bangumiKey)
    if (!bangumiRequest) {
      bangumiRequest = searchBangumi(bangumiQuery, parsed.year, parsed.season ?? 1, locale)
      bangumiCache.set(bangumiKey, bangumiRequest)
    }
    const localized = await bangumiRequest
    if (localized) {
      if (primary) return materializeLocalized(primary, localized, parsed, locale)
      if (settings.tvmazeEnabled && parsed.looksLikeEpisode) {
        const tvmaze = await cachedTvmaze(queries[0])
        if (tvmaze) return materializeLocalized(tvmaze, localized, parsed, locale)
      }
      return materialize(localized.base, localized.episodes, parsed, locale)
    }
  }
  if (primary) return materialize(primary.base, primary.episodes, parsed, locale)
  if (settings.tvmazeEnabled && parsed.looksLikeEpisode) {
    const bundle = await cachedTvmaze(queries[0])
    if (bundle) return materialize(bundle.base, bundle.episodes, { ...parsed, season: parsed.season ?? 1 }, locale)
  }
  return null
}

function materialize(base: Partial<MediaItem>, episodes: ExternalEpisode[], parsed: ParsedFilename, locale: string): Partial<MediaItem> {
  const episode = parsed.episode
    ? episodes.find((entry) => entry.season === (parsed.season ?? 1) && entry.episode === parsed.episode)
    : undefined
  return {
    ...base,
    season: parsed.season,
    episode: parsed.episode,
    episodeTitle: episode?.title,
    episodeOverview: episode?.overview,
    episodeImage: episode?.image,
    airdate: episode?.airdate,
    runtime: episode?.runtime ?? base.runtime,
    metadataVersion: METADATA_VERSION,
    metadataLocale: locale,
  }
}

async function cachedTvmaze(query: string) {
  const key = normalized(query)
  let request = tvmazeCache.get(key)
  if (!request) {
    request = searchTvmaze(query)
    tvmazeCache.set(key, request)
  }
  return request
}

function materializeLocalized(identity: MetadataBundle, localized: MetadataBundle, parsed: ParsedFilename, locale: string) {
  const base = compactMerge(identity.base, localized.base, {
    metadataProvider: identity.base.metadataProvider,
    metadataId: identity.base.metadataId,
    backdrop: identity.base.backdrop || localized.base.backdrop,
    cast: identity.base.cast?.length ? identity.base.cast : localized.base.cast,
  })
  const episodes = identity.episodes.map((episode) => {
    const translation = localized.episodes.find((entry) => entry.episode === episode.episode && entry.season === (parsed.season ?? 1))
    return compactMerge(episode, translation ?? {})
  })
  return materialize(base, episodes, parsed, locale)
}

function compactMerge<T extends object>(...sources: Partial<T>[]): T {
  const result: Record<string, unknown> = {}
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined && value !== null && value !== '') result[key] = value
    }
  }
  return result as T
}

function parseFilename(value: string): ParsedFilename {
  const year = value.match(/\b((?:19|20)\d{2})\b/)?.[1]
  const seasonEpisode = value.match(/\bS(\d{1,2})[ ._-]*E(\d{1,3})\b/i)
  const alternateEpisode = value.match(/\b(\d{1,2})x(\d{1,3})\b/i)
  const simpleEpisode = value.match(/\b(?:EP|Episode)[ ._-]*(\d{1,3})\b/i)
    ?? value.match(/第\s*(\d{1,3})\s*[集话]/)
    ?? value.match(/\[(\d{1,3})\]/)
  const season = Number(seasonEpisode?.[1] ?? alternateEpisode?.[1]) || undefined
  const episode = Number(seasonEpisode?.[2] ?? alternateEpisode?.[2] ?? simpleEpisode?.[1]) || undefined
  const looksLikeEpisode = /\bS\d{1,2}[ ._-]*E\d{1,3}\b/i.test(value)
    || /\b\d{1,2}x\d{1,3}\b/i.test(value)
    || /\b(?:EP|Episode)[ ._-]*\d{1,3}\b/i.test(value)
    || /第\s*\d{1,3}\s*[集话]/.test(value)
    || /\[\d{1,3}\]/.test(value)
  const query = value
    .replace(/[._]+/g, ' ')
    .replace(/\[[^\]]*\]|\([^)]*(?:字幕|压制|rip|web|bluray)[^)]*\)/gi, ' ')
    .replace(/\bS\d{1,2}[ ._-]*E\d{1,3}\b.*$/i, ' ')
    .replace(/\b\d{1,2}x\d{1,3}\b.*$/i, ' ')
    .replace(/\b(?:EP|Episode)[ ._-]*\d{1,3}\b.*$/i, ' ')
    .replace(/第\s*\d{1,3}\s*[集话].*$/, ' ')
    .replace(/\b(?:19|20)\d{2}\b.*$/, ' ')
    .replace(/\b(2160p|1080p|720p|bluray|web[- ]?dl|webrip|hdr|x26[45]|h\.?26[45]).*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { query, year, looksLikeEpisode, season, episode }
}

function metadataQueries(item: MediaItem, parsed: ParsedFilename) {
  const queries: string[] = []
  const add = (value?: string) => {
    const query = value?.replace(/\b(?:S|Season)[ ._-]*\d{1,2}\b/gi, ' ')
      .replace(/第\s*[一二三四五六七八九十\d]{1,2}\s*季/g, ' ')
      .replace(/\b(?:complete|collection|合集|全集)\b/gi, ' ')
      .replace(/\s+/g, ' ').trim()
    if (!query || /^\d+$/.test(query) || /^(?:movies?|tv|series|anime|电影|剧集|动漫|视频)$/i.test(query)) return
    if (!queries.some((entry) => normalized(entry) === normalized(query))) queries.push(query)
  }
  add(parsed.query)
  const folders = (item.folderPath ?? item.path.slice(0, item.path.lastIndexOf('/'))).split('/').filter(Boolean)
  for (const folder of folders.slice(-2).reverse()) add(parseFilename(folder).query || folder)
  return queries.slice(0, 3)
}

const tmdbCache = new Map<string, Promise<MetadataBundle | null>>()
const tmdbSeasonCache = new Map<string, Promise<ExternalEpisode[]>>()
const bangumiCache = new Map<string, Promise<MetadataBundle | null>>()
const tvmazeCache = new Map<string, Promise<MetadataBundle | null>>()

function normalized(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function confidence(query: string, candidate: string) {
  const a = normalized(query), b = normalized(candidate)
  if (!a || !b) return 0
  if (a === b) return 1
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return 0.86
  return 0
}

async function tmdbFetch(url: string, token: string) {
  if (Capacitor.isNativePlatform()) {
    const response = await NativeHttp.request({ url, headers: { Authorization: `Bearer ${token}` } })
    if (response.status < 200 || response.status >= 300) throw new Error(`TMDB ${response.status}`)
    return JSON.parse(response.body)
  }
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`TMDB ${response.status}`)
  return response.json()
}

export async function verifyTmdbConnection(token: string) {
  await tmdbFetch('https://api.themoviedb.org/3/configuration', token.trim().replace(/^Bearer\s+/i, ''))
}

interface TmdbCandidate {
  entry: any
  mediaType: 'movie' | 'tv'
  query: string
  score: number
  order: number
}

async function searchTmdb(queries: string[], year: string | undefined, token: string, locale: string, looksLikeEpisode: boolean): Promise<MetadataBundle | null> {
  const endpoints = looksLikeEpisode ? ['tv'] as const : ['movie', 'multi', 'tv'] as const
  const candidates = new Map<string, TmdbCandidate>()
  let order = 0

  for (const query of queries) {
    for (const endpoint of endpoints) {
      const parameters = new URLSearchParams({ language: locale, include_adult: 'false', query })
      if (year && endpoint === 'movie') parameters.set('primary_release_year', year)
      if (year && endpoint === 'tv') parameters.set('first_air_date_year', year)
      let search: any
      try {
        search = await tmdbFetch(`https://api.themoviedb.org/3/search/${endpoint}?${parameters}`, token)
      } catch {
        continue
      }
      const ranked: TmdbCandidate[] = (search.results ?? []).flatMap((entry: any, index: number) => {
        const mediaType = (endpoint === 'multi' ? entry.media_type : endpoint) as 'movie' | 'tv'
        if (mediaType !== 'movie' && mediaType !== 'tv') return []
        const releaseYear = (entry.release_date || entry.first_air_date || '').slice(0, 4)
        let score = Math.max(confidence(query, entry.title || entry.name || ''), confidence(query, entry.original_title || entry.original_name || ''))
        if (year && releaseYear === year) score += 0.08
        return [{ entry, mediaType, query, score, order: order + index }]
      }).sort((a: TmdbCandidate, b: TmdbCandidate) => b.score - a.score || a.order - b.order)
      order += search.results?.length ?? 0
      for (const candidate of ranked.slice(0, 5)) {
        const key = `${candidate.mediaType}:${candidate.entry.id}`
        const previous = candidates.get(key)
        if (!previous || candidate.score > previous.score) candidates.set(key, candidate)
      }
      if (ranked[0]?.score >= 0.94) {
        const bundle = await hydrateTmdbCandidate(ranked[0], year, token, locale)
        if (bundle) return bundle
      }
    }
  }

  // TMDB text search also matches translated and alternative titles, but the
  // canonical title returned in the search row may differ from the file name.
  // Validate the best rows against the richer title lists before giving up.
  const shortlist = [...candidates.values()].sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 6)
  for (const candidate of shortlist) {
    const detail = await fetchTmdbDetail(candidate.mediaType, candidate.entry.id, token, locale)
    if (!detail) continue
    const releaseYear = (detail.release_date || detail.first_air_date || '').slice(0, 4)
    let score = Math.max(...tmdbTitles(detail).map((title) => confidence(candidate.query, title)), 0)
    if (year && releaseYear === year) score += 0.08
    if (score < 0.94) continue
    return buildTmdbBundle(detail, candidate.mediaType, locale, candidate.entry.title || candidate.entry.name)
  }
  return null
}

async function hydrateTmdbCandidate(candidate: TmdbCandidate, year: string | undefined, token: string, locale: string) {
  const detail = await fetchTmdbDetail(candidate.mediaType, candidate.entry.id, token, locale)
  if (!detail) return null
  const releaseYear = (detail.release_date || detail.first_air_date || '').slice(0, 4)
  const titleScore = Math.max(...tmdbTitles(detail).map((title) => confidence(candidate.query, title)), candidate.score)
  if (titleScore + (year && releaseYear === year ? 0.08 : 0) < 0.94) return null
  return buildTmdbBundle(detail, candidate.mediaType, locale, candidate.entry.title || candidate.entry.name)
}

async function fetchTmdbDetail(mediaType: 'movie' | 'tv', id: number, token: string, locale: string) {
  const append = mediaType === 'movie'
    ? 'credits,images,alternative_titles,translations,release_dates'
    : 'credits,images,alternative_titles,translations,content_ratings'
  const language = locale.split('-')[0]
  const parameters = new URLSearchParams({ language: locale, append_to_response: append, include_image_language: `${language},en,null` })
  return tmdbFetch(`https://api.themoviedb.org/3/${mediaType}/${id}?${parameters}`, token).catch(() => null)
}

function tmdbTitles(detail: any): string[] {
  const alternativeTitles = [...(detail.alternative_titles?.titles ?? []), ...(detail.alternative_titles?.results ?? [])]
    .map((entry: any) => entry.title)
  const translatedTitles = (detail.translations?.translations ?? []).map((entry: any) => entry.data?.title || entry.data?.name)
  return [detail.title, detail.name, detail.original_title, detail.original_name, ...alternativeTitles, ...translatedTitles].filter(Boolean)
}

function tmdbTranslation(detail: any, locale: string) {
  const [language, region] = locale.split('-')
  const translations = detail.translations?.translations ?? []
  const regionalOrder = locale === 'zh-CN' ? ['CN', 'SG', 'TW', 'HK'] : [region]
  return translations.find((entry: any) => entry.iso_639_1 === language && regionalOrder.includes(entry.iso_3166_1))
    ?? translations.find((entry: any) => entry.iso_639_1 === language)
}

function tmdbEnglishTranslation(detail: any) {
  const translations = detail.translations?.translations ?? []
  return translations.find((entry: any) => entry.iso_639_1 === 'en' && entry.iso_3166_1 === 'US')
    ?? translations.find((entry: any) => entry.iso_639_1 === 'en')
}

function tmdbImage(images: any[] | undefined, locale: string) {
  const language = locale.split('-')[0]
  const ordered = [...(images ?? [])].sort((a, b) => Number(b.vote_average ?? 0) - Number(a.vote_average ?? 0))
  return ordered.find((entry) => entry.iso_639_1 === language)?.file_path
    ?? ordered.find((entry) => entry.iso_639_1 == null)?.file_path
    ?? ordered.find((entry) => entry.iso_639_1 === 'en')?.file_path
    ?? ordered[0]?.file_path
}

function tmdbCertification(detail: any, mediaType: 'movie' | 'tv', locale: string) {
  const results = mediaType === 'movie' ? detail.release_dates?.results ?? [] : detail.content_ratings?.results ?? []
  const preferredRegions = [locale.split('-')[1], 'CN', 'US'].filter(Boolean)
  const selected = preferredRegions.map((region) => results.find((entry: any) => entry.iso_3166_1 === region)).find(Boolean) ?? results[0]
  if (mediaType === 'tv') return selected?.rating || undefined
  return selected?.release_dates?.find((entry: any) => entry.certification)?.certification || undefined
}

function buildTmdbBundle(detail: any, mediaType: 'movie' | 'tv', locale: string, searchTitle?: string): MetadataBundle {
  const localized = tmdbTranslation(detail, locale)?.data ?? {}
  const english = tmdbEnglishTranslation(detail)?.data ?? {}
  const title = localized.title || localized.name || detail.title || detail.name || searchTitle
  const originalTitle = detail.original_title || detail.original_name
  const releaseDate = detail.release_date || detail.first_air_date
  const posterPath = detail.poster_path || tmdbImage(detail.images?.posters, locale)
  const backdropPath = detail.backdrop_path || tmdbImage(detail.images?.backdrops, locale)
  const crew = detail.credits?.crew ?? []
  const cast: MediaCastMember[] = (detail.credits?.cast ?? []).slice(0, 12).map((entry: any) => ({
    name: entry.name,
    role: entry.character,
    image: entry.profile_path ? `${TMDB_IMAGE_BASE}/w185${entry.profile_path}` : undefined,
  }))
  return {
    base: {
      tmdbId: detail.id,
      metadataId: detail.id,
      title,
      originalTitle: originalTitle && originalTitle !== title ? originalTitle : undefined,
      overview: localized.overview || detail.overview || english.overview,
      tagline: localized.tagline || detail.tagline || english.tagline,
      year: releaseDate?.slice(0, 4),
      releaseDate,
      poster: posterPath ? `${TMDB_IMAGE_BASE}/w500${posterPath}` : undefined,
      backdrop: backdropPath ? `${TMDB_IMAGE_BASE}/w780${backdropPath}` : undefined,
      category: mediaType,
      metadataProvider: 'tmdb',
      rating: Number(detail.vote_average) || undefined,
      voteCount: Number(detail.vote_count) || undefined,
      genres: (detail.genres ?? []).map((entry: any) => entry.name).filter(Boolean),
      directors: [...new Set(crew.filter((entry: any) => entry.job === 'Director').map((entry: any) => entry.name))] as string[],
      writers: [...new Set(crew.filter((entry: any) => entry.department === 'Writing').map((entry: any) => entry.name))] as string[],
      studios: (detail.production_companies ?? []).map((entry: any) => entry.name).filter(Boolean),
      countries: (detail.production_countries ?? detail.origin_country ?? []).map((entry: any) => typeof entry === 'string' ? entry : entry.name).filter(Boolean),
      certification: tmdbCertification(detail, mediaType, locale),
      status: detail.status,
      runtime: detail.runtime || detail.episode_run_time?.[0],
      cast,
    },
    episodes: [],
    tmdbMediaType: mediaType,
    tmdbId: detail.id,
  }
}

async function loadTmdbSeason(id: number, season: number, token: string, locale: string): Promise<ExternalEpisode[]> {
  const key = `${token.slice(-8)}:${locale}:${id}:${season}`
  let request = tmdbSeasonCache.get(key)
  if (!request) {
    request = tmdbFetch(`https://api.themoviedb.org/3/tv/${id}/season/${season}?language=${locale}`, token)
      .then((detail) => (detail.episodes ?? []).map((entry: any) => ({
        season: entry.season_number,
        episode: entry.episode_number,
        title: entry.name,
        overview: entry.overview,
        image: entry.still_path ? `${TMDB_IMAGE_BASE}/w300${entry.still_path}` : undefined,
        airdate: entry.air_date,
        runtime: entry.runtime,
      })))
      .catch(() => [])
    tmdbSeasonCache.set(key, request)
  }
  return request
}

let bangumiQueue: Promise<unknown> = Promise.resolve()

async function bangumiJson(url: string, options: { method?: string; body?: unknown } = {}) {
  if (Capacitor.isNativePlatform()) {
    if (nativeBangumiUnavailable) throw new Error('Bangumi 当前网络不可用')
    try {
      const response = await NativeHttp.request({ url, method: options.method, body: options.body ? JSON.stringify(options.body) : undefined })
      if (response.status < 200 || response.status >= 300) throw new Error(`Bangumi ${response.status}`)
      return JSON.parse(response.body)
    } catch (error) {
      nativeBangumiUnavailable = true
      throw error
    }
  }
  const response = await fetch(url, {
    method: options.method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  if (!response.ok) throw new Error(`Bangumi ${response.status}`)
  return response.json()
}

async function searchBangumi(query: string, year: string | undefined, season: number, locale: 'zh-CN' | 'ja-JP'): Promise<MetadataBundle | null> {
  const request = bangumiQueue.then(async () => {
    try {
      const search = await bangumiJson('https://api.bgm.tv/v0/search/subjects?limit=8', {
        method: 'POST',
        body: { keyword: query, sort: 'match', filter: { type: [2, 6], nsfw: false } },
      })
      const ranked = (search.data ?? []).map((entry: any) => {
        const titles = bangumiTitles(entry)
        let score = Math.max(0, ...titles.map((title) => confidence(query, title)))
        if (year && entry.date?.slice(0, 4) === year) score += 0.08
        return { entry, score }
      }).sort((a: any, b: any) => b.score - a.score)
      const best = ranked[0]
      if (!best || best.score < 0.84) return null

      const [detail, episodePage] = await Promise.all([
        bangumiJson(`https://api.bgm.tv/v0/subjects/${best.entry.id}`),
        bangumiJson(`https://api.bgm.tv/v0/episodes?subject_id=${best.entry.id}&type=0&limit=200`).catch(() => ({ data: [] })),
      ])
      const preferChinese = locale === 'zh-CN'
      const title = preferChinese ? detail.name_cn || detail.name : detail.name || detail.name_cn
      const movieHints = `${detail.platform ?? ''} ${(detail.meta_tags ?? []).join(' ')} ${detail.name_cn ?? ''} ${detail.name ?? ''}`
      const category = /电影|劇場|剧场|映画|movie/i.test(movieHints) ? 'movie' : 'tv'
      const episodes: ExternalEpisode[] = (episodePage.data ?? []).map((entry: any) => ({
        season,
        episode: Number(entry.ep ?? entry.sort) || undefined,
        title: preferChinese ? entry.name_cn || entry.name : entry.name || entry.name_cn,
        overview: preferChinese ? undefined : entry.desc,
        airdate: entry.airdate,
        runtime: parseBangumiDuration(entry.duration),
      }))
      return {
        base: {
          metadataProvider: 'bangumi' as const,
          metadataId: detail.id,
          title,
          overview: detail.summary,
          year: detail.date?.slice(0, 4),
          poster: detail.images?.large || detail.images?.common || detail.images?.medium,
          category,
          rating: Number(detail.rating?.score) || undefined,
          genres: (detail.tags ?? []).slice(0, 7).map((entry: any) => entry.name).filter(Boolean),
          runtime: episodes.find((entry) => entry.runtime)?.runtime,
        },
        episodes,
      }
    } catch (error) {
      console.warn('Bangumi 元数据请求失败', error)
      return null
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 650))
    }
  })
  bangumiQueue = request.then(() => undefined, () => undefined)
  return request as Promise<MetadataBundle | null>
}

function bangumiTitles(entry: any): string[] {
  const aliases = (entry.infobox ?? []).filter((row: any) => /别名|alias/i.test(row.key ?? '')).flatMap((row: any) => {
    if (Array.isArray(row.value)) return row.value.map((item: any) => typeof item === 'string' ? item : item?.v)
    return [row.value]
  })
  return [entry.name, entry.name_cn, ...aliases].filter((value): value is string => Boolean(value))
}

function parseBangumiDuration(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const clock = value.match(/^(\d{1,2}):(\d{2}):(\d{2})$/)
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]) + Math.round(Number(clock[3]) / 60)
  const minutes = value.match(/(\d+)\s*(?:m|min|分钟|分)/i)
  return minutes ? Number(minutes[1]) : undefined
}

let tvmazeQueue: Promise<unknown> = Promise.resolve()

async function searchTvmaze(query: string): Promise<MetadataBundle | null> {
  const request = tvmazeQueue.then(async () => {
    try {
      const response = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`)
      if (!response.ok) return null
      const results = await response.json()
      const ranked = results.map((result: any) => ({ ...result, localScore: confidence(query, result.show?.name ?? '') }))
        .sort((a: any, b: any) => b.localScore - a.localScore)
      const best = ranked[0]
      if (!best || best.localScore < 0.86) return null
      const detailResponse = await fetch(`https://api.tvmaze.com/shows/${best.show.id}?embed[]=episodes&embed[]=cast`)
      if (!detailResponse.ok) return null
      const show = await detailResponse.json()
      const episodes: ExternalEpisode[] = (show._embedded?.episodes ?? []).map((entry: any) => ({
        season: entry.season,
        episode: entry.number,
        title: entry.name,
        overview: String(entry.summary ?? '').replace(/<[^>]+>/g, ''),
        image: entry.image?.original || entry.image?.medium,
        airdate: entry.airdate,
        runtime: entry.runtime,
      }))
      const cast: MediaCastMember[] = (show._embedded?.cast ?? []).slice(0, 12).map((entry: any) => ({
        name: entry.person?.name,
        role: entry.character?.name,
        image: entry.person?.image?.original || entry.person?.image?.medium,
      })).filter((entry: MediaCastMember) => entry.name)
      return {
        base: {
          metadataId: show.id,
          title: show.name,
          overview: String(show.summary ?? '').replace(/<[^>]+>/g, ''),
          year: show.premiered?.slice(0, 4),
          poster: show.image?.original || show.image?.medium,
          backdrop: episodes.find((entry) => entry.image)?.image,
          category: 'tv' as const,
          metadataProvider: 'tvmaze' as const,
          rating: Number(show.rating?.average) || undefined,
          genres: show.genres ?? [],
          runtime: show.runtime || show.averageRuntime,
          cast,
        },
        episodes,
      }
    } catch {
      return null
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 550))
    }
  })
  tvmazeQueue = request.then(() => undefined, () => undefined)
  return request as Promise<MetadataBundle | null>
}
