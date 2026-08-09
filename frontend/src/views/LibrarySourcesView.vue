<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowLeft, Check, ChevronRight, Folder, FolderOpen, LoaderCircle, Plus, Trash2 } from '@lucide/vue'
import { useRouter } from 'vue-router'
import { useLibrarySourcesStore } from '../stores/librarySources'
import { useOpenListStore } from '../stores/openlist'
import { openListRequest, type OpenListFile } from '../services/openlist'

const router = useRouter()
const sources = useLibrarySourcesStore()
const openlist = useOpenListStore()
const choosing = ref(false)
const loading = ref(false)
const currentPath = ref('/')
const folders = ref<OpenListFile[]>([])
const error = ref('')

const crumbs = computed(() => {
  const parts = currentPath.value.split('/').filter(Boolean)
  return [{ label: '根目录', path: '/' }, ...parts.map((label, index) => ({ label, path: `/${parts.slice(0, index + 1).join('/')}` }))]
})

async function listFolders(path: string) {
  loading.value = true
  error.value = ''
  try {
    if (openlist.state !== 'ready') await openlist.start()
    if (openlist.state !== 'ready') throw new Error(openlist.error || 'OpenList 服务未就绪')
    const data = await openListRequest<{ content: OpenListFile[] | null }>(openlist.baseUrl, '/api/fs/list', {
      path, password: '', page: 1, per_page: 0, refresh: false,
    }, openlist.token)
    folders.value = (data.content ?? []).filter((entry) => entry.is_dir).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    currentPath.value = path
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    folders.value = []
  } finally {
    loading.value = false
  }
}

async function openPicker() {
  choosing.value = true
  await listFolders('/')
}

async function openFolder(name: string) {
  await listFolders(`${currentPath.value === '/' ? '' : currentPath.value}/${name}`)
}

async function chooseCurrent() {
  if (await sources.add(currentPath.value)) choosing.value = false
}

onMounted(() => sources.load())
</script>

<template>
  <section class="page source-page">
    <header class="page-header">
      <div class="title-row">
        <button class="icon-button" aria-label="返回" @click="router.back()"><ArrowLeft :size="20" /></button>
        <div><p class="eyebrow">Library folders</p><h1>媒体资源库</h1></div>
      </div>
      <button v-if="!choosing" class="icon-button" aria-label="添加目录" @click="openPicker"><Plus :size="20" /></button>
    </header>

    <template v-if="choosing">
      <div class="picker-heading">
        <div><h2>选择媒体目录</h2><p>只会扫描所选目录及其子目录，不会遍历整个网盘</p></div>
        <button class="text-button" @click="choosing = false">取消</button>
      </div>
      <nav class="breadcrumbs" aria-label="当前目录">
        <button v-for="crumb in crumbs" :key="crumb.path" :class="{ active: crumb.path === currentPath }" @click="listFolders(crumb.path)">
          {{ crumb.label }}<ChevronRight v-if="crumb.path !== currentPath" :size="13" />
        </button>
      </nav>
      <div v-if="loading" class="folder-state"><LoaderCircle class="spin" :size="24" />正在读取目录…</div>
      <p v-else-if="error" class="error-banner">{{ error }}</p>
      <div v-else class="folder-list">
        <button v-for="folder in folders" :key="folder.name" class="folder-row" @click="openFolder(folder.name)">
          <Folder :size="19" /><span>{{ folder.name }}</span><ChevronRight :size="17" />
        </button>
        <p v-if="!folders.length" class="folder-state">这个目录内没有子目录</p>
      </div>
      <div class="picker-actions">
        <small v-if="currentPath === '/'">请进入网盘中的具体目录后再选择</small>
        <span v-else><FolderOpen :size="16" />{{ currentPath }}</span>
        <button class="primary-button" :disabled="currentPath === '/'" @click="chooseCurrent"><Check :size="17" />选择当前目录</button>
      </div>
    </template>

    <template v-else>
      <div class="intro"><p>扫描仅在这里配置的路径中进行你可以为电影、剧集、音乐或不同网盘分别添加目录</p></div>
      <div v-if="sources.sources.length" class="source-list">
        <article v-for="source in sources.sources" :key="source.path" class="source-row">
          <button class="source-main" @click="sources.toggle(source.path)">
            <span class="source-icon"><FolderOpen :size="19" /></span>
            <span><strong>{{ source.path.split('/').filter(Boolean).at(-1) }}</strong><small>{{ source.path }}</small></span>
            <i :class="{ on: source.enabled }"><b /></i>
          </button>
          <button class="remove-button" aria-label="删除目录" @click="sources.remove(source.path)"><Trash2 :size="17" /></button>
        </article>
      </div>
      <div v-else class="empty-state compact">
        <div><span class="empty-icon"><FolderOpen :size="24" /></span><h2>还没有媒体目录</h2><p>添加网盘内存放电影、剧集或音乐的具体目录</p><button class="primary-button" @click="openPicker"><Plus :size="17" />添加目录</button></div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.title-row,.picker-heading,.source-main,.picker-actions{display:flex;align-items:center}.title-row{gap:14px}.picker-heading{justify-content:space-between;gap:18px}.picker-heading h2{margin-bottom:5px}.picker-heading p,.intro p{margin:0;color:var(--muted);font-size:13px;line-height:1.65}.text-button{border:0;color:var(--beam);background:transparent}.breadcrumbs{display:flex;gap:2px;margin:20px 0 12px;overflow-x:auto}.breadcrumbs button{display:flex;align-items:center;gap:2px;flex:0 0 auto;padding:7px 5px;border:0;color:var(--dim);background:transparent;font-size:12px}.breadcrumbs button.active{color:var(--ink)}.folder-list,.source-list{border-top:1px solid var(--line)}.folder-row{display:grid;width:100%;grid-template-columns:24px 1fr auto;align-items:center;gap:9px;padding:15px 4px;border:0;border-bottom:1px solid var(--line);color:var(--ink);background:transparent;text-align:left}.folder-row svg:first-child{color:var(--beam)}.folder-row svg:last-child{color:var(--dim)}.folder-state{display:flex;min-height:140px;align-items:center;justify-content:center;gap:9px;color:var(--muted);font-size:13px}.picker-actions{position:sticky;bottom:calc(70px + env(safe-area-inset-bottom));justify-content:space-between;gap:12px;margin-top:16px;padding:13px;border:1px solid var(--line);border-radius:9px;background:rgba(17,19,26,.96);backdrop-filter:blur(12px)}.picker-actions span{display:flex;min-width:0;align-items:center;gap:7px;overflow:hidden;color:var(--muted);font-size:12px;text-overflow:ellipsis;white-space:nowrap}.picker-actions small{color:var(--dim)}.primary-button:disabled{opacity:.38}.intro{margin-bottom:20px;padding:14px 16px;border-left:2px solid var(--beam);background:var(--surface)}.source-row{display:grid;grid-template-columns:1fr auto;border-bottom:1px solid var(--line)}.source-main{min-width:0;gap:11px;padding:15px 4px;border:0;background:transparent;text-align:left}.source-icon{display:grid;width:34px;height:34px;flex:0 0 auto;place-items:center;border-radius:7px;color:var(--beam);background:var(--beam-soft)}.source-main>span:nth-child(2){display:grid;min-width:0;gap:3px}.source-main strong,.source-main small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source-main strong{font-size:14px}.source-main small{color:var(--dim);font-size:11px}.source-main i{position:relative;width:34px;height:20px;margin-left:auto;border-radius:10px;background:var(--line)}.source-main i b{position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:var(--muted);transition:transform .18s ease}.source-main i.on{background:var(--beam)}.source-main i.on b{background:white;transform:translateX(14px)}.remove-button{width:42px;border:0;color:var(--dim);background:transparent}.compact{min-height:42svh}.error-banner{padding:12px;border:1px solid rgba(255,113,109,.35);border-radius:7px;color:var(--danger);background:rgba(255,113,109,.07)}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(min-width:720px){.picker-actions{bottom:20px}}
</style>
