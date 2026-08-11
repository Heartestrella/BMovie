<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ExternalLink, Film, LoaderCircle, RefreshCw } from '@lucide/vue'
import { loadResourceDetail, type ResourceDetail } from '../services/resourceSearch'

const route = useRoute()
const router = useRouter()
const detail = ref<ResourceDetail | null>(null)
const loading = ref(false)
const error = ref('')

async function load() {
  const url = typeof route.query.url === 'string' ? route.query.url : ''
  loading.value = true
  error.value = ''
  try { detail.value = await loadResourceDetail(url) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
  finally { loading.value = false }
}

onMounted(load)
</script>

<template>
  <section class="page resource-detail-page">
    <header class="detail-nav">
      <button class="icon-button" aria-label="返回找资源" @click="router.back()"><ArrowLeft :size="20" /></button>
      <span>资源详情</span>
      <a v-if="detail" class="icon-button" :href="detail.sourceUrl" target="_blank" rel="noopener noreferrer" aria-label="打开来源页"><ExternalLink :size="18" /></a>
      <i v-else />
    </header>

    <div v-if="loading" class="detail-state"><LoaderCircle class="spin" :size="28" /><strong>正在读取公开信息</strong><p>网络较慢时可能需要等待片刻</p></div>
    <div v-else-if="error" class="detail-state"><Film :size="30" /><strong>暂时无法读取详情</strong><p>{{ error }}</p><button class="secondary-button" @click="load"><RefreshCw :size="15" />重试</button></div>

    <template v-else-if="detail">
      <section class="detail-hero">
        <div class="poster"><img v-if="detail.image" :src="detail.image" alt="" /><Film v-else :size="42" /></div>
        <div class="hero-copy"><p class="source-label">BT影视公开索引</p><h1>{{ detail.title }}</h1><div v-if="detail.tags.length" class="tags"><span v-for="tag in detail.tags" :key="tag">{{ tag }}</span></div><a class="primary-button" :href="detail.sourceUrl" target="_blank" rel="noopener noreferrer">查看来源页面 <ExternalLink :size="16" /></a></div>
      </section>

      <section v-if="detail.description" class="description"><h2>内容简介</h2><p>{{ detail.description }}</p></section>
      <section v-if="detail.facts.length" class="facts"><h2>资源信息</h2><dl><template v-for="fact in detail.facts" :key="`${fact.label}:${fact.value}`"><dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd></template></dl></section>
      <p class="attribution">信息来自 btbtla.com，BMovie 仅展示公开页面内容，详情与可用性以来源页为准</p>
    </template>
  </section>
</template>

<style scoped>
.resource-detail-page{max-width:980px}.detail-nav{display:grid;grid-template-columns:42px 1fr 42px;align-items:center;margin-bottom:30px}.detail-nav>span{text-align:center;font-size:13px;font-weight:700}.detail-nav>i{width:42px}.detail-hero{display:grid;grid-template-columns:minmax(180px,260px) minmax(0,1fr);align-items:end;gap:30px;padding-bottom:34px;border-bottom:1px solid var(--line)}.poster{display:grid;aspect-ratio:2/3;place-items:center;overflow:hidden;border-radius:10px;color:var(--beam);background:var(--surface-raised)}.poster img{width:100%;height:100%;object-fit:cover}.hero-copy{padding-bottom:4px}.source-label{margin-bottom:9px;color:var(--beam);font-size:11px;font-weight:700}.hero-copy h1{max-width:18ch;margin-bottom:16px;font-size:38px;line-height:1.12;text-wrap:balance}.tags{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:22px}.tags span{padding:5px 8px;border-radius:5px;color:var(--muted);background:var(--surface);font-size:10px}.description,.facts{padding:30px 0;border-bottom:1px solid var(--line)}.description p{max-width:72ch;margin:0;color:var(--muted);font-size:13px;line-height:1.85;text-wrap:pretty}.facts dl{display:grid;grid-template-columns:minmax(90px,150px) minmax(0,1fr);margin:0}.facts dt,.facts dd{margin:0;padding:11px 0;border-bottom:1px solid rgba(41,43,53,.65);font-size:12px}.facts dt{color:var(--dim)}.facts dd{color:var(--ink)}.attribution{margin-top:20px;color:var(--dim);font-size:9px;line-height:1.6}.detail-state{display:grid;min-height:55svh;place-items:center;align-content:center;gap:10px;text-align:center}.detail-state svg{color:var(--beam)}.detail-state strong{font-size:16px}.detail-state p{max-width:360px;margin:0 0 8px;color:var(--muted);font-size:12px}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:620px){.detail-hero{grid-template-columns:110px minmax(0,1fr);align-items:center;gap:17px}.hero-copy h1{margin-bottom:12px;font-size:24px}.tags{max-height:60px;margin-bottom:14px;overflow:hidden}.primary-button{min-height:40px;padding:0 12px;font-size:11px}.description,.facts{padding:24px 0}.facts dl{grid-template-columns:92px minmax(0,1fr)}}
@media(prefers-reduced-motion:reduce){.spin{animation:none}}
</style>
