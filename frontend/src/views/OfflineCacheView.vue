<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ArrowLeft, CircleAlert, Download, FileVideo2, LoaderCircle, Play, RotateCw, Trash2 } from '@lucide/vue'
import { useRouter } from 'vue-router'
import { useOfflineCacheStore, offlineCacheId, type OfflineCacheEntry, type OfflineSubtitleRequest } from '../stores/offlineCache'
import { useMediaStore } from '../stores/media'
import { useOpenListStore } from '../stores/openlist'
import { openListRequest } from '../services/openlist'
import { NativePlayer } from '../services/nativePlayer'

const router = useRouter()
const offline = useOfflineCacheStore()
const media = useMediaStore()
const openlist = useOpenListStore()
const busyId = ref('')
const error = ref('')
let poll: number | undefined

const summary = computed(() => {
  const parts = [`${offline.completedCount} 项可离线播放`, sizeLabel(offline.totalSize)]
  if (offline.activeCount) parts.unshift(`${offline.activeCount} 项下载中`)
  return parts.join(' · ')
})

function sizeLabel(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** unit).toFixed(unit >= 3 ? 2 : unit === 2 ? 1 : 0)} ${units[unit]}`
}

function progress(entry: OfflineCacheEntry) {
  return entry.total > 0 ? Math.min(100, entry.downloaded / entry.total * 100) : 0
}

function statusLabel(entry: OfflineCacheEntry) {
  if (entry.status === 'completed') return `已缓存 · ${sizeLabel(entry.size)}`
  if (entry.status === 'failed') return entry.error || '下载失败'
  if (entry.status === 'paused') return entry.error || '等待网络恢复'
  if (entry.status === 'queued') return '等待系统开始下载'
  return entry.total > 0 ? `${Math.round(progress(entry))}% · ${sizeLabel(entry.downloaded)} / ${sizeLabel(entry.total)}` : `已下载 ${sizeLabel(entry.downloaded)}`
}

async function play(entry: OfflineCacheEntry) {
  if (!entry.uri || busyId.value) return
  busyId.value = entry.id
  error.value = ''
  try {
    const item = media.items.find((candidate) => candidate.path === entry.sourcePath)
    const result = await NativePlayer.play({
      url: entry.internalUri || entry.uri,
      title: entry.title,
      position: (item?.position ?? 0) * 1000,
      subtitles: entry.subtitles.map((subtitle) => ({ ...subtitle, url: subtitle.internalUrl || subtitle.url })),
    })
    if (item && result.duration > 0) await media.updateProgress(item.path, item.title, result.position / 1000, result.duration / 1000)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    busyId.value = ''
  }
}

async function retry(entry: OfflineCacheEntry) {
  if (busyId.value) return
  busyId.value = entry.id
  error.value = ''
  try {
    if (openlist.state !== 'ready') await openlist.start()
    if (openlist.state !== 'ready') throw new Error(openlist.error || 'OpenList 服务未就绪')
    const item = media.items.find((candidate) => candidate.path === entry.sourcePath)
    const url = await rawUrl(entry.sourcePath)
    const subtitleResults = item ? await Promise.allSettled((item.subtitles ?? []).map(async (subtitle): Promise<OfflineSubtitleRequest> => ({
      url: await rawUrl(subtitle.path),
      fileName: fileName(subtitle.path),
      label: subtitle.label,
      language: subtitle.language,
      mimeType: subtitle.mimeType,
    }))) : []
    const subtitles: OfflineSubtitleRequest[] = subtitleResults
      .filter((result): result is PromiseFulfilledResult<OfflineSubtitleRequest> => result.status === 'fulfilled')
      .map((result) => result.value)
    await offline.start({
      id: offlineCacheId(entry.sourcePath),
      url,
      sourcePath: entry.sourcePath,
      title: entry.title,
      fileName: entry.fileName,
      poster: entry.poster,
      expectedSize: item?.size || entry.total,
      subtitles,
    })
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    busyId.value = ''
  }
}

async function remove(entry: OfflineCacheEntry) {
  if (busyId.value || !window.confirm(`删除“${entry.title}”的本机缓存？\n不会删除网盘中的原文件。`)) return
  busyId.value = entry.id
  error.value = ''
  try {
    await offline.remove(entry.id)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    busyId.value = ''
  }
}

async function clearAll() {
  const targets = [...offline.entries]
  if (!targets.length || busyId.value || !window.confirm(`删除全部 ${targets.length} 项本机缓存？\n不会删除网盘中的原文件。`)) return
  busyId.value = 'all'
  error.value = ''
  try {
    for (const entry of targets) await offline.remove(entry.id)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    busyId.value = ''
  }
}

async function rawUrl(path: string) {
  const data = await openListRequest<{ raw_url: string }>(openlist.baseUrl, '/api/fs/get', { path, password: '' }, openlist.token)
  if (!data.raw_url) throw new Error('网盘没有返回可用的文件地址')
  return data.raw_url
}

function fileName(path: string) {
  return path.split('/').at(-1) || path
}

onMounted(async () => {
  await Promise.all([offline.refresh(), media.load()])
  poll = window.setInterval(() => {
    if (offline.activeCount) void offline.refresh()
  }, 1200)
})

onUnmounted(() => window.clearInterval(poll))
</script>

<template>
  <section class="page cache-page">
    <header class="page-header compact-header">
      <button class="icon-button" aria-label="返回" @click="router.back()"><ArrowLeft :size="20" /></button>
      <div class="header-copy"><p class="eyebrow">Offline</p><h1>缓存管理</h1><small>{{ summary }}</small></div>
      <button v-if="offline.entries.length" class="clear-button" :disabled="Boolean(busyId)" @click="clearAll"><Trash2 :size="16" />清空</button>
    </header>

    <p class="intro">缓存文件保存在 BMovie 的应用目录中，播放时优先走本机，不会占用网盘流量。卸载应用会同时移除这些文件。</p>
    <p v-if="error" class="error-banner"><CircleAlert :size="17" />{{ error }}</p>

    <div v-if="offline.entries.length" class="cache-list">
      <article v-for="entry in offline.entries" :key="entry.id" class="cache-row">
        <span class="cache-artwork">
          <img v-if="entry.poster" :src="entry.poster" alt="" />
          <FileVideo2 v-else :size="24" />
        </span>
        <div class="cache-copy">
          <strong>{{ entry.title }}</strong>
          <small class="file-name">{{ entry.fileName }}</small>
          <span class="cache-status" :class="entry.status">{{ statusLabel(entry) }}</span>
          <span v-if="entry.status !== 'completed' && entry.status !== 'failed'" class="progress-track" aria-hidden="true"><i :style="{ width: `${progress(entry)}%` }" /></span>
        </div>
        <div class="row-actions">
          <button v-if="entry.status === 'completed'" :disabled="Boolean(busyId)" @click="play(entry)"><LoaderCircle v-if="busyId === entry.id" class="spin" :size="16" /><Play v-else :size="16" fill="currentColor" />播放</button>
          <button v-else-if="entry.status === 'failed'" :disabled="Boolean(busyId)" @click="retry(entry)"><LoaderCircle v-if="busyId === entry.id" class="spin" :size="16" /><RotateCw v-else :size="16" />重试</button>
          <button class="delete-button" :disabled="Boolean(busyId)" @click="remove(entry)"><Trash2 :size="16" />删除</button>
        </div>
      </article>
    </div>

    <div v-else class="empty-state">
      <div><span class="empty-icon"><Download :size="24" /></span><h2>还没有本机缓存</h2><p>在影片详情页点“缓存到本机”，下载完成后就能离线播放。</p></div>
    </div>
  </section>
</template>

<style scoped>
.compact-header{align-items:center;justify-content:flex-start}.header-copy{min-width:0;flex:1}.header-copy small{display:block;margin-top:7px;color:var(--muted);font-size:11px}.clear-button,.row-actions button{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--line);border-radius:7px;color:var(--ink);background:transparent}.clear-button{min-height:38px;padding:0 12px}.clear-button:disabled,.row-actions button:disabled{opacity:.5}.intro{max-width:68ch;margin-bottom:22px;color:var(--muted);font-size:12px;line-height:1.7}.error-banner{display:flex;align-items:center;gap:8px;margin-bottom:16px;padding:11px 12px;border:1px solid rgba(255,113,109,.35);border-radius:7px;color:var(--danger);background:rgba(255,113,109,.07);font-size:12px}.cache-list{border-top:1px solid var(--line)}.cache-row{display:grid;grid-template-columns:62px minmax(0,1fr) auto;align-items:center;gap:14px;padding:16px 0;border-bottom:1px solid var(--line)}.cache-artwork{display:grid;width:62px;aspect-ratio:2/3;place-items:center;overflow:hidden;border-radius:6px;color:var(--muted);background:var(--surface-raised)}.cache-artwork img{width:100%;height:100%;object-fit:cover}.cache-copy{display:grid;min-width:0;gap:4px}.cache-copy strong,.file-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cache-copy strong{font-size:14px}.file-name{color:var(--dim);font-size:10px}.cache-status{color:var(--muted);font-size:11px}.cache-status.completed{color:#b9ff7b}.cache-status.failed{color:var(--danger)}.progress-track{height:3px;max-width:340px;margin-top:4px;overflow:hidden;border-radius:2px;background:var(--surface-raised)}.progress-track i{display:block;height:100%;background:var(--beam);transition:width .2s ease-out}.row-actions{display:flex;gap:7px}.row-actions button{min-height:36px;padding:0 11px;font-size:11px}.row-actions .delete-button{color:var(--muted)}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:640px){.cache-row{grid-template-columns:54px minmax(0,1fr);align-items:start;gap:11px}.cache-artwork{width:54px}.row-actions{grid-column:2;justify-content:flex-start}.row-actions button{min-height:34px}.clear-button{padding-inline:10px}.clear-button{font-size:0}.clear-button svg{width:17px;height:17px}}
@media(prefers-reduced-motion:reduce){.progress-track i{transition:none}.spin{animation:none}}
</style>
