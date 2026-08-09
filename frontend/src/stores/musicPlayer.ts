import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { Capacitor } from '@capacitor/core'
import type { MediaItem } from './media'
import { useMediaStore } from './media'
import { useOpenListStore } from './openlist'
import { useOfflineCacheStore } from './offlineCache'
import { openListRequest } from '../services/openlist'
import { MUSIC_METADATA_VERSION, probeAudio, reportLyricError, resolveOnlineMusic, type AudioTechnicalInfo, type OnlineMusicInfo } from '../services/musicMetadata'
import { t } from '../i18n'
import { NativeMusicPlayback, type NativeMusicState, type NativeMusicTrack } from '../services/nativeMusicPlayback'

export interface LyricLine { time: number; text: string; translation?: string }

export const useMusicPlayerStore = defineStore('music-player', () => {
  const queue = ref<MediaItem[]>([])
  const currentIndex = ref(-1)
  const source = ref('')
  const artwork = ref('')
  const lyrics = ref<LyricLine[]>([])
  const lyricsSource = ref<'none' | 'local' | 'netease'>('none')
  const onlineInfo = ref<OnlineMusicInfo | null>(null)
  const technicalInfo = ref<AudioTechnicalInfo | null>(null)
  const metadataLoading = ref(false)
  const reportingLyrics = ref(false)
  const lyricsNotice = ref('')
  const playing = ref(false)
  const loading = ref(false)
  const position = ref(0)
  const duration = ref(0)
  const error = ref('')
  const current = computed(() => queue.value[currentIndex.value])
  const hasPrevious = computed(() => currentIndex.value > 0)
  const hasNext = computed(() => currentIndex.value >= 0 && currentIndex.value < queue.value.length - 1)
  const activeLyricIndex = computed(() => {
    let result = -1
    for (let index = 0; index < lyrics.value.length; index += 1) {
      if (lyrics.value[index].time > position.value + .08) break
      result = index
    }
    return result
  })
  let audio: HTMLAudioElement | undefined
  let requestVersion = 0
  let lastSavedAt = 0
  const nativePlayback = Capacitor.isNativePlatform()
  let nativeListenerReady = false

  function attach(element: HTMLAudioElement) {
    if (nativePlayback) {
      void connectNativePlayback()
      return
    }
    audio = element
    if (source.value && element.src !== source.value) element.src = source.value
  }

  async function playQueue(items: MediaItem[], index = 0) {
    queue.value = [...items]
    currentIndex.value = Math.max(0, Math.min(index, items.length - 1))
    await loadCurrent(true)
  }

  async function loadCurrent(autoplay = true) {
    const item = current.value
    if (!item) return
    const startAt = resumePosition(item)
    const version = ++requestVersion
    loading.value = true
    error.value = ''
    position.value = startAt
    duration.value = item.duration ?? 0
    lyrics.value = []
    lyricsSource.value = 'none'
    onlineInfo.value = null
    technicalInfo.value = null
    metadataLoading.value = true
    lyricsNotice.value = ''
    artwork.value = item.thumb ?? item.musicArtwork ?? ''
    try {
      const offline = useOfflineCacheStore()
      await offline.load()
      if (nativePlayback) {
        await connectNativePlayback()
        const urls = await Promise.all(queue.value.map((track) => playbackUrl(track)))
        if (version !== requestVersion) return
        const tracks: NativeMusicTrack[] = queue.value.map((track, index) => ({
          id: track.path,
          url: urls[index]!,
          title: track.title,
          artist: track.artist || track.artists?.join(' / ') || t('music.unknownArtist'),
          album: track.album || t('music.unknownAlbum'),
          artwork: track.musicArtwork || track.thumb || '',
        }))
        source.value = urls[currentIndex.value] ?? ''
        await NativeMusicPlayback.setQueue({ tracks, index: currentIndex.value, position: startAt, autoplay })
      } else {
        const url = await playbackUrl(item)
        if (version !== requestVersion) return
        source.value = url
        updateMediaSession()
        if (audio) {
          audio.src = url
          audio.currentTime = startAt
          if (autoplay) await audio.play()
        }
      }
      loading.value = false
      await hydrateCurrentDetails(item, version, source.value)
    } catch (reason) {
      if (version === requestVersion) error.value = reason instanceof Error ? reason.message : String(reason)
    } finally {
      if (version === requestVersion) {
        loading.value = false
        metadataLoading.value = false
      }
    }
  }

  async function playbackUrl(item: MediaItem) {
    const offline = useOfflineCacheStore()
    const cached = offline.entryForPath(item.path)
    let url = cached?.status === 'completed' ? cached.internalUri || cached.uri || '' : ''
    if (!url) url = await rawUrl(item.path)
    return url
  }

  async function hydrateCurrentDetails(item: MediaItem, version: number, url: string) {
    const [localArtwork, localLyrics, resolvedOnline, resolvedTechnical] = await Promise.all([
      item.artworkPath ? rawUrl(item.artworkPath).catch(() => '') : Promise.resolve(''),
      item.lyricsPath ? loadLyrics(item.lyricsPath).catch(() => [] as LyricLine[]) : Promise.resolve([] as LyricLine[]),
      resolveOnlineMusic(item).catch(() => null),
      probeAudio(item.path, url, item).catch(() => null),
    ])
    if (version !== requestVersion || current.value?.path !== item.path) return
    onlineInfo.value = resolvedOnline
    technicalInfo.value = resolvedTechnical
    if (localLyrics.length) {
      lyrics.value = localLyrics
      lyricsSource.value = 'local'
    } else if (resolvedOnline?.lyric) {
      lyrics.value = parseLrc(resolvedOnline.lyric, resolvedOnline.translatedLyric)
      lyricsSource.value = lyrics.value.length ? 'netease' : 'none'
    }
    artwork.value = localArtwork || resolvedOnline?.artwork || item.thumb || ''
    if (resolvedOnline) void applyOnlineMetadata(item, resolvedOnline)
    updateMediaSession()
  }

  async function connectNativePlayback() {
    if (!nativePlayback || nativeListenerReady) return
    nativeListenerReady = true
    await NativeMusicPlayback.addListener('stateChanged', onNativeState)
    onNativeState(await NativeMusicPlayback.getState())
  }

  function onNativeState(state: NativeMusicState) {
    playing.value = state.playing
    position.value = Math.max(0, state.position || 0)
    if (state.duration > 0) duration.value = state.duration
    if (state.index >= 0 && state.index < queue.value.length && state.index !== currentIndex.value) {
      currentIndex.value = state.index
      const item = current.value
      if (item) {
        const version = ++requestVersion
        source.value = ''
        artwork.value = item.musicArtwork || item.thumb || ''
        lyrics.value = []
        lyricsSource.value = 'none'
        onlineInfo.value = null
        technicalInfo.value = null
        metadataLoading.value = true
        void playbackUrl(item)
          .then((url) => {
            if (version !== requestVersion) return
            source.value = url
            return hydrateCurrentDetails(item, version, url)
          })
          .finally(() => { if (version === requestVersion) metadataLoading.value = false })
      }
    }
    if (Date.now() - lastSavedAt > 15000) void saveProgress()
  }

  async function rawUrl(path: string) {
    const openlist = useOpenListStore()
    if (openlist.state !== 'ready') await openlist.start()
    if (openlist.state !== 'ready') throw new Error(openlist.error || 'OpenList 服务未就绪')
    const data = await openListRequest<{ raw_url: string }>(openlist.baseUrl, '/api/fs/get', { path, password: '' }, openlist.token)
    if (!data.raw_url) throw new Error('网盘没有返回可用的音频地址')
    return data.raw_url
  }

  async function loadLyrics(path: string) {
    const response = await fetch(await rawUrl(path))
    if (!response.ok) throw new Error('歌词读取失败')
    return parseLrc(await response.text())
  }

  async function reportCurrentLyrics() {
    const item = current.value
    const reported = onlineInfo.value
    if (!item || lyricsSource.value !== 'netease' || !reported || reportingLyrics.value) return
    reportingLyrics.value = true
    lyricsNotice.value = t('music.reportRetrying')
    try {
      await reportLyricError(item.path, reported.neteaseId)
      const replacement = await resolveOnlineMusic(item, true)
      if (current.value?.path !== item.path) return
      onlineInfo.value = replacement
      if (replacement?.lyric) {
        lyrics.value = parseLrc(replacement.lyric, replacement.translatedLyric)
        lyricsSource.value = lyrics.value.length ? 'netease' : 'none'
        lyricsNotice.value = replacement.neteaseId === reported.neteaseId ? t('music.reportRecorded') : t('music.reportSwitched')
        await applyOnlineMetadata(item, replacement)
      } else {
        lyrics.value = []
        lyricsSource.value = 'none'
        lyricsNotice.value = t('music.reportNoReplacement')
      }
    } catch (reason) {
      lyricsNotice.value = reason instanceof Error ? reason.message : t('music.reportFailed')
    } finally {
      reportingLyrics.value = false
    }
  }

  async function applyOnlineMetadata(item: MediaItem, info: OnlineMusicInfo) {
    const artists = info.artists.filter(Boolean)
    const metadata: Partial<MediaItem> = {
      title: info.title || item.title,
      artists,
      artist: artists.join(' / ') || item.artist,
      album: info.album || item.album,
      duration: technicalInfo.value?.durationUs ? technicalInfo.value.durationUs / 1_000_000 : info.duration || item.duration,
      musicMetadataProvider: 'netease',
      musicMetadataId: info.neteaseId,
      musicMetadataFetchedAt: info.fetchedAt,
      musicMetadataVersion: MUSIC_METADATA_VERSION,
      musicArtwork: info.artwork || item.musicArtwork,
    }
    Object.assign(item, metadata)
    await useMediaStore().updateMusicMetadata(item.path, metadata)
    updateMediaSession()
  }

  function toggle() {
    if (!current.value) return
    if (nativePlayback) {
      void (playing.value ? NativeMusicPlayback.pause() : NativeMusicPlayback.play())
      return
    }
    if (!audio) return
    if (audio.paused) audio.play().catch((reason) => { error.value = String(reason) })
    else audio.pause()
  }

  function seek(value: number) {
    if (!Number.isFinite(value)) return
    if (nativePlayback) {
      position.value = Math.max(0, Math.min(value, duration.value || value))
      void NativeMusicPlayback.seek({ position: position.value })
      return
    }
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(value, audio.duration || value))
    position.value = audio.currentTime
  }

  async function previous() {
    if (!current.value) return
    if (nativePlayback) {
      await saveProgress()
      await NativeMusicPlayback.previous()
      return
    }
    if (!audio) return
    if (audio.currentTime > 5 || !hasPrevious.value) return seek(0)
    await saveProgress()
    currentIndex.value -= 1
    await loadCurrent(true)
  }

  async function next() {
    await saveProgress()
    if (nativePlayback) {
      await NativeMusicPlayback.next()
      return
    }
    if (!hasNext.value) {
      playing.value = false
      return
    }
    currentIndex.value += 1
    await loadCurrent(true)
  }

  function onPlaying(value: boolean) {
    playing.value = value
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = value ? 'playing' : 'paused'
    if (!value) void saveProgress()
  }

  function onTime(currentTime: number, total: number) {
    position.value = currentTime
    if (Number.isFinite(total)) duration.value = total
    if (Date.now() - lastSavedAt > 15000) void saveProgress()
    if ('mediaSession' in navigator && duration.value > 0) {
      try { navigator.mediaSession.setPositionState({ duration: duration.value, position: Math.min(position.value, duration.value), playbackRate: audio?.playbackRate ?? 1 }) }
      catch { /* Some WebViews expose MediaSession without position state. */ }
    }
  }

  async function saveProgress() {
    const item = current.value
    if (!item || !duration.value) return
    lastSavedAt = Date.now()
    const savedPosition = duration.value - position.value <= 2 ? 0 : position.value
    await useMediaStore().updateProgress(item.path, item.title, savedPosition, duration.value)
  }

  function updateMediaSession() {
    if (nativePlayback) return
    if (!('mediaSession' in navigator) || !current.value) return
    const item = current.value
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.title,
      artist: item.artist || '未知艺术家',
      album: item.album || '未知专辑',
      artwork: artwork.value ? [{ src: artwork.value }] : [],
    })
  }

  return {
    queue, currentIndex, current, source, artwork, lyrics, lyricsSource, onlineInfo, technicalInfo, metadataLoading,
    reportingLyrics, lyricsNotice, playing, loading, position, duration, error,
    hasPrevious, hasNext, activeLyricIndex, attach, playQueue, loadCurrent, rawUrl, toggle, seek, previous, next,
    onPlaying, onTime, saveProgress, updateMediaSession, reportCurrentLyrics, nativePlayback,
  }
})

function resumePosition(item: MediaItem) {
  const saved = item.position ?? 0
  const total = item.duration ?? 0
  return total > 0 && total - saved <= 2 ? 0 : saved
}

function parseLrc(value: string, translatedValue = ''): LyricLine[] {
  const result: LyricLine[] = []
  for (const line of value.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const timestamps = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    const text = line.replace(/\[[^\]]+\]/g, '').trim()
    if (!text) continue
    for (const match of timestamps) {
      const fraction = match[3] ? Number(`0.${match[3].padEnd(3, '0').slice(0, 3)}`) : 0
      result.push({ time: Number(match[1]) * 60 + Number(match[2]) + fraction, text })
    }
  }
  if (translatedValue) {
    const translated = parseLrc(translatedValue)
    const translations = new Map(translated.map((line) => [Math.round(line.time * 100), line.text]))
    for (const line of result) {
      const translation = translations.get(Math.round(line.time * 100))
      if (translation && translation !== line.text) line.translation = translation
    }
  }
  return result.sort((a, b) => a.time - b.time)
}
