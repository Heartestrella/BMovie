<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FileVideo2 } from '@lucide/vue'

const props = withDefaults(defineProps<{
  poster?: string
  thumbnail?: string
  alt?: string
  fallbackLabel?: string
  mode?: 'poster' | 'landscape'
}>(), {
  alt: '',
  fallbackLabel: '暂无可用画面',
  mode: 'poster',
})

const failedSources = ref(new Set<string>())
watch(() => [props.poster, props.thumbnail], () => { failedSources.value = new Set() })

const source = computed(() => {
  if (props.poster && !failedSources.value.has(props.poster)) return { url: props.poster, kind: 'poster' as const }
  if (props.thumbnail && !failedSources.value.has(props.thumbnail)) return { url: props.thumbnail, kind: 'thumbnail' as const }
  return undefined
})

function markFailed(url: string) {
  failedSources.value = new Set([...failedSources.value, url])
}
</script>

<template>
  <span class="media-artwork" :class="[mode, source?.kind]">
    <template v-if="source">
      <img v-if="source.kind === 'thumbnail' && mode === 'poster'" class="thumbnail-fill" :src="source.url" alt="" aria-hidden="true" @error="markFailed(source.url)" />
      <img class="artwork-image" :src="source.url" :alt="alt" @error="markFailed(source.url)" />
    </template>
    <span v-else class="artwork-empty" role="img" :aria-label="fallbackLabel">
      <FileVideo2 :size="25" />
      <small>{{ fallbackLabel }}</small>
    </span>
  </span>
</template>

<style scoped>
.media-artwork{position:relative;display:grid;width:100%;height:100%;place-items:center;overflow:hidden;color:var(--muted);background:var(--surface-raised)}
.artwork-image{position:relative;z-index:1;width:100%;height:100%;object-fit:cover}
.poster.thumbnail .artwork-image{height:auto;max-height:72%;object-fit:contain;box-shadow:0 2px 8px rgba(0,0,0,.45)}
.thumbnail-fill{position:absolute;inset:-12%;width:124%;height:124%;object-fit:cover;filter:blur(14px) brightness(.48);transform:scale(1.04)}
.artwork-empty{display:grid;justify-items:center;gap:9px;padding:16px;text-align:center}
.artwork-empty small{color:var(--dim);font-size:10px}
.landscape.thumbnail .artwork-image{object-fit:cover}
</style>
