import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import localforage from 'localforage'

export interface MediaItem {
  path: string
  title: string
  size: number
  modified: string
  thumb?: string
  position?: number
  duration?: number
  lastPlayed?: number
  tmdbId?: number
  poster?: string
  overview?: string
  originalTitle?: string
  tagline?: string
  year?: string
  releaseDate?: string
  category?: 'pending' | 'movie' | 'tv' | 'music' | 'other'
  metadataProvider?: 'tmdb' | 'bangumi' | 'tvmaze'
  metadataId?: number
  metadataLocale?: string
  season?: number
  episode?: number
  folderPath?: string
  libraryRoot?: string
  backdrop?: string
  rating?: number
  voteCount?: number
  genres?: string[]
  directors?: string[]
  writers?: string[]
  studios?: string[]
  countries?: string[]
  certification?: string
  status?: string
  runtime?: number
  cast?: MediaCastMember[]
  episodeTitle?: string
  episodeOverview?: string
  episodeImage?: string
  airdate?: string
  subtitles?: SidecarSubtitle[]
  artist?: string
  artists?: string[]
  album?: string
  albumArtist?: string
  trackNumber?: number
  discNumber?: number
  artworkPath?: string
  lyricsPath?: string
  musicMetadataProvider?: 'netease'
  musicMetadataId?: number
  musicMetadataFetchedAt?: number
  musicMetadataVersion?: number
  musicArtwork?: string
  streamUrl?: string
  streamProvider?: 'netease'
  metadataVersion?: number
  indexVersion?: number
  indexTitle?: string
  indexKind?: 'series' | 'movie'
}

export interface MediaCastMember {
  name: string
  role?: string
  image?: string
}

export interface SidecarSubtitle {
  path: string
  label: string
  language?: string
  mimeType: string
}

export interface MediaSeason {
  id: string
  folderPath: string
  folderName: string
  number?: number
  items: MediaItem[]
  sources: MediaSource[]
}

export interface MediaSource {
  id: string
  label: string
  folderPath: string
  folderName: string
  libraryRoot?: string
  items: MediaItem[]
}

export interface MediaWork {
  id: string
  identity: string
  title: string
  category: 'pending' | 'movie' | 'tv' | 'other'
  poster?: string
  thumbnail?: string
  backdrop?: string
  overview?: string
  originalTitle?: string
  tagline?: string
  year?: string
  releaseDate?: string
  rating?: number
  voteCount?: number
  genres: string[]
  directors: string[]
  writers: string[]
  studios: string[]
  countries: string[]
  certification?: string
  status?: string
  runtime?: number
  cast: MediaCastMember[]
  metadataProvider?: 'tmdb' | 'bangumi' | 'tvmaze'
  metadataId?: number
  items: MediaItem[]
  seasons: MediaSeason[]
  lastPlayed?: number
  indexKind?: 'series' | 'movie'
  manuallyCorrected: boolean
  metadataLocked: boolean
}

export interface MediaCorrection {
  path: string
  groupId?: string
  title?: string
  category?: 'movie' | 'tv' | 'other'
  season?: number | null
  episode?: number | null
  metadataLocked?: boolean
  updatedAt: number
}

export type MediaCorrectionUpdate = Omit<Partial<MediaCorrection>, 'path' | 'updatedAt'> & { path: string }

const STORAGE_KEY = 'bmovie-media-library'
const CORRECTIONS_KEY = 'bmovie-media-corrections-v1'
export const MEDIA_INDEX_VERSION = 2

export const useMediaStore = defineStore('media', () => {
  const items = ref<MediaItem[]>([])
  const corrections = ref<Record<string, MediaCorrection>>({})
  const loaded = ref(false)
  const recent = computed(() => items.value.filter((item) => item.lastPlayed).sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)))
  const musicItems = computed(() => items.value.filter((item) => item.category === 'music'))
  const works = computed<MediaWork[]>(() => {
    const grouped = new Map<string, MediaItem[]>()
    for (const item of items.value) {
      if (item.category === 'music') continue
      const identity = corrections.value[item.path]?.groupId
        ? `manual:${corrections.value[item.path].groupId}`
        : workIdentity(item)
      const group = grouped.get(identity) ?? []
      group.push(item)
      grouped.set(identity, group)
    }
    return [...grouped.entries()].map(([identity, group]) => {
      const primary = group.find((item) => item.poster || item.overview) ?? group.find((item) => item.thumb) ?? group[0]
      const sorted = [...group].sort(compareEpisodes)
      const category = primary.category === 'music' ? 'other' : primary.category ?? 'other'
      const folderName = (primary.folderPath ?? parentPath(primary.path)).split('/').filter(Boolean).at(-1)
      const indexKind = group.find((item) => item.indexKind)?.indexKind
      return {
        id: `w${hashIdentity(identity)}`,
        identity,
        title: category === 'pending'
          ? primary.indexTitle || folderName || primary.title
          : category === 'other' ? primary.indexTitle || (group.length > 1 ? folderName : undefined) || primary.title : primary.title,
        category,
        indexKind,
        poster: primary.poster,
        thumbnail: group.find((item) => item.thumb)?.thumb,
        backdrop: group.find((item) => item.backdrop)?.backdrop || group.find((item) => item.episodeImage)?.episodeImage,
        overview: primary.overview,
        originalTitle: primary.originalTitle,
        tagline: primary.tagline,
        year: primary.year,
        releaseDate: primary.releaseDate,
        rating: group.find((item) => Number.isFinite(item.rating) && (item.rating ?? 0) > 0)?.rating,
        voteCount: group.find((item) => Number.isFinite(item.voteCount) && (item.voteCount ?? 0) > 0)?.voteCount,
        genres: primary.genres ?? [],
        directors: primary.directors ?? [],
        writers: primary.writers ?? [],
        studios: primary.studios ?? [],
        countries: primary.countries ?? [],
        certification: primary.certification,
        status: primary.status,
        runtime: primary.runtime,
        cast: primary.cast ?? [],
        metadataProvider: primary.metadataProvider,
        metadataId: primary.metadataId ?? primary.tmdbId,
        items: sorted,
        seasons: category === 'tv' ? buildSeasons(sorted) : [],
        lastPlayed: Math.max(0, ...group.map((item) => item.lastPlayed ?? 0)) || undefined,
        manuallyCorrected: group.some((item) => Boolean(corrections.value[item.path])),
        metadataLocked: group.length > 0 && group.every((item) => corrections.value[item.path]?.metadataLocked === true),
      }
    }).sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.title.localeCompare(b.title, 'zh-CN'))
  })
  const recentWorks = computed(() => works.value.filter((work) => work.lastPlayed))
  let loadRequest: Promise<void> | undefined

  async function load() {
    if (loaded.value) return
    if (!loadRequest) {
      loadRequest = (async () => {
        const [savedItems, savedCorrections] = await Promise.all([
          localforage.getItem<MediaItem[]>(STORAGE_KEY),
          localforage.getItem<Record<string, MediaCorrection>>(CORRECTIONS_KEY),
        ])
        corrections.value = savedCorrections ?? {}
        const persistedItems = savedItems ?? []
        const libraryItems = persistedItems.filter((item) => !item.path.startsWith('netease://'))
        const migrated = libraryItems.map((item) => {
          const inferred = inferEpisode(item.path)
          return {
            ...item,
            poster: migrateTmdbImageUrl(item.poster),
            backdrop: resizeTmdbImageUrl(item.backdrop, 'w780'),
            episodeImage: resizeTmdbImageUrl(item.episodeImage, 'w300'),
            cast: item.cast?.map((member) => ({ ...member, image: migrateTmdbImageUrl(member.image) })),
            category: item.category ?? 'other',
            season: item.season ?? inferred.season,
            episode: item.episode ?? inferred.episode,
            folderPath: item.folderPath ?? parentPath(item.path),
          }
        })
        reconcileTvFolders(migrated)
        items.value = applyStoredCorrections(migrated, corrections.value)
        if (libraryItems.length !== persistedItems.length) await localforage.setItem(STORAGE_KEY, JSON.parse(JSON.stringify(items.value)))
        loaded.value = true
      })()
    }
    try {
      await loadRequest
    } finally {
      loadRequest = undefined
    }
  }
  async function save() {
    const plain = JSON.parse(JSON.stringify(items.value)) as MediaItem[]
    await localforage.setItem(STORAGE_KEY, plain)
  }
  function previewScan(scanned: MediaItem[]) {
    items.value = applyStoredCorrections(scanned, corrections.value)
  }
  async function commitScan(scanned: MediaItem[]) {
    reconcileTvFolders(scanned)
    items.value = applyStoredCorrections(scanned, corrections.value)
    await save()
  }
  function correctionFor(path: string) {
    return corrections.value[path]
  }
  function isMetadataLocked(path: string) {
    return corrections.value[path]?.metadataLocked === true
  }
  async function applyManualCorrections(updates: MediaCorrectionUpdate[]) {
    const now = Date.now()
    const next = { ...corrections.value }
    for (const update of updates) {
      const current = next[update.path]
      next[update.path] = {
        ...current,
        ...update,
        path: update.path,
        updatedAt: now,
      }
    }
    corrections.value = next
    items.value = applyStoredCorrections(items.value, next)
    await Promise.all([saveCorrections(), save()])
  }
  async function clearManualCorrections(paths: string[]) {
    const next = { ...corrections.value }
    for (const path of paths) delete next[path]
    corrections.value = next
    const affected = new Set(paths)
    for (const item of items.value) {
      if (!affected.has(item.path)) continue
      item.category = 'pending'
      item.metadataVersion = 0
    }
    await Promise.all([saveCorrections(), save()])
  }
  async function saveCorrections() {
    await localforage.setItem(CORRECTIONS_KEY, JSON.parse(JSON.stringify(corrections.value)))
  }
  async function updateProgress(path: string, title: string, position: number, duration: number) {
    if (path.startsWith('netease://')) return
    let item = items.value.find((entry) => entry.path === path)
    if (!item) { item = { path, title, size: 0, modified: '' }; items.value.push(item) }
    // Some WebViews reset currentTime to zero while tearing down the video.
    // Do not let that late event erase a valid position saved by pause/ended.
    if (!(position < 1 && (item.position ?? 0) >= 1)) item.position = position
    item.duration = duration
    item.lastPlayed = Date.now()
    await save()
  }
  async function updateMusicMetadata(path: string, metadata: Partial<MediaItem>) {
    const item = items.value.find((entry) => entry.path === path)
    if (!item) return
    Object.assign(item, metadata)
    await save()
  }
  async function updateMusicMetadataBatch(updates: Array<{ path: string; metadata: Partial<MediaItem> }>) {
    let changed = false
    for (const update of updates) {
      const item = items.value.find((entry) => entry.path === update.path)
      if (!item) continue
      Object.assign(item, update.metadata)
      changed = true
    }
    if (changed) await save()
  }
  async function updateMediaMetadataBatch(updates: Array<{ path: string; metadata: Partial<MediaItem> }>) {
    let changed = false
    for (const update of updates) {
      const item = items.value.find((entry) => entry.path === update.path)
      if (!item) continue
      Object.assign(item, update.metadata)
      changed = true
    }
    if (!changed) return
    items.value = applyStoredCorrections(items.value, corrections.value)
    await save()
  }
  return {
    items, works, musicItems, recent, recentWorks, corrections, loaded, load, previewScan, commitScan,
    correctionFor, isMetadataLocked, applyManualCorrections, clearManualCorrections,
    updateProgress, updateMusicMetadata, updateMusicMetadataBatch, updateMediaMetadataBatch,
  }
})

function applyStoredCorrections(items: MediaItem[], corrections: Record<string, MediaCorrection>) {
  return items.map((source) => {
    const correction = corrections[source.path]
    if (!correction) return source
    const item = { ...source }
    if (correction.title !== undefined) item.title = correction.title
    if (correction.category !== undefined) item.category = correction.category
    if (correction.season !== undefined) item.season = correction.season ?? undefined
    if (correction.episode !== undefined) item.episode = correction.episode ?? undefined
    return item
  })
}

function workIdentity(item: MediaItem) {
  if (item.category === 'pending') return `pending:${item.folderPath ?? parentPath(item.path)}`
  if (item.category === 'other') return `folder:${item.folderPath ?? parentPath(item.path)}`
  if (!item.metadataProvider) return `file:${item.path}`
  const metadataId = item.metadataId ?? item.tmdbId
  if (metadataId) return `metadata:${item.metadataProvider}:${metadataId}`
  return `metadata:${item.metadataProvider}:${normalizeTitle(item.title)}:${item.year ?? ''}`
}

function normalizeTitle(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function migrateTmdbImageUrl(value?: string) {
  return value?.replace(/^https:\/\/image\.tmdb\.org\//, 'https://images.tmdb.org/')
}

function resizeTmdbImageUrl(value: string | undefined, size: 'w300' | 'w780') {
  return migrateTmdbImageUrl(value)?.replace(/\/t\/p\/(?:original|w\d+)\//, `/t/p/${size}/`)
}

function compareEpisodes(a: MediaItem, b: MediaItem) {
  return (a.season ?? 1) - (b.season ?? 1)
    || (a.episode ?? Number.MAX_SAFE_INTEGER) - (b.episode ?? Number.MAX_SAFE_INTEGER)
    || a.path.localeCompare(b.path, 'zh-CN', { numeric: true })
}

function buildSeasons(items: MediaItem[]): MediaSeason[] {
  const folders = new Map<string, MediaItem[]>()
  for (const item of items) {
    const folderPath = item.folderPath ?? parentPath(item.path)
    const group = folders.get(folderPath) ?? []
    group.push(item)
    folders.set(folderPath, group)
  }
  const folderSources = [...folders.entries()].map(([folderPath, group]) => {
    const folderName = folderPath.split('/').filter(Boolean).at(-1) ?? folderPath
    const explicitNumber = inferSeasonNumber(folderName)
    const itemNumbers = [...new Set(group.map((item) => item.season).filter((value): value is number => Boolean(value)))]
    return {
      number: explicitNumber ?? (itemNumbers.length === 1 ? itemNumbers[0] : undefined),
      source: {
        id: `source-${hashIdentity(folderPath)}`,
        label: sourceLabel(group[0], folderName),
        folderPath,
        folderName,
        libraryRoot: group[0]?.libraryRoot,
        items: [...group].sort(compareEpisodes),
      } satisfies MediaSource,
    }
  }).sort((a, b) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER)
    || a.source.folderPath.localeCompare(b.source.folderPath, 'zh-CN', { numeric: true }))

  const seasons: Array<{ number?: number, sources: MediaSource[] }> = []
  for (const candidate of folderSources) {
    const matchingSeason = seasons.find((season) => {
      if (season.number && candidate.number && season.number !== candidate.number) return false
      if (season.number && candidate.number && season.number === candidate.number) return true
      return season.sources.some((source) => sourcesContainSameEpisodes(source, candidate.source))
    })
    if (matchingSeason) {
      matchingSeason.number ??= candidate.number
      matchingSeason.sources.push(candidate.source)
    } else {
      seasons.push({ number: candidate.number, sources: [candidate.source] })
    }
  }

  if (seasons.length > 1) {
    const used = new Set(seasons.map((group) => group.number).filter((value): value is number => Boolean(value)))
    let next = 1
    for (const group of seasons) {
      if (group.number) continue
      while (used.has(next)) next += 1
      group.number = next
      used.add(next)
    }
    seasons.sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
  }

  return seasons.map((season) => {
    makeSourceLabelsUnique(season.sources)
    const primary = season.sources[0]
    const items = season.sources.flatMap((source) => source.items).sort(compareEpisodes)
    const identity = `${season.number ?? 'unknown'}:${season.sources.map((source) => source.folderPath).sort().join('|')}`
    return {
      id: `s${hashIdentity(identity)}`,
      folderPath: primary.folderPath,
      folderName: primary.folderName,
      number: season.number,
      items,
      sources: season.sources,
    }
  })
}

function sourceLabel(item: MediaItem | undefined, folderName: string) {
  const root = item?.libraryRoot || item?.path
  return root?.split('/').filter(Boolean)[0] || folderName || '未知来源'
}

function makeSourceLabelsUnique(sources: MediaSource[]) {
  const counts = new Map<string, number>()
  for (const source of sources) counts.set(source.label, (counts.get(source.label) ?? 0) + 1)
  const used = new Map<string, number>()
  for (const source of sources) {
    if ((counts.get(source.label) ?? 0) <= 1) continue
    const base = `${source.label} · ${source.folderName}`
    const index = (used.get(base) ?? 0) + 1
    used.set(base, index)
    source.label = index > 1 ? `${base} ${index}` : base
  }
}

function sourcesContainSameEpisodes(a: MediaSource, b: MediaSource) {
  const aItems = a.items.filter((item) => item.episode)
  const bItems = b.items.filter((item) => item.episode)
  const minimum = Math.min(aItems.length, bItems.length)
  if (minimum < 2) return false

  const exactA = new Set(aItems.map(exactEpisodeFingerprint))
  const exactMatches = bItems.filter((item) => exactA.has(exactEpisodeFingerprint(item))).length
  if (exactMatches >= 2 && exactMatches / minimum >= 0.5) return true

  const semanticA = new Set(aItems.map(semanticEpisodeFingerprint).filter(Boolean))
  const semanticMatches = bItems.filter((item) => {
    const fingerprint = semanticEpisodeFingerprint(item)
    return fingerprint ? semanticA.has(fingerprint) : false
  }).length
  return semanticMatches >= Math.min(3, minimum) && semanticMatches / minimum >= 0.8
}

function exactEpisodeFingerprint(item: MediaItem) {
  const fileName = item.path.split('/').at(-1)?.normalize('NFKC').toLocaleLowerCase() ?? ''
  return `${item.episode}:${item.size}:${fileName}`
}

function semanticEpisodeFingerprint(item: MediaItem) {
  const title = item.episodeTitle ? normalizeTitle(item.episodeTitle) : ''
  return item.episode && title ? `${item.episode}:${title}` : ''
}

function inferSeasonNumber(value: string) {
  const numeric = value.match(/(?:^|\b)(?:S|Season)[ ._-]*(\d{1,2})(?:\b|$)/i)
    ?? value.match(/第\s*(\d{1,2})\s*季/)
  if (numeric) return Number(numeric[1]) || undefined
  const chinese: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  const written = value.match(/第\s*([一二三四五六七八九十])\s*季/)
  return written ? chinese[written[1]] : undefined
}

function parentPath(path: string) {
  const index = path.lastIndexOf('/')
  return index > 0 ? path.slice(0, index) : '/'
}

function reconcileTvFolders(items: MediaItem[]) {
  const folders = new Map<string, MediaItem[]>()
  for (const item of items) {
    const folderPath = item.folderPath ?? parentPath(item.path)
    item.folderPath = folderPath
    const group = folders.get(folderPath) ?? []
    group.push(item)
    folders.set(folderPath, group)
  }

  for (const group of folders.values()) {
    const recognized = group.filter((item) => item.category === 'tv' && item.metadataProvider)
    const identities = new Set(recognized.map(workIdentity))
    if (identities.size !== 1) continue
    const primary = recognized.find((item) => item.poster || item.overview) ?? recognized[0]
    const commonSeason = [...new Set(recognized.map((item) => item.season).filter((value): value is number => Boolean(value)))]
    for (const item of group) {
      if (item.category === 'tv' || item.category === 'music') continue
      item.category = 'tv'
      item.title = primary.title
      item.poster = primary.poster
      item.backdrop = primary.backdrop
      item.overview = primary.overview
      item.originalTitle = primary.originalTitle
      item.tagline = primary.tagline
      item.year = primary.year
      item.releaseDate = primary.releaseDate
      item.rating = primary.rating
      item.voteCount = primary.voteCount
      item.genres = primary.genres
      item.directors = primary.directors
      item.writers = primary.writers
      item.studios = primary.studios
      item.countries = primary.countries
      item.certification = primary.certification
      item.status = primary.status
      item.runtime = primary.runtime
      item.cast = primary.cast
      item.metadataProvider = primary.metadataProvider
      item.metadataId = primary.metadataId
      item.tmdbId = primary.tmdbId
      item.metadataVersion = primary.metadataVersion
      item.metadataLocale = primary.metadataLocale
      if (!item.season && commonSeason.length === 1) item.season = commonSeason[0]
    }
  }
}

function hashIdentity(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function inferEpisode(value: string) {
  const standard = value.match(/\bS(\d{1,2})[ ._-]*E(\d{1,3})\b/i)
  const alternate = value.match(/\b(\d{1,2})x(\d{1,3})\b/i)
  const simple = value.match(/\b(?:EP|Episode)[ ._-]*(\d{1,3})\b/i)
    ?? value.match(/第\s*(\d{1,3})\s*[集话]/)
    ?? value.match(/\[(\d{1,3})\]/)
  return {
    season: Number(standard?.[1] ?? alternate?.[1]) || undefined,
    episode: Number(standard?.[2] ?? alternate?.[2] ?? simple?.[1]) || undefined,
  }
}
