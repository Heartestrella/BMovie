import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
    { path: '/library', name: 'library', component: () => import('../views/LibraryView.vue') },
    { path: '/media', name: 'media-detail', component: () => import('../views/MediaDetailView.vue') },
    { path: '/files/:path(.*)*', name: 'files', component: () => import('../views/FileBrowserView.vue') },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
    { path: '/settings/storage', name: 'storage-settings', component: () => import('../views/StorageSettingsView.vue') },
    { path: '/settings/library', name: 'library-settings', component: () => import('../views/LibrarySourcesView.vue') },
    { path: '/settings/metadata', name: 'metadata-settings', component: () => import('../views/MetadataSettingsView.vue') },
    { path: '/settings/player', name: 'player-settings', component: () => import('../views/PlayerSettingsView.vue') },
    { path: '/player', name: 'player', component: () => import('../views/PlayerView.vue') },
  ],
})

export default router
