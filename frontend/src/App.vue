<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import { useRouter } from 'vue-router'
import { App as CapacitorApp } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import { Clapperboard, Folder, House, LoaderCircle, Music2, Settings } from '@lucide/vue'
import { useOpenListStore } from './stores/openlist'
import { MEDIA_INDEX_VERSION, useMediaStore } from './stores/media'
import { useLibrarySourcesStore } from './stores/librarySources'
import { useLibraryScanStore } from './stores/libraryScan'
import { loadMetadataSettings, METADATA_VERSION, resolveMetadataLocale } from './services/metadata'
import { prefetchDetailArtwork } from './services/artworkPrefetch'
import GlobalMusicPlayer from './components/GlobalMusicPlayer.vue'
import { t } from './i18n'

const openlist = useOpenListStore()
const media = useMediaStore()
const sources = useLibrarySourcesStore()
const scanner = useLibraryScanStore()
const router = useRouter()
const isOnboarding = computed(() => router.currentRoute.value.name === 'onboarding')
let backHandle: PluginListenerHandle | undefined
let appStateHandle: PluginListenerHandle | undefined

const backgroundScanLabel = computed(() => scanner.stage === 'indexing'
  ? `后台索引 · ${scanner.indexedGroups} 个作品 / ${scanner.discovered} 个文件`
  : scanner.stage === 'metadata'
    ? `后台整理元数据 · ${scanner.processed} / ${scanner.candidateCount}`
    : scanner.stage === 'saving' ? '正在保存媒体库' : '正在准备媒体索引')

async function ensureLibraryScan() {
  await Promise.all([media.load(), sources.load()])
  if (!sources.enabledSources.length) {
    if (sources.needsRescan) {
      await media.commitScan([])
      await sources.markScanned()
    }
    return
  }
  const settings = await loadMetadataSettings()
  const locale = resolveMetadataLocale(settings)
  const stale = media.items.some((item) => item.category !== 'music' && ((item.metadataVersion ?? 0) < METADATA_VERSION || item.metadataLocale !== locale || item.indexVersion !== MEDIA_INDEX_VERSION))
  if (!media.items.length || sources.needsRescan || stale) void scanner.start()
}

onMounted(async () => {
  void openlist.start()
  await ensureLibraryScan()
  backHandle = await CapacitorApp.addListener('backButton', () => {
    if (router.currentRoute.value.name === 'onboarding') CapacitorApp.minimizeApp()
    else if (router.currentRoute.value.path !== '/') router.back()
    else CapacitorApp.minimizeApp()
  })
  appStateHandle = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void ensureLibraryScan()
  })
})
const stopArtworkPrefetch = watch(() => media.works, prefetchDetailArtwork, { immediate: true })
onUnmounted(() => {
  backHandle?.remove()
  appStateHandle?.remove()
  stopArtworkPrefetch()
})

const tabs = computed(() => [
  { to: '/', label: t('nav.home'), icon: House },
  { to: '/library', label: t('nav.library'), icon: Clapperboard },
  { to: '/music', label: t('nav.music'), icon: Music2 },
  { to: '/files', label: t('nav.files'), icon: Folder },
  { to: '/settings', label: t('nav.settings'), icon: Settings },
])

const activeTabIndex = computed(() => {
  const name = String(router.currentRoute.value.name ?? '')
  if (name === 'library' || name === 'media-detail' || name === 'player') return 1
  if (name === 'music' || name === 'music-player') return 2
  if (name === 'files') return 3
  if (name.includes('settings') || name === 'offline-cache' || name === 'about' || name === 'resource-detail') return 4
  return 0
})
</script>

<template>
  <div class="app-shell">
    <main class="app-content" :class="{ 'onboarding-host': isOnboarding }">
      <RouterView />
    </main>

    <GlobalMusicPlayer v-if="!isOnboarding" />

    <button v-if="!isOnboarding && scanner.scanning && router.currentRoute.value.path !== '/library'" class="background-scan" @click="router.push('/library')">
      <LoaderCircle class="scan-spin" :size="15" />
      <span>{{ backgroundScanLabel }}</span>
    </button>

    <nav
      v-if="!isOnboarding"
      class="bottom-nav"
      :style="{ '--active-tab': activeTabIndex }"
      :aria-label="t('nav.main')"
    >
      <i class="nav-indicator" aria-hidden="true" />
      <RouterLink
        v-for="(tab, index) in tabs"
        :key="tab.to"
        :to="tab.to"
        class="nav-item"
        :class="{ 'nav-item-active': index === activeTabIndex }"
      >
        <component :is="tab.icon" :size="21" :stroke-width="index === activeTabIndex ? 2.2 : 1.7" aria-hidden="true" />
        <span>{{ tab.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.background-scan{position:fixed;z-index:19;right:14px;bottom:calc(76px + env(safe-area-inset-bottom));display:flex;max-width:min(82vw,360px);min-height:38px;align-items:center;gap:8px;padding:0 12px;border:1px solid var(--line);border-radius:8px;color:var(--ink);background:var(--surface-raised);font-size:11px;font-weight:650}.background-scan span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.background-scan svg{flex:0 0 auto;color:var(--beam)}.scan-spin{animation:scan-spin 1s linear infinite}@keyframes scan-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.scan-spin{animation:none}}
.onboarding-host{padding:0}
</style>
