<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronLeft, FileVideo, Folder, LoaderCircle, RefreshCw } from '@lucide/vue'
import { useOpenListStore } from '../stores/openlist'
import { openListRequest, type OpenListFile } from '../services/openlist'

const route = useRoute()
const router = useRouter()
const openlist = useOpenListStore()
const files = ref<OpenListFile[]>([])
const loading = ref(false)
const error = ref('')
const noStorage = ref(false)

const currentPath = computed(() => {
  const value = route.params.path
  const parts = Array.isArray(value) ? value : value ? [value] : []
  return `/${parts.join('/')}`.replace(/\/{2,}/g, '/')
})
const parentPath = computed(() => currentPath.value.split('/').slice(0, -1).join('/') || '/')
const title = computed(() => currentPath.value === '/' ? '文件' : currentPath.value.split('/').at(-1))

function childPath(name: string) {
  return `${currentPath.value === '/' ? '' : currentPath.value}/${name}`
}

async function load(refresh = false) {
  if (openlist.state !== 'ready') return
  loading.value = true
  error.value = ''
  noStorage.value = false
  try {
    const data = await openListRequest<{ content: OpenListFile[] | null }>(
      openlist.baseUrl,
      '/api/fs/list',
      { path: currentPath.value, password: '', page: 1, per_page: 0, refresh },
      openlist.token,
    )
    files.value = data.content ?? []
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('storage not found')) {
      files.value = []
      noStorage.value = true
    } else {
      error.value = message
    }
  } finally {
    loading.value = false
  }
}

async function open(item: OpenListFile) {
  const path = childPath(item.name)
  if (item.is_dir) {
    await router.push({ name: 'files', params: { path: path.split('/').filter(Boolean) } })
    return
  }
  const data = await openListRequest<{ raw_url: string }>(
    openlist.baseUrl,
    '/api/fs/get',
    { path, password: '' },
    openlist.token,
  )
  const baseName = item.name.replace(/\.[^.]+$/, '').toLowerCase()
  const subtitle = files.value.find((file) => !file.is_dir && /\.(srt|vtt)$/i.test(file.name) && file.name.replace(/\.[^.]+$/, '').toLowerCase() === baseName)
  let subtitleUrl = ''
  if (subtitle) {
    const subtitleData = await openListRequest<{ raw_url: string }>(openlist.baseUrl, '/api/fs/get', { path: childPath(subtitle.name), password: '' }, openlist.token)
    subtitleUrl = subtitleData.raw_url
  }
  await router.push({ name: 'player', query: { src: data.raw_url, title: item.name, path, subtitle: subtitleUrl } })
}

watch([currentPath, () => openlist.state], () => load(), { immediate: true })
onMounted(() => { if (openlist.state === 'stopped') openlist.start() })
</script>

<template>
  <section class="page">
    <header class="page-header">
      <div>
        <p class="eyebrow">{{ currentPath }}</p>
        <h1>{{ title }}</h1>
      </div>
      <button class="icon-button" aria-label="刷新" @click="load(true)"><RefreshCw :size="18" /></button>
    </header>
    <div v-if="openlist.state === 'starting' || loading" class="empty-state"><div><LoaderCircle class="spin" /><p>正在读取目录…</p></div></div>
    <div v-else-if="openlist.state === 'error' || error" class="empty-state"><div><h2>无法读取文件</h2><p>{{ error || openlist.error }}</p><button class="primary-button" @click="load()">重试</button></div></div>
    <div v-else class="file-list">
      <button v-if="currentPath !== '/'" class="file-row" @click="router.push(parentPath === '/' ? '/files' : `/files${parentPath}`)">
        <ChevronLeft :size="20" /><span><strong>返回上一级</strong></span>
      </button>
      <button v-for="item in files" :key="item.name" class="file-row" @click="open(item)">
        <Folder v-if="item.is_dir" :size="21" /><FileVideo v-else :size="21" />
        <span><strong>{{ item.name }}</strong><small v-if="!item.is_dir">{{ (item.size / 1024 / 1024).toFixed(1) }} MB</small></span>
      </button>
      <div v-if="files.length === 0" class="empty-state"><div><span class="empty-icon"><Folder :size="24" /></span><h2>{{ noStorage ? '尚未添加存储' : '目录为空' }}</h2><p>{{ noStorage ? '请先前往设置添加网盘存储。' : '这个目录中还没有文件。' }}</p><RouterLink v-if="noStorage" to="/settings" class="primary-button">前往设置</RouterLink></div></div>
    </div>
  </section>
</template>

<style scoped>
.file-list { border-top: 1px solid var(--line); }
.file-row { display: grid; width: 100%; grid-template-columns: 30px 1fr; align-items: center; gap: 10px; padding: 15px 4px; border: 0; border-bottom: 1px solid var(--line); color: var(--ink); background: transparent; text-align: left; }
.file-row > span { display: flex; min-width: 0; justify-content: space-between; gap: 14px; }
.file-row strong { overflow: hidden; font-size: 14px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.file-row small { flex: none; color: var(--dim); }
.spin { margin: 0 auto 14px; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
