<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AlertCircle, Clapperboard, FolderCog, LoaderCircle, RefreshCw, Search, Star } from '@lucide/vue'
import { useOpenListStore } from '../stores/openlist'
import { useMediaStore, type MediaItem, type MediaWork, type SidecarSubtitle } from '../stores/media'
import { useLibrarySourcesStore } from '../stores/librarySources'
import { openListRequest, type OpenListFile } from '../services/openlist'
import { loadMetadataSettings, matchMetadata, METADATA_VERSION, resolveMetadataLocale } from '../services/metadata'
import MediaArtwork from '../components/MediaArtwork.vue'

type CategoryFilter = 'all' | 'movie' | 'tv' | 'other' | 'pending'

const router = useRouter()
const openlist = useOpenListStore()
const media = useMediaStore()
const sources = useLibrarySourcesStore()
const scanning = ref(false)
const error = ref('')
const query = ref('')
const activeCategory = ref<CategoryFilter>('all')
const currentFolder = ref('')
const discovered = ref(0)
const recognized = ref(0)
const failedFolders = ref(0)
let scanRun = 0

const videoPattern = /\.(mp4|mkv|webm|mov|m4v|avi|ts|m2ts|flv|wmv|m3u8)$/i
const subtitlePattern = /\.(srt|ass|ssa|vtt)$/i
const tabs = computed(() => {
  const counts = { movie: 0, tv: 0, other: 0, pending: 0 }
  for (const work of media.works) counts[work.category] += 1
  return [
    { key: 'all' as const, label: '全部', count: media.works.length },
    { key: 'movie' as const, label: '电影', count: counts.movie },
    { key: 'tv' as const, label: '剧集', count: counts.tv },
    { key: 'other' as const, label: '其他', count: counts.other },
    ...(counts.pending ? [{ key: 'pending' as const, label: '识别中', count: counts.pending }] : []),
  ]
})
const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return media.works.filter((work) => {
    const categoryMatches = activeCategory.value === 'all' || work.category === activeCategory.value
    return categoryMatches && (!needle || work.title.toLocaleLowerCase().includes(needle) || work.items.some((item) => item.path.toLocaleLowerCase().includes(needle)))
  })
})
const hasConfiguredSources = computed(() => sources.enabledSources.length > 0)

async function list(path: string) {
  const data = await openListRequest<{ content: OpenListFile[] | null }>(openlist.baseUrl, '/api/fs/list', {
    path, password: '', page: 1, per_page: 0, refresh: false,
  }, openlist.token)
  return data.content ?? []
}

function childPath(parent: string, name: string) {
  return `${parent === '/' ? '' : parent}/${name}`
}

function basenameWithoutExtension(name: string) {
  return name.replace(/\.[^.]+$/, '')
}

function matchingSubtitles(videoName: string, parent: string, files: OpenListFile[]): SidecarSubtitle[] {
  const videoStem = basenameWithoutExtension(videoName)
  const normalizedVideo = videoStem.normalize('NFKC').toLocaleLowerCase()
  return files.filter((file) => !file.is_dir && subtitlePattern.test(file.name)).flatMap((file) => {
    const subtitleStem = basenameWithoutExtension(file.name)
    const normalizedSubtitle = subtitleStem.normalize('NFKC').toLocaleLowerCase()
    const suffix = normalizedSubtitle.slice(normalizedVideo.length)
    if (normalizedSubtitle !== normalizedVideo && !(normalizedSubtitle.startsWith(normalizedVideo) && '. _-[('.includes(suffix.charAt(0)))) return []
    const extension = file.name.split('.').at(-1)?.toLocaleLowerCase() ?? 'srt'
    const languageHint = suffix.replace(/^[^a-z0-9\p{L}]+/iu, '').replace(/[^a-z0-9\p{L}]+$/iu, '').toLocaleLowerCase()
    const language = subtitleLanguage(languageHint)
    return [{
      path: childPath(parent, file.name),
      label: language?.label ?? (languageHint ? languageHint.toLocaleUpperCase() : '外挂字幕'),
      language: language?.code,
      mimeType: extension === 'vtt' ? 'text/vtt' : extension === 'srt' ? 'application/x-subrip' : 'text/x-ssa',
    }]
  })
}

function subtitleLanguage(value: string) {
  if (/^(zh|zh-cn|chs|sc|简|简中|中文)$/.test(value)) return { code: 'zh-CN', label: '简体中文' }
  if (/^(zh-tw|cht|tc|繁|繁中)$/.test(value)) return { code: 'zh-TW', label: '繁体中文' }
  if (/^(en|eng|english)$/.test(value)) return { code: 'en', label: 'English' }
  if (/^(ja|jpn|jp|japanese)$/.test(value)) return { code: 'ja', label: '日本語' }
  return undefined
}

async function scan() {
  if (scanning.value) return
  await sources.load()
  if (!sources.enabledSources.length) {
    error.value = '请先选择至少一个媒体目录。'
    return
  }
  const run = ++scanRun
  scanning.value = true
  error.value = ''
  currentFolder.value = ''
  discovered.value = 0
  recognized.value = 0
  failedFolders.value = 0
  try {
    if (openlist.state !== 'ready') await openlist.start()
    if (openlist.state !== 'ready') throw new Error(openlist.error || 'OpenList 服务未就绪')
    const settings = await loadMetadataSettings()
    const metadataLocale = resolveMetadataLocale(settings)
    const queue = sources.enabledSources.map((source) => source.path)
    const visitedFolders = new Set<string>()
    const visitedFiles = new Set<string>()
    const matching = new Set<Promise<void>>()
    media.beginScan()

    const scheduleMatch = async (item: MediaItem) => {
      const job = matchMetadata(item, settings)
        .then((metadata) => {
          if (run !== scanRun) return
          if (metadata) {
            media.updateScanned(item.path, { ...metadata, category: metadata.category ?? 'other' })
            recognized.value += 1
          } else {
            media.updateScanned(item.path, { category: 'other', metadataVersion: METADATA_VERSION, metadataLocale })
          }
        })
        .finally(() => matching.delete(job))
      matching.add(job)
      if (matching.size >= 3) await Promise.race(matching)
    }

    while (queue.length && discovered.value < 5000 && run === scanRun) {
      const parent = queue.shift()!
      if (visitedFolders.has(parent)) continue
      visitedFolders.add(parent)
      currentFolder.value = parent
      let files: OpenListFile[]
      try {
        files = await list(parent)
      } catch {
        failedFolders.value += 1
        continue
      }
      for (const file of files) {
        const path = childPath(parent, file.name)
        if (file.is_dir) {
          queue.push(path)
        } else if (videoPattern.test(file.name) && !visitedFiles.has(path)) {
          visitedFiles.add(path)
          const item: MediaItem = {
            path,
            title: file.name.replace(/\.[^.]+$/, ''),
            size: file.size,
            modified: file.modified,
            thumb: file.thumb,
            category: 'pending',
            folderPath: parent,
            libraryRoot: sources.enabledSources.find((source) => parent === source.path || parent.startsWith(`${source.path}/`))?.path,
            subtitles: matchingSubtitles(file.name, parent, files),
          }
          await media.appendScanned(item)
          discovered.value += 1
          await scheduleMatch(item)
        }
        if (discovered.value >= 5000) break
      }
    }
    await Promise.all([...matching])
    await media.finishScan()
    await sources.markScanned()
    if (failedFolders.value && !media.items.length) error.value = '所选媒体目录暂时无法读取，请检查网盘连接或目录是否仍然存在。'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    if (media.items.some((item) => item.category === 'pending')) {
      for (const item of media.items.filter((entry) => entry.category === 'pending')) media.updateScanned(item.path, { category: 'other' })
      await media.finishScan()
    }
  } finally {
    if (run === scanRun) {
      scanning.value = false
      currentFolder.value = ''
    }
  }
}

function openDetails(work: MediaWork) {
  router.push({ name: 'media-detail', query: { id: work.id } })
}

function tvSummary(work: MediaWork) {
  const episodes = work.items.filter((item) => item.episode).length
  const extras = work.items.length - episodes
  const seasons = work.seasons.length > 1 ? `${work.seasons.length} 季 · ` : ''
  return `${seasons}${episodes || work.items.length} 集${extras && episodes ? ` · ${extras} 个附加视频` : ''}`
}

function coverKind(work: MediaWork) {
  if (work.category === 'tv') return '本地剧集'
  if (work.category === 'movie') return '本地电影'
  return work.items.length > 1 ? `${work.items.length} 个视频` : '本地视频'
}

onMounted(async () => {
  await Promise.all([media.load(), sources.load()])
  const metadataSettings = await loadMetadataSettings()
  const metadataLocale = resolveMetadataLocale(metadataSettings)
  if (!sources.enabledSources.length && sources.needsRescan) {
    media.beginScan()
    await media.finishScan()
    await sources.markScanned()
  } else if (sources.enabledSources.length && (!media.items.length || sources.needsRescan || media.items.some((item) => item.metadataVersion !== METADATA_VERSION || item.metadataLocale !== metadataLocale))) {
    void scan()
  }
})
</script>

<template>
  <section class="page library-page">
    <header class="page-header">
      <div><p class="eyebrow">Library</p><h1>媒体库</h1></div>
      <button class="icon-button" :disabled="scanning || !hasConfiguredSources" aria-label="重新扫描" @click="scan">
        <LoaderCircle v-if="scanning" class="spin" :size="18" /><RefreshCw v-else :size="18" />
      </button>
    </header>

    <div v-if="scanning" class="scan-status">
      <LoaderCircle class="spin" :size="18" />
      <span><strong>正在更新媒体库</strong><small>{{ currentFolder || '准备扫描…' }}</small></span>
      <em>发现 {{ discovered }} · 已识别 {{ recognized }}</em>
    </div>
    <p v-if="error" class="error-banner"><AlertCircle :size="17" />{{ error }}</p>

    <template v-if="media.items.length">
      <label class="search-box"><Search :size="18" /><input v-model="query" placeholder="搜索标题或路径" /></label>
      <nav class="category-tabs" aria-label="媒体分类">
        <button v-for="tab in tabs" :key="tab.key" :class="{ active: activeCategory === tab.key }" @click="activeCategory = tab.key">
          {{ tab.label }}<span>{{ tab.count }}</span>
        </button>
      </nav>
      <div v-if="filtered.length" class="media-grid">
        <button v-for="work in filtered" :key="work.id" class="media-card" @click="openDetails(work)">
          <span class="poster" :class="{ pending: work.category === 'pending' }">
            <LoaderCircle v-if="work.category === 'pending' && !work.poster && !work.thumbnail" class="spin" :size="25" />
            <MediaArtwork v-else :poster="work.poster" :thumbnail="work.thumbnail" :alt="`${work.title} 封面`" :fallback-label="coverKind(work)" />
            <em v-if="work.rating" class="rating-badge"><Star :size="11" fill="currentColor" />{{ work.rating.toFixed(1) }}</em>
            <small v-if="work.category === 'pending'">识别中</small>
          </span>
          <strong>{{ work.title }} <em v-if="work.year">{{ work.year }}</em></strong>
          <small v-if="work.category === 'tv'">{{ tvSummary(work) }}</small>
          <small v-else-if="work.category === 'movie' && work.items.length > 1">{{ work.items.length }} 个版本</small>
          <small v-else-if="work.items.length > 1">{{ work.items.length }} 个视频</small>
          <small v-else>{{ work.overview || work.items[0]?.path }}</small>
        </button>
      </div>
      <div v-else class="filtered-empty"><h2>没有匹配的内容</h2><p>换一个分类或搜索词试试。</p></div>
    </template>

    <div v-else-if="!hasConfiguredSources" class="empty-state">
      <div><span class="empty-icon"><FolderCog :size="24" /></span><h2>先选择媒体目录</h2><p>指定网盘中存放电影或剧集的具体路径，BMovie 不会扫描其他备份文件。</p><RouterLink to="/settings/library" class="primary-button">配置媒体资源库</RouterLink></div>
    </div>
    <div v-else-if="scanning" class="empty-state compact"><div><Clapperboard :size="28" /><h2>等待发现媒体</h2><p>找到文件后会立即显示，无需等扫描结束。</p></div></div>
    <div v-else class="empty-state">
      <div><span class="empty-icon"><Clapperboard :size="24" /></span><h2>目录中没有媒体</h2><p>可以调整媒体目录，或稍后重新扫描。</p><RouterLink to="/settings/library" class="primary-button">管理媒体目录</RouterLink></div>
    </div>
  </section>
</template>

<style scoped>
.icon-button:disabled{opacity:.4}.scan-status,.error-banner{display:flex;align-items:center}.scan-status{gap:11px;margin:-10px 0 16px;padding:12px 13px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}.scan-status>svg{flex:0 0 auto;color:var(--beam)}.scan-status>span{display:grid;min-width:0;gap:2px}.scan-status strong{font-size:12px}.scan-status small{overflow:hidden;color:var(--dim);font-size:10px;text-overflow:ellipsis;white-space:nowrap}.scan-status em{margin-left:auto;flex:0 0 auto;color:var(--muted);font-size:10px;font-style:normal}.error-banner{gap:8px;margin-bottom:15px;padding:11px 12px;border:1px solid rgba(255,113,109,.35);border-radius:7px;color:var(--danger);background:rgba(255,113,109,.07);font-size:12px}.search-box{display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:0 13px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}.search-box input{width:100%;padding:12px 0;border:0;outline:0;color:var(--ink);background:transparent}.category-tabs{display:flex;gap:6px;margin-bottom:20px;overflow-x:auto}.category-tabs button{display:flex;align-items:center;gap:6px;flex:0 0 auto;padding:8px 11px;border:1px solid var(--line);border-radius:18px;color:var(--muted);background:transparent;font-size:12px}.category-tabs button.active{border-color:var(--beam);color:var(--ink);background:var(--beam-soft)}.category-tabs span{color:var(--dim);font-size:10px}.category-tabs button.active span{color:#bbb5ff}.media-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:20px 14px}.media-card{position:relative;display:grid;min-width:0;gap:5px;padding:0 0 8px;overflow:hidden;border:0;color:var(--ink);background:transparent;text-align:left}.poster{position:relative;display:grid;aspect-ratio:2/3;margin-bottom:5px;place-items:center;overflow:hidden;border:1px solid var(--line);border-radius:7px;color:var(--beam);background:linear-gradient(145deg,var(--surface-raised),var(--surface))}.poster.pending{border-style:dashed}.poster>small{position:absolute;bottom:12px;color:var(--dim);font-size:10px}.poster img{width:100%;height:100%;object-fit:cover}.poster-fallback{display:grid;width:100%;height:100%;place-content:center;justify-items:center;gap:12px;padding:20px;color:var(--muted);background:radial-gradient(circle at 50% 38%,rgba(132,120,255,.14),transparent 44%)}.poster-fallback b{color:var(--ink);font-size:34px;font-weight:760;letter-spacing:-.04em}.poster-fallback small{color:var(--dim);font-size:10px;letter-spacing:.06em}.rating-badge{position:absolute;top:8px;right:8px;display:flex;align-items:center;gap:4px;padding:5px 7px;border-radius:999px;color:#fff3b3;background:rgba(5,6,10,.78);font-size:11px;font-style:normal;font-weight:700;backdrop-filter:blur(6px)}.media-card strong,.media-card>small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.media-card strong em{color:var(--dim);font-size:10px;font-style:normal}.media-card>small{color:var(--dim);font-size:10px}.media-card>i{position:absolute;bottom:0;left:0;height:2px;background:var(--beam)}.filtered-empty{padding:48px 0;border-top:1px solid var(--line);text-align:center}.filtered-empty h2{margin-bottom:7px}.filtered-empty p{color:var(--muted)}.compact{min-height:38svh}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:520px){.scan-status em{display:none}.media-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
