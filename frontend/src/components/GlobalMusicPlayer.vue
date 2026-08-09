<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ListMusic, Music2, Pause, Play, SkipBack, SkipForward } from '@lucide/vue'
import { useMusicPlayerStore } from '../stores/musicPlayer'
import { t } from '../i18n'
import { Capacitor } from '@capacitor/core'

const player = useMusicPlayerStore()
const router = useRouter()
const route = useRoute()
const audio = ref<HTMLAudioElement>()

function timeLabel(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function openFullPlayer() {
  const navigate = () => router.push('/music/player')
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const transitionDocument = document as Document & { startViewTransition?: (update: () => Promise<unknown>) => unknown }
  if (!reducedMotion && transitionDocument.startViewTransition) transitionDocument.startViewTransition(navigate)
  else void navigate()
}

onMounted(() => {
  if (!audio.value) return
  player.attach(audio.value)
  if (!Capacitor.isNativePlatform() && 'mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => audio.value?.play())
    navigator.mediaSession.setActionHandler('pause', () => audio.value?.pause())
    navigator.mediaSession.setActionHandler('previoustrack', () => player.previous())
    navigator.mediaSession.setActionHandler('nexttrack', () => player.next())
    navigator.mediaSession.setActionHandler('seekto', (details) => details.seekTime != null && player.seek(details.seekTime))
    navigator.mediaSession.setActionHandler('seekbackward', () => player.seek(player.position - 10))
    navigator.mediaSession.setActionHandler('seekforward', () => player.seek(player.position + 10))
  }
})

watch(() => player.artwork, () => player.updateMediaSession())
</script>

<template>
  <audio ref="audio" preload="metadata" @play="player.onPlaying(true)" @pause="player.onPlaying(false)" @timeupdate="player.onTime(audio?.currentTime ?? 0, audio?.duration ?? 0)" @loadedmetadata="player.onTime(audio?.currentTime ?? 0, audio?.duration ?? 0)" @ended="player.next" />
  <aside v-if="player.current && route.name !== 'music-player'" class="global-player" :aria-label="t('music.player')">
    <button class="now-playing" @click="openFullPlayer">
      <span class="mini-cover"><img v-if="player.artwork" :src="player.artwork" alt="" /><Music2 v-else :size="19" /></span>
      <span><strong>{{ player.current.title }}</strong><small>{{ player.current.artist || t('music.unknownArtist') }} · {{ player.current.album || t('music.unknownAlbum') }}</small></span>
    </button>
    <div class="transport">
      <button :aria-label="t('music.previous')" @click="player.previous"><SkipBack :size="18" fill="currentColor" /></button>
      <button class="play-toggle" :aria-label="t(player.playing ? 'music.pause' : 'music.play')" @click="player.toggle"><Pause v-if="player.playing" :size="18" fill="currentColor" /><Play v-else :size="18" fill="currentColor" /></button>
      <button :aria-label="t('music.next')" @click="player.next"><SkipForward :size="18" fill="currentColor" /></button>
    </div>
    <div class="timeline"><span>{{ timeLabel(player.position) }}</span><input type="range" min="0" :max="Math.max(player.duration, 1)" :value="player.position" :aria-label="t('music.progress')" @input="player.seek(Number(($event.target as HTMLInputElement).value))" /><span>{{ timeLabel(player.duration) }}</span></div>
    <button class="queue-button" :aria-label="t('music.queue')" @click="router.push('/music')"><ListMusic :size="19" /></button>
  </aside>
</template>

<style scoped>
audio{display:none}.global-player{position:fixed;z-index:19;right:0;bottom:calc(66px + env(safe-area-inset-bottom));left:0;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:7px;padding:9px 12px;border-top:1px solid var(--line);background:rgba(17,19,26,.97);box-shadow:0 -14px 32px rgba(0,0,0,.2);backdrop-filter:blur(18px)}.now-playing{display:flex;min-width:0;align-items:center;gap:10px;padding:0;border:0;background:transparent;text-align:left}.now-playing>span:last-child{display:grid;min-width:0;gap:2px}.now-playing strong,.now-playing small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.now-playing strong{font-size:12px}.now-playing small{color:var(--dim);font-size:9px}.mini-cover{display:grid;width:40px;height:40px;flex:0 0 auto;place-items:center;overflow:hidden;border-radius:5px;color:var(--beam);background:var(--beam-soft);view-transition-name:music-artwork}.mini-cover img{width:100%;height:100%;object-fit:cover}.transport{display:flex;align-items:center}.transport button,.queue-button{display:grid;width:36px;height:36px;place-items:center;border:0;color:var(--ink);background:transparent}.play-toggle{border-radius:50%!important;color:#0a0b0f!important;background:var(--ink)!important}.timeline{display:none}.queue-button{display:none}@media(min-width:720px){.global-player{bottom:0;left:88px;grid-template-columns:minmax(220px,1fr) auto minmax(260px,1.5fr) 44px;padding:8px 20px}.timeline{display:grid;grid-template-columns:36px 1fr 36px;align-items:center;gap:7px;color:var(--dim);font-size:9px}.timeline input{width:100%;height:3px;accent-color:var(--beam)}.queue-button{display:grid}}
</style>
