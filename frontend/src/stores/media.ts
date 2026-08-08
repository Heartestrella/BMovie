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
  category?: 'pending' | 'movie' | 'tv' | 'other'
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
  metadataVersion?: number
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
}

const STORAGE_KEY = 'bmovie-media-library'

export const useMediaStore = defineStore('media', () => {
  const items = ref<MediaItem[]>([])
  const loaded = ref(false)
  const recent = computed(() => items.value.filter((item) => item.lastPlayed).sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)))
  const works = computed<MediaWork[]>(() => {
    const grouped = new Map<string, MediaItem[]>()
    for (const item of items.value) {
      const identity = workIdentity(item)
      const group = grouped.get(identity) ?? []
      group.push(item)
      grouped.set(identity, group)
    }
    return [...grouped.entries()].map(([identity, group]) => {
      const primary = group.find((item) => item.poster || item.overview) ?? group.find((item) => item.thumb) ?? group[0]
      const sorted = [...group].sort(compareEpisodes)
      const category = primary.category ?? 'other'
      const folderName = (primary.folderPath ?? parentPath(primary.path)).split('/').filter(Boolean).at(-1)
      return {
        id: `w${hashIdentity(identity)}`,
        identity,
        title: category === 'other' && group.length > 1 ? folderName || primary.title : primary.title,
        category,
        poster: primary.poster,
        thumbnail: group.find((item) => item.thumb)?.thumb,
        backdrop: group.find((item) => item.backdrop)?.backdrop || group.find((item) => item.episodeImage)?.episodeImage,
        overview: primary.overview,
        originalTitle: primary.originalTitle,
        tagline: primary.tagline,
        year: primary.year,
        releaseDate: primary.releaseDate,
        rating: primary.rating,
        voteCount: primary.voteCount,
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
      }
    }).sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.title.localeCompare(b.title, 'zh-CN'))
  })
  const recentWorks = computed(() => works.value.filter((work) => work.lastPlayed))
  let scanHistory = new Map<string, MediaItem>()
  let unsavedScanItems = 0
  let loadRequest: Promise<void> | undefined

  async function load() {
    if (loaded.value) return
    if (!loadRequest) {
      loadRequest = (async () => {
        items.value = ((await localforage.getItem<MediaItem[]>(STORAGE_KEY)) ?? []).map((item) => {
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
        reconcileTvFolders(items.value)
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
  async function replaceLibrary(scanned: MediaItem[]) {
    const history = new Map(items.value.map((item) => [item.path, item]))
    items.value = scanned.map((item) => ({ ...item, ...pickProgress(history.get(item.path)) }))
    await save()
  }
  function beginScan() {
    scanHistory = new Map(items.value.map((item) => [item.path, item]))
    unsavedScanItems = 0
    items.value = []
  }
  async function appendScanned(item: MediaItem) {
    const previous = scanHistory.get(item.path)
    items.value.push({ ...item, ...pickProgress(previous) })
    unsavedScanItems += 1
    if (unsavedScanItems >= 20) {
      unsavedScanItems = 0
      await save()
    }
  }
  function updateScanned(path: string, patch: Partial<MediaItem>) {
    const item = items.value.find((entry) => entry.path === path)
    if (item) Object.assign(item, patch)
  }
  async function finishScan() {
    unsavedScanItems = 0
    scanHistory.clear()
    reconcileTvFolders(items.value)
    await save()
  }
  async function updateProgress(path: string, title: string, position: number, duration: number) {
    let item = items.value.find((entry) => entry.path === path)
    if (!item) { item = { path, title, size: 0, modified: '' }; items.value.push(item) }
    // Some WebViews reset currentTime to zero while tearing down the video.
    // Do not let that late event erase a valid position saved by pause/ended.
    if (!(position < 1 && (item.position ?? 0) >= 1)) item.position = position
    item.duration = duration
    item.lastPlayed = Date.now()
    await save()
  }
  return { items, works, recent, recentWorks, loaded, load, replaceLibrary, beginScan, appendScanned, updateScanned, finishScan, updateProgress }
})

function pickProgress(item?: MediaItem) {
  return item ? { position: item.position, duration: item.duration, lastPlayed: item.lastPlayed } : {}
}

function workIdentity(item: MediaItem) {
  if (item.category === 'pending') return `pending:${item.path}`
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
    folders.set(folderPath, [...(folders.get(folderPath) ?? []), item])
  }
  const groups = [...folders.entries()].map(([folderPath, group]) => {
    const folderName = folderPath.split('/').filter(Boolean).at(-1) ?? folderPath
    const explicitNumber = inferSeasonNumber(folderName)
    const itemNumbers = [...new Set(group.map((item) => item.season).filter((value): value is number => Boolean(value)))]
    return {
      id: `s${hashIdentity(folderPath)}`,
      folderPath,
      folderName,
      number: explicitNumber ?? (itemNumbers.length === 1 ? itemNumbers[0] : undefined),
      items: [...group].sort(compareEpisodes),
    }
  }).sort((a, b) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER)
    || a.folderPath.localeCompare(b.folderPath, 'zh-CN', { numeric: true }))

  if (groups.length > 1) {
    const used = new Set(groups.map((group) => group.number).filter((value): value is number => Boolean(value)))
    let next = 1
    for (const group of groups) {
      if (group.number) continue
      while (used.has(next)) next += 1
      group.number = next
      used.add(next)
    }
    groups.sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
  }
  return groups
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
    folders.set(folderPath, [...(folders.get(folderPath) ?? []), item])
  }

  for (const group of folders.values()) {
    const recognized = group.filter((item) => item.category === 'tv' && item.metadataProvider)
    const identities = new Set(recognized.map(workIdentity))
    if (identities.size !== 1) continue
    const primary = recognized.find((item) => item.poster || item.overview) ?? recognized[0]
    const commonSeason = [...new Set(recognized.map((item) => item.season).filter((value): value is number => Boolean(value)))]
    for (const item of group) {
      if (item.category === 'tv') continue
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
