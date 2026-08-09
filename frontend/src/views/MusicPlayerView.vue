<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Disc3, Flag, ListMusic, LoaderCircle, Music2, Pause, Play, SkipBack, SkipForward } from '@lucide/vue'
import { useMusicPlayerStore } from '../stores/musicPlayer'
import { t } from '../i18n'

const player = useMusicPlayerStore()
const router = useRouter()
const lyricsScroller = ref<HTMLElement>()

const item = computed(() => player.current)
const fileFormat = computed(() => item.value?.path.split('.').at(-1)?.toLocaleUpperCase() || '—')
const queuePosition = computed(() => player.currentIndex >= 0 ? `${player.currentIndex + 1} / ${player.queue.length}` : '')
const backgroundStyle = computed(() => player.artwork ? { backgroundImage: `url("${player.artwork.replaceAll('"', '\\"')}")` } : {})
const artistLabel = computed(() => player.onlineInfo?.artists.join(' / ') || item.value?.artists?.join(' / ') || item.value?.artist || t('music.unknownArtist'))
const metadata = computed(() => {
  if (!item.value) return []
  const track = item.value.trackNumber
    ? `${item.value.discNumber && item.value.discNumber > 1 ? `CD ${item.value.discNumber} · ` : ''}${String(item.value.trackNumber).padStart(2, '0')}`
    : '—'
  return [
    { label: t('music.artist'), value: artistLabel.value },
    { label: t('music.album'), value: player.onlineInfo?.album || item.value.album || t('music.unknownAlbum') },
    { label: t('music.format'), value: fileFormat.value },
    { label: t('music.duration'), value: timeLabel(player.duration || item.value.duration || 0) },
    { label: t('music.bitrate'), value: bitrateLabel(player.technicalInfo?.bitrate) },
    { label: t('music.sampleRate'), value: sampleRateLabel(player.technicalInfo?.sampleRate) },
    { label: t('music.bitDepth'), value: player.technicalInfo?.bitDepth ? `${player.technicalInfo.bitDepth} bit` : '—' },
    { label: t('music.channels'), value: channelLabel(player.technicalInfo?.channels) },
    { label: t('music.fileSize'), value: sizeLabel(item.value.size) },
    { label: t('music.track'), value: track },
  ]
})

function timeLabel(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function sizeLabel(bytes: number) {
  if (!bytes) return '—'
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function bitrateLabel(value?: number) {
  if (!value) return '—'
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)} Mbps` : `${Math.round(value / 1000)} kbps`
}

function sampleRateLabel(value?: number) {
  if (!value) return '—'
  return `${(value / 1000).toFixed(value % 1000 ? 1 : 0)} kHz`
}

function channelLabel(value?: number) {
  if (!value) return '—'
  if (value === 1) return t('music.mono')
  if (value === 2) return t('music.stereo')
  return t('music.channelCount', { count: value })
}

function close() {
  if (window.history.length > 1) router.back()
  else router.replace('/music')
}

async function centerActiveLyric() {
  await nextTick()
  const scroller = lyricsScroller.value
  const active = scroller?.querySelector<HTMLElement>('.lyric-line.active')
  if (!scroller || !active) return
  const scrollerBox = scroller.getBoundingClientRect()
  const activeBox = active.getBoundingClientRect()
  const top = activeBox.top - scrollerBox.top + scroller.scrollTop - (scroller.clientHeight - active.clientHeight) / 2
  scroller.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}

watch(() => player.activeLyricIndex, centerActiveLyric)
watch(() => item.value?.path, () => {
  lyricsScroller.value?.scrollTo({ top: 0, behavior: 'auto' })
  void centerActiveLyric()
})

onMounted(() => {
  if (!item.value) void router.replace('/music')
  else void centerActiveLyric()
})
</script>

<template>
  <section v-if="item" class="full-player">
    <div class="artwork-atmosphere" :style="backgroundStyle" aria-hidden="true" />
    <div class="atmosphere-shade" aria-hidden="true" />

    <header class="player-header">
      <button class="round-button" :aria-label="t('music.backToMusic')" @click="close"><ArrowLeft :size="21" /></button>
      <div><strong>{{ t('music.nowPlaying') }}</strong><small>{{ queuePosition }}</small></div>
      <button class="round-button" :aria-label="t('music.queue')" @click="router.push('/music')"><ListMusic :size="21" /></button>
    </header>

    <main class="player-content">
      <section class="record-panel">
        <div class="artwork-shell">
          <img v-if="player.artwork" :src="player.artwork" :alt="item.album || t('music.unknownAlbum')" />
          <span v-else><Disc3 :size="70" :stroke-width="1.2" /></span>
        </div>

        <div class="track-heading">
          <h1>{{ item.title }}</h1>
          <p>{{ artistLabel }}<span aria-hidden="true"> · </span>{{ player.onlineInfo?.album || item.album || t('music.unknownAlbum') }}</p>
        </div>

        <div class="timeline">
          <input type="range" min="0" :max="Math.max(player.duration, 1)" :value="player.position" :aria-label="t('music.progress')" @input="player.seek(Number(($event.target as HTMLInputElement).value))" />
          <div><span>{{ timeLabel(player.position) }}</span><span>{{ timeLabel(player.duration) }}</span></div>
        </div>

        <div class="transport">
          <button :disabled="!player.hasPrevious && player.position < 5" :aria-label="t('music.previous')" @click="player.previous"><SkipBack :size="25" fill="currentColor" /></button>
          <button class="play-toggle" :aria-label="t(player.playing ? 'music.pause' : 'music.play')" @click="player.toggle"><Pause v-if="player.playing" :size="27" fill="currentColor" /><Play v-else :size="27" fill="currentColor" /></button>
          <button :disabled="!player.hasNext" :aria-label="t('music.next')" @click="player.next"><SkipForward :size="25" fill="currentColor" /></button>
        </div>

      </section>

      <section class="lyrics-panel" :aria-label="t('music.lyrics')">
        <div class="lyrics-heading"><div><h2>{{ t('music.lyrics') }}</h2><span v-if="player.lyrics.length">{{ t(player.lyricsSource === 'local' ? 'music.localLyrics' : 'music.onlineLyrics') }}</span></div><button v-if="player.lyricsSource === 'netease'" class="report-button" :disabled="player.reportingLyrics" @click="player.reportCurrentLyrics"><LoaderCircle v-if="player.reportingLyrics" class="spin" :size="13" /><Flag v-else :size="13" />{{ t(player.reportingLyrics ? 'music.reportingLyrics' : 'music.reportLyrics') }}</button></div>
        <div v-if="player.lyrics.length" ref="lyricsScroller" class="lyrics-scroller" aria-live="polite">
          <button v-for="(line, index) in player.lyrics" :key="`${line.time}-${index}`" class="lyric-line" :class="{ active: index === player.activeLyricIndex }" @click="player.seek(line.time)"><strong>{{ line.text }}</strong><small v-if="line.translation">{{ line.translation }}</small></button>
        </div>
        <div v-else class="lyrics-empty"><Music2 :size="28" /><p>{{ t('music.noLyrics') }}</p></div>
        <p v-if="player.lyricsNotice" class="lyrics-notice">{{ player.lyricsNotice }}</p>
      </section>

      <section class="metadata-panel" :aria-label="t('music.trackInfo')">
        <div class="metadata-heading"><h2>{{ t('music.trackInfo') }}</h2><span :class="{ loading: player.metadataLoading }"><LoaderCircle v-if="player.metadataLoading" class="spin" :size="12" />{{ player.metadataLoading ? t('music.onlineMatching') : player.onlineInfo ? t('music.onlineMatched') : '' }}</span></div>
        <dl><div v-for="row in metadata" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></div></dl>
        <p :title="item.path"><Music2 :size="14" />{{ item.folderPath || item.libraryRoot || item.path }}</p>
      </section>
    </main>

    <p v-if="player.error" class="player-error">{{ player.error }}</p>
  </section>
</template>

<style scoped>
.full-player{position:fixed;z-index:30;inset:0;overflow:hidden;color:var(--ink);background:#090a0e}.artwork-atmosphere,.atmosphere-shade{position:absolute;inset:-50px;pointer-events:none}.artwork-atmosphere{background-position:center;background-size:cover;filter:blur(70px) saturate(.72);opacity:.25;transform:scale(1.12)}.atmosphere-shade{background:linear-gradient(180deg,rgba(9,10,14,.72),rgba(9,10,14,.92) 45%,#090a0e 100%)}.player-header{position:relative;z-index:1;display:grid;height:calc(68px + env(safe-area-inset-top));grid-template-columns:44px 1fr 44px;align-items:center;padding:env(safe-area-inset-top) max(18px,env(safe-area-inset-right)) 0 max(18px,env(safe-area-inset-left));text-align:center}.player-header>div{display:grid;gap:2px}.player-header strong{font-size:13px}.player-header small{color:var(--muted);font-size:10px}.round-button{display:grid;width:40px;height:40px;place-items:center;border:1px solid rgba(242,239,232,.14);border-radius:50%;background:rgba(17,19,26,.58)}.player-content{position:relative;z-index:1;display:grid;height:calc(100svh - 68px - env(safe-area-inset-top));grid-template-columns:minmax(300px,.82fr) minmax(360px,1.18fr);grid-template-rows:minmax(0,1fr) auto;gap:18px clamp(32px,5vw,76px);max-width:1200px;margin:0 auto;padding:28px clamp(30px,6vw,86px) 38px}.record-panel{display:flex;min-height:0;align-items:center;flex-direction:column;grid-column:1;grid-row:1}.artwork-shell{display:grid;width:min(36vh,330px);max-width:100%;aspect-ratio:1;flex:0 1 auto;place-items:center;overflow:hidden;border-radius:12px;background:var(--surface-raised);box-shadow:0 6px 8px rgba(0,0,0,.28)}.artwork-shell img{width:100%;height:100%;object-fit:cover}.artwork-shell span{display:grid;width:100%;height:100%;place-items:center;color:var(--beam);background:radial-gradient(circle at 38% 32%,var(--beam-soft),var(--surface-raised) 64%)}.track-heading{width:100%;margin-top:20px;text-align:center}.track-heading h1{overflow:hidden;margin:0;font-family:var(--font-body);font-size:23px;font-weight:750;letter-spacing:-.025em;line-height:1.25;text-overflow:ellipsis;white-space:nowrap}.track-heading p{overflow:hidden;margin:7px 0 0;color:#b6b4bb;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.timeline{width:100%;margin-top:20px}.timeline input{display:block;width:100%;height:4px;margin:0;accent-color:var(--beam)}.timeline>div{display:flex;justify-content:space-between;margin-top:5px;color:#aaa8b1;font-size:10px;font-variant-numeric:tabular-nums}.transport{display:flex;align-items:center;justify-content:center;gap:31px;margin-top:9px}.transport button{display:grid;width:44px;height:44px;place-items:center;border:0;background:transparent}.transport button:disabled{opacity:.28}.transport .play-toggle{width:58px;height:58px;border-radius:50%;color:#111219;background:var(--ink)}.metadata-panel{width:100%;grid-column:1;grid-row:2;padding-top:15px;border-top:1px solid rgba(242,239,232,.12)}.metadata-panel h2{margin:0 0 11px;font-family:var(--font-body);font-size:12px}.metadata-panel dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 14px;margin:0}.metadata-panel dl>div{min-width:0}.metadata-panel dt{color:#aaa8b1;font-size:9px}.metadata-panel dd{overflow:hidden;margin:3px 0 0;font-size:11px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}.metadata-panel>p{display:flex;min-width:0;align-items:center;gap:6px;overflow:hidden;margin:12px 0 0;color:#aaa8b1;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.metadata-panel>p svg{flex:0 0 auto}.lyrics-panel{display:grid;min-height:0;grid-column:2;grid-row:1/3;grid-template-rows:auto 1fr;padding-left:clamp(20px,3vw,48px);border-left:1px solid rgba(242,239,232,.12)}.lyrics-heading{display:flex;align-items:center;justify-content:space-between;padding:6px 4px 16px}.lyrics-heading h2{margin:0;font-family:var(--font-body);font-size:13px}.lyrics-heading span{color:var(--muted);font-size:10px}.lyrics-scroller{min-height:0;padding:42% 0;overflow-y:auto;overscroll-behavior:contain;scroll-behavior:smooth;mask-image:linear-gradient(transparent,#000 13%,#000 87%,transparent)}.lyric-line{display:block;width:100%;padding:11px 4px;border:0;color:rgba(242,239,232,.42);background:transparent;font-size:16px;font-weight:600;line-height:1.55;text-align:left;transform-origin:left center}.lyric-line.active{color:var(--ink);font-size:21px;font-weight:760}.lyrics-empty{display:grid;align-content:center;justify-items:center;gap:10px;color:#aaa8b1;text-align:center}.lyrics-empty p{font-size:12px}.player-error{position:absolute;z-index:2;right:20px;bottom:18px;left:20px;margin:0;padding:10px 13px;border-radius:7px;color:#fff;background:rgba(176,45,43,.88);font-size:11px;text-align:center}
.artwork-shell{view-transition-name:music-artwork}.metadata-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:11px}.metadata-heading h2{margin:0}.metadata-heading span{display:flex;min-width:0;align-items:center;gap:5px;overflow:hidden;color:var(--beam);font-size:9px;text-overflow:ellipsis;white-space:nowrap}.metadata-heading span:empty{display:none}.metadata-heading .loading{color:#aaa8b1}.lyrics-heading>div{display:grid;gap:3px}.report-button{display:flex;min-height:32px;align-items:center;gap:6px;padding:0 10px;border:1px solid rgba(242,239,232,.15);border-radius:6px;color:#c8c5ce;background:transparent;font-size:10px}.report-button:disabled{opacity:.55}.lyric-line strong,.lyric-line small{display:block}.lyric-line strong{font:inherit}.lyric-line small{margin-top:3px;color:rgba(242,239,232,.34);font-size:.66em;font-weight:500}.lyric-line.active small{color:rgba(242,239,232,.66)}.lyrics-notice{position:absolute;right:0;bottom:4px;left:clamp(20px,3vw,48px);margin:0;padding:8px 10px;border-radius:6px;color:#d9d6de;background:rgba(17,19,26,.9);font-size:10px;text-align:center}.lyrics-panel{position:relative}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:719px){.player-content{height:calc(100svh - 68px - env(safe-area-inset-top));grid-template-columns:1fr;grid-template-rows:auto minmax(260px,34svh) auto;gap:18px;padding:12px 22px calc(20px + env(safe-area-inset-bottom));overflow-y:auto}.record-panel{grid-column:1;grid-row:1;overflow:visible}.artwork-shell{width:min(42vw,210px);flex:none}.track-heading{margin-top:13px}.track-heading h1{font-size:19px}.track-heading p{margin-top:4px}.timeline{margin-top:12px}.transport{gap:26px;margin-top:4px}.transport .play-toggle{width:54px;height:54px}.lyrics-panel{min-height:260px;grid-column:1;grid-row:2;padding:18px 0 0;border-top:1px solid rgba(242,239,232,.12);border-left:0}.lyrics-heading{padding:0 2px 8px}.lyrics-scroller{height:34svh;padding:40% 0}.lyric-line{padding:10px 2px;font-size:15px;text-align:center;transform-origin:center}.lyric-line.active{font-size:20px}.lyrics-empty{min-height:220px}.metadata-panel{grid-column:1;grid-row:3;padding-top:12px}.metadata-panel dl{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 12px}.metadata-panel>p{display:none}}
@media(max-height:700px) and (min-width:720px){.player-content{padding-top:18px;padding-bottom:22px}.artwork-shell{width:min(31vh,260px)}.track-heading{margin-top:13px}.timeline{margin-top:12px}.metadata-panel{margin-top:10px;padding-top:10px}.metadata-panel>p{display:none}.lyric-line{padding-block:8px}}
@media(prefers-reduced-motion:no-preference){.full-player{animation:player-reveal .24s cubic-bezier(.22,1,.36,1) both}.player-header{animation:player-header-reveal .3s .05s cubic-bezier(.22,1,.36,1) both}.artwork-shell{animation:artwork-reveal .42s cubic-bezier(.16,1,.3,1) both}.track-heading,.timeline,.transport,.metadata-panel{animation:details-reveal .34s .08s cubic-bezier(.22,1,.36,1) both}.lyrics-panel{animation:lyrics-reveal .38s .1s cubic-bezier(.22,1,.36,1) both}.round-button,.transport button,.lyric-line,.report-button{transition:color .2s ease,background-color .2s ease,opacity .2s ease,transform .2s cubic-bezier(.22,1,.36,1)}.round-button:active,.transport button:active,.report-button:active{transform:scale(.94)}.lyric-line.active{transform:scale(1.018)}@keyframes player-reveal{from{opacity:0}to{opacity:1}}@keyframes player-header-reveal{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}@keyframes artwork-reveal{from{opacity:.2;transform:translateY(22px) scale(.94)}to{opacity:1;transform:none}}@keyframes details-reveal{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}@keyframes lyrics-reveal{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:none}}}
@media(prefers-reduced-motion:reduce){.lyrics-scroller{scroll-behavior:auto}}
</style>
