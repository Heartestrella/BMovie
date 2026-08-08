<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowLeft, Check, ExternalLink, PlayCircle } from '@lucide/vue'
import { useRouter } from 'vue-router'
import { loadPlayerSettings, savePlayerSettings, type PlayerMode } from '../services/playerSettings'

const router = useRouter()
const selected = ref<PlayerMode>('internal')
const loaded = ref(false)

const choices = [
  {
    value: 'internal' as const,
    icon: PlayCircle,
    title: 'BMovie 内置播放器',
    description: '支持播放进度回传、内嵌字幕与同名外挂字幕。',
  },
  {
    value: 'external' as const,
    icon: ExternalLink,
    title: '系统外部播放器',
    description: '播放时由 Android 拉起 VLC、MX Player、MPV 等已安装应用。',
  },
]

async function select(mode: PlayerMode) {
  selected.value = mode
  await savePlayerSettings({ defaultMode: mode })
}

onMounted(async () => {
  selected.value = (await loadPlayerSettings()).defaultMode
  loaded.value = true
})
</script>

<template>
  <section class="page player-settings-page">
    <header class="page-header compact-header">
      <button class="icon-button" aria-label="返回" @click="router.back()"><ArrowLeft :size="20" /></button>
      <div><p class="eyebrow">Playback</p><h1>默认播放器</h1></div>
    </header>

    <p class="intro">选择点按影片或分集时默认使用的播放器。详情页仍可临时切换，不会覆盖这里的设置。</p>
    <div class="player-options" :class="{ loading: !loaded }">
      <button v-for="choice in choices" :key="choice.value" class="player-option" :class="{ selected: selected === choice.value }" @click="select(choice.value)">
        <span class="option-icon"><component :is="choice.icon" :size="22" /></span>
        <span class="option-copy"><strong>{{ choice.title }}</strong><small>{{ choice.description }}</small></span>
        <span class="option-check"><Check v-if="selected === choice.value" :size="17" /></span>
      </button>
    </div>

    <p class="note">外部播放器的播放能力由对应应用决定。BMovie 会传递视频地址、标题、续播位置和外挂字幕；播放进度是否回传取决于第三方播放器。</p>
  </section>
</template>

<style scoped>
.compact-header{align-items:center;justify-content:flex-start}.compact-header>div{min-width:0}.intro{max-width:65ch;margin-bottom:23px;color:var(--muted);font-size:13px;line-height:1.7}.player-options{border-top:1px solid var(--line)}.player-options.loading{opacity:.55}.player-option{display:grid;width:100%;grid-template-columns:44px 1fr 28px;align-items:center;gap:13px;padding:18px 3px;border:0;border-bottom:1px solid var(--line);color:var(--ink);background:transparent;text-align:left}.option-icon{display:grid;width:42px;height:42px;place-items:center;border-radius:10px;color:var(--muted);background:var(--surface)}.player-option.selected .option-icon{color:var(--beam);background:var(--beam-soft)}.option-copy{display:grid;gap:5px}.option-copy strong{font-size:14px}.option-copy small{max-width:62ch;color:var(--muted);font-size:11px;line-height:1.55}.option-check{display:grid;width:24px;height:24px;place-items:center;border:1px solid var(--line);border-radius:50%;color:#0b0b10}.player-option.selected .option-check{border-color:var(--beam);background:var(--beam)}.note{max-width:68ch;margin-top:22px;color:var(--dim);font-size:11px;line-height:1.7}
</style>
