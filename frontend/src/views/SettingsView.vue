<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ChevronRight, Cloud, Database, Download, Info, KeyRound, Languages, PlayCircle } from '@lucide/vue'
import type { Component } from 'vue'
import { loadPlayerSettings, type PlayerMode } from '../services/playerSettings'
import { useOfflineCacheStore } from '../stores/offlineCache'

interface SettingRow { icon: Component; label: string; detail: string; to?: string }
interface SettingGroup { title: string; rows: SettingRow[] }

const playerMode = ref<PlayerMode>('internal')
const offline = useOfflineCacheStore()
function sizeLabel(bytes: number) {
  if (!bytes) return '暂无缓存'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** unit).toFixed(unit >= 3 ? 2 : unit === 2 ? 1 : 0)} ${units[unit]}`
}
const groups = computed<SettingGroup[]>(() => [
  {
    title: '语言',
    rows: [{ icon: Languages, label: '界面语言', detail: '简体中文（默认）' }],
  },
  {
    title: '内容来源',
    rows: [
      { icon: Cloud, label: '网盘存储', detail: '添加和管理', to: '/settings/storage' },
      { icon: Database, label: '媒体资源库', detail: '自定义扫描目录', to: '/settings/library' },
      { icon: KeyRound, label: '元数据来源', detail: '语言、Bangumi、TMDB、TVmaze', to: '/settings/metadata' },
    ],
  },
  {
    title: '播放',
    rows: [
      { icon: PlayCircle, label: '默认播放器', detail: playerMode.value === 'external' ? '系统外部播放器' : 'BMovie 内置播放器', to: '/settings/player' },
      { icon: Download, label: '缓存管理', detail: offline.activeCount ? `${offline.activeCount} 项下载中` : offline.completedCount ? `${offline.completedCount} 项 · ${sizeLabel(offline.totalSize)}` : '暂无缓存', to: '/settings/cache' },
    ],
  },
  {
    title: '关于',
    rows: [{ icon: Info, label: 'BMovie', detail: '0.1.0' }],
  },
])

onMounted(async () => {
  const [settings] = await Promise.all([loadPlayerSettings(), offline.refresh()])
  playerMode.value = settings.defaultMode
})
</script>

<template>
  <section class="page settings-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">Settings</p>
        <h1>设置</h1>
      </div>
    </header>

    <section v-for="group in groups" :key="group.title" class="setting-group">
      <h2>{{ group.title }}</h2>
      <component :is="row.to ? 'RouterLink' : 'button'" v-for="row in group.rows" :key="row.label" :to="row.to" class="setting-row">
        <component :is="row.icon" :size="19" aria-hidden="true" />
        <span class="row-copy"><strong>{{ row.label }}</strong><small>{{ row.detail }}</small></span>
        <ChevronRight :size="17" class="chevron" aria-hidden="true" />
      </component>
    </section>
  </section>
</template>

<style scoped>
.setting-group { margin-bottom: 27px; }
.setting-group h2 { margin-bottom: 8px; color: var(--muted); font-family: var(--font-body); font-size: 12px; font-weight: 600; }
.setting-row { display: grid; width: 100%; grid-template-columns: 28px 1fr auto; align-items: center; gap: 9px; padding: 15px 2px; border: 0; border-bottom: 1px solid var(--line); color: var(--ink); background: transparent; text-align: left; }
.setting-row { text-decoration: none; }
.row-copy { display: flex; min-width: 0; justify-content: space-between; gap: 12px; }
.row-copy strong { font-size: 14px; font-weight: 550; }
.row-copy small { overflow: hidden; color: var(--dim); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.chevron { color: var(--dim); }
</style>
