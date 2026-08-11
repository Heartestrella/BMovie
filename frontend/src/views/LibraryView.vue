<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { AlertCircle, Clapperboard, FolderCog, LoaderCircle, RefreshCw, Search, Star, Tv2 } from '@lucide/vue'
import { storeToRefs } from 'pinia'
import { useMediaStore, type MediaWork } from '../stores/media'
import { useLibrarySourcesStore } from '../stores/librarySources'
import { useLibraryScanStore } from '../stores/libraryScan'
import { loadMetadataSettings, METADATA_VERSION, resolveMetadataLocale } from '../services/metadata'
import MediaArtwork from '../components/MediaArtwork.vue'
import { useDiscoveryStore, type BiliFollow } from '../stores/discovery'

type CategoryFilter = 'all' | 'movie' | 'tv' | 'other' | 'pending' | 'following'

const router = useRouter()
const media = useMediaStore()
const sources = useLibrarySourcesStore()
const scanner = useLibraryScanStore()
const discovery = useDiscoveryStore()
const { scanning, error, currentFolder, discovered, indexedFolders, indexedGroups, processed, recognized, candidateCount } = storeToRefs(scanner)
const query = ref('')
const activeCategory = ref<CategoryFilter>('all')
const visibleLimit = ref(120)
const tabs = computed<Array<{ key: CategoryFilter; label: string; count: number }>>(() => {
  const counts = { movie: 0, tv: 0, other: 0, pending: 0 }
  for (const work of media.works) counts[work.category] += 1
  const result: Array<{ key: CategoryFilter; label: string; count: number }> = [
    { key: 'all' as const, label: '全部', count: media.works.length },
    { key: 'movie' as const, label: '电影', count: counts.movie },
    { key: 'tv' as const, label: '剧集', count: counts.tv },
    { key: 'other' as const, label: '其他', count: counts.other },
    ...(counts.pending ? [{ key: 'pending' as const, label: '识别中', count: counts.pending }] : []),
  ]
  if (discovery.connected || discovery.follows.length) result.push({ key: 'following' as const, label: 'B站追番', count: discovery.follows.length })
  return result
})
const filtered = computed(() => {
  if (activeCategory.value === 'following') return []
  const needle = query.value.trim().toLocaleLowerCase()
  return media.works.filter((work) => {
    const categoryMatches = activeCategory.value === 'all' || work.category === activeCategory.value
    return categoryMatches && (!needle || work.title.toLocaleLowerCase().includes(needle) || work.items.some((item) => item.path.toLocaleLowerCase().includes(needle)))
  })
})
const filteredFollows = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return discovery.follows.filter((item) => !needle || `${item.title} ${item.summary || ''} ${item.areas || ''}`.toLocaleLowerCase().includes(needle))
})
const visibleWorks = computed(() => filtered.value.slice(0, visibleLimit.value))
const hasConfiguredSources = computed(() => sources.enabledSources.length > 0)

const scanTitle = computed(() => scanner.stage === 'preparing' ? '正在准备扫描'
  : scanner.stage === 'indexing' ? '正在后台建立作品索引'
    : scanner.stage === 'metadata' ? '正在后台补全元数据' : '正在保存媒体库')
const scanSummary = computed(() => scanner.stage === 'preparing' ? '连接媒体源…'
  : scanner.stage === 'indexing' ? `${indexedGroups.value} 个作品索引 · ${discovered.value} 个媒体文件 · ${indexedFolders.value} 个目录`
    : `已整理 ${processed.value} / ${candidateCount.value} 组 · 命中 ${recognized.value} 组`)

watch([query, activeCategory], () => { visibleLimit.value = 120 })

function openDetails(work: MediaWork) {
  router.push({ name: 'media-detail', query: { id: work.id } })
}

function openFollow(item: BiliFollow) {
  router.push({ name: 'discovery-settings', query: { season: item.seasonId } })
}

function tvSummary(work: MediaWork) {
  const episodes = work.items.filter((item) => item.episode).length
  const extras = work.items.length - episodes
  const seasons = work.seasons.length > 1 ? `${work.seasons.length} 季 · ` : ''
  return `${seasons}${episodes || work.items.length} 集${extras && episodes ? ` · ${extras} 个附加视频` : ''}`
}

function coverKind(work: MediaWork) {
  if (work.category === 'pending') return work.indexKind === 'series' ? '剧集索引' : '影片索引'
  if (work.category === 'tv') return '本地剧集'
  if (work.category === 'movie') return '本地电影'
  return work.items.length > 1 ? `${work.items.length} 个视频` : '本地视频'
}

function pendingSummary(work: MediaWork) {
  return work.indexKind === 'series'
    ? `已索引 ${work.items.length} 集 · 正在匹配元数据`
    : `${work.items.length > 1 ? `已索引 ${work.items.length} 个版本` : '影片索引已建立'} · 正在匹配元数据`
}

onMounted(async () => {
  await Promise.all([media.load(), sources.load(), discovery.load()])
  if (discovery.connected && (!discovery.account?.syncedAt || Date.now() - discovery.account.syncedAt > 6 * 60 * 60 * 1000)) void discovery.syncFollowing().catch(() => undefined)
  const metadataSettings = await loadMetadataSettings()
  const metadataLocale = resolveMetadataLocale(metadataSettings)
  if (!sources.enabledSources.length && sources.needsRescan) {
    await media.commitScan([])
    await sources.markScanned()
  } else if (sources.enabledSources.length && (!media.items.length || sources.needsRescan || media.items.some((item) => item.category !== 'music' && ((item.metadataVersion ?? 0) < METADATA_VERSION || item.metadataLocale !== metadataLocale)))) {
    void scanner.start()
  }
})
</script>

<template>
  <section class="page library-page">
    <header class="page-header">
      <div><p class="eyebrow">Library</p><h1>媒体库</h1></div>
      <button class="icon-button" :disabled="scanning || !hasConfiguredSources" aria-label="重新扫描" @click="scanner.start">
        <LoaderCircle v-if="scanning" class="spin" :size="18" /><RefreshCw v-else :size="18" />
      </button>
    </header>

    <div v-if="scanning" class="scan-status">
      <LoaderCircle class="spin" :size="18" />
      <span><strong>{{ scanTitle }}</strong><small>{{ currentFolder || '准备扫描…' }}</small></span>
      <em>{{ scanSummary }}</em>
    </div>
    <p v-if="error" class="error-banner"><AlertCircle :size="17" />{{ error }}</p>

    <template v-if="media.items.length || discovery.follows.length">
      <label class="search-box"><Search :size="18" /><input v-model="query" placeholder="搜索标题、路径或追番" /></label>
      <nav class="category-tabs" aria-label="媒体分类">
        <button v-for="tab in tabs" :key="tab.key" :class="{ active: activeCategory === tab.key }" @click="activeCategory = tab.key">
          {{ tab.label }}<span>{{ tab.count }}</span>
        </button>
      </nav>
      <section v-if="activeCategory === 'all' && discovery.follows.length" class="following-preview">
        <div class="following-heading"><span><Tv2 :size="18" /><strong>B站追番</strong><small>{{ discovery.follows.length }} 部</small></span><button @click="activeCategory = 'following'">查看全部</button></div>
        <div class="following-strip">
          <button v-for="item in discovery.follows.slice(0, 12)" :key="item.seasonId" class="follow-card" @click="openFollow(item)">
            <span class="follow-poster"><img v-if="item.cover" :src="item.cover" :alt="`${item.title} 封面`" /><Tv2 v-else :size="24" /><em v-if="item.badge">{{ item.badge }}</em></span>
            <strong>{{ item.title }}</strong><small>{{ item.latest || item.progress || item.areas || '已追番' }}</small>
          </button>
        </div>
      </section>

      <div v-if="activeCategory === 'following' && filteredFollows.length" class="media-grid">
        <button v-for="item in filteredFollows" :key="item.seasonId" class="media-card follow-library-card" @click="openFollow(item)">
          <span class="poster"><img v-if="item.cover" :src="item.cover" :alt="`${item.title} 封面`" /><span v-else class="poster-fallback"><Tv2 :size="28" /><small>B站追番</small></span><em v-if="item.rating" class="rating-badge"><Star :size="11" fill="currentColor" />{{ item.rating.toFixed(1) }}</em><small v-if="item.badge" class="source-badge">{{ item.badge }}</small></span>
          <strong>{{ item.title }}</strong><small>{{ item.latest || item.progress || item.areas || item.summary }}</small>
        </button>
      </div>
      <div v-else-if="activeCategory !== 'following' && filtered.length" class="media-grid">
        <button v-for="(work, index) in visibleWorks" :key="work.id" class="media-card" @click="openDetails(work)">
          <span class="poster" :class="{ pending: work.category === 'pending' }">
            <LoaderCircle v-if="work.category === 'pending' && !work.poster && !work.thumbnail" class="spin" :size="25" />
            <MediaArtwork v-else :poster="work.poster" :thumbnail="work.thumbnail" :alt="`${work.title} 封面`" :fallback-label="coverKind(work)" :loading="index < 12 ? 'eager' : 'lazy'" />
            <em v-if="work.rating" class="rating-badge"><Star :size="11" fill="currentColor" />{{ work.rating.toFixed(1) }}</em>
            <small v-if="work.category === 'pending'">识别中</small>
            <small v-else-if="work.manuallyCorrected" class="manual-badge">已纠正</small>
          </span>
          <strong>{{ work.title }} <em v-if="work.year">{{ work.year }}</em></strong>
          <small v-if="work.category === 'pending'">{{ pendingSummary(work) }}</small>
          <small v-else-if="work.category === 'tv'">{{ tvSummary(work) }}</small>
          <small v-else-if="work.category === 'movie' && work.items.length > 1">{{ work.items.length }} 个版本</small>
          <small v-else-if="work.items.length > 1">{{ work.items.length }} 个视频</small>
          <small v-else>{{ work.overview || work.items[0]?.path }}</small>
        </button>
      </div>
      <button v-if="activeCategory !== 'following' && visibleWorks.length < filtered.length" class="load-more" @click="visibleLimit += 120">继续显示（{{ filtered.length - visibleWorks.length }}）</button>
      <div v-if="activeCategory === 'following' ? !filteredFollows.length : !filtered.length" class="filtered-empty"><h2>没有匹配的内容</h2><p>换一个分类或搜索词试试</p></div>
    </template>

    <div v-else-if="!hasConfiguredSources" class="empty-state">
      <div><span class="empty-icon"><FolderCog :size="24" /></span><h2>先选择媒体目录</h2><p>指定网盘中存放电影或剧集的具体路径，BMovie 不会扫描其他备份文件</p><RouterLink to="/settings/library" class="primary-button">配置媒体资源库</RouterLink></div>
    </div>
    <div v-else-if="scanning" class="empty-state compact"><div><Clapperboard :size="28" /><h2>等待发现媒体</h2><p>找到文件后会立即显示，无需等扫描结束</p></div></div>
    <div v-else class="empty-state">
      <div><span class="empty-icon"><Clapperboard :size="24" /></span><h2>目录中没有媒体</h2><p>可以调整媒体目录，或稍后重新扫描</p><RouterLink to="/settings/library" class="primary-button">管理媒体目录</RouterLink></div>
    </div>
  </section>
</template>

<style scoped>
.following-preview{margin-bottom:24px;padding-bottom:22px;border-bottom:1px solid var(--line)}.following-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.following-heading>span{display:flex;align-items:center;gap:8px}.following-heading strong{font-size:14px}.following-heading small{color:var(--dim);font-size:10px}.following-heading button{padding:7px 0;border:0;color:var(--beam);background:transparent;font-size:11px}.following-strip{display:flex;gap:12px;overflow-x:auto;padding-bottom:5px;overscroll-behavior-inline:contain}.follow-card{display:grid;width:112px;flex:0 0 112px;gap:5px;padding:0;border:0;color:var(--ink);background:transparent;text-align:left}.follow-poster{position:relative;display:grid;aspect-ratio:2/3;place-items:center;overflow:hidden;border-radius:6px;color:var(--beam);background:var(--surface-raised)}.follow-poster img{width:100%;height:100%;object-fit:cover}.follow-poster em{position:absolute;right:6px;bottom:6px;padding:3px 5px;border-radius:4px;color:#fff;background:rgba(7,8,12,.78);font-size:8px;font-style:normal}.follow-card strong,.follow-card small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.follow-card strong{font-size:11px}.follow-card small{color:var(--dim);font-size:9px}.poster .source-badge{right:auto;bottom:8px;left:8px;padding:4px 6px;border-radius:4px;color:#fff;background:rgba(7,8,12,.76)}.poster .manual-badge{right:8px;bottom:8px;left:auto;padding:4px 6px;border-radius:4px;color:#d8d4ff;background:rgba(31,28,66,.88);font-weight:700}
.icon-button:disabled{opacity:.4}.scan-status,.error-banner{display:flex;align-items:center}.scan-status{gap:11px;margin:-10px 0 16px;padding:12px 13px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}.scan-status>svg{flex:0 0 auto;color:var(--beam)}.scan-status>span{display:grid;min-width:0;gap:2px}.scan-status strong{font-size:12px}.scan-status small{overflow:hidden;color:var(--dim);font-size:10px;text-overflow:ellipsis;white-space:nowrap}.scan-status em{margin-left:auto;flex:0 0 auto;color:var(--muted);font-size:10px;font-style:normal}.error-banner{gap:8px;margin-bottom:15px;padding:11px 12px;border:1px solid rgba(255,113,109,.35);border-radius:7px;color:var(--danger);background:rgba(255,113,109,.07);font-size:12px}.search-box{display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:0 13px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}.search-box input{width:100%;padding:12px 0;border:0;outline:0;color:var(--ink);background:transparent}.category-tabs{display:flex;gap:6px;margin-bottom:20px;overflow-x:auto}.category-tabs button{display:flex;align-items:center;gap:6px;flex:0 0 auto;padding:8px 11px;border:1px solid var(--line);border-radius:18px;color:var(--muted);background:transparent;font-size:12px}.category-tabs button.active{border-color:var(--beam);color:var(--ink);background:var(--beam-soft)}.category-tabs span{color:var(--dim);font-size:10px}.category-tabs button.active span{color:#bbb5ff}.media-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:20px 14px}.media-card{position:relative;display:grid;min-width:0;gap:5px;padding:0 0 8px;overflow:hidden;border:0;color:var(--ink);background:transparent;text-align:left;content-visibility:auto;contain-intrinsic-size:auto 280px}.poster{position:relative;display:grid;aspect-ratio:2/3;margin-bottom:5px;place-items:center;overflow:hidden;border:1px solid var(--line);border-radius:7px;color:var(--beam);background:linear-gradient(145deg,var(--surface-raised),var(--surface))}.poster.pending{border-style:dashed}.poster>small{position:absolute;bottom:12px;color:var(--dim);font-size:10px}.poster img{width:100%;height:100%;object-fit:cover}.poster-fallback{display:grid;width:100%;height:100%;place-content:center;justify-items:center;gap:12px;padding:20px;color:var(--muted);background:radial-gradient(circle at 50% 38%,rgba(132,120,255,.14),transparent 44%)}.poster-fallback b{color:var(--ink);font-size:34px;font-weight:760;letter-spacing:-.04em}.poster-fallback small{color:var(--dim);font-size:10px;letter-spacing:.06em}.rating-badge{position:absolute;z-index:3;top:8px;right:8px;display:flex;align-items:center;gap:4px;padding:5px 7px;border-radius:999px;color:#fff3b3;background:rgba(5,6,10,.78);font-size:11px;font-style:normal;font-weight:700;backdrop-filter:blur(6px)}.media-card strong,.media-card>small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.media-card strong em{color:var(--dim);font-size:10px;font-style:normal}.media-card>small{color:var(--dim);font-size:10px}.media-card>i{position:absolute;bottom:0;left:0;height:2px;background:var(--beam)}.load-more{display:block;min-height:42px;margin:22px auto 0;padding:0 18px;border:1px solid var(--line);border-radius:7px;color:var(--ink);background:var(--surface);font-size:12px}.filtered-empty{padding:48px 0;border-top:1px solid var(--line);text-align:center}.filtered-empty h2{margin-bottom:7px}.filtered-empty p{color:var(--muted)}.compact{min-height:38svh}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:520px){.scan-status em{display:none}.media-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
