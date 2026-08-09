<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Check, ExternalLink, LoaderCircle, LogIn, RefreshCw, Search, Trash2, Tv2 } from '@lucide/vue'
import { useDiscoveryStore, type BiliEpisode, type BiliSearchResult, type BiliSource } from '../stores/discovery'
import { useMediaStore } from '../stores/media'

const route = useRoute()
const router = useRouter()
const discovery = useDiscoveryStore()
const media = useMediaStore()
const resourceQuery = ref('')
const query = ref('')
const targetQuery = ref('')
const targetPath = ref('')
const results = ref<BiliSearchResult[]>([])
const source = ref<BiliSource | null>(null)
const busy = ref('')
const notice = ref('')
const pageError = ref('')
const autoProgress = ref('')

function searchResources() {
  const keyword = resourceQuery.value.trim()
  if (!keyword) return
  window.open(`https://www.btbtla.com/search/${encodeURIComponent(keyword)}`, '_blank', 'noopener,noreferrer')
}

const videoItems = computed(() => media.items.filter((item) => item.category !== 'music'))
const filteredTargets = computed(() => {
  const needle = normalize(targetQuery.value)
  const list = needle ? videoItems.value.filter((item) => normalize(`${item.title} ${item.episodeTitle || ''} ${item.path}`).includes(needle)) : videoItems.value
  return list.slice(0, 180)
})

function targetLabel(path: string) {
  const item = media.items.find((entry) => entry.path === path)
  if (!item) return path
  return `${item.title}${item.episode ? ` · 第 ${item.episode} 集` : ''} — ${fileName(path)}`
}

async function bindAccount() {
  busy.value = 'login'; clearFeedback()
  try { await discovery.login(); notice.value = `已绑定 ${discovery.account?.name}，同步了 ${discovery.follows.length} 部追番` }
  catch (reason) { pageError.value = message(reason) }
  finally { busy.value = '' }
}

async function sync() {
  busy.value = 'sync'; clearFeedback()
  try { await discovery.syncFollowing(); notice.value = `已同步 ${discovery.follows.length} 部追番` }
  catch (reason) { pageError.value = message(reason) }
  finally { busy.value = '' }
}

async function unbind() {
  await discovery.logout()
  notice.value = '已解除账号绑定，弹幕缓存不会被删除'
}

async function findSource() {
  const value = query.value.trim()
  if (!value) return
  busy.value = 'search'; clearFeedback(); source.value = null; results.value = []
  try {
    if (looksDirect(value)) source.value = await discovery.resolveSource(value)
    else results.value = await discovery.search(value)
    if (!source.value && !results.value.length) notice.value = '没有找到匹配的番剧'
  } catch (reason) { pageError.value = message(reason) }
  finally { busy.value = '' }
}

async function openResult(result: BiliSearchResult) {
  busy.value = `season:${result.seasonId}`; clearFeedback()
  try { source.value = await discovery.resolveSource(result.seasonId); results.value = [] }
  catch (reason) { pageError.value = message(reason) }
  finally { busy.value = '' }
}

async function bindEpisode(episode: BiliEpisode) {
  if (!source.value || !targetPath.value) { pageError.value = '请先选择要绑定的本地或网盘视频'; return }
  busy.value = `episode:${episode.cid}`; clearFeedback()
  try {
    const binding = await discovery.bindDanmaku(targetPath.value, source.value, episode)
    notice.value = `已抓取 ${binding.comments.length} 条弹幕，播放该视频时会自动显示`
  } catch (reason) { pageError.value = message(reason) }
  finally { busy.value = '' }
}

async function autoMatch() {
  if (!source.value || busy.value) return
  const sourceTitle = normalize(source.value.title)
  const work = media.works.find((entry) => {
    const title = normalize(entry.title)
    return title && sourceTitle && (title.includes(sourceTitle) || sourceTitle.includes(title))
  })
  if (!work) { pageError.value = '媒体库中没有找到同名作品，请使用下方单集绑定'; return }
  const localEpisodes = [...work.items].sort((a, b) => (a.episode ?? 9999) - (b.episode ?? 9999))
  const matches = source.value.episodes.map((episode, index) => ({ episode, item: localEpisodes.find((item) => item.episode === episode.index) ?? localEpisodes[index] })).filter((match) => match.item)
  if (!matches.length) { pageError.value = '这部作品没有可绑定的视频文件'; return }
  busy.value = 'auto'; clearFeedback()
  let completed = 0
  try {
    for (const match of matches) {
      autoProgress.value = `${completed + 1} / ${matches.length}`
      await discovery.bindDanmaku(match.item!.path, source.value, match.episode)
      completed += 1
    }
    notice.value = `已为 ${completed} 集抓取并绑定弹幕`
  } catch (reason) { pageError.value = `已完成 ${completed} 集：${message(reason)}` }
  finally { busy.value = ''; autoProgress.value = '' }
}

function clearFeedback() { pageError.value = ''; notice.value = '' }
function normalize(value: string) { return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') }
function fileName(path: string) { return path.split('/').filter(Boolean).at(-1) || path }
function message(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
function looksDirect(value: string) { return /BV[0-9A-Za-z]{10}|(?:^|\/)ep\d+|(?:^|\/)ss\d+|cid\s*[:=]?\s*\d+|^\d{5,}$/i.test(value) }
function episodeLabel(episode: BiliEpisode) { return episode.longTitle ? `${episode.title}. ${episode.longTitle}` : `第 ${episode.title} 集` }
function dateLabel(value?: number) { return value ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '尚未同步' }

onMounted(async () => {
  await Promise.all([discovery.load(), media.load()])
  if (discovery.connected) void discovery.verify()
  const seasonId = Number(route.query.season)
  if (seasonId) {
    busy.value = `season:${seasonId}`
    try { source.value = await discovery.resolveSource(seasonId); query.value = source.value.title }
    catch (reason) { pageError.value = message(reason) }
    finally { busy.value = '' }
  }
})
</script>

<template>
  <section class="page discovery-page">
    <header class="page-header compact-header">
      <button class="back-button" aria-label="返回设置" @click="router.back()"><ArrowLeft :size="20" /></button>
      <div><p class="eyebrow">Discovery</p><h1>找资源</h1></div>
    </header>

    <section class="account-section">
      <div class="section-copy"><h2>B站账号</h2><p>从官方登录页绑定账号，用于同步追番列表登录信息只保存在本机</p></div>
      <div v-if="discovery.account" class="account-row">
        <img v-if="discovery.account.face" :src="discovery.account.face" alt="" />
        <span><strong>{{ discovery.account.name }}</strong><small>UID {{ discovery.account.mid }} · {{ discovery.follows.length }} 部追番 · {{ dateLabel(discovery.account.syncedAt) }}</small></span>
        <button class="secondary-button" :disabled="Boolean(busy)" @click="sync"><LoaderCircle v-if="busy === 'sync'" class="spin" :size="15" /><RefreshCw v-else :size="15" />同步</button>
        <button class="text-button danger" @click="unbind">解除绑定</button>
      </div>
      <button v-else class="primary-button login-button" :disabled="busy === 'login'" @click="bindAccount"><LoaderCircle v-if="busy === 'login'" class="spin" :size="17" /><LogIn v-else :size="17" />绑定哔哩哔哩账号</button>
    </section>

    <section class="resource-section">
      <div class="section-copy"><h2>搜索影视资源</h2><p>输入番剧、电视剧或电影名称，将在浏览器中打开对应的资源搜索结果</p></div>
      <form class="source-search resource-search" @submit.prevent="searchResources">
        <Search :size="18" /><input v-model="resourceQuery" aria-label="影视资源关键词" placeholder="番剧、电视剧或电影名称" /><button :disabled="!resourceQuery.trim()">搜索资源<ExternalLink :size="14" /></button>
      </form>
    </section>

    <section class="danmaku-section">
      <div class="section-copy"><h2>抓取弹幕</h2><p>搜索番剧，或粘贴 B站番剧链接、BV/EP/SS 号、CID选择媒体库中的视频后即可绑定，视频本身不需要来自 B 站</p></div>
      <form class="source-search" @submit.prevent="findSource">
        <Search :size="18" /><input v-model="query" placeholder="番剧名称、B站链接、BV号或 CID" /><button :disabled="busy === 'search'">{{ busy === 'search' ? '查找中…' : '查找' }}</button>
      </form>

      <div v-if="results.length" class="search-results">
        <button v-for="result in results" :key="result.seasonId" @click="openResult(result)">
          <img v-if="result.cover" :src="result.cover" alt="" />
          <span><strong>{{ result.title }}</strong><small>{{ result.latest || result.areas || result.summary }}</small></span>
          <LoaderCircle v-if="busy === `season:${result.seasonId}`" class="spin" :size="17" /><ExternalLink v-else :size="16" />
        </button>
      </div>

      <article v-if="source" class="source-panel">
        <header>
          <img v-if="source.cover" :src="source.cover" alt="" />
          <span><strong>{{ source.title }}</strong><small>{{ source.episodes.length }} 个弹幕轨道</small></span>
          <button class="secondary-button" :disabled="Boolean(busy)" @click="autoMatch"><LoaderCircle v-if="busy === 'auto'" class="spin" :size="15" /><Check v-else :size="15" />{{ busy === 'auto' ? `匹配中 ${autoProgress}` : '整季自动匹配' }}</button>
        </header>
        <label class="target-filter"><Search :size="16" /><input v-model="targetQuery" placeholder="筛选媒体库视频" /></label>
        <select v-model="targetPath" class="target-select">
          <option value="">选择要绑定弹幕的视频</option>
          <option v-for="item in filteredTargets" :key="item.path" :value="item.path">{{ targetLabel(item.path) }}</option>
        </select>
        <div class="episode-list">
          <div v-for="episode in source.episodes" :key="episode.cid">
            <span><b>{{ episodeLabel(episode) }}</b><small>CID {{ episode.cid }}</small></span>
            <button :disabled="Boolean(busy) || !targetPath" @click="bindEpisode(episode)"><LoaderCircle v-if="busy === `episode:${episode.cid}`" class="spin" :size="14" />{{ busy === `episode:${episode.cid}` ? '抓取中' : '绑定并抓取' }}</button>
          </div>
        </div>
      </article>
    </section>

    <p v-if="pageError" class="feedback error">{{ pageError }}</p>
    <p v-if="notice" class="feedback success">{{ notice }}</p>

    <section v-if="discovery.bindings.length" class="bindings-section">
      <div class="section-copy"><h2>已绑定弹幕</h2><p>播放对应视频时自动加载，可在播放器顶部临时关闭</p></div>
      <div class="binding-list">
        <div v-for="binding in discovery.bindings" :key="binding.targetPath">
          <Tv2 :size="18" />
          <span><strong>{{ binding.sourceTitle }} · {{ binding.episodeTitle }}</strong><small>{{ fileName(binding.targetPath) }} · {{ binding.comments.length }} 条</small></span>
          <button aria-label="删除弹幕绑定" @click="discovery.removeBinding(binding.targetPath)"><Trash2 :size="16" /></button>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.discovery-page{max-width:1040px}.compact-header{display:flex;align-items:center;justify-content:flex-start;gap:13px}.back-button{display:grid;width:42px;height:42px;place-items:center;border:1px solid var(--line);border-radius:50%;color:var(--ink);background:transparent}.account-section,.resource-section,.danmaku-section,.bindings-section{padding:24px 0;border-top:1px solid var(--line)}.section-copy{max-width:68ch;margin-bottom:16px}.section-copy h2{margin-bottom:5px;font:700 18px/1.25 var(--font-body)}.section-copy p{color:var(--muted);font-size:12px;line-height:1.65}.account-row{display:grid;grid-template-columns:48px minmax(0,1fr) auto auto;align-items:center;gap:12px}.account-row>img{width:48px;height:48px;border-radius:50%;object-fit:cover}.account-row>span{display:grid;gap:3px}.account-row strong{font-size:14px}.account-row small{color:var(--dim);font-size:11px}.secondary-button,.login-button{display:inline-flex;align-items:center;justify-content:center;gap:7px}.secondary-button{min-height:38px;padding:0 13px;border:1px solid var(--line);border-radius:7px;color:var(--ink);background:var(--surface);font-size:12px;font-weight:650}.text-button{padding:8px;border:0;background:transparent;font-size:11px}.danger{color:var(--danger)}.source-search,.target-filter{display:flex;align-items:center;border:1px solid var(--line);border-radius:8px;background:var(--surface)}.source-search{max-width:760px;padding-left:13px}.source-search input,.target-filter input{min-width:0;flex:1;border:0;outline:0;color:var(--ink);background:transparent}.source-search input{padding:13px 10px}.source-search button{display:flex;align-items:center;justify-content:center;gap:7px;align-self:stretch;padding:0 18px;border:0;border-radius:0 7px 7px 0;color:#08090d;background:var(--ink);font-size:12px;font-weight:750;white-space:nowrap}.source-search button:disabled,.episode-list button:disabled,.secondary-button:disabled{opacity:.52}.search-results{display:grid;max-width:760px;margin-top:10px;border-top:1px solid var(--line)}.search-results button{display:grid;grid-template-columns:46px minmax(0,1fr) auto;align-items:center;gap:11px;padding:10px 3px;border:0;border-bottom:1px solid var(--line);color:var(--ink);background:transparent;text-align:left}.search-results img{width:46px;height:62px;border-radius:5px;object-fit:cover}.search-results span{display:grid;gap:4px}.search-results strong{font-size:13px}.search-results small{overflow:hidden;color:var(--dim);font-size:10px;text-overflow:ellipsis;white-space:nowrap}.source-panel{max-width:900px;margin-top:18px;padding:18px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}.source-panel>header{display:grid;grid-template-columns:52px minmax(0,1fr) auto;align-items:center;gap:12px;margin-bottom:15px}.source-panel>header img{width:52px;height:70px;border-radius:5px;object-fit:cover}.source-panel>header span{display:grid;gap:4px}.source-panel>header strong{font-size:16px}.source-panel>header small{color:var(--dim);font-size:11px}.target-filter{padding-left:11px;margin-bottom:8px}.target-filter input{padding:10px}.target-select{width:100%;height:42px;margin-bottom:12px;padding:0 10px;border:1px solid var(--line);border-radius:7px;color:var(--ink);background:var(--canvas);font-size:12px}.episode-list{max-height:330px;overflow-y:auto;border-top:1px solid var(--line)}.episode-list>div{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--line)}.episode-list span{display:grid;min-width:0;gap:3px}.episode-list b{overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.episode-list small{color:var(--dim);font-size:9px}.episode-list button{display:flex;min-height:34px;align-items:center;gap:5px;padding:0 10px;border:1px solid var(--line);border-radius:6px;color:var(--ink);background:transparent;font-size:10px}.feedback{max-width:900px;margin:12px 0;padding:11px 12px;border-radius:7px;font-size:12px}.feedback.error{color:#ff918d;background:rgba(255,113,109,.08)}.feedback.success{color:#baff82;background:rgba(157,255,101,.07)}.binding-list{max-width:900px;border-top:1px solid var(--line)}.binding-list>div{display:grid;grid-template-columns:28px minmax(0,1fr) 38px;align-items:center;gap:9px;padding:12px 2px;border-bottom:1px solid var(--line)}.binding-list span{display:grid;min-width:0;gap:3px}.binding-list strong,.binding-list small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.binding-list strong{font-size:12px}.binding-list small{color:var(--dim);font-size:10px}.binding-list button{display:grid;width:34px;height:34px;place-items:center;border:0;color:var(--dim);background:transparent}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:640px){.account-row{grid-template-columns:44px minmax(0,1fr)}.account-row .secondary-button,.account-row .text-button{grid-row:2}.source-panel{padding:14px}.source-panel>header{grid-template-columns:44px minmax(0,1fr)}.source-panel>header img{width:44px;height:60px}.source-panel>header .secondary-button{grid-column:1/-1}.episode-list>div{align-items:start}.episode-list b{white-space:normal}}
@media(prefers-reduced-motion:reduce){.spin{animation:none}}
</style>
