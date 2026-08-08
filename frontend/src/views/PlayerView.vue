<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Play } from '@lucide/vue'
import Hls from 'hls.js'
import { useMediaStore } from '../stores/media'

const route = useRoute()
const router = useRouter()
const media = useMediaStore()
const video = ref<HTMLVideoElement>()
const subtitleUrl = ref('')
const playbackError = ref('')
let hls: Hls | undefined
let lastSaved = 0
const source = computed(() => typeof route.query.src === 'string' ? route.query.src : '')
const title = computed(() => typeof route.query.title === 'string' ? route.query.title : '')
const path = computed(() => typeof route.query.path === 'string' ? route.query.path : title.value)
const subtitle = computed(() => typeof route.query.subtitle === 'string' ? route.query.subtitle : '')

function saveProgress(force = false) {
  if (!video.value || !path.value || !Number.isFinite(video.value.duration)) return
  if (!force && Date.now() - lastSaved < 5000) return
  lastSaved = Date.now()
  media.updateProgress(path.value, title.value, video.value.currentTime, video.value.duration)
}

onMounted(async () => {
  await media.load()
  if (!video.value || !source.value) return
  if (subtitle.value) {
    if (/\.srt(?:\?|$)/i.test(subtitle.value)) {
      try {
        const text = await (await fetch(subtitle.value)).text()
        subtitleUrl.value = URL.createObjectURL(new Blob([`WEBVTT\n\n${text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`], { type: 'text/vtt' }))
      } catch { playbackError.value = '字幕加载失败' }
    } else subtitleUrl.value = subtitle.value
  }
  if (/\.m3u8(?:\?|$)/i.test(source.value) && Hls.isSupported()) {
    hls = new Hls()
    hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) playbackError.value = '视频流加载失败' })
    hls.loadSource(source.value)
    hls.attachMedia(video.value)
  }
  video.value.addEventListener('loadedmetadata', () => {
    const saved = media.items.find((item) => item.path === path.value)?.position ?? 0
    if (saved > 5 && saved < video.value!.duration - 5) video.value!.currentTime = saved
    video.value!.play().catch(() => undefined)
  }, { once: true })
})
onBeforeUnmount(() => { saveProgress(true); hls?.destroy(); if (subtitleUrl.value.startsWith('blob:')) URL.revokeObjectURL(subtitleUrl.value) })
</script>

<template>
  <section class="player-page">
    <button class="player-back" aria-label="返回" @click="router.back()"><ArrowLeft :size="22" /></button>
    <video v-if="source" ref="video" class="video" :src="/\.m3u8(?:\?|$)/i.test(source) && Hls.isSupported() ? undefined : source" controls autoplay playsinline @timeupdate="saveProgress()" @pause="saveProgress(true)" @ended="saveProgress(true)" @error="playbackError = '无法播放这个视频格式或链接已失效'"><track v-if="subtitleUrl" kind="subtitles" label="字幕" srclang="zh" :src="subtitleUrl" default /></video>
    <div v-else class="player-empty">
      <Play :size="36" />
      <p>选择影片后开始播放</p>
    </div>
    <p v-if="source && title" class="player-title">{{ title }}</p>
    <p v-if="playbackError" class="player-error">{{ playbackError }}</p>
  </section>
</template>

<style scoped>
.player-page { position: fixed; z-index: 50; inset: 0; display: grid; place-items: center; background: #030305; }
.player-back { position: absolute; z-index: 3; top: calc(18px + env(safe-area-inset-top)); left: 18px; display: grid; width: 44px; height: 44px; place-items: center; border: 0; border-radius: 50%; color: var(--ink); background: #17181e; }
.video { width: 100%; height: 100%; object-fit: contain; background: #000; }
.player-title { position: absolute; z-index: 3; top: calc(25px + env(safe-area-inset-top)); left: 78px; right: 24px; overflow: hidden; color: var(--ink); font-size: 14px; text-overflow: ellipsis; white-space: nowrap; pointer-events: none; }
.player-error { position: absolute; z-index: 4; bottom: 70px; padding: 10px 14px; border-radius: 6px; color: #fff; background: rgba(160,30,30,.85); }
.player-empty { color: var(--dim); text-align: center; }
.player-empty svg { margin-bottom: 12px; }
.player-empty p { font-size: 13px; }
</style>
