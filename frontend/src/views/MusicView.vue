<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { Check, Cloud, Disc3, Download, FolderCog, LoaderCircle, Music2, Pause, Play, RefreshCw, Search } from '@lucide/vue'
import { useMediaStore, type MediaItem } from '../stores/media'
import { useLibrarySourcesStore } from '../stores/librarySources'
import { useLibraryScanStore } from '../stores/libraryScan'
import { useMusicPlayerStore } from '../stores/musicPlayer'
import { offlineCacheId, useOfflineCacheStore } from '../stores/offlineCache'
import { t } from '../i18n'
import { MUSIC_METADATA_VERSION, resolveOnlineMusic } from '../services/musicMetadata'
import { useNeteaseStore, type ImportedNeteasePlaylist, type NeteaseTrack } from '../stores/netease'

interface MusicAlbum { id: string; title: string; artist: string; folderPath: string; artworkPath?: string; artworkUrl?: string; items: MediaItem[] }

const media = useMediaStore()
const router = useRouter()
const sources = useLibrarySourcesStore()
const scanner = useLibraryScanStore()
const player = useMusicPlayerStore()
const offline = useOfflineCacheStore()
const netease = useNeteaseStore()
const { scanning, discovered, currentFolder } = storeToRefs(scanner)
const query = ref('')
const activeAlbumId = ref('')
const activeImportedId = ref(0)
const activeCollectionKind = ref<'album' | 'netease'>('album')
const visibleTrackCount = ref(10)
const coverUrls = reactive<Record<string, string>>({})
const coverFailures = new Set<string>()
const cachingPath = ref('')
const error = ref('')
let cachePoll: number | undefined
let metadataHydrationRunning = false
let metadataHydrationCancelled = false

const libraryMusic = computed(() => {
  const indexed = new Map(media.musicItems.map((item) => [item.path, item]))
  for (const item of scanner.musicPreview) indexed.set(item.path, item)
  return [...indexed.values()]
})
const albums = computed<MusicAlbum[]>(() => {
  const grouped = new Map<string, MediaItem[]>()
  for (const item of libraryMusic.value) {
    const folder = item.folderPath || item.path.slice(0, item.path.lastIndexOf('/'))
    const group = grouped.get(folder) ?? []
    group.push(item)
    grouped.set(folder, group)
  }
  return [...grouped.entries()].map(([folderPath, items]) => {
    const sorted = [...items].sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1)
      || (a.trackNumber ?? Number.MAX_SAFE_INTEGER) - (b.trackNumber ?? Number.MAX_SAFE_INTEGER)
      || a.path.localeCompare(b.path, 'zh-CN', { numeric: true }))
    const artists = [...new Set(sorted.map((item) => item.albumArtist || item.artist).filter(Boolean))]
    return {
      id: folderPath,
      folderPath,
      title: sorted[0]?.album || folderPath.split('/').filter(Boolean).at(-1) || t('music.unknownAlbum'),
      artist: artists.length === 1 ? artists[0]! : artists.length > 1 ? t('music.multipleArtists') : t('music.unknownArtist'),
      artworkPath: sorted.find((item) => item.artworkPath)?.artworkPath,
      artworkUrl: sorted.find((item) => item.musicArtwork)?.musicArtwork,
      items: sorted,
    }
  }).sort((a, b) => a.title.localeCompare(b.title, 'zh-CN', { numeric: true }))
})

const filteredAlbums = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  if (!needle) return albums.value
  return albums.value.filter((album) => `${album.title} ${album.artist} ${album.items.map((item) => `${item.title} ${item.artist ?? ''}`).join(' ')}`.toLocaleLowerCase().includes(needle))
})
const activeAlbum = computed(() => albums.value.find((album) => album.id === activeAlbumId.value) ?? filteredAlbums.value[0] ?? albums.value[0])
const totalDuration = computed(() => activeAlbum.value?.items.reduce((sum, item) => sum + (item.duration ?? 0), 0) ?? 0)
const filteredImported = computed(() => {
  const needle = normalize(query.value)
  if (!needle) return netease.imported
  return netease.imported.filter((playlist) => normalize(`${playlist.name} ${playlist.creator || ''} ${playlist.tracks.map((track) => `${track.name} ${track.artists.join(' ')}`).join(' ')}`).includes(needle))
})
const activeImported = computed(() => netease.imported.find((playlist) => playlist.id === activeImportedId.value) ?? filteredImported.value[0] ?? netease.imported[0])
const importedMatches = computed(() => activeImported.value?.tracks.map((track) => matchLibraryTrack(track)).filter((item): item is MediaItem => Boolean(item)) ?? [])
type MusicCollection = { key: string; kind: 'album'; album: MusicAlbum } | { key: string; kind: 'netease'; playlist: ImportedNeteasePlaylist }
const collections = computed<MusicCollection[]>(() => [
  ...filteredImported.value.map((playlist) => ({ key: `netease:${playlist.id}`, kind: 'netease' as const, playlist })),
  ...filteredAlbums.value.map((album) => ({ key: `album:${album.id}`, kind: 'album' as const, album })),
])
const visibleImportedTracks = computed(() => activeImported.value?.tracks.slice(0, visibleTrackCount.value) ?? [])
const visibleAlbumTracks = computed(() => activeAlbum.value?.items.slice(0, visibleTrackCount.value) ?? [])

function timeLabel(seconds: number) {
  if (!seconds) return ''
  if (seconds < 60) return t('music.seconds', { count: Math.max(1, Math.round(seconds)) })
  const minutes = Math.round(seconds / 60)
  return minutes >= 60
    ? t('music.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
    : t('music.minutes', { count: minutes })
}

function sizeLabel(bytes: number) {
  if (!bytes) return ''
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function trackIndex(item: MediaItem, index: number) {
  return item.trackNumber ? String(item.trackNumber).padStart(2, '0') : String(index + 1).padStart(2, '0')
}

function isCurrent(item: MediaItem) { return player.current?.path === item.path }
function cached(item: MediaItem) { return offline.entryForPath(item.path)?.status === 'completed' }
function albumCover(album: MusicAlbum) { return coverUrls[album.id] || album.artworkUrl }
function normalize(value: string) { return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') }
function matchLibraryTrack(track: NeteaseTrack) {
  const byId = libraryMusic.value.find((item) => item.musicMetadataId === track.id)
  if (byId) return byId
  const title = normalize(track.name)
  const artists = track.artists.map(normalize).filter(Boolean)
  return libraryMusic.value.find((item) => {
    if (normalize(item.title) !== title) return false
    const localArtists = (item.artists?.length ? item.artists : [item.artist]).filter(Boolean).map((artist) => normalize(artist!))
    return !artists.length || !localArtists.length || artists.some((artist) => localArtists.some((local) => artist === local || artist.includes(local) || local.includes(artist)))
  })
}
async function playImported(track: NeteaseTrack) {
  const match = matchLibraryTrack(track)
  if (match) {
    const index = importedMatches.value.findIndex((item) => item.path === match.path)
    await player.playQueue(importedMatches.value, Math.max(0, index))
    return
  }
  error.value = ''
  try {
    const urls = await netease.playbackUrls([track.id])
    const url = urls.get(track.id)
    if (!url) throw new Error(t('music.neteaseUnavailable'))
    const remoteItem: MediaItem = {
      path: `netease://${track.id}`,
      title: track.name,
      size: 0,
      modified: new Date().toISOString(),
      category: 'music',
      artist: track.artists.join(' / '),
      artists: track.artists,
      album: track.album,
      duration: track.duration,
      musicArtwork: track.artwork,
      musicMetadataProvider: 'netease',
      musicMetadataId: track.id,
      streamUrl: url,
      streamProvider: 'netease',
    }
    await player.playQueue([remoteItem], 0)
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
}
function selectCollection(collection: MusicCollection) {
  activeCollectionKind.value = collection.kind
  visibleTrackCount.value = 10
  if (collection.kind === 'album') activeAlbumId.value = collection.album.id
  else activeImportedId.value = collection.playlist.id
}

async function hydrateOnlineMetadata() {
  if (metadataHydrationRunning) return
  const pending = media.musicItems.filter((item) => item.musicMetadataVersion !== MUSIC_METADATA_VERSION || !item.musicMetadataId || !item.musicMetadataFetchedAt || Date.now() - item.musicMetadataFetchedAt > 30 * 24 * 60 * 60 * 1000).slice(0, 120)
  if (!pending.length) return
  metadataHydrationRunning = true
  try {
    for (let cursor = 0; cursor < pending.length && !metadataHydrationCancelled; cursor += 3) {
      const resolved = await Promise.all(pending.slice(cursor, cursor + 3).map(async (item) => ({ item, info: await resolveOnlineMusic(item).catch(() => null) })))
      const updates = resolved.flatMap(({ item, info }) => info ? [{ path: item.path, metadata: {
        title: info.title || item.title,
        artists: info.artists,
        artist: info.artists.join(' / ') || item.artist,
        album: info.album || item.album,
        duration: info.duration || item.duration,
        musicArtwork: info.artwork || item.musicArtwork,
        musicMetadataProvider: 'netease' as const,
        musicMetadataId: info.neteaseId,
        musicMetadataFetchedAt: info.fetchedAt,
        musicMetadataVersion: MUSIC_METADATA_VERSION,
      } }] : [])
      if (updates.length) await media.updateMusicMetadataBatch(updates)
      if (cursor + 3 < pending.length) await new Promise((resolve) => window.setTimeout(resolve, 260))
    }
  } finally { metadataHydrationRunning = false }
}

async function resolveCovers() {
  const targets = [activeAlbum.value, ...filteredAlbums.value.slice(0, 24)].filter((album): album is MusicAlbum => Boolean(album?.artworkPath && !coverUrls[album.id] && !coverFailures.has(album.id)))
  const unique = [...new Map(targets.map((album) => [album.id, album])).values()]
  for (let cursor = 0; cursor < unique.length; cursor += 4) {
    await Promise.all(unique.slice(cursor, cursor + 4).map(async (album) => {
      try { coverUrls[album.id] = await player.rawUrl(album.artworkPath!) }
      catch { coverFailures.add(album.id) }
    }))
  }
}

async function playAlbum(index = 0) {
  if (!activeAlbum.value) return
  await player.playQueue(activeAlbum.value.items, index)
}

async function cacheTrack(item: MediaItem) {
  if (cachingPath.value || cached(item)) return
  cachingPath.value = item.path
  error.value = ''
  try {
    await offline.start({
      id: offlineCacheId(item.path), url: await player.rawUrl(item.path), sourcePath: item.path,
      title: `${item.artist ? `${item.artist} · ` : ''}${item.title}`, fileName: item.path.split('/').at(-1) || `${item.title}.mp3`,
      poster: activeAlbum.value ? coverUrls[activeAlbum.value.id] : undefined, expectedSize: item.size, subtitles: [],
    })
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
  finally { cachingPath.value = '' }
}

watch([filteredAlbums, query], () => {
  if (!albums.value.some((album) => album.id === activeAlbumId.value)) activeAlbumId.value = filteredAlbums.value[0]?.id ?? ''
  void resolveCovers()
}, { immediate: true })
watch(activeAlbum, () => void resolveCovers())
watch(filteredImported, (items, previousItems) => {
  if (!items.some((item) => item.id === activeImportedId.value)) activeImportedId.value = items[0]?.id ?? 0
  if (items.length && !previousItems?.length) activeCollectionKind.value = 'netease'
}, { immediate: true })
watch(() => media.musicItems.length, () => void hydrateOnlineMetadata())
watch(query, () => { visibleTrackCount.value = 10 })

onMounted(async () => {
  await Promise.all([media.load(), sources.load(), offline.load(), netease.load()])
  if (!albums.value.length && netease.imported.length) activeCollectionKind.value = 'netease'
  if (!media.musicItems.length && sources.enabledSources.length) void scanner.start()
  void hydrateOnlineMetadata()
  void resolveCovers()
  cachePoll = window.setInterval(() => void offline.refresh(), 2500)
})
onUnmounted(() => { metadataHydrationCancelled = true; if (cachePoll) window.clearInterval(cachePoll) })
</script>

<template>
  <section class="page music-page">
    <header class="page-header"><div><p class="eyebrow">Music</p><h1>{{ t('music.title') }}</h1></div><button class="icon-button" :disabled="scanning || !sources.enabledSources.length" :aria-label="t('music.rescan')" @click="scanner.start"><LoaderCircle v-if="scanning" class="spin" :size="18" /><RefreshCw v-else :size="18" /></button></header>
    <div v-if="scanning" class="scan-status"><LoaderCircle class="spin" :size="18" /><span><strong>{{ t('music.scanning') }}</strong><small>{{ currentFolder || t('music.scanPreparing') }}</small></span><em>{{ t('music.discovered', { count: discovered }) }}</em></div>
    <p v-if="error || player.error || scanner.error" class="error-banner">{{ error || player.error || scanner.error }}</p>
    <label v-if="libraryMusic.length || netease.imported.length" class="search-box"><Search :size="18" /><input v-model="query" :placeholder="t('music.search')" /></label>

    <section v-if="collections.length" class="collection-section">
      <div class="section-heading"><h2>{{ t('music.albumsAndPlaylists') }}</h2><span>{{ t('music.collectionSummary', { count: collections.length }) }}</span></div>
      <div class="album-grid">
        <button v-for="collection in collections" :key="collection.key" class="album-card" :class="{ active: collection.kind === activeCollectionKind && (collection.kind === 'album' ? activeAlbum?.id === collection.album.id : activeImported?.id === collection.playlist.id) }" @click="selectCollection(collection)">
          <span class="album-cover">
            <img v-if="collection.kind === 'album' ? albumCover(collection.album) : collection.playlist.coverImgUrl" :src="collection.kind === 'album' ? albumCover(collection.album) : collection.playlist.coverImgUrl" alt="" />
            <Disc3 v-else :size="30" />
            <i v-if="collection.kind === 'netease'" class="netease-icon" :aria-label="t('music.neteaseSource')"><Cloud :size="12" fill="currentColor" /></i>
          </span>
          <strong>{{ collection.kind === 'album' ? collection.album.title : collection.playlist.name }}</strong>
          <small>{{ collection.kind === 'album' ? collection.album.artist : t('music.neteasePlaylist') }} · {{ t('music.songCount', { count: collection.kind === 'album' ? collection.album.items.length : collection.playlist.tracks.length }) }}</small>
        </button>
      </div>
      <section v-if="activeCollectionKind === 'netease' && activeImported" class="cloud-detail">
        <header><div><h3>{{ activeImported.name }}</h3><p>{{ t('music.matchedTracks', { matched: importedMatches.length, total: activeImported.tracks.length }) }}</p></div><RouterLink to="/settings/discovery">{{ t('music.managePlaylists') }}</RouterLink></header>
        <div class="track-list">
          <article v-for="track in visibleImportedTracks" :key="track.id" class="track-row cloud-track">
            <button class="track-main" @click="playImported(track)"><span class="track-number"><Play :size="13" fill="currentColor" /></span><span><strong>{{ track.name }}</strong><small>{{ track.artists.join(' / ') || t('music.unknownArtist') }}{{ track.album ? ` · ${track.album}` : '' }}</small></span></button>
            <span class="cloud-state" :class="{ matched: matchLibraryTrack(track) }">{{ t(matchLibraryTrack(track) ? 'music.libraryPlayable' : 'music.neteaseStreaming') }}</span>
          </article>
        </div>
        <button v-if="visibleTrackCount < activeImported.tracks.length" class="load-more" @click="visibleTrackCount += 10">{{ t('music.loadMore') }}</button>
      </section>
    </section>

    <template v-if="libraryMusic.length">
      <section v-if="activeCollectionKind === 'album' && activeAlbum" class="album-detail">
        <div class="album-hero"><span class="hero-cover"><img v-if="albumCover(activeAlbum)" :src="albumCover(activeAlbum)" alt="" /><Music2 v-else :size="40" /></span><div><p class="eyebrow">Album</p><h2>{{ activeAlbum.title }}</h2><p>{{ activeAlbum.artist }} · {{ t('music.songCount', { count: activeAlbum.items.length }) }}<span v-if="totalDuration"> · {{ timeLabel(totalDuration) }}</span></p><button class="primary-button" @click="playAlbum(0)"><Play :size="17" fill="currentColor" />{{ t('music.playAll') }}</button></div></div>
        <div class="track-list">
          <article v-for="(item, index) in visibleAlbumTracks" :key="item.path" class="track-row" :class="{ current: isCurrent(item) }">
            <button class="track-main" @click="playAlbum(index)"><span class="track-number"><Pause v-if="isCurrent(item) && player.playing" :size="14" fill="currentColor" /><Play v-else-if="isCurrent(item)" :size="14" fill="currentColor" /><template v-else>{{ trackIndex(item, index) }}</template></span><span><strong>{{ item.title }}</strong><small>{{ item.artist || activeAlbum.artist }}</small></span></button>
            <span class="track-meta">{{ item.duration ? `${Math.floor(item.duration / 60)}:${String(Math.floor(item.duration % 60)).padStart(2, '0')}` : sizeLabel(item.size) }}</span>
            <button class="cache-button" :disabled="cachingPath === item.path || cached(item)" :aria-label="t(cached(item) ? 'music.cached' : 'music.cache')" @click="cacheTrack(item)"><LoaderCircle v-if="cachingPath === item.path" class="spin" :size="16" /><Check v-else-if="cached(item)" :size="16" /><Download v-else :size="16" /></button>
          </article>
        </div>
        <button v-if="visibleTrackCount < activeAlbum.items.length" class="load-more" @click="visibleTrackCount += 10">{{ t('music.loadMore') }}</button>
      </section>

      <section v-if="player.current" class="now-section"><div class="section-heading"><h2>{{ t('music.nowPlaying') }}</h2><span>{{ t('music.queueCount', { count: player.queue.length }) }}</span></div><div class="now-grid">
        <button class="now-info" @click="router.push('/music/player')"><span class="now-cover"><img v-if="player.artwork" :src="player.artwork" alt="" /><Music2 v-else :size="34" /></span><strong>{{ player.current.title }}</strong><small>{{ player.current.artist || t('music.unknownArtist') }} · {{ player.current.album }}</small><span class="open-player">{{ t('music.openFullPlayer') }}</span></button>
        <div class="lyrics" :class="{ empty: !player.lyrics.length }"><template v-if="player.lyrics.length"><button v-for="(line, index) in player.lyrics" :key="`${line.time}-${index}`" :class="{ active: index === player.activeLyricIndex }" @click="player.seek(line.time)">{{ line.text }}</button></template><p v-else>{{ t('music.noLyrics') }}</p></div>
      </div></section>
    </template>

    <div v-else-if="!netease.imported.length && !sources.enabledSources.length" class="empty-state"><div><span class="empty-icon"><FolderCog :size="24" /></span><h2>{{ t('music.chooseFolder') }}</h2><p>{{ t('music.chooseFolderBody') }}</p><RouterLink to="/settings/library" class="primary-button">{{ t('music.configureFolder') }}</RouterLink></div></div>
    <div v-else-if="!netease.imported.length && scanning" class="empty-state"><div><LoaderCircle class="spin" :size="28" /><h2>{{ t('music.building') }}</h2><p>{{ t('music.buildingBody') }}</p></div></div>
    <div v-else-if="!netease.imported.length" class="empty-state"><div><span class="empty-icon"><Music2 :size="24" /></span><h2>{{ t('music.empty') }}</h2><p>{{ t('music.formats') }}</p><button class="primary-button" @click="scanner.start"><RefreshCw :size="17" />{{ t('music.rescan') }}</button></div></div>
  </section>
</template>

<style scoped>
.music-page{max-width:1160px;padding-bottom:130px}.icon-button:disabled{opacity:.4}.scan-status,.error-banner{display:flex;align-items:center}.scan-status{gap:11px;margin:-10px 0 16px;padding:12px 13px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}.scan-status>svg{flex:0 0 auto;color:var(--beam)}.scan-status>span{display:grid;min-width:0;gap:2px}.scan-status strong{font-size:12px}.scan-status small{overflow:hidden;color:var(--dim);font-size:10px;text-overflow:ellipsis;white-space:nowrap}.scan-status em{margin-left:auto;color:var(--muted);font-size:10px;font-style:normal}.error-banner{margin-bottom:14px;padding:11px 13px;border:1px solid rgba(255,113,109,.35);border-radius:7px;color:var(--danger);background:rgba(255,113,109,.07)}.search-box{display:flex;align-items:center;gap:10px;margin-bottom:25px;padding:0 13px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}.search-box input{width:100%;padding:12px 0;border:0;outline:0;color:var(--ink);background:transparent}.section-heading{display:flex;align-items:center;justify-content:space-between}.section-heading span{color:var(--dim);font-size:11px}.album-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:18px 12px}.album-card{display:grid;min-width:0;gap:5px;padding:0 0 9px;border:0;border-bottom:2px solid transparent;color:var(--ink);background:transparent;text-align:left}.album-card.active{border-color:var(--beam)}.album-cover,.hero-cover,.now-cover{display:grid;place-items:center;overflow:hidden;color:var(--beam);background:radial-gradient(circle at 35% 30%,var(--beam-soft),var(--surface-raised) 60%)}.album-cover{aspect-ratio:1;border:1px solid var(--line);border-radius:7px}.album-cover img,.hero-cover img,.now-cover img{width:100%;height:100%;object-fit:cover}.album-card strong,.album-card small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.album-card strong{font-size:12px}.album-card small{color:var(--dim);font-size:9px}.album-detail,.now-section{margin-top:42px;padding-top:28px;border-top:1px solid var(--line)}.album-hero{display:flex;align-items:flex-end;gap:20px;margin-bottom:24px}.hero-cover{width:150px;aspect-ratio:1;flex:0 0 auto;border-radius:8px}.album-hero h2{margin-bottom:6px;font-size:27px}.album-hero p:not(.eyebrow){margin-bottom:18px;color:var(--muted);font-size:12px}.track-list{border-top:1px solid var(--line)}.track-row{display:grid;grid-template-columns:1fr auto 40px;align-items:center;border-bottom:1px solid var(--line)}.track-row.current{background:linear-gradient(90deg,var(--beam-soft),transparent 68%)}.track-main{display:grid;min-width:0;grid-template-columns:38px 1fr;align-items:center;padding:12px 0;border:0;background:transparent;text-align:left}.track-main>span:last-child{display:grid;min-width:0;gap:3px}.track-main strong,.track-main small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.track-main strong{font-size:13px}.track-main small{color:var(--dim);font-size:10px}.track-number{display:grid;place-items:center;color:var(--beam);font-family:var(--font-display);font-size:11px}.track-meta{color:var(--dim);font-size:10px}.cache-button{display:grid;width:40px;height:40px;place-items:center;border:0;color:var(--muted);background:transparent}.cache-button:disabled{color:var(--beam)}.now-grid{display:grid;grid-template-columns:210px 1fr;gap:26px}.now-info{display:grid;align-content:start;gap:5px;padding:0;border:0;background:transparent;text-align:left}.now-cover{width:100%;aspect-ratio:1;margin-bottom:8px;border-radius:8px}.now-info small{color:var(--dim);font-size:10px}.open-player{margin-top:7px;color:var(--beam);font-size:10px;font-weight:700}.lyrics{height:260px;padding:92px 18px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;background:var(--surface);text-align:center}.lyrics button{display:block;width:100%;padding:8px;border:0;color:var(--dim);background:transparent;font-size:13px}.lyrics button.active{color:var(--ink);font-size:15px;font-weight:700}.lyrics.empty{display:grid;place-items:center;padding:18px;color:var(--dim);font-size:12px}.lyrics.empty p{margin:0}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:620px){.album-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.album-hero{align-items:center}.hero-cover{width:100px}.now-grid{grid-template-columns:1fr}.now-info{grid-template-columns:84px 1fr}.now-cover{grid-row:1/4;width:72px}.lyrics{height:220px}.track-meta{display:none}}
.cloud-library{margin-bottom:40px}.cloud-library .section-heading h2{display:flex;align-items:center;gap:8px}.cloud-playlists{display:grid;grid-auto-columns:minmax(132px,170px);grid-auto-flow:column;gap:12px;padding-bottom:8px;overflow-x:auto;scroll-snap-type:x proximity}.cloud-playlists>button{display:grid;min-width:0;gap:5px;padding:0 0 9px;border:0;border-bottom:2px solid transparent;color:var(--ink);background:transparent;text-align:left;scroll-snap-align:start}.cloud-playlists>button.active{border-color:var(--beam)}.cloud-playlists>button>span{display:grid;aspect-ratio:1;place-items:center;overflow:hidden;border-radius:7px;color:var(--beam);background:var(--surface-raised)}.cloud-playlists img{width:100%;height:100%;object-fit:cover}.cloud-playlists strong,.cloud-playlists small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cloud-playlists strong{font-size:12px}.cloud-playlists small{color:var(--dim);font-size:9px}.cloud-detail{margin-top:24px}.cloud-detail>header{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:13px}.cloud-detail h3{margin:0 0 4px;font-size:18px}.cloud-detail p{margin:0;color:var(--dim);font-size:10px}.cloud-detail a{color:var(--beam);font-size:11px;text-decoration:none}.cloud-track{grid-template-columns:minmax(0,1fr) auto}.cloud-track.unavailable{opacity:.56}.cloud-track .track-main:disabled{cursor:default}.cloud-state{padding-left:14px;color:var(--dim);font-size:9px;white-space:nowrap}.cloud-state.matched{color:var(--beam)}
.collection-section{margin-bottom:40px}.album-cover{position:relative}.netease-icon{position:absolute;right:6px;bottom:6px;display:grid;width:24px;height:24px;place-items:center;border:2px solid #fff;border-radius:50%;color:#fff;background:#e53131;box-shadow:0 2px 5px rgba(0,0,0,.35)}.load-more{display:flex;min-width:150px;min-height:40px;align-items:center;justify-content:center;margin:22px auto 0;padding:0 20px;border:1px solid var(--line);border-radius:7px;color:var(--ink);background:var(--surface);font-size:12px;font-weight:650}.load-more:active{background:var(--surface-raised)}
@media(max-width:620px){.cloud-playlists{grid-auto-columns:118px}.cloud-detail>header{align-items:start}.cloud-state{max-width:92px;white-space:normal;text-align:right}}
</style>
