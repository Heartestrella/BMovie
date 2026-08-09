import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useLibrarySourcesStore } from './librarySources'
import { useMediaStore, type MediaItem, type SidecarSubtitle } from './media'
import { useOpenListStore } from './openlist'
import { openListRequest, type OpenListFile } from '../services/openlist'
import { loadMetadataSettings, matchMetadataGroup, METADATA_VERSION, resolveMetadataLocale } from '../services/metadata'

type ScanStage = 'idle' | 'preparing' | 'indexing' | 'metadata' | 'saving'

const MAX_MEDIA_FILES = 5000
const METADATA_CONCURRENCY = 4
const UI_PUBLISH_INTERVAL = 300
const videoPattern = /\.(mp4|mkv|webm|mov|m4v|avi|ts|m2ts|flv|wmv|m3u8)$/i
const subtitlePattern = /\.(srt|ass|ssa|vtt)$/i

export const useLibraryScanStore = defineStore('library-scan', () => {
  const scanning = ref(false)
  const stage = ref<ScanStage>('idle')
  const error = ref('')
  const currentFolder = ref('')
  const discovered = ref(0)
  const processed = ref(0)
  const recognized = ref(0)
  const candidateCount = ref(0)
  const failedFolders = ref(0)
  const reachedLimit = ref(false)
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
    processed.value = 0
    recognized.value = 0
    candidateCount.value = 0
    failedFolders.value = 0
    reachedLimit.value = false

    await Promise.all([media.load(), sources.load()])
    if (!sources.enabledSources.length) {
      error.value = '请先选择至少一个媒体目录。'
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

      stage.value = 'indexing'
      while (queueCursor < queue.length && discovered.value < MAX_MEDIA_FILES) {
        const parent = queue[queueCursor++]
        if (visitedFolders.has(parent)) continue
        visitedFolders.add(parent)
        currentFolder.value = parent
        let files: OpenListFile[]
        try {
          files = await listFolder(openlist.baseUrl, openlist.token, parent)
        } catch {
          failedFolders.value += 1
          unreadableFolders.add(parent)
          continue
        }

        const subtitleIndex = buildSubtitleIndex(files, parent)
        let processedInFolder = 0
        for (const file of files) {
          const path = childPath(parent, file.name)
          if (file.is_dir) {
            queue.push(path)
          } else if (videoPattern.test(file.name) && !visitedFiles.has(path)) {
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
              libraryRoot: sources.enabledSources.find((source) => parent === source.path || parent.startsWith(`${source.path}/`))?.path,
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
              subtitles: base.subtitles,
              position: base.position,
              duration: base.duration,
              lastPlayed: base.lastPlayed,
            } : base)
            discovered.value += 1
          }
          processedInFolder += 1
          if (processedInFolder % 100 === 0) await yieldToMainThread()
          if (discovered.value >= MAX_MEDIA_FILES) break
        }
      }
      reachedLimit.value = discovered.value >= MAX_MEDIA_FILES
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
      await sources.markScanned()
      if (failedFolders.value && !draft.length) error.value = '所选媒体目录暂时无法读取，请检查网盘连接或目录是否仍然存在。'
      else if (reachedLimit.value) error.value = `已达到单次扫描 ${MAX_MEDIA_FILES} 个视频的安全上限，请缩小媒体目录范围。`
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason)
    }
  }

  return { scanning, stage, error, currentFolder, discovered, processed, recognized, candidateCount, failedFolders, reachedLimit, progress, start }
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
