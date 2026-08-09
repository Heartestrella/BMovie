<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ChevronRight, Cloud, Compass, Database, Download, Info, KeyRound, Languages, PlayCircle, Search } from '@lucide/vue'
import type { Component } from 'vue'
import { loadPlayerSettings, type PlayerMode } from '../services/playerSettings'
import { useOfflineCacheStore } from '../stores/offlineCache'
import { currentLocale, t } from '../i18n'

interface SettingRow { icon: Component; label: string; detail: string; to?: string }
interface SettingGroup { title: string; rows: SettingRow[] }

const playerMode = ref<PlayerMode>('internal')
const offline = useOfflineCacheStore()
function sizeLabel(bytes: number) {
  if (!bytes) return t('settings.noCache')
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** unit).toFixed(unit >= 3 ? 2 : unit === 2 ? 1 : 0)} ${units[unit]}`
}
const groups = computed<SettingGroup[]>(() => [
  {
    title: t('settings.languageGroup'),
    rows: [{ icon: Languages, label: t('settings.interfaceLanguage'), detail: currentLocale.value === 'en-US' ? 'English' : '简体中文', to: '/settings/language' }],
  },
  {
    title: t('settings.sourcesGroup'),
    rows: [
      { icon: Cloud, label: t('settings.storage'), detail: t('settings.storageDetail'), to: '/settings/storage' },
      { icon: Database, label: t('settings.library'), detail: t('settings.libraryDetail'), to: '/settings/library' },
      { icon: KeyRound, label: t('settings.metadata'), detail: t('settings.metadataDetail'), to: '/settings/metadata' },
      { icon: Search, label: t('settings.discovery'), detail: t('settings.discoveryDetail'), to: '/settings/discovery' },
    ],
  },
  {
    title: t('settings.playbackGroup'),
    rows: [
      { icon: PlayCircle, label: t('settings.defaultPlayer'), detail: playerMode.value === 'external' ? t('settings.externalPlayer') : t('settings.internalPlayer'), to: '/settings/player' },
      { icon: Download, label: t('settings.cache'), detail: offline.activeCount ? t('settings.downloading', { count: offline.activeCount }) : offline.completedCount ? `${offline.completedCount} · ${sizeLabel(offline.totalSize)}` : t('settings.noCache'), to: '/settings/cache' },
    ],
  },
  {
    title: t('settings.aboutGroup'),
    rows: [
      { icon: Compass, label: t('settings.onboarding'), detail: t('settings.onboardingDetail'), to: '/onboarding' },
      { icon: Info, label: t('settings.about'), detail: t('settings.version', { version: '0.1.0' }), to: '/settings/about' },
    ],
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
        <h1>{{ t('nav.settings') }}</h1>
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
