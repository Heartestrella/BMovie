<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronRight, Clock3, Search } from '@lucide/vue'
import { useMediaStore, type MediaWork } from '../stores/media'
import MediaArtwork from '../components/MediaArtwork.vue'

const media = useMediaStore(), router = useRouter()
type HomeCard = Partial<MediaWork> & { title: string }
const placeholders: HomeCard[] = [
  { title: '等待你的第一部影片' },
  { title: '电影与剧集' },
  { title: '跨设备媒体库' },
]
const recent = computed<HomeCard[]>(() => media.recentWorks.length ? media.recentWorks.slice(0, 6) : placeholders)
function open(item: HomeCard) {
  if (!item.id) return router.push('/library')
  router.push({ name: 'media-detail', query: { id: item.id } })
}
onMounted(() => media.load())
</script>

<template>
  <section class="page home-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">BMovie / 私人放映厅</p>
        <h1>晚上好</h1>
      </div>
      <button class="icon-button" aria-label="搜索" @click="router.push('/library')">
        <Search :size="19" />
      </button>
    </header>

    <section class="film-strip" aria-labelledby="continue-title">
      <div class="section-heading">
        <h2 id="continue-title"><Clock3 :size="17" /> 继续观看</h2>
        <RouterLink to="/library">全部 <ChevronRight :size="15" /></RouterLink>
      </div>
      <div class="strip-track">
        <article v-for="(item,index) in recent" :key="item.id || item.title" class="film-frame" @click="open(item)">
          <div class="frame-art" :style="{ backgroundColor: ['#28243f','#202b36','#32252a'][index % 3] }">
            <MediaArtwork v-if="item.id" :poster="item.poster" :thumbnail="item.thumbnail" :alt="`${item.title} 预览图`" mode="landscape" fallback-label="暂无预览" />
            <span class="sprockets" aria-hidden="true" />
            <span class="frame-mark">B</span>
          </div>
          <h3>{{ item.title }}</h3>
          <p>{{ item.id ? `${item.items?.length ?? 1} 个文件` : ['连接网盘后自动出现在这里','按观看进度继续播放','从你的文件建立私人片库'][index] }}</p>
        </article>
      </div>
    </section>

    <section class="start-panel">
      <p class="panel-kicker">{{ media.items.length ? `媒体库已有 ${media.works.length} 部作品` : '媒体库尚未连接' }}</p>
      <h2>{{ media.items.length ? '你的私人放映厅已经准备好了。' : '把分散的网盘，变成一间放映厅。' }}</h2>
      <p>{{ media.items.length ? '浏览媒体库、搜索影片，或从上方继续上次的观看。' : '添加 OpenList 存储后，BMovie 会整理目录、识别影片并在这里生成海报墙。' }}</p>
      <RouterLink :to="media.items.length ? '/library' : '/settings/storage'" class="primary-button">{{ media.items.length ? '打开媒体库' : '开始连接' }}</RouterLink>
    </section>
  </section>
</template>

<style scoped>
.section-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 13px; }
.section-heading h2 { display: flex; align-items: center; gap: 8px; margin: 0; }
.section-heading a { display: inline-flex; align-items: center; color: var(--muted); font-size: 12px; text-decoration: none; }
.strip-track { display: grid; grid-auto-columns: minmax(230px, 72vw); grid-auto-flow: column; gap: 12px; margin-right: -20px; padding-right: 20px; overflow-x: auto; scrollbar-width: none; scroll-snap-type: x mandatory; }
.strip-track::-webkit-scrollbar { display: none; }
.film-frame { scroll-snap-align: start; }
.film-frame { position: relative; cursor: pointer; }.frame-progress { position: absolute; bottom: -5px; left: 0; height: 2px; background: var(--beam); }
.frame-art { position: relative; height: 130px; margin-bottom: 11px; overflow: hidden; border: 1px solid #34313e; border-radius: 5px; }
.frame-art>.media-artwork{position:absolute;inset:0}.frame-art>.media-artwork~.frame-mark,.frame-art>.media-artwork~.sprockets{display:none}
.frame-art::before, .frame-art::after { content: ''; position: absolute; top: 8px; right: 8px; bottom: 8px; width: 5px; background: #0c0d11; box-shadow: 0 14px #0c0d11, 0 28px #0c0d11, 0 42px #0c0d11, 0 56px #0c0d11, 0 70px #0c0d11, 0 84px #0c0d11, 0 98px #0c0d11; }
.frame-art::before { right: auto; left: 8px; }
.frame-mark { position: absolute; right: 28px; bottom: 9px; color: rgba(242, 239, 232, .16); font-family: var(--font-display); font-size: 66px; font-weight: 800; line-height: .8; }
.film-frame h3 { margin: 0 0 3px; font-size: 14px; font-weight: 650; }
.film-frame p { margin: 0; color: var(--dim); font-size: 11px; }
.start-panel { margin-top: 34px; padding: 25px 0 4px; border-top: 1px solid var(--line); }
.panel-kicker { margin-bottom: 8px; color: var(--beam); font-size: 11px; font-weight: 700; letter-spacing: .08em; }
.start-panel h2 { max-width: 430px; margin-bottom: 9px; font-size: clamp(23px, 6vw, 32px); line-height: 1.2; }
.start-panel > p:not(.panel-kicker) { max-width: 510px; margin-bottom: 20px; color: var(--muted); font-size: 13px; line-height: 1.7; }
@media (min-width: 720px) { .strip-track { grid-auto-columns: 290px; margin-right: 0; padding-right: 0; } .frame-art { height: 162px; } }
</style>
