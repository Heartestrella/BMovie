import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useLibrarySourcesStore } from './librarySources'
import { MEDIA_INDEX_VERSION, useMediaStore, type MediaItem, type SidecarSubtitle } from './media'
import { useOpenListStore } from './openlist'
import { openListRequest, type OpenListFile } from '../services/openlist'
import { loadMetadataSettings, matchMetadataGroup, METADATA_VERSION, resolveMetadataLocale } from '../services/metadata'

type ScanStage = 'idle' | 'preparing' | 'indexing' | 'metadata' | 'saving'

const MAX_MEDIA_FILES = 5000
const DIRECTORY_CONCURRENCY = 6
const METADATA_CONCURRENCY = 4
const UI_PUBLISH_INTERVAL = 240
const videoPattern = /\.(mp4|mkv|webm|mov|m4v|avi|ts|m2ts|flv|wmv|m3u8)$/i
const audioPattern = /\.(mp3|flac|m4a|aac|ogg|opus|wav|wma|ape|alac|aiff|mka)$/i
const subtitlePattern = /\.(srt|ass|ssa|vtt)$/i
const lyricPattern = /\.lrc$/i
const artworkPattern = /\.(jpe?g|png|webp)$/i

export const useLibraryScanStore = defineStore('library-scan', () => {
  const scanning = ref(false)
  const stage = ref<ScanStage>('idle')
  const error = ref('')
  const currentFolder = ref('')
  const discovered = ref(0)
  const indexedFolders = ref(0)
  const indexedGroups = ref(0)
  const processed = ref(0)
  const recognized = ref(0)
  const candidateCount = ref(0)
  const failedFolders = ref(0)
  const reachedLimit = ref(false)
  const musicPreview = ref<MediaItem[]>([])
  const progress = computed(() => candidateCount.value > 0 ? Math.min(1, processed.value / candidateCount.value) : 0)
  let activeScan: Promise<void> | undefined

  function start() {
    if (activeScan) return activeScan
    scanning.value = true
    stage.value = 'preparing'
    activeScan = run().finally(() => {
      scanning.value = false
      stage.value = 'idle'
      currentFolder.value = ''
      activeScan = undefined
    })
    return activeScan
  }

  async function run() {
    const media = useMediaStore()
    const sources = useLibrarySourcesStore()
    const openlist = useOpenListStore()
    error.value = ''
    currentFolder.value = ''
    discovered.value = 0
    indexedFolders.value = 0
    indexedGroups.value = 0
    processed.value = 0
    recognized.value = 0
    candidateCount.value = 0
    failedFolders.value = 0
    reachedLimit.value = false
    musicPreview.value = []

    await Promise.all([media.load(), sources.load()])
    if (!sources.enabledSources.length) {
      error.value = '请先选择至少一个媒体目录'
      return
    }

    try {
      if (openlist.state !== 'ready') await openlist.start()
      if (openlist.state !== 'ready') throw new Error(openlist.error || 'OpenList 服务未就绪')
      const settings = await loadMetadataSettings()
      const metadataLocale = resolveMetadataLocale(settings)
      const previous = new Map(media.items.map((item) => [item.path, item]))
      const queue = sources.enabledSources.map((source) => source.path)
      let queueCursor = 0
      const visitedFolders = new Set<string>()
      const visitedFiles = new Set<string>()
      const unreadableFolders = new Set<string>()
      const draft: MediaItem[] = []
      const musicDraft: MediaItem[] = []
      let lastMusicPublish = 0
      let lastIndexPublish = 0

      const publishIndex = async (force = false) => {
        const now = performance.now()
        if (!force && now - lastIndexPublish < UI_PUBLISH_INTERVAL) return
        lastIndexPublish = now
        const retained = [...previous.values()].filter((item) => !visitedFiles.has(item.path))
        media.previewScan(cloneItems([...draft, ...retained]))
        await yieldToMainThread()
      }

      stage.value = 'indexing'
      while (queueCursor < queue.length && discovered.value < MAX_MEDIA_FILES) {
        const batch: string[] = []
        while (batch.length < DIRECTORY_CONCURRENCY && queueCursor < queue.length) {
          const path = queue[queueCursor++]
          if (visitedFolders.has(path)) continue
          visitedFolders.add(path)
          batch.push(path)
        }
        if (!batch.length) continue
        const listings = await Promise.all(batch.map(async (parent) => {
          try {
            return { parent, files: await listFolder(openlist.baseUrl, openlist.token, parent) }
          } catch {
            return { parent, files: undefined }
          }
        }))

        for (const { parent, files } of listings) {
          currentFolder.value = parent
          indexedFolders.value += 1
          if (!files) {
            failedFolders.value += 1
            unreadableFolders.add(parent)
            continue
          }
          for (const directory of files.filter((file) => file.is_dir)) queue.push(childPath(parent, directory.name))
          const videoFiles = files.filter((file) => !file.is_dir && videoPattern.test(file.name))
          const audioFiles = files.filter((file) => !file.is_dir && audioPattern.test(file.name))
          if (videoFiles.length || audioFiles.length) indexedGroups.value += 1
          const episodeHints = videoFiles.filter((file) => looksLikeEpisode(file.name)).length
          const indexKind: MediaItem['indexKind'] = videoFiles.length > 1 && episodeHints >= Math.min(2, videoFiles.length) ? 'series' : 'movie'
          const indexTitle = folderIndexTitle(parent)
          const subtitleIndex = buildSubtitleIndex(files, parent)
          const lyricIndex = buildLyricIndex(files, parent)
          const artworkPath = findFolderArtwork(files, parent)
          const libraryRoot = sources.enabledSources.find((source) => parent === source.path || parent.startsWith(`${source.path}/`))?.path

          for (const file of videoFiles) {
            if (discovered.value >= MAX_MEDIA_FILES) break
            const path = childPath(parent, file.name)
            if (visitedFiles.has(path)) continue
            visitedFiles.add(path)
            const old = previous.get(path)
            const base: MediaItem = {
              path,
              title: basenameWithoutExtension(file.name),
              size: file.size,
              modified: file.modified,
              thumb: file.thumb || old?.thumb,
              category: 'pending',
              folderPath: parent,
              libraryRoot,
              indexTitle,
              indexKind,
              indexVersion: MEDIA_INDEX_VERSION,
              subtitles: subtitleIndex.get(normalizedStem(file.name)) ?? [],
              position: old?.position,
              duration: old?.duration,
              lastPlayed: old?.lastPlayed,
            }
            draft.push(canReuseMetadata(old, metadataLocale) ? {
              ...old!,
              path: base.path,
              size: base.size,
              modified: base.modified,
              thumb: base.thumb,
              folderPath: base.folderPath,
              libraryRoot: base.libraryRoot,
              indexTitle,
              indexKind,
              indexVersion: MEDIA_INDEX_VERSION,
              subtitles: base.subtitles,
              position: base.position,
              duration: base.duration,
              lastPlayed: base.lastPlayed,
            } : base)
            discovered.value += 1
          }

          for (const file of audioFiles) {
            if (discovered.value >= MAX_MEDIA_FILES) break
            const path = childPath(parent, file.name)
            if (visitedFiles.has(path)) continue
            visitedFiles.add(path)
            const old = previous.get(path)
            const inferred = inferMusicMetadata(file.name, parent)
            const base: MediaItem = {
              path,
              title: inferred.title,
              artist: inferred.artist,
              album: inferred.album,
              trackNumber: inferred.trackNumber,
              discNumber: inferred.discNumber,
              size: file.size,
              modified: file.modified,
              thumb: file.thumb || old?.thumb,
              category: 'music',
              folderPath: parent,
              libraryRoot,
              artworkPath,
              lyricsPath: lyricIndex.get(normalizedStem(file.name)),
              position: old?.position,
              duration: old?.duration,
              lastPlayed: old?.lastPlayed,
              metadataVersion: METADATA_VERSION,
              metadataLocale,
              indexVersion: MEDIA_INDEX_VERSION,
            }
            const musicItem = old?.category === 'music' ? { ...old, ...base } : base
            draft.push(musicItem)
            musicDraft.push(musicItem)
            discovered.value += 1
          }
        }
        if (performance.now() - lastMusicPublish > UI_PUBLISH_INTERVAL) {
          lastMusicPublish = performance.now()
          musicPreview.value = cloneItems(musicDraft)
        }
        await publishIndex()
      }
      await publishIndex(true)
      reachedLimit.value = discovered.value >= MAX_MEDIA_FILES
      musicPreview.value = cloneItems(musicDraft)
      if (!reachedLimit.value && unreadableFolders.size) {
        for (const item of previous.values()) {
          if (visitedFiles.has(item.path) || ![...unreadableFolders].some((folder) => item.path === folder || item.path.startsWith(`${folder}/`))) continue
          draft.push({ ...item })
          visitedFiles.add(item.path)
          discovered.value += 1
        }
      }

      const groups = buildMetadataGroups(draft)
      candidateCount.value = groups.length
      stage.value = 'metadata'
      media.previewScan(cloneItems(draft))
      await yieldToMainThread()

      let cursor = 0
      let lastPublish = performance.now()
      const publishInterval = draft.length > 1000 ? 1000 : UI_PUBLISH_INTERVAL
      const publish = async (force = false) => {
        const now = performance.now()
        if (!force && now - lastPublish < publishInterval) return
        lastPublish = now
        media.previewScan(cloneItems(draft))
        await yieldToMainThread()
      }
      const worker = async () => {
        while (cursor < groups.length) {
          const group = groups[cursor++]
          currentFolder.value = group[0]?.folderPath || group[0]?.title || ''
          try {
            const patches = await matchMetadataGroup(group, settings)
            if (patches.size) recognized.value += 1
            for (const item of group) {
              const patch = patches.get(item.path)
              Object.assign(item, patch
                ? { ...patch, category: patch.category ?? 'other' }
                : { category: 'other', metadataVersion: METADATA_VERSION, metadataLocale })
            }
          } catch {
            for (const item of group) Object.assign(item, { category: 'other', metadataVersion: METADATA_VERSION, metadataLocale })
          }
          processed.value += 1
          await publish()
        }
      }
      await Promise.all(Array.from({ length: Math.min(METADATA_CONCURRENCY, groups.length) }, () => worker()))
      await publish(true)

      stage.value = 'saving'
      currentFolder.value = ''
      await media.commitScan(draft)
      musicPreview.value = []
      await sources.markScanned()
      if (failedFolders.value && !draft.length) error.value = '所选媒体目录暂时无法读取，请检查网盘连接或目录是否仍然存在'
      else if (reachedLimit.value) error.value = `已达到单次扫描 ${MAX_MEDIA_FILES} 个媒体文件的安全上限，请缩小媒体目录范围`
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason)
    }
  }

  return { scanning, stage, error, currentFolder, discovered, indexedFolders, indexedGroups, processed, recognized, candidateCount, failedFolders, reachedLimit, musicPreview, progress, start }
})

async function listFolder(baseUrl: string, token: string, path: string) {
  const data = await openListRequest<{ content: OpenListFile[] | null }>(baseUrl, '/api/fs/list', {
    path, password: '', page: 1, per_page: 0, refresh: false,
  }, token)
  return data.content ?? []
}

function buildMetadataGroups(items: MediaItem[]) {
  const folders = new Map<string, MediaItem[]>()
  for (const item of items) {
    if (item.category !== 'pending') continue
    const folder = item.folderPath ?? parentPath(item.path)
    const group = folders.get(folder) ?? []
    group.push(item)
    folders.set(folder, group)
  }
  const groups: MediaItem[][] = []
  for (const pending of folders.values()) {
    const episodeHints = pending.filter((item) => looksLikeEpisode(item.title)).length
    const looksLikeSeries = pending.length > 1 && episodeHints >= Math.min(2, pending.length)
    if (looksLikeSeries) groups.push(pending)
    else for (const item of pending) groups.push([item])
  }
  return groups
}

function looksLikeEpisode(value: string) {
  return /\bS\d{1,2}[ ._-]*E\d{1,3}\b/i.test(value)
    || /\b\d{1,2}x\d{1,3}\b/i.test(value)
    || /\b(?:EP|Episode)[ ._-]*\d{1,3}\b/i.test(value)
    || /第\s*\d{1,3}\s*[集话]/.test(value)
    || /\[\d{1,3}\]/.test(value)
}

function canReuseMetadata(item: MediaItem | undefined, locale: string) {
  return Boolean(item && item.category !== 'pending' && (item.metadataVersion ?? 0) >= METADATA_VERSION && item.metadataLocale === locale)
}

function cloneItems(items: MediaItem[]) {
  return items.map((item) => ({ ...item }))
}

function childPath(parent: string, name: string) {
  return `${parent === '/' ? '' : parent}/${name}`
}

function parentPath(path: string) {
  const index = path.lastIndexOf('/')
  return index > 0 ? path.slice(0, index) : '/'
}

function basenameWithoutExtension(name: string) {
  return name.replace(/\.[^.]+$/, '')
}

function folderIndexTitle(path: string) {
  const parts = path.split('/').filter(Boolean)
  const folder = parts.at(-1) ?? path
  if (/^(?:第\s*[一二三四五六七八九十两\d]+\s*季|S(?:eason)?[ ._-]*\d{1,2}|正片|TV)$/i.test(folder)) {
    return parts.at(-2) ?? folder
  }
  return folder.replace(/^\d{1,2}[.、 _-]+/, '').trim() || folder
}

function buildSubtitleIndex(files: OpenListFile[], parent: string) {
  const videoStems = new Set(files.filter((file) => !file.is_dir && videoPattern.test(file.name)).map((file) => normalizedStem(file.name)))
  const result = new Map<string, SidecarSubtitle[]>()
  for (const file of files) {
    if (file.is_dir || !subtitlePattern.test(file.name)) continue
    const subtitleStem = basenameWithoutExtension(file.name)
    const normalizedSubtitle = subtitleStem.normalize('NFKC').toLocaleLowerCase()
    let matchedStem = videoStems.has(normalizedSubtitle) ? normalizedSubtitle : ''
    for (let index = 1; index < normalizedSubtitle.length; index += 1) {
      if (!'. _-[('.includes(normalizedSubtitle[index])) continue
      const candidate = normalizedSubtitle.slice(0, index)
      if (candidate.length > matchedStem.length && videoStems.has(candidate)) matchedStem = candidate
    }
    if (!matchedStem) continue
    const suffix = normalizedSubtitle.slice(matchedStem.length)
    const extension = file.name.split('.').at(-1)?.toLocaleLowerCase() ?? 'srt'
    const languageHint = suffix.replace(/^[^a-z0-9\p{L}]+/iu, '').replace(/[^a-z0-9\p{L}]+$/iu, '').toLocaleLowerCase()
    const language = subtitleLanguage(languageHint)
    const sidecar = {
      path: childPath(parent, file.name),
      label: language?.label ?? (languageHint ? languageHint.toLocaleUpperCase() : '外挂字幕'),
      language: language?.code,
      mimeType: extension === 'vtt' ? 'text/vtt' : extension === 'srt' ? 'application/x-subrip' : 'text/x-ssa',
    }
    const sidecars = result.get(matchedStem) ?? []
    sidecars.push(sidecar)
    result.set(matchedStem, sidecars)
  }
  return result
}

function buildLyricIndex(files: OpenListFile[], parent: string) {
  const audioStems = new Set(files.filter((file) => !file.is_dir && audioPattern.test(file.name)).map((file) => normalizedStem(file.name)))
  const result = new Map<string, string>()
  for (const file of files) {
    if (file.is_dir || !lyricPattern.test(file.name)) continue
    const normalized = normalizedStem(file.name)
    let matched = audioStems.has(normalized) ? normalized : ''
    for (let index = 1; index < normalized.length; index += 1) {
      if (!'. _-[('.includes(normalized[index])) continue
      const candidate = normalized.slice(0, index)
      if (candidate.length > matched.length && audioStems.has(candidate)) matched = candidate
    }
    if (matched) result.set(matched, childPath(parent, file.name))
  }
  return result
}

function findFolderArtwork(files: OpenListFile[], parent: string) {
  const images = files.filter((file) => !file.is_dir && artworkPattern.test(file.name))
  const preferred = images.find((file) => /^(cover|folder|front|album)(?:[ ._-]|\.)/i.test(file.name)) ?? images[0]
  return preferred ? childPath(parent, preferred.name) : undefined
}

function inferMusicMetadata(fileName: string, parent: string) {
  const stem = basenameWithoutExtension(fileName).normalize('NFKC').trim()
  const trackMatch = stem.match(/^(?:(?:CD|DISC)\s*(\d{1,2})[ ._-]+)?(\d{1,3})[ ._-]+(.+)$/i)
  const cleaned = (trackMatch?.[3] ?? stem).trim()
  const segments = cleaned.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean)
  const artist = segments.length > 1 ? segments.shift() : undefined
  return {
    title: segments.join(' - ') || cleaned,
    artist,
    album: parent.split('/').filter(Boolean).at(-1) || '未知专辑',
    trackNumber: trackMatch ? Number(trackMatch[2]) || undefined : undefined,
    discNumber: trackMatch?.[1] ? Number(trackMatch[1]) || undefined : undefined,
  }
}

function normalizedStem(fileName: string) {
  return basenameWithoutExtension(fileName).normalize('NFKC').toLocaleLowerCase()
}

function subtitleLanguage(value: string) {
  if (/^(zh|zh-cn|chs|sc|简|简中|中文)$/.test(value)) return { code: 'zh-CN', label: '简体中文' }
  if (/^(zh-tw|cht|tc|繁|繁中)$/.test(value)) return { code: 'zh-TW', label: '繁体中文' }
  if (/^(en|eng|english)$/.test(value)) return { code: 'en', label: 'English' }
  if (/^(ja|jpn|jp|japanese)$/.test(value)) return { code: 'ja', label: '日本語' }
  return undefined
}

function yieldToMainThread() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}
