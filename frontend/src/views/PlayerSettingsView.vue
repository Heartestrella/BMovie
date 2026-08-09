<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowLeft, Check, ExternalLink, MessageCircle, PlayCircle } from '@lucide/vue'
import { useRouter } from 'vue-router'
import { loadPlayerSettings, savePlayerSettings, type PlayerMode } from '../services/playerSettings'

const router = useRouter()
const selected = ref<PlayerMode>('internal')
const autoDanmaku = ref(false)
const loaded = ref(false)

const choices = [
  {
    value: 'internal' as const,
    icon: PlayCircle,
    title: 'BMovie 内置播放器',
    description: '支持播放进度回传、内嵌字幕与同名外挂字幕',
  },
  {
    value: 'external' as const,
    icon: ExternalLink,
    title: '系统外部播放器',
    description: '播放时由 Android 拉起 VLC、MX Player、MPV 等已安装应用',
  },
]

async function select(mode: PlayerMode) {
  selected.value = mode
  await savePlayerSettings({ defaultMode: mode })
}

async function toggleAutoDanmaku() {
  autoDanmaku.value = !autoDanmaku.value
  await savePlayerSettings({ autoDanmaku: autoDanmaku.value })
}

onMounted(async () => {
  const settings = await loadPlayerSettings()
  selected.value = settings.defaultMode
  autoDanmaku.value = settings.autoDanmaku
  loaded.value = true
})
</script>

<template>
  <section class="page player-settings-page">
    <header class="page-header compact-header">
      <button class="icon-button" aria-label="返回" @click="router.back()"><ArrowLeft :size="20" /></button>
      <div><p class="eyebrow">Playback</p><h1>默认播放器</h1></div>
    </header>

    <p class="intro">选择点按影片或分集时默认使用的播放器详情页仍可临时切换，不会覆盖这里的设置</p>
    <div class="player-options" :class="{ loading: !loaded }">
      <button v-for="choice in choices" :key="choice.value" class="player-option" :class="{ selected: selected === choice.value }" @click="select(choice.value)">
        <span class="option-icon"><component :is="choice.icon" :size="22" /></span>
        <span class="option-copy"><strong>{{ choice.title }}</strong><small>{{ choice.description }}</small></span>
        <span class="option-check"><Check v-if="selected === choice.value" :size="17" /></span>
      </button>
    </div>

    <section class="feature-section">
      <p class="eyebrow">Danmaku</p>
      <button class="feature-toggle" :class="{ selected: autoDanmaku }" role="switch" :aria-checked="autoDanmaku" @click="toggleAutoDanmaku">
        <span class="option-icon"><MessageCircle :size="22" /></span>
        <span class="option-copy">
          <strong>自动匹配弹幕</strong>
          <small>内置播放剧集时，按作品、季号和集号自动匹配 B 站弹幕；成功后会缓存到本机</small>
        </span>
        <span class="switch"><i /></span>
      </button>
      <p class="feature-note">开启后，即使默认播放器设为外部播放器，有可匹配弹幕的剧集也会优先使用内置播放器匹配失败不会影响正常播放</p>
    </section>

    <p class="note">外部播放器的播放能力由对应应用决定BMovie 会传递视频地址、标题、续播位置和外挂字幕；播放进度是否回传取决于第三方播放器</p>
  </section>
</template>

<style scoped>
.compact-header{align-items:center;justify-content:flex-start}.compact-header>div{min-width:0}.intro{max-width:65ch;margin-bottom:23px;color:var(--muted);font-size:13px;line-height:1.7}.player-options{border-top:1px solid var(--line)}.player-options.loading{opacity:.55}.player-option,.feature-toggle{display:grid;width:100%;grid-template-columns:44px 1fr 28px;align-items:center;gap:13px;padding:18px 3px;border:0;border-bottom:1px solid var(--line);color:var(--ink);background:transparent;text-align:left}.option-icon{display:grid;width:42px;height:42px;place-items:center;border-radius:10px;color:var(--muted);background:var(--surface)}.player-option.selected .option-icon,.feature-toggle.selected .option-icon{color:var(--beam);background:var(--beam-soft)}.option-copy{display:grid;gap:5px}.option-copy strong{font-size:14px}.option-copy small{max-width:62ch;color:var(--muted);font-size:11px;line-height:1.55}.option-check{display:grid;width:24px;height:24px;place-items:center;border:1px solid var(--line);border-radius:50%;color:#0b0b10}.player-option.selected .option-check{border-color:var(--beam);background:var(--beam)}.feature-section{margin-top:34px;border-top:1px solid var(--line);padding-top:22px}.feature-toggle{grid-template-columns:44px 1fr 42px;padding-top:14px}.switch{position:relative;width:40px;height:22px;border:1px solid var(--line);border-radius:999px;background:var(--surface);transition:.2s ease}.switch i{position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:var(--dim);transition:.2s ease}.feature-toggle.selected .switch{border-color:var(--beam);background:var(--beam)}.feature-toggle.selected .switch i{left:21px;background:#0b0b10}.feature-note,.note{max-width:68ch;margin-top:13px;color:var(--dim);font-size:11px;line-height:1.7}.note{margin-top:28px}
</style>
