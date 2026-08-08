<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import { useRouter } from 'vue-router'
import { App as CapacitorApp } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import { Clapperboard, Folder, House, Settings } from '@lucide/vue'
import { useOpenListStore } from './stores/openlist'
import { useMediaStore } from './stores/media'
import { prefetchDetailArtwork } from './services/artworkPrefetch'

const openlist = useOpenListStore()
const media = useMediaStore()
const router = useRouter()
let backHandle: PluginListenerHandle | undefined
onMounted(async () => {
  openlist.start()
  await media.load()
  backHandle = await CapacitorApp.addListener('backButton', () => {
    if (router.currentRoute.value.path !== '/') router.back()
    else CapacitorApp.minimizeApp()
  })
})
const stopArtworkPrefetch = watch(() => media.works, prefetchDetailArtwork, { immediate: true })
onUnmounted(() => {
  backHandle?.remove()
  stopArtworkPrefetch()
})

const tabs = [
  { to: '/', label: '首页', icon: House },
  { to: '/library', label: '媒体库', icon: Clapperboard },
  { to: '/files', label: '文件', icon: Folder },
  { to: '/settings', label: '设置', icon: Settings },
]
</script>

<template>
  <div class="app-shell">
    <main class="app-content">
      <RouterView />
    </main>

    <nav class="bottom-nav" aria-label="主导航">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.to"
        v-slot="{ isActive }"
        :to="tab.to"
        class="nav-item"
      >
        <component :is="tab.icon" :size="21" :stroke-width="isActive ? 2.2 : 1.7" aria-hidden="true" />
        <span>{{ tab.label }}</span>
        <i v-if="isActive" class="nav-indicator" />
      </RouterLink>
    </nav>
  </div>
</template>
