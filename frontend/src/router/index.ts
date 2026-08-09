import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
    { path: '/onboarding', name: 'onboarding', component: () => import('../views/OnboardingView.vue') },
    { path: '/library', name: 'library', component: () => import('../views/LibraryView.vue') },
    { path: '/music', name: 'music', component: () => import('../views/MusicView.vue') },
    { path: '/music/player', name: 'music-player', component: () => import('../views/MusicPlayerView.vue') },
    { path: '/media', name: 'media-detail', component: () => import('../views/MediaDetailView.vue') },
    { path: '/files/:path(.*)*', name: 'files', component: () => import('../views/FileBrowserView.vue') },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
    { path: '/settings/language', name: 'language-settings', component: () => import('../views/LanguageSettingsView.vue') },
    { path: '/settings/storage', name: 'storage-settings', component: () => import('../views/StorageSettingsView.vue') },
    { path: '/settings/library', name: 'library-settings', component: () => import('../views/LibrarySourcesView.vue') },
    { path: '/settings/metadata', name: 'metadata-settings', component: () => import('../views/MetadataSettingsView.vue') },
    { path: '/settings/discovery', name: 'discovery-settings', component: () => import('../views/DiscoverySettingsView.vue') },
    { path: '/settings/player', name: 'player-settings', component: () => import('../views/PlayerSettingsView.vue') },
    { path: '/settings/cache', name: 'offline-cache', component: () => import('../views/OfflineCacheView.vue') },
    { path: '/settings/about', name: 'about', component: () => import('../views/AboutView.vue') },
    { path: '/player', name: 'player', component: () => import('../views/PlayerView.vue') },
  ],
})

router.beforeEach((to, from) => {
  if (to.name === 'onboarding' || localStorage.getItem('bmovie-onboarding-completed-v1') === 'true') return true
  if (from.name === 'onboarding') return true
  return { name: 'onboarding' }
})

export default router
