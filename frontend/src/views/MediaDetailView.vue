<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Captions, Check, CircleAlert, Clock3, Cloud, Download, ExternalLink, FileVideo2, GitMerge, LoaderCircle, LockKeyhole, MessageCircle, PencilLine, Play, RefreshCw, RotateCcw, Save, Scissors, Star, UserRound, X } from '@lucide/vue'
import { Capacitor } from '@capacitor/core'
import { useMediaStore, type MediaCorrectionUpdate, type MediaItem, type MediaSource } from '../stores/media'
import { useOpenListStore } from '../stores/openlist'
import { openListRequest } from '../services/openlist'
import { NativePlayer, type NativeSubtitle } from '../services/nativePlayer'
import { loadPlayerSettings, type PlayerMode } from '../services/playerSettings'
import { offlineCacheId, useOfflineCacheStore, type OfflineCacheEntry } from '../stores/offlineCache'
import { useDiscoveryStore } from '../stores/discovery'
import { useLibraryScanStore } from '../stores/libraryScan'
import { loadMetadataSettings, matchMetadataGroup } from '../services/metadata'

type CorrectionMode = 'work' | 'split' | 'merge'
interface CorrectionRow {
  path: string
  selected: boolean
  season: string
  episode: string
}

const route = useRoute()
const router = useRouter()
const media = useMediaStore()
const openlist = useOpenListStore()
const offline = useOfflineCacheStore()
const discovery = useDiscoveryStore()
const scanner = useLibraryScanStore()
const resolvingPath = ref('')
const cachingPath = ref('')
const error = ref('')
const activeSeasonId = ref('')
const activeSourceId = ref('')
const defaultPlayer = ref<PlayerMode>('internal')
const autoDanmaku = ref(false)
const matchingDanmakuPath = ref('')
const correcting = ref(false)
const correctionMode = ref<CorrectionMode>('work')
const correctionTitle = ref('')
const correctionCategory = ref<'movie' | 'tv' | 'other'>('tv')
const correctionLock = ref(true)
const correctionRows = ref<CorrectionRow[]>([])
const mergeTargetId = ref('')
const correctionSaving = ref(false)
const correctionMessage = ref('')
const correctionError = ref('')
const correctionPanel = ref<HTMLElement>()
let cachePoll: number | undefined

const work = computed(() => media.works.find((entry) => entry.id === route.query.id))
const seasons = computed(() => work.value?.category === 'tv' ? work.value.seasons : [])
const activeSeason = computed(() => seasons.value.find((season) => season.id === activeSeasonId.value) ?? seasons.value[0])
const seasonSources = computed(() => activeSeason.value?.sources ?? [])
const activeSource = computed(() => seasonSources.value.find((source) => source.id === activeSourceId.value) ?? seasonSources.value[0])
const visibleItems = computed(() => work.value?.category === 'tv' ? activeSource.value?.items ?? [] : work.value?.items ?? [])
const nextItem = computed(() => visibleItems.value.find((item) => item.position && item.duration && item.position < item.duration - 30)
  ?? visibleItems.value.find((item) => !item.lastPlayed)
  ?? visibleItems.value[0])
const primaryPlayer = computed<PlayerMode>(() => nextItem.value && (danmakuBinding(nextItem.value) || canAutoMatchDanmaku(nextItem.value)) ? 'internal' : defaultPlayer.value)
const alternatePlayer = computed<PlayerMode>(() => primaryPlayer.value === 'external' ? 'internal' : 'external')
const heroImage = computed(() => work.value?.backdrop
  || activeSeason.value?.items.find((item) => item.episodeImage)?.episodeImage
  || work.value?.poster
  || work.value?.thumbnail)
const heroPreview = computed(() => work.value?.poster
  || work.value?.thumbnail
  || activeSeason.value?.items.find((item) => item.thumb)?.thumb)
const heroLoaded = ref(false)
const detailTitle = computed(() => {
  if (!work.value) return ''
  if (work.value.category === 'tv' && seasons.value.length > 1 && activeSeason.value?.number) return `${work.value.title} 第 ${activeSeason.value.number} 季`
  return work.value.title
})
const genreLabels: Record<string, string> = {
  Comedy: '喜剧', Anime: '动画', Music: '音乐', Drama: '剧情', Romance: '爱情', Action: '动作',
  Adventure: '冒险', Fantasy: '奇幻', Thriller: '惊悚', Horror: '恐怖', Mystery: '悬疑',
  'Science-Fiction': '科幻', Family: '家庭', Crime: '犯罪', History: '历史', War: '战争',
}
const localizedGenres = computed(() => work.value?.genres.map((genre) => genreLabels[genre] ?? genre) ?? [])
const mergeTargets = computed(() => media.works.filter((entry) => entry.id !== work.value?.id && entry.category !== 'pending'))
const selectedCorrectionCount = computed(() => correctionRows.value.filter((row) => row.selected).length)

function filename(path: string) {
  return path.split('/').at(-1) ?? path
}

function filenameWithoutExtension(path: string) {
  return filename(path).replace(/\.[^.]+$/, '')
}

function sizeLabel(bytes: number) {
  if (!bytes) return '大小未知'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** unit).toFixed(unit >= 3 ? 2 : 0)} ${units[unit]}`
}

function durationLabel(item: MediaItem) {
  if (item.duration) {
    const minutes = Math.floor(item.duration / 60)
    const seconds = Math.floor(item.duration % 60)
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }
  return item.runtime ? `${item.runtime} 分钟` : ''
}

function episodeTitle(item: MediaItem) {
  if (!item.episode) return filenameWithoutExtension(item.path)
  return item.episodeTitle || `第 ${item.episode} 集`
}

function episodeIndex(item: MediaItem) {
  return item.episode ? String(item.episode) : '附'
}

function seasonLabel(number: number | undefined, folderName: string) {
  if (number) return `第 ${number} 季`
  return folderName || '选集'
}

function episodeSummary(items: MediaItem[]) {
  const episodes = items.filter((item) => item.episode).length
  const extras = items.length - episodes
  return `${episodes || items.length} 集${extras && episodes ? `，另有 ${extras} 个附加视频` : ''}`
}

function sourceItemCount(source: MediaSource) {
  const episodes = source.items.filter((item) => item.episode).length
  return episodes ? `${episodes} 集` : `${source.items.length} 个文件`
}

function preferredSource(sources: MediaSource[]) {
  return [...sources].sort((a, b) => {
    const aRecent = Math.max(0, ...a.items.map((item) => item.lastPlayed ?? 0))
    const bRecent = Math.max(0, ...b.items.map((item) => item.lastPlayed ?? 0))
    return bRecent - aRecent || b.items.length - a.items.length
  })[0]
}

function progress(item: MediaItem) {
  return item.position && item.duration ? Math.min(100, item.position / item.duration * 100) : 0
}

function correctionBasis(item?: MediaItem) {
  if (!item) return '识别依据未知'
  const correction = media.correctionFor(item.path)
  if (correction?.groupId) return '用户指定作品分组'
  if (item.metadataProvider) {
    const provider = item.metadataProvider === 'tmdb' ? 'TMDB' : item.metadataProvider === 'bangumi' ? 'Bangumi' : 'TVmaze'
    return `${provider}${item.metadataId || item.tmdbId ? ` #${item.metadataId ?? item.tmdbId}` : ''}`
  }
  if (item.category === 'pending') return '最小媒体文件夹，等待元数据'
  if (item.category === 'other') return '最小媒体文件夹'
  return '文件名与目录结构'
}

function fieldOrigin(item: MediaItem | undefined, field: 'season' | 'episode') {
  if (!item) return '未识别'
  const correction = media.correctionFor(item.path)
  if (correction && correction[field] !== undefined) return '用户纠正'
  const name = filename(item.path)
  if (/\bS\d{1,2}[ ._-]*E\d{1,3}\b|\b\d{1,2}x\d{1,3}\b|\b(?:EP|Episode)[ ._-]*\d{1,3}\b|第\s*\d{1,3}\s*[集话]|\[\d{1,3}\]/i.test(name)) return '文件名'
  return item.metadataProvider ? '元数据' : '未识别'
}

function openCorrectionPanel(mode: CorrectionMode = 'work') {
  if (!work.value) return
  correctionMode.value = mode
  correctionTitle.value = work.value.title
  correctionCategory.value = work.value.category === 'pending'
    ? work.value.indexKind === 'series' ? 'tv' : 'movie'
    : work.value.category
  correctionLock.value = work.value.metadataLocked
  correctionRows.value = work.value.items.map((item) => ({
    path: item.path,
    selected: mode !== 'split',
    season: item.season ? String(item.season) : '',
    episode: item.episode ? String(item.episode) : '',
  }))
  mergeTargetId.value = mergeTargets.value[0]?.id ?? ''
  correctionMessage.value = ''
  correctionError.value = ''
  correcting.value = true
  void nextTick(() => correctionPanel.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

function changeCorrectionMode(mode: CorrectionMode) {
  correctionMode.value = mode
  correctionMessage.value = ''
  correctionError.value = ''
  if (mode === 'split') correctionRows.value = correctionRows.value.map((row) => ({ ...row, selected: false }))
}

function manualGroupId(paths: string[]) {
  return paths.map((path) => media.correctionFor(path)?.groupId).find(Boolean)
    ?? newManualGroupId()
}

function newManualGroupId() {
  return `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function parsedCorrectionNumber(value: string) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function correctionUpdates(paths: string[], groupId: string): MediaCorrectionUpdate[] {
  const rows = new Map(correctionRows.value.map((row) => [row.path, row]))
  return paths.map((path) => {
    const row = rows.get(path)
    return {
      path,
      groupId,
      title: correctionTitle.value.trim(),
      category: correctionCategory.value,
      season: correctionCategory.value === 'tv' ? parsedCorrectionNumber(row?.season ?? '') : null,
      episode: correctionCategory.value === 'tv' ? parsedCorrectionNumber(row?.episode ?? '') : null,
      metadataLocked: correctionLock.value,
    }
  })
}

function correctedWorkFor(path: string) {
  return media.works.find((entry) => entry.items.some((item) => item.path === path))
}

async function persistCorrection(showSuccess = true) {
  if (!work.value || correctionSaving.value) return false
  const title = correctionTitle.value.trim()
  if (!title) {
    correctionError.value = '请输入作品标题'
    return false
  }
  const allPaths = work.value.items.map((item) => item.path)
  const paths = correctionMode.value === 'split'
    ? correctionRows.value.filter((row) => row.selected).map((row) => row.path)
    : allPaths
  if (correctionMode.value === 'split' && (!paths.length || paths.length === allPaths.length)) {
    correctionError.value = paths.length ? '请至少保留一个文件在原作品中' : '请选择要拆成新作品的文件'
    return false
  }
  correctionSaving.value = true
  correctionError.value = ''
  correctionMessage.value = ''
  try {
    const groupId = correctionMode.value === 'split' ? newManualGroupId() : manualGroupId(allPaths)
    await media.applyManualCorrections(correctionUpdates(paths, groupId))
    const corrected = correctedWorkFor(paths[0])
    if (corrected && route.query.id !== corrected.id) await router.replace({ name: 'media-detail', query: { id: corrected.id } })
    if (showSuccess) correctionMessage.value = correctionMode.value === 'split' ? `已拆出 ${paths.length} 个文件` : '识别纠错已保存，重新扫描也会保留'
    return true
  } catch (reason) {
    correctionError.value = reason instanceof Error ? reason.message : String(reason)
    return false
  } finally {
    correctionSaving.value = false
  }
}

async function mergeWork() {
  if (!work.value || correctionSaving.value) return
  const target = media.works.find((entry) => entry.id === mergeTargetId.value)
  if (!target) {
    correctionError.value = '请选择要合并到的作品'
    return
  }
  correctionSaving.value = true
  correctionError.value = ''
  correctionMessage.value = ''
  try {
    const currentPaths = work.value.items.map((item) => item.path)
    const targetPaths = target.items.map((item) => item.path)
    const groupId = manualGroupId(targetPaths)
    const updates: MediaCorrectionUpdate[] = [...targetPaths, ...currentPaths].map((path) => ({
      path,
      groupId,
      title: target.title,
      category: target.category === 'pending' ? 'other' : target.category,
      metadataLocked: target.metadataLocked,
    }))
    await media.applyManualCorrections(updates)
    const merged = correctedWorkFor(currentPaths[0])
    if (merged) await router.replace({ name: 'media-detail', query: { id: merged.id } })
    correctionTitle.value = target.title
    correctionCategory.value = target.category === 'pending' ? 'other' : target.category
    correctionMessage.value = `已合并到「${target.title}」`
  } catch (reason) {
    correctionError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    correctionSaving.value = false
  }
}

async function rematchMetadata() {
  if (!work.value || correctionSaving.value) return
  const title = correctionTitle.value.trim()
  if (!title) {
    correctionError.value = '请输入用于匹配的作品标题'
    return
  }
  correctionSaving.value = true
  correctionError.value = ''
  correctionMessage.value = ''
  try {
    const rowByPath = new Map(correctionRows.value.map((row) => [row.path, row]))
    const candidates = work.value.items.map((item) => {
      const row = rowByPath.get(item.path)
      const season = parsedCorrectionNumber(row?.season ?? '') ?? 1
      const episode = parsedCorrectionNumber(row?.episode ?? '')
      return {
        ...item,
        title: correctionCategory.value === 'tv' && episode ? `${title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}` : title,
        indexTitle: title,
        category: 'pending' as const,
      }
    })
    const settings = await loadMetadataSettings()
    const patches = await matchMetadataGroup(candidates, settings)
    if (!patches.size) {
      correctionError.value = '没有匹配到元数据，请检查标题或元数据服务设置'
      return
    }
    await media.updateMediaMetadataBatch([...patches.entries()].map(([path, metadata]) => ({ path, metadata })))
    const matchedTitle = [...patches.values()].find((metadata) => metadata.title)?.title
    if (matchedTitle) correctionTitle.value = matchedTitle
    const allPaths = work.value.items.map((item) => item.path)
    await media.applyManualCorrections(correctionUpdates(allPaths, manualGroupId(allPaths)))
    const corrected = correctedWorkFor(allPaths[0])
    if (corrected && route.query.id !== corrected.id) await router.replace({ name: 'media-detail', query: { id: corrected.id } })
    correctionMessage.value = `已用「${title}」重新匹配元数据${correctionLock.value ? '并锁定结果' : ''}`
  } catch (reason) {
    correctionError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    correctionSaving.value = false
  }
}

async function clearCorrectionAndRescan() {
  if (!work.value || correctionSaving.value) return
  correctionSaving.value = true
  const paths = work.value.items.map((item) => item.path)
  try {
    await media.clearManualCorrections(paths)
    correcting.value = false
    await router.replace('/library')
    void scanner.start()
  } finally {
    correctionSaving.value = false
  }
}

async function rawUrl(path: string) {
  const data = await openListRequest<{ raw_url: string }>(openlist.baseUrl, '/api/fs/get', { path, password: '' }, openlist.token)
  if (!data.raw_url) throw new Error('网盘没有返回可用的文件地址')
  return data.raw_url
}

async function resolveSubtitles(item: MediaItem): Promise<Array<NativeSubtitle & { fileName: string }>> {
  const results = await Promise.allSettled((item.subtitles ?? []).map(async (subtitle) => ({
    url: await rawUrl(subtitle.path),
    label: subtitle.label,
    language: subtitle.language,
    mimeType: subtitle.mimeType,
    fileName: filename(subtitle.path),
  })))
  return results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
}

async function play(item?: MediaItem, mode?: PlayerMode) {
  if (!item || resolvingPath.value) return
  resolvingPath.value = item.path
  error.value = ''
  try {
    let binding = danmakuBinding(item)
    const shouldPrepareDanmaku = mode !== 'external' && Boolean(work.value) && Boolean(binding || canAutoMatchDanmaku(item))
    if (shouldPrepareDanmaku && work.value) {
      matchingDanmakuPath.value = item.path
      try {
        binding = await discovery.prepareDanmaku(item, work.value) ?? undefined
      } finally {
        matchingDanmakuPath.value = ''
      }
    }
    const effectiveMode: PlayerMode = mode ?? (binding || shouldPrepareDanmaku ? 'internal' : defaultPlayer.value)
    const cached = offline.entryForPath(item.path)
    let url: string
    let subtitles: NativeSubtitle[]
    if (cached?.status === 'completed' && cached.uri) {
      url = effectiveMode === 'external' ? cached.uri : cached.internalUri || cached.uri
      subtitles = cached.subtitles.map((subtitle) => ({
        ...subtitle,
        url: effectiveMode === 'external' ? subtitle.url : subtitle.internalUrl || subtitle.url,
      }))
    } else {
      if (openlist.state !== 'ready') await openlist.start()
      if (openlist.state !== 'ready') throw new Error(openlist.error || 'OpenList 服务未就绪')
      ;[url, subtitles] = await Promise.all([rawUrl(item.path), resolveSubtitles(item)])
    }
    if (Capacitor.isNativePlatform()) {
      if (effectiveMode === 'external') {
        await NativePlayer.playExternal({ url, title: filename(item.path), position: (item.position ?? 0) * 1000, subtitles })
        await media.updateProgress(item.path, item.title, item.position ?? 0, item.duration ?? 0)
      } else {
        const result = await NativePlayer.play({
          url,
          title: filename(item.path),
          position: (item.position ?? 0) * 1000,
          subtitles,
          danmaku: binding?.comments,
          danmakuSource: binding
            ? `哔哩哔哩 · ${binding.sourceTitle} · ${binding.episodeTitle} · ${binding.comments.length} 条`
            : shouldPrepareDanmaku ? '未匹配到可用弹幕' : undefined,
        })
        if (result.duration > 0) await media.updateProgress(item.path, item.title, result.position / 1000, result.duration / 1000)
      }
    } else if (effectiveMode === 'external') {
      window.open(url, '_blank', 'noopener,noreferrer')
    } else {
      await router.push({ name: 'player', query: { src: url, title: filename(item.path), path: item.path } })
    }
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    resolvingPath.value = ''
  }
}

function canAutoMatchDanmaku(item?: MediaItem) {
  return Boolean(autoDanmaku.value && item?.episode && work.value?.category === 'tv')
}

function danmakuBinding(item?: MediaItem) {
  return item && work.value ? discovery.bindingForMedia(item, work.value) : undefined
}

function cacheEntry(item?: MediaItem) {
  return item ? offline.entryForPath(item.path) : undefined
}

function isCacheActive(entry?: OfflineCacheEntry) {
  return entry ? ['queued', 'downloading', 'paused'].includes(entry.status) : false
}

function cacheLabel(item?: MediaItem) {
  if (!item) return '缓存到本机'
  const entry = cacheEntry(item)
  if (!entry) return '缓存到本机'
  if (entry.status === 'completed') return '已缓存'
  if (entry.status === 'failed') return '重试下载'
  if (entry.status === 'paused') return '等待网络'
  if (entry.status === 'queued') return '等待下载'
  const total = entry.total || item.size
  return total > 0 ? `下载中 ${Math.min(99, Math.round(entry.downloaded / total * 100))}%` : '正在下载'
}

async function cacheMedia(item?: MediaItem) {
  if (!item || cachingPath.value) return
  const existing = cacheEntry(item)
  if (existing?.status === 'completed' || isCacheActive(existing)) return
  cachingPath.value = item.path
  error.value = ''
  try {
    if (openlist.state !== 'ready') await openlist.start()
    if (openlist.state !== 'ready') throw new Error(openlist.error || 'OpenList 服务未就绪')
    const [url, subtitles] = await Promise.all([rawUrl(item.path), resolveSubtitles(item)])
    await offline.start({
      id: offlineCacheId(item.path),
      url,
      sourcePath: item.path,
      title: work.value?.category === 'tv' ? `${work.value.title} · ${episodeTitle(item)}` : work.value?.title || filename(item.path),
      fileName: filename(item.path),
      poster: work.value?.poster || work.value?.thumbnail,
      expectedSize: item.size,
      subtitles,
    })
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    cachingPath.value = ''
  }
}

watch(seasons, (groups) => {
  if (!groups.some((group) => group.id === activeSeasonId.value)) activeSeasonId.value = groups[0]?.id ?? ''
}, { immediate: true })

watch(seasonSources, (sources) => {
  if (!sources.some((source) => source.id === activeSourceId.value)) activeSourceId.value = preferredSource(sources)?.id ?? ''
}, { immediate: true })

watch(heroImage, () => {
  heroLoaded.value = false
}, { immediate: true })

onMounted(async () => {
  const [, settings] = await Promise.all([media.load(), loadPlayerSettings(), offline.refresh(), discovery.load()])
  defaultPlayer.value = settings.defaultMode
  autoDanmaku.value = settings.autoDanmaku
  cachePoll = window.setInterval(() => {
    if (offline.activeCount) void offline.refresh()
  }, 1200)
})

onUnmounted(() => window.clearInterval(cachePoll))
</script>

<template>
  <section v-if="work" class="detail-page">
    <header class="hero">
      <div v-if="heroImage || heroPreview" class="hero-backdrop">
        <img v-if="heroPreview && heroPreview !== heroImage" class="hero-preview" :src="heroPreview" alt="" />
        <img
          v-if="heroImage"
          class="hero-image"
          :class="{ loaded: heroLoaded || !heroPreview || heroImage === heroPreview }"
          :src="heroImage"
          alt=""
          @load="heroLoaded = true"
        />
      </div>
      <button class="back-button" aria-label="返回" @click="router.back()"><ArrowLeft :size="22" /></button>
      <div class="hero-body">
        <div class="hero-copy">
          <h1>{{ detailTitle }}</h1>
          <div class="facts">
            <span v-if="work.rating"><Star :size="15" fill="currentColor" />{{ work.rating.toFixed(1) }}</span>
            <span v-if="work.year">{{ work.year }}</span>
            <span v-if="nextItem?.runtime"><Clock3 :size="15" />{{ nextItem.runtime }} 分钟</span>
            <span>{{ work.category === 'tv' && activeSource ? episodeSummary(activeSource.items) : work.items.length > 1 ? `${work.items.length} 个版本` : '影片' }}</span>
          </div>
          <p v-if="localizedGenres.length" class="genres">{{ localizedGenres.join(' · ') }}</p>
          <div class="play-actions">
            <button class="play-button" :disabled="Boolean(resolvingPath)" @click="play(nextItem)">
              <LoaderCircle v-if="resolvingPath === nextItem?.path" class="spin" :size="21" />
              <ExternalLink v-else-if="primaryPlayer === 'external'" :size="20" />
              <Play v-else :size="21" fill="currentColor" />
              {{ matchingDanmakuPath === nextItem?.path ? '正在加载弹幕…' : resolvingPath === nextItem?.path ? '正在准备播放…' : danmakuBinding(nextItem) ? '用内置播放器播放（弹幕）' : canAutoMatchDanmaku(nextItem) ? '用内置播放器播放（自动弹幕）' : primaryPlayer === 'external' ? '用外部播放器播放' : nextItem?.position ? '继续播放' : work.category === 'tv' ? '播放本季第 1 集' : '播放' }}
            </button>
            <button class="alternate-button" :disabled="Boolean(resolvingPath)" @click="play(nextItem, alternatePlayer)">
              <Play v-if="alternatePlayer === 'internal'" :size="18" fill="currentColor" />
              <ExternalLink v-else :size="18" />
              {{ alternatePlayer === 'external' ? (danmakuBinding(nextItem) || canAutoMatchDanmaku(nextItem) ? '外置播放（无弹幕）' : '其他播放器') : '内置播放' }}
            </button>
            <button
              class="cache-action"
              :disabled="!nextItem || Boolean(cachingPath) || isCacheActive(cacheEntry(nextItem)) || cacheEntry(nextItem)?.status === 'completed'"
              @click="cacheMedia(nextItem)"
            >
              <LoaderCircle v-if="cachingPath === nextItem?.path || isCacheActive(cacheEntry(nextItem))" class="spin" :size="18" />
              <Check v-else-if="cacheEntry(nextItem)?.status === 'completed'" :size="18" />
              <Download v-else :size="18" />
              {{ cacheLabel(nextItem) }}
            </button>
            <button class="correction-action" :aria-expanded="correcting" @click="correcting ? correcting = false : openCorrectionPanel()">
              <PencilLine :size="18" />{{ work.manuallyCorrected ? '调整识别纠错' : '纠正识别' }}
            </button>
          </div>
          <p v-if="error" class="play-error"><CircleAlert :size="16" />{{ error }}</p>
        </div>
        <nav v-if="seasons.length > 1" class="season-tabs" aria-label="选择季">
          <button v-for="group in seasons" :key="group.id" :class="{ active: group.id === activeSeason?.id }" @click="activeSeasonId = group.id">
            {{ seasonLabel(group.number, group.folderName) }}
          </button>
        </nav>
      </div>
    </header>

    <main class="detail-content">
      <Transition name="correction">
        <section v-if="correcting" ref="correctionPanel" class="recognition-panel" aria-labelledby="correction-title">
          <header class="recognition-header">
            <div>
              <span class="recognition-kicker"><PencilLine :size="15" />媒体识别纠错</span>
              <h2 id="correction-title">告诉 BMovie 这些文件属于什么</h2>
              <p>纠错按文件路径保存，后续扫描会先识别，再应用你的结果</p>
            </div>
            <button class="panel-close" aria-label="关闭识别纠错" @click="correcting = false"><X :size="19" /></button>
          </header>

          <nav class="correction-modes" aria-label="纠错方式">
            <button :class="{ active: correctionMode === 'work' }" :aria-pressed="correctionMode === 'work'" @click="changeCorrectionMode('work')"><PencilLine :size="16" />修改作品</button>
            <button :class="{ active: correctionMode === 'split' }" :aria-pressed="correctionMode === 'split'" @click="changeCorrectionMode('split')"><Scissors :size="16" />拆分文件</button>
            <button :class="{ active: correctionMode === 'merge' }" :aria-pressed="correctionMode === 'merge'" @click="changeCorrectionMode('merge')"><GitMerge :size="16" />合并作品</button>
          </nav>

          <div v-if="correctionMode !== 'merge'" class="correction-form">
            <div class="correction-fields">
              <label class="correction-field title-field">
                <span>作品标题</span>
                <input v-model="correctionTitle" autocomplete="off" placeholder="用于展示和重新匹配元数据" />
              </label>
              <fieldset class="category-field">
                <legend>媒体类型</legend>
                <label><input v-model="correctionCategory" type="radio" value="tv" /><span>剧集</span></label>
                <label><input v-model="correctionCategory" type="radio" value="movie" /><span>电影</span></label>
                <label><input v-model="correctionCategory" type="radio" value="other" /><span>其他</span></label>
              </fieldset>
              <label class="lock-field">
                <input v-model="correctionLock" type="checkbox" />
                <span><LockKeyhole :size="17" /><strong>锁定元数据</strong><small>扫描时保留当前海报、简介和元数据来源</small></span>
              </label>
            </div>

            <div class="file-correction-heading">
              <div>
                <h3>{{ correctionMode === 'split' ? '选择要拆出的文件' : '逐集检查' }}</h3>
                <p>{{ correctionMode === 'split' ? `已选择 ${selectedCorrectionCount} 个，选中的文件会成为一部新作品` : '季数和集数留空表示不指定，文件名与识别依据始终保留供核对' }}</p>
              </div>
              <button v-if="correctionMode === 'split'" @click="correctionRows = correctionRows.map((row) => ({ ...row, selected: !row.selected }))">反选</button>
            </div>

            <div class="correction-file-list">
              <div v-for="row in correctionRows" :key="row.path" class="correction-file-row" :class="{ selected: row.selected && correctionMode === 'split' }">
                <label v-if="correctionMode === 'split'" class="file-selector" :aria-label="`选择 ${filename(row.path)}`"><input v-model="row.selected" type="checkbox" /></label>
                <div class="correction-file-main">
                  <strong>{{ filename(row.path) }}</strong>
                  <span>{{ row.path }}</span>
                  <small>
                    <em>{{ correctionBasis(work.items.find((item) => item.path === row.path)) }}</em>
                    <template v-if="correctionCategory === 'tv'">季数来自 {{ fieldOrigin(work.items.find((item) => item.path === row.path), 'season') }} · 集数来自 {{ fieldOrigin(work.items.find((item) => item.path === row.path), 'episode') }}</template>
                  </small>
                </div>
                <template v-if="correctionCategory === 'tv'">
                  <label class="number-field"><span>季</span><input v-model="row.season" type="number" inputmode="numeric" min="1" placeholder="—" /></label>
                  <label class="number-field"><span>集</span><input v-model="row.episode" type="number" inputmode="numeric" min="1" placeholder="—" /></label>
                </template>
              </div>
            </div>

            <footer class="correction-actions">
              <span v-if="correctionError" class="correction-feedback error"><CircleAlert :size="16" />{{ correctionError }}</span>
              <span v-else-if="correctionMessage" class="correction-feedback success"><Check :size="16" />{{ correctionMessage }}</span>
              <span v-else class="correction-feedback"><LockKeyhole :size="16" />{{ work.manuallyCorrected ? '这部作品已有持久化纠错' : '保存后不会被重新扫描覆盖' }}</span>
              <button v-if="work.manuallyCorrected" class="reset-correction" :disabled="correctionSaving || scanner.scanning" @click="clearCorrectionAndRescan"><RotateCcw :size="16" />清除纠错并重新识别</button>
              <button class="rematch-button" :disabled="correctionSaving" @click="rematchMetadata"><LoaderCircle v-if="correctionSaving" class="spin" :size="16" /><RefreshCw v-else :size="16" />按标题重匹配元数据</button>
              <button class="save-correction" :disabled="correctionSaving" @click="persistCorrection()"><LoaderCircle v-if="correctionSaving" class="spin" :size="16" /><Save v-else :size="16" />{{ correctionMode === 'split' ? `拆分 ${selectedCorrectionCount} 个文件` : '保存识别纠错' }}</button>
            </footer>
          </div>

          <div v-else class="merge-form">
            <label class="correction-field">
              <span>合并到</span>
              <select v-model="mergeTargetId" :disabled="!mergeTargets.length">
                <option v-for="target in mergeTargets" :key="target.id" :value="target.id">{{ target.title }} · {{ target.category === 'tv' ? '剧集' : target.category === 'movie' ? '电影' : '其他' }} · {{ target.items.length }} 个文件</option>
              </select>
            </label>
            <p v-if="mergeTargets.length">当前作品的文件会加入目标作品，沿用目标标题和媒体类型，原始文件不会移动</p>
            <p v-else>媒体库里暂时没有可合并的其他作品</p>
            <span v-if="correctionError" class="correction-feedback error"><CircleAlert :size="16" />{{ correctionError }}</span>
            <span v-else-if="correctionMessage" class="correction-feedback success"><Check :size="16" />{{ correctionMessage }}</span>
            <button class="save-correction" :disabled="correctionSaving || !mergeTargets.length" @click="mergeWork"><LoaderCircle v-if="correctionSaving" class="spin" :size="16" /><GitMerge v-else :size="16" />合并到所选作品</button>
          </div>
        </section>
      </Transition>

      <section class="episode-section">
        <div class="section-heading">
          <h2>{{ work.category === 'tv' ? '选集' : work.category === 'movie' && work.items.length > 1 ? '影片版本' : '媒体文件' }}</h2>
          <span v-if="work.category === 'tv' && activeSource">{{ episodeSummary(activeSource.items) }}<template v-if="seasonSources.length > 1"> · {{ seasonSources.length }} 个来源</template></span>
          <span v-else>{{ visibleItems.length }} 个文件</span>
        </div>
        <nav v-if="work.category === 'tv' && seasonSources.length > 1" class="source-picker" aria-label="选择播放来源">
          <span class="source-label"><Cloud :size="15" />来源</span>
          <button
            v-for="source in seasonSources"
            :key="source.id"
            :class="{ active: source.id === activeSource?.id }"
            :aria-pressed="source.id === activeSource?.id"
            @click="activeSourceId = source.id"
          >
            <span>{{ source.label }}</span>
            <small>{{ sourceItemCount(source) }}</small>
          </button>
        </nav>
        <div class="episode-strip">
          <article v-for="item in visibleItems" :key="item.path" class="episode-card">
            <button class="episode-play" :disabled="Boolean(resolvingPath)" @click="play(item)">
              <span class="episode-image">
                <FileVideo2 class="episode-placeholder" :size="28" />
                <img v-if="item.thumb || work.poster || work.thumbnail" class="episode-preview" :src="item.thumb || work.poster || work.thumbnail" alt="" />
                <img v-if="item.episodeImage" class="episode-still" :src="item.episodeImage" alt="" />
                <span class="play-chip"><LoaderCircle v-if="resolvingPath === item.path" class="spin" :size="18" /><Play v-else :size="18" fill="currentColor" /></span>
                <em v-if="durationLabel(item)">{{ durationLabel(item) }}</em>
                <i v-if="progress(item)" :style="{ width: `${progress(item)}%` }" />
              </span>
            </button>
            <span class="episode-title-row">
              <span class="episode-name"><b v-if="work.category === 'tv'">{{ episodeIndex(item) }}.</b>{{ episodeTitle(item) }}</span>
              <button
                class="episode-cache"
                :aria-label="`${cacheLabel(item)}：${episodeTitle(item)}`"
                :title="cacheLabel(item)"
                :disabled="Boolean(cachingPath) || isCacheActive(cacheEntry(item)) || cacheEntry(item)?.status === 'completed'"
                @click="cacheMedia(item)"
              >
                <LoaderCircle v-if="cachingPath === item.path || isCacheActive(cacheEntry(item))" class="spin" :size="15" />
                <Check v-else-if="cacheEntry(item)?.status === 'completed'" :size="15" />
                <Download v-else :size="15" />
              </button>
            </span>
            <span class="episode-tags">
              <small>{{ cacheEntry(item)?.status === 'completed' ? '本机播放' : sizeLabel(item.size) }}</small>
              <small v-if="isCacheActive(cacheEntry(item))">{{ cacheLabel(item) }}</small>
              <small v-if="item.subtitles?.length"><Captions :size="14" />{{ item.subtitles.length }} 个外挂字幕</small>
              <small v-if="danmakuBinding(item)"><MessageCircle :size="14" />{{ danmakuBinding(item)?.comments.length }} 条弹幕</small>
            </span>
          </article>
        </div>
      </section>

      <section class="synopsis-section">
        <div class="section-heading"><h2>剧情简介</h2></div>
        <p>{{ work.overview || '暂时没有剧情简介' }}</p>
      </section>

      <section v-if="work.cast.length" class="cast-section">
        <div class="section-heading"><h2>相关演员</h2><span>{{ work.cast.length }} 位</span></div>
        <div class="cast-strip">
          <div v-for="person in work.cast" :key="`${person.name}-${person.role}`" class="cast-member">
            <span class="avatar"><img v-if="person.image" :src="person.image" :alt="person.name" /><UserRound v-else :size="25" /></span>
            <strong>{{ person.name }}</strong>
            <small v-if="person.role">饰 {{ person.role }}</small>
          </div>
        </div>
      </section>

      <section v-if="nextItem" class="file-section">
        <div class="section-heading"><h2>文件信息</h2></div>
        <p class="file-name">{{ filename(nextItem.path) }}</p>
        <p>{{ nextItem.path }}</p>
        <div class="file-facts">
          <span v-if="activeSource"><Cloud :size="15" />{{ activeSource.label }}</span>
          <span>{{ sizeLabel(nextItem.size) }}</span>
          <span v-if="durationLabel(nextItem)">{{ durationLabel(nextItem) }}</span>
          <span v-if="nextItem.subtitles?.length"><Captions :size="15" />{{ nextItem.subtitles.map((subtitle) => subtitle.label).join('、') }}</span>
        </div>
      </section>

      <p v-if="work.metadataProvider" class="metadata-credit">元数据由 {{ work.metadataProvider === 'tmdb' ? 'TMDB' : work.metadataProvider === 'bangumi' ? 'Bangumi' : 'TVmaze' }} 提供</p>
    </main>
  </section>

  <section v-else class="page"><div class="empty-state"><div><h2>找不到这部作品</h2><p>媒体库可能已经重新扫描，请返回后重新选择</p><RouterLink to="/library" class="primary-button">返回媒体库</RouterLink></div></div></section>
</template>

<style scoped>
.detail-page{min-height:100svh;padding-bottom:calc(76px + env(safe-area-inset-bottom));background:var(--canvas)}
.hero{position:relative;min-height:min(74svh,680px);overflow:hidden;background:#121218}.hero-backdrop{position:absolute;inset:0}.hero-backdrop::after{position:absolute;content:"";inset:0;background:linear-gradient(90deg,rgba(8,9,14,.86) 0%,rgba(8,9,14,.42) 58%,rgba(8,9,14,.2)),linear-gradient(0deg,#090a0f 0%,rgba(9,10,15,.72) 24%,rgba(9,10,15,.06) 64%)}.hero-backdrop img{position:absolute;width:100%;height:100%;object-fit:cover}.hero-preview{filter:blur(12px);transform:scale(1.04)}.hero-image{opacity:0;transition:opacity .22s ease}.hero-image.loaded{opacity:1}.back-button{position:absolute;z-index:2;top:calc(20px + env(safe-area-inset-top));left:max(24px,calc((100% - 1180px)/2));display:grid;width:44px;height:44px;place-items:center;border:0;border-radius:50%;color:#fff;background:rgba(10,11,16,.72)}.hero-body{position:relative;z-index:1;display:flex;width:min(100%,1180px);min-height:min(74svh,680px);flex-direction:column;justify-content:flex-end;margin:auto;padding:92px 36px 0}.hero-copy{max-width:760px;padding-bottom:34px}.hero-copy h1{max-width:18ch;margin-bottom:14px;color:#fff;font-family:var(--font-body);font-size:42px;letter-spacing:-.03em;line-height:1.12;text-wrap:balance}.facts{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;margin-bottom:10px;color:#efedf2;font-size:13px}.facts span{display:flex;align-items:center;gap:5px}.facts span:first-child{color:#b9ff7b}.genres{margin-bottom:22px;color:#d2cfd6;font-size:13px}.play-actions{display:flex;flex-wrap:wrap;gap:10px}.play-button,.alternate-button{display:inline-flex;min-height:54px;align-items:center;justify-content:center;gap:10px;padding:0 25px;border-radius:7px;font-size:14px;font-weight:750}.play-button{min-width:220px;border:0;color:#090a0e;background:#fff;font-size:15px}.alternate-button{border:1px solid rgba(255,255,255,.28);color:#fff;background:rgba(10,11,16,.62)}.play-button:disabled,.alternate-button:disabled,.episode-card:disabled{opacity:.58}.play-error{display:flex;align-items:center;gap:7px;margin-top:12px;color:#ff8a86;font-size:12px}.season-tabs{display:flex;gap:34px;overflow-x:auto}.season-tabs button{position:relative;flex:0 0 auto;padding:0 0 17px;border:0;color:#aaa7b0;background:transparent;font-size:17px}.season-tabs button.active{color:#fff;font-weight:750}.season-tabs button.active::after{position:absolute;right:0;bottom:0;left:0;height:3px;content:"";background:var(--beam)}
.detail-content{width:min(100%,1180px);margin:auto;padding:34px 36px 48px}.episode-section,.synopsis-section,.cast-section,.file-section{margin-bottom:38px}.section-heading{display:flex;align-items:baseline;gap:14px;margin-bottom:17px}.section-heading h2{font-family:var(--font-body);font-size:22px;letter-spacing:-.02em}.section-heading span{color:var(--dim);font-size:11px}.episode-strip,.cast-strip{display:flex;gap:15px;overflow-x:auto;overscroll-behavior-inline:contain;scroll-snap-type:x proximity;padding-bottom:8px}.episode-card{display:grid;width:245px;flex:0 0 245px;gap:8px;padding:0;border:0;color:var(--ink);background:transparent;text-align:left;scroll-snap-align:start}.episode-image{position:relative;display:grid;aspect-ratio:16/9;place-items:center;overflow:hidden;border-radius:7px;color:var(--beam);background:var(--surface-raised)}.episode-placeholder{position:absolute}.episode-image img{position:absolute;inset:0;z-index:0;width:100%;height:100%;object-fit:cover}.episode-preview{filter:brightness(.76)}.episode-image .episode-still{z-index:1}.episode-image::after{position:absolute;z-index:1;content:"";inset:45% 0 0;background:linear-gradient(transparent,rgba(0,0,0,.7))}.play-chip{position:absolute;z-index:2;display:grid;width:40px;height:40px;place-items:center;border-radius:50%;color:#090a0e;background:rgba(255,255,255,.92)}.episode-image em{position:absolute;z-index:2;right:8px;bottom:7px;color:#fff;font-size:10px;font-style:normal}.episode-image>i{position:absolute;z-index:3;bottom:0;left:0;height:3px;background:var(--beam)}.episode-name{display:block;overflow:hidden;font-size:13px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}.episode-name b{margin-right:5px;color:var(--beam)}.episode-tags{display:flex;min-height:18px;align-items:center;gap:10px;color:var(--dim)}.episode-tags small{display:flex;align-items:center;gap:4px;font-size:10px}.synopsis-section>p{max-width:75ch;color:#c4c1c9;font-size:14px;line-height:1.9;text-wrap:pretty}.cast-strip{gap:22px}.cast-member{display:grid;width:92px;flex:0 0 92px;justify-items:center;gap:5px;text-align:center}.avatar{display:grid;width:78px;height:78px;margin-bottom:3px;place-items:center;overflow:hidden;border-radius:50%;color:var(--muted);background:var(--surface-raised)}.avatar img{width:100%;height:100%;object-fit:cover}.cast-member strong,.cast-member small{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cast-member strong{font-size:12px}.cast-member small{color:var(--dim);font-size:10px}.file-section{padding-top:28px;border-top:1px solid var(--line)}.file-section p{max-width:100%;overflow:hidden;color:var(--dim);font-size:11px;text-overflow:ellipsis;white-space:nowrap}.file-section .file-name{margin-bottom:7px;color:var(--ink);font-size:13px}.file-facts{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:10px;color:var(--muted);font-size:11px}.file-facts span{display:flex;align-items:center;gap:5px}.metadata-credit{color:var(--dim);font-size:10px}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.source-picker{display:flex;align-items:center;gap:8px;overflow-x:auto;margin:-3px 0 18px;padding-bottom:2px;overscroll-behavior-inline:contain}.source-label{display:inline-flex;flex:0 0 auto;align-items:center;gap:6px;margin-right:2px;color:var(--muted);font-size:12px;font-weight:700}.source-picker button{display:inline-flex;min-height:38px;flex:0 0 auto;align-items:center;gap:9px;padding:0 13px;border:1px solid var(--line);border-radius:7px;color:var(--muted);background:var(--surface);font-size:12px}.source-picker button small{color:var(--dim);font-size:10px}.source-picker button.active{border-color:var(--beam);color:var(--ink);background:color-mix(in srgb,var(--beam) 11%,var(--surface))}.source-picker button.active small{color:var(--muted)}
.cache-action{display:inline-flex;min-height:54px;align-items:center;justify-content:center;gap:8px;padding:0 18px;border:1px solid rgba(255,255,255,.2);border-radius:7px;color:#fff;background:rgba(10,11,16,.62);font-size:13px;font-weight:700}.cache-action:disabled,.episode-play:disabled,.episode-cache:disabled{opacity:.58}.episode-play{display:block;width:100%;padding:0;border:0;color:inherit;background:transparent;text-align:left}.episode-title-row{display:flex;min-width:0;align-items:center;gap:7px}.episode-title-row .episode-name{min-width:0;flex:1}.episode-cache{display:grid;width:30px;height:30px;flex:0 0 auto;place-items:center;border:1px solid var(--line);border-radius:50%;color:var(--muted);background:var(--surface)}.episode-cache:disabled{color:var(--beam)}
.correction-action{display:inline-flex;min-height:54px;align-items:center;justify-content:center;gap:8px;padding:0 18px;border:1px solid rgba(255,255,255,.2);border-radius:7px;color:#fff;background:rgba(10,11,16,.62);font-size:13px;font-weight:700}.recognition-panel{scroll-margin-top:18px;margin:-6px 0 36px;padding:26px 0 30px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.recognition-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:22px}.recognition-header h2{margin:7px 0 6px;font-family:var(--font-body);font-size:24px;letter-spacing:-.025em}.recognition-header p{max-width:68ch;margin:0;color:var(--muted);font-size:12px;line-height:1.65}.recognition-kicker{display:flex;align-items:center;gap:7px;color:var(--beam);font-size:12px;font-weight:750}.panel-close{display:grid;width:44px;height:44px;flex:0 0 auto;place-items:center;border:1px solid var(--line);border-radius:50%;color:var(--muted);background:transparent}.correction-modes{display:flex;gap:6px;margin-bottom:24px;overflow-x:auto}.correction-modes button{display:inline-flex;min-height:42px;flex:0 0 auto;align-items:center;gap:7px;padding:0 14px;border:1px solid var(--line);border-radius:7px;color:var(--muted);background:transparent;font-size:12px;font-weight:700}.correction-modes button.active{border-color:var(--beam);color:var(--ink);background:var(--beam-soft)}.correction-fields{display:grid;grid-template-columns:minmax(260px,1fr) auto minmax(230px,.72fr);align-items:end;gap:14px;margin-bottom:28px}.correction-field{display:grid;min-width:0;gap:8px}.correction-field>span,.category-field legend{color:var(--muted);font-size:11px;font-weight:700}.correction-field input,.correction-field select{width:100%;min-height:46px;padding:0 13px;border:1px solid var(--line);border-radius:7px;outline:0;color:var(--ink);background:var(--surface);font-size:13px}.correction-field input::placeholder{color:#858691}.correction-field input:focus,.correction-field select:focus{border-color:var(--beam)}.category-field{display:grid;grid-template-columns:repeat(3,minmax(68px,1fr));min-width:222px;gap:5px;margin:0;padding:0;border:0}.category-field legend{grid-column:1/-1;margin-bottom:3px}.category-field label{position:relative;display:grid;height:46px;place-items:center}.category-field input{position:absolute;opacity:0}.category-field span{display:grid;width:100%;height:100%;place-items:center;border:1px solid var(--line);color:var(--muted);background:var(--surface);font-size:12px}.category-field label:first-of-type span{border-radius:7px 0 0 7px}.category-field label:last-of-type span{border-radius:0 7px 7px 0}.category-field input:checked+span{z-index:1;border-color:var(--beam);color:var(--ink);background:var(--beam-soft)}.category-field input:focus-visible+span{outline:2px solid var(--beam);outline-offset:2px}.lock-field{display:flex;min-height:46px;align-items:center;gap:10px;padding:0 12px;border:1px solid var(--line);border-radius:7px;background:var(--surface)}.lock-field>input,.file-selector input{width:18px;height:18px;flex:0 0 auto;accent-color:var(--beam)}.lock-field>span{display:grid;grid-template-columns:auto 1fr;align-items:center;column-gap:7px}.lock-field strong{font-size:12px}.lock-field small{grid-column:2;color:var(--dim);font-size:9px}.file-correction-heading{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:10px}.file-correction-heading h3{margin:0 0 4px;font-size:15px}.file-correction-heading p{margin:0;color:var(--dim);font-size:10px}.file-correction-heading button{min-height:38px;padding:0 8px;border:0;color:var(--beam);background:transparent;font-size:11px}.correction-file-list{max-height:440px;overflow:auto;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.correction-file-row{display:grid;grid-template-columns:minmax(0,1fr) 72px 72px;align-items:center;gap:12px;min-height:82px;padding:11px 4px;border-bottom:1px solid var(--line)}.correction-file-row:last-child{border-bottom:0}.correction-file-row.selected{background:color-mix(in srgb,var(--beam) 6%,transparent)}.correction-file-row:has(.file-selector){grid-template-columns:34px minmax(0,1fr) 72px 72px}.file-selector{display:grid;width:34px;height:44px;place-items:center}.correction-file-main{display:grid;min-width:0;gap:3px}.correction-file-main strong,.correction-file-main span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.correction-file-main strong{font-size:12px}.correction-file-main span{color:var(--dim);font-size:9px}.correction-file-main small{display:flex;flex-wrap:wrap;gap:5px 10px;color:var(--muted);font-size:9px}.correction-file-main em{color:var(--beam);font-style:normal}.number-field{display:grid;gap:5px}.number-field span{color:var(--dim);font-size:9px}.number-field input{width:100%;height:40px;padding:0 8px;border:1px solid var(--line);border-radius:7px;outline:0;color:var(--ink);background:var(--surface);text-align:center}.number-field input:focus{border-color:var(--beam)}.correction-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;margin-top:18px}.correction-feedback{display:flex;min-width:220px;flex:1;align-items:center;gap:7px;color:var(--dim);font-size:10px}.correction-feedback.error{color:var(--danger)}.correction-feedback.success{color:#b9ff7b}.reset-correction,.rematch-button,.save-correction{display:inline-flex;min-height:44px;align-items:center;justify-content:center;gap:7px;padding:0 13px;border-radius:7px;font-size:11px;font-weight:700}.reset-correction{border:0;color:var(--muted);background:transparent}.rematch-button{border:1px solid var(--line);color:var(--ink);background:var(--surface)}.save-correction{border:0;color:#0b0b10;background:var(--ink)}.reset-correction:disabled,.rematch-button:disabled,.save-correction:disabled{opacity:.5}.merge-form{display:grid;max-width:680px;gap:14px}.merge-form>p{margin:0;color:var(--muted);font-size:11px;line-height:1.6}.merge-form .save-correction{justify-self:start}.correction-enter-active,.correction-leave-active{transition:opacity .18s ease,transform .18s cubic-bezier(.22,1,.36,1)}.correction-enter-from,.correction-leave-to{opacity:0;transform:translateY(-8px)}
@media(max-width:640px){.hero{min-height:620px}.hero-body{min-height:620px;padding:88px 20px 0}.hero-copy{padding-bottom:28px}.hero-copy h1{font-size:34px}.play-actions{display:grid;grid-template-columns:1fr auto}.play-button{width:100%;min-width:0}.alternate-button{padding-inline:16px}.back-button{left:20px}.season-tabs{gap:28px}.detail-content{padding:28px 20px 40px}.episode-card{width:220px;flex-basis:220px}.section-heading{align-items:flex-start;flex-direction:column;gap:4px}.source-picker{margin-top:0}.synopsis-section>p{font-size:13px}.cast-member{width:82px;flex-basis:82px}.avatar{width:70px;height:70px}}
@media(max-width:840px){.correction-fields{grid-template-columns:1fr 1fr}.title-field{grid-column:1/-1}.lock-field{align-self:end}.correction-actions{align-items:stretch}.correction-feedback{flex-basis:100%}}
@media(max-width:640px){.cache-action,.correction-action{grid-column:1/-1;min-height:46px}.recognition-panel{margin-top:0;padding-top:22px}.recognition-header h2{font-size:20px}.correction-fields{grid-template-columns:1fr}.title-field{grid-column:auto}.category-field{min-width:0}.correction-file-row,.correction-file-row:has(.file-selector){grid-template-columns:34px 1fr 1fr;gap:8px;padding:12px 2px}.correction-file-row:not(:has(.file-selector)){grid-template-columns:1fr 1fr}.correction-file-main{grid-column:2/-1}.correction-file-row:not(:has(.file-selector)) .correction-file-main{grid-column:1/-1}.correction-actions{display:grid;grid-template-columns:1fr}.correction-feedback{min-width:0}.reset-correction,.rematch-button,.save-correction{width:100%}.merge-form .save-correction{justify-self:stretch}.correction-file-list{max-height:58svh}}
@media(prefers-reduced-motion:reduce){.spin{animation:none}.hero-image,.correction-enter-active,.correction-leave-active{transition:none}.episode-strip,.cast-strip{scroll-behavior:auto}}
</style>
