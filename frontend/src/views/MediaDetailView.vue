<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Captions, Check, CircleAlert, Clock3, Download, ExternalLink, FileVideo2, LoaderCircle, Play, Star, UserRound } from '@lucide/vue'
import { Capacitor } from '@capacitor/core'
import { useMediaStore, type MediaItem } from '../stores/media'
import { useOpenListStore } from '../stores/openlist'
import { openListRequest } from '../services/openlist'
import { NativePlayer, type NativeSubtitle } from '../services/nativePlayer'
import { loadPlayerSettings, type PlayerMode } from '../services/playerSettings'
import { offlineCacheId, useOfflineCacheStore, type OfflineCacheEntry } from '../stores/offlineCache'

const route = useRoute()
const router = useRouter()
const media = useMediaStore()
const openlist = useOpenListStore()
const offline = useOfflineCacheStore()
const resolvingPath = ref('')
const cachingPath = ref('')
const error = ref('')
const activeSeasonId = ref('')
const defaultPlayer = ref<PlayerMode>('internal')
let cachePoll: number | undefined

const work = computed(() => media.works.find((entry) => entry.id === route.query.id))
const seasons = computed(() => work.value?.category === 'tv' ? work.value.seasons : [])
const activeSeason = computed(() => seasons.value.find((season) => season.id === activeSeasonId.value) ?? seasons.value[0])
const visibleItems = computed(() => work.value?.category === 'tv' ? activeSeason.value?.items ?? [] : work.value?.items ?? [])
const nextItem = computed(() => visibleItems.value.find((item) => item.position && item.duration && item.position < item.duration - 30)
  ?? visibleItems.value.find((item) => !item.lastPlayed)
  ?? visibleItems.value[0])
const alternatePlayer = computed<PlayerMode>(() => defaultPlayer.value === 'external' ? 'internal' : 'external')
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

function progress(item: MediaItem) {
  return item.position && item.duration ? Math.min(100, item.position / item.duration * 100) : 0
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

async function play(item?: MediaItem, mode: PlayerMode = defaultPlayer.value) {
  if (!item || resolvingPath.value) return
  resolvingPath.value = item.path
  error.value = ''
  try {
    const cached = offline.entryForPath(item.path)
    let url: string
    let subtitles: NativeSubtitle[]
    if (cached?.status === 'completed' && cached.uri) {
      url = mode === 'external' ? cached.uri : cached.internalUri || cached.uri
      subtitles = cached.subtitles.map((subtitle) => ({
        ...subtitle,
        url: mode === 'external' ? subtitle.url : subtitle.internalUrl || subtitle.url,
      }))
    } else {
      if (openlist.state !== 'ready') await openlist.start()
      if (openlist.state !== 'ready') throw new Error(openlist.error || 'OpenList 服务未就绪')
      ;[url, subtitles] = await Promise.all([rawUrl(item.path), resolveSubtitles(item)])
    }
    if (Capacitor.isNativePlatform()) {
      if (mode === 'external') {
        await NativePlayer.playExternal({ url, title: filename(item.path), position: (item.position ?? 0) * 1000, subtitles })
        await media.updateProgress(item.path, item.title, item.position ?? 0, item.duration ?? 0)
      } else {
        const result = await NativePlayer.play({ url, title: filename(item.path), position: (item.position ?? 0) * 1000, subtitles })
        if (result.duration > 0) await media.updateProgress(item.path, item.title, result.position / 1000, result.duration / 1000)
      }
    } else if (mode === 'external') {
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

watch(heroImage, () => {
  heroLoaded.value = false
}, { immediate: true })

onMounted(async () => {
  const [, settings] = await Promise.all([media.load(), loadPlayerSettings(), offline.refresh()])
  defaultPlayer.value = settings.defaultMode
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
            <span>{{ work.category === 'tv' && activeSeason ? episodeSummary(activeSeason.items) : work.items.length > 1 ? `${work.items.length} 个版本` : '影片' }}</span>
          </div>
          <p v-if="localizedGenres.length" class="genres">{{ localizedGenres.join(' · ') }}</p>
          <div class="play-actions">
            <button class="play-button" :disabled="Boolean(resolvingPath)" @click="play(nextItem)">
              <LoaderCircle v-if="resolvingPath === nextItem?.path" class="spin" :size="21" />
              <ExternalLink v-else-if="defaultPlayer === 'external'" :size="20" />
              <Play v-else :size="21" fill="currentColor" />
              {{ resolvingPath === nextItem?.path ? '正在准备播放…' : defaultPlayer === 'external' ? '用外部播放器播放' : nextItem?.position ? '继续播放' : work.category === 'tv' ? '播放本季第 1 集' : '播放' }}
            </button>
            <button class="alternate-button" :disabled="Boolean(resolvingPath)" @click="play(nextItem, alternatePlayer)">
              <Play v-if="alternatePlayer === 'internal'" :size="18" fill="currentColor" />
              <ExternalLink v-else :size="18" />
              {{ alternatePlayer === 'external' ? '其他播放器' : '内置播放' }}
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
      <section class="episode-section">
        <div class="section-heading">
          <h2>{{ work.category === 'tv' ? '选集' : work.category === 'movie' && work.items.length > 1 ? '影片版本' : '媒体文件' }}</h2>
          <span v-if="work.category === 'tv' && activeSeason">{{ episodeSummary(activeSeason.items) }} · {{ activeSeason.folderName }}</span>
          <span v-else>{{ visibleItems.length }} 个文件</span>
        </div>
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
            </span>
          </article>
        </div>
      </section>

      <section class="synopsis-section">
        <div class="section-heading"><h2>剧情简介</h2></div>
        <p>{{ work.overview || '暂时没有剧情简介。' }}</p>
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
          <span>{{ sizeLabel(nextItem.size) }}</span>
          <span v-if="durationLabel(nextItem)">{{ durationLabel(nextItem) }}</span>
          <span v-if="nextItem.subtitles?.length"><Captions :size="15" />{{ nextItem.subtitles.map((subtitle) => subtitle.label).join('、') }}</span>
        </div>
      </section>

      <p v-if="work.metadataProvider" class="metadata-credit">元数据由 {{ work.metadataProvider === 'tmdb' ? 'TMDB' : work.metadataProvider === 'bangumi' ? 'Bangumi' : 'TVmaze' }} 提供</p>
    </main>
  </section>

  <section v-else class="page"><div class="empty-state"><div><h2>找不到这部作品</h2><p>媒体库可能已经重新扫描，请返回后重新选择。</p><RouterLink to="/library" class="primary-button">返回媒体库</RouterLink></div></div></section>
</template>

<style scoped>
.detail-page{min-height:100svh;padding-bottom:calc(76px + env(safe-area-inset-bottom));background:var(--canvas)}
.hero{position:relative;min-height:min(74svh,680px);overflow:hidden;background:#121218}.hero-backdrop{position:absolute;inset:0}.hero-backdrop::after{position:absolute;content:"";inset:0;background:linear-gradient(90deg,rgba(8,9,14,.86) 0%,rgba(8,9,14,.42) 58%,rgba(8,9,14,.2)),linear-gradient(0deg,#090a0f 0%,rgba(9,10,15,.72) 24%,rgba(9,10,15,.06) 64%)}.hero-backdrop img{position:absolute;width:100%;height:100%;object-fit:cover}.hero-preview{filter:blur(12px);transform:scale(1.04)}.hero-image{opacity:0;transition:opacity .22s ease}.hero-image.loaded{opacity:1}.back-button{position:absolute;z-index:2;top:calc(20px + env(safe-area-inset-top));left:max(24px,calc((100% - 1180px)/2));display:grid;width:44px;height:44px;place-items:center;border:0;border-radius:50%;color:#fff;background:rgba(10,11,16,.72)}.hero-body{position:relative;z-index:1;display:flex;width:min(100%,1180px);min-height:min(74svh,680px);flex-direction:column;justify-content:flex-end;margin:auto;padding:92px 36px 0}.hero-copy{max-width:760px;padding-bottom:34px}.hero-copy h1{max-width:18ch;margin-bottom:14px;color:#fff;font-family:var(--font-body);font-size:42px;letter-spacing:-.03em;line-height:1.12;text-wrap:balance}.facts{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;margin-bottom:10px;color:#efedf2;font-size:13px}.facts span{display:flex;align-items:center;gap:5px}.facts span:first-child{color:#b9ff7b}.genres{margin-bottom:22px;color:#d2cfd6;font-size:13px}.play-actions{display:flex;flex-wrap:wrap;gap:10px}.play-button,.alternate-button{display:inline-flex;min-height:54px;align-items:center;justify-content:center;gap:10px;padding:0 25px;border-radius:7px;font-size:14px;font-weight:750}.play-button{min-width:220px;border:0;color:#090a0e;background:#fff;font-size:15px}.alternate-button{border:1px solid rgba(255,255,255,.28);color:#fff;background:rgba(10,11,16,.62)}.play-button:disabled,.alternate-button:disabled,.episode-card:disabled{opacity:.58}.play-error{display:flex;align-items:center;gap:7px;margin-top:12px;color:#ff8a86;font-size:12px}.season-tabs{display:flex;gap:34px;overflow-x:auto}.season-tabs button{position:relative;flex:0 0 auto;padding:0 0 17px;border:0;color:#aaa7b0;background:transparent;font-size:17px}.season-tabs button.active{color:#fff;font-weight:750}.season-tabs button.active::after{position:absolute;right:0;bottom:0;left:0;height:3px;content:"";background:var(--beam)}
.detail-content{width:min(100%,1180px);margin:auto;padding:34px 36px 48px}.episode-section,.synopsis-section,.cast-section,.file-section{margin-bottom:38px}.section-heading{display:flex;align-items:baseline;gap:14px;margin-bottom:17px}.section-heading h2{font-family:var(--font-body);font-size:22px;letter-spacing:-.02em}.section-heading span{color:var(--dim);font-size:11px}.episode-strip,.cast-strip{display:flex;gap:15px;overflow-x:auto;overscroll-behavior-inline:contain;scroll-snap-type:x proximity;padding-bottom:8px}.episode-card{display:grid;width:245px;flex:0 0 245px;gap:8px;padding:0;border:0;color:var(--ink);background:transparent;text-align:left;scroll-snap-align:start}.episode-image{position:relative;display:grid;aspect-ratio:16/9;place-items:center;overflow:hidden;border-radius:7px;color:var(--beam);background:var(--surface-raised)}.episode-placeholder{position:absolute}.episode-image img{position:absolute;inset:0;z-index:0;width:100%;height:100%;object-fit:cover}.episode-preview{filter:brightness(.76)}.episode-image .episode-still{z-index:1}.episode-image::after{position:absolute;z-index:1;content:"";inset:45% 0 0;background:linear-gradient(transparent,rgba(0,0,0,.7))}.play-chip{position:absolute;z-index:2;display:grid;width:40px;height:40px;place-items:center;border-radius:50%;color:#090a0e;background:rgba(255,255,255,.92)}.episode-image em{position:absolute;z-index:2;right:8px;bottom:7px;color:#fff;font-size:10px;font-style:normal}.episode-image>i{position:absolute;z-index:3;bottom:0;left:0;height:3px;background:var(--beam)}.episode-name{display:block;overflow:hidden;font-size:13px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}.episode-name b{margin-right:5px;color:var(--beam)}.episode-tags{display:flex;min-height:18px;align-items:center;gap:10px;color:var(--dim)}.episode-tags small{display:flex;align-items:center;gap:4px;font-size:10px}.synopsis-section>p{max-width:75ch;color:#c4c1c9;font-size:14px;line-height:1.9;text-wrap:pretty}.cast-strip{gap:22px}.cast-member{display:grid;width:92px;flex:0 0 92px;justify-items:center;gap:5px;text-align:center}.avatar{display:grid;width:78px;height:78px;margin-bottom:3px;place-items:center;overflow:hidden;border-radius:50%;color:var(--muted);background:var(--surface-raised)}.avatar img{width:100%;height:100%;object-fit:cover}.cast-member strong,.cast-member small{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cast-member strong{font-size:12px}.cast-member small{color:var(--dim);font-size:10px}.file-section{padding-top:28px;border-top:1px solid var(--line)}.file-section p{max-width:100%;overflow:hidden;color:var(--dim);font-size:11px;text-overflow:ellipsis;white-space:nowrap}.file-section .file-name{margin-bottom:7px;color:var(--ink);font-size:13px}.file-facts{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:10px;color:var(--muted);font-size:11px}.file-facts span{display:flex;align-items:center;gap:5px}.metadata-credit{color:var(--dim);font-size:10px}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.cache-action{display:inline-flex;min-height:54px;align-items:center;justify-content:center;gap:8px;padding:0 18px;border:1px solid rgba(255,255,255,.2);border-radius:7px;color:#fff;background:rgba(10,11,16,.62);font-size:13px;font-weight:700}.cache-action:disabled,.episode-play:disabled,.episode-cache:disabled{opacity:.58}.episode-play{display:block;width:100%;padding:0;border:0;color:inherit;background:transparent;text-align:left}.episode-title-row{display:flex;min-width:0;align-items:center;gap:7px}.episode-title-row .episode-name{min-width:0;flex:1}.episode-cache{display:grid;width:30px;height:30px;flex:0 0 auto;place-items:center;border:1px solid var(--line);border-radius:50%;color:var(--muted);background:var(--surface)}.episode-cache:disabled{color:var(--beam)}
@media(max-width:640px){.hero{min-height:620px}.hero-body{min-height:620px;padding:88px 20px 0}.hero-copy{padding-bottom:28px}.hero-copy h1{font-size:34px}.play-actions{display:grid;grid-template-columns:1fr auto}.play-button{width:100%;min-width:0}.alternate-button{padding-inline:16px}.back-button{left:20px}.season-tabs{gap:28px}.detail-content{padding:28px 20px 40px}.episode-card{width:220px;flex-basis:220px}.section-heading{align-items:flex-start;flex-direction:column;gap:4px}.synopsis-section>p{font-size:13px}.cast-member{width:82px;flex-basis:82px}.avatar{width:70px;height:70px}}
@media(max-width:640px){.cache-action{grid-column:1/-1;min-height:46px}}
@media(prefers-reduced-motion:reduce){.spin{animation:none}.hero-image{transition:none}.episode-strip,.cast-strip{scroll-behavior:auto}}
</style>
