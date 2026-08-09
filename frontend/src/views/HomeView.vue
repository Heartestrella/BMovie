<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronRight, Clock3, Disc3, Music2, Play, Search } from '@lucide/vue'
import { useMediaStore, type MediaItem, type MediaWork } from '../stores/media'
import { useMusicPlayerStore } from '../stores/musicPlayer'
import MediaArtwork from '../components/MediaArtwork.vue'

const media = useMediaStore(), player = useMusicPlayerStore(), router = useRouter()
type HomeCard = Partial<MediaWork> & { title: string }
const placeholders: HomeCard[] = [
  { title: '等待你的第一部影片' },
  { title: '电影与剧集' },
  { title: '跨设备媒体库' },
]
const recent = computed<HomeCard[]>(() => media.recentWorks.length ? media.recentWorks.slice(0, 6) : placeholders)
const songs = computed(() => media.musicItems.slice(0, 8))
function open(item: HomeCard) {
  if (!item.id) return router.push('/library')
  router.push({ name: 'media-detail', query: { id: item.id } })
}
async function playSong(item: MediaItem) {
  const index = media.musicItems.findIndex((entry) => entry.path === item.path)
  await player.playQueue(media.musicItems, Math.max(0, index))
  router.push('/music')
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

    <section class="music-section" aria-labelledby="music-title">
      <div class="section-heading">
        <h2 id="music-title"><Music2 :size="17" /> 音乐</h2>
        <RouterLink to="/music">全部 <ChevronRight :size="15" /></RouterLink>
      </div>
      <div v-if="songs.length" class="song-list">
        <button v-for="(song,index) in songs" :key="song.path" class="song-row" @click="playSong(song)">
          <span class="song-art">
            <img v-if="song.musicArtwork || song.thumb" :src="song.musicArtwork || song.thumb" alt="" />
            <Disc3 v-else :size="20" />
            <span class="play-mark"><Play :size="13" fill="currentColor" /></span>
          </span>
          <span class="song-index">{{ String(index + 1).padStart(2, '0') }}</span>
          <span class="song-copy"><strong>{{ song.title }}</strong><small>{{ song.artists?.join(' / ') || song.artist || '未知艺术家' }}{{ song.album ? ` · ${song.album}` : '' }}</small></span>
          <small class="song-duration">{{ song.duration ? `${Math.floor(song.duration / 60)}:${String(Math.floor(song.duration % 60)).padStart(2, '0')}` : '—' }}</small>
        </button>
      </div>
      <div v-else class="music-empty">
        <Disc3 :size="24" />
        <span><strong>音乐列表还是空的</strong><small>在媒体库加入音乐目录后，歌曲会出现在这里</small></span>
        <RouterLink to="/settings/storage">添加媒体</RouterLink>
      </div>
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
.music-section{margin-top:34px;padding-top:25px;border-top:1px solid var(--line)}
.song-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:28px}
.song-row{display:grid;grid-template-columns:42px 25px minmax(0,1fr) auto;align-items:center;gap:10px;padding:10px 0;border:0;border-bottom:1px solid var(--line);color:var(--ink);background:transparent;text-align:left}
.song-art{position:relative;display:grid;width:42px;height:42px;place-items:center;overflow:hidden;border-radius:6px;color:var(--beam);background:var(--surface)}.song-art img{width:100%;height:100%;object-fit:cover}.play-mark{position:absolute;inset:0;display:grid;place-items:center;color:white;background:rgba(8,9,14,.55);opacity:0;transition:opacity .18s}.song-row:hover .play-mark{opacity:1}.song-index{color:var(--dim);font:600 10px/1 var(--font-display)}.song-copy{display:grid;min-width:0;gap:4px}.song-copy strong,.song-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.song-copy strong{font-size:13px}.song-copy small,.song-duration{color:var(--dim);font-size:10px}.music-empty{display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:12px;padding:16px;border:1px solid var(--line);border-radius:9px;background:var(--surface)}.music-empty>span{display:grid;gap:4px}.music-empty strong{font-size:13px}.music-empty small{color:var(--dim);font-size:10px}.music-empty a{color:var(--beam);font-size:11px;text-decoration:none}
@media (min-width: 720px) { .strip-track { grid-auto-columns: 290px; margin-right: 0; padding-right: 0; } .frame-art { height: 162px; } }
@media(max-width:700px){.song-list{grid-template-columns:1fr}.song-row:nth-child(n+7){display:none}}
@media(prefers-reduced-motion:reduce){.play-mark{transition:none}}
</style>
