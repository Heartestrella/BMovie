<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowLeft, ChevronRight, Code2, ExternalLink, MessageCircleQuestion, Users } from '@lucide/vue'
import { useRouter } from 'vue-router'
import { t } from '../i18n'

interface Contributor {
  login: string
  avatar_url: string
  html_url: string
  contributions: number
}

const VERSION = '0.1.0'
const REPOSITORY = 'https://github.com/Heartestrella/BMovie'
const router = useRouter()
const contributors = ref<Contributor[]>([])
const contributorsLoading = ref(true)
const contributorsFailed = ref(false)

onMounted(async () => {
  try {
    const response = await fetch('https://api.github.com/repos/Heartestrella/BMovie/contributors?per_page=20', {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) throw new Error(`GitHub ${response.status}`)
    const values = await response.json() as Contributor[]
    contributors.value = values.filter((item) => item.login && !item.login.endsWith('[bot]'))
  } catch {
    contributorsFailed.value = true
    contributors.value = [{ login: 'Heartestrella', avatar_url: 'https://github.com/Heartestrella.png', html_url: 'https://github.com/Heartestrella', contributions: 0 }]
  } finally {
    contributorsLoading.value = false
  }
})
</script>

<template>
  <section class="page about-page">
    <header class="page-header">
      <div class="title-row">
        <button class="icon-button" :aria-label="t('about.back')" @click="router.back()"><ArrowLeft :size="20" /></button>
        <div><p class="eyebrow">BMovie</p><h1>{{ t('about.title') }}</h1></div>
      </div>
    </header>

    <section class="identity" aria-labelledby="app-name">
      <img src="/favicon.svg" alt="" />
      <div><h2 id="app-name">BMovie</h2><strong>{{ t('about.version', { version: VERSION }) }}</strong><p>{{ t('about.description') }}</p></div>
    </section>

    <section class="about-section">
      <a class="link-row" :href="REPOSITORY" target="_blank" rel="noopener noreferrer">
        <span class="row-icon"><Code2 :size="21" /></span>
        <span><strong>{{ t('about.repository') }}</strong><small>{{ t('about.repositoryDetail') }}</small></span>
        <ExternalLink :size="17" aria-hidden="true" />
      </a>
      <a class="link-row" :href="`${REPOSITORY}/issues`" target="_blank" rel="noopener noreferrer">
        <span class="row-icon"><MessageCircleQuestion :size="21" /></span>
        <span><strong>{{ t('about.feedback') }}</strong><small>{{ t('about.feedbackDetail') }}</small></span>
        <ChevronRight :size="17" aria-hidden="true" />
      </a>
    </section>

    <section class="contributors-section" aria-labelledby="contributors-title">
      <div class="section-heading"><h2 id="contributors-title"><Users :size="18" />{{ t('about.contributors') }}</h2><span v-if="contributors.length">{{ contributors.length }}</span></div>
      <p v-if="contributorsLoading" class="contributors-status">{{ t('about.contributorsLoading') }}</p>
      <div v-else class="contributors">
        <a v-for="contributor in contributors" :key="contributor.login" :href="contributor.html_url" target="_blank" rel="noopener noreferrer" :aria-label="`${contributor.login} · ${t('about.openExternal')}`">
          <img :src="contributor.avatar_url" alt="" loading="lazy" />
          <span><strong>{{ contributor.login }}</strong><small v-if="contributor.contributions">{{ contributor.contributions }} commits</small></span>
        </a>
      </div>
      <p v-if="contributorsFailed" class="contributors-note">{{ t('about.contributorsFailed') }}</p>
    </section>

    <p class="project-note">{{ t('about.licenseNote') }}</p>
  </section>
</template>

<style scoped>
.about-page{max-width:760px}.title-row,.section-heading h2{display:flex;align-items:center}.title-row{gap:14px}.identity{display:flex;align-items:center;gap:18px;padding:4px 0 28px;border-bottom:1px solid var(--line)}.identity>img{width:76px;height:76px;flex:0 0 auto;border-radius:15px;background:var(--surface)}.identity h2{margin:0 0 3px;font-size:24px}.identity strong{display:inline-block;margin-bottom:7px;color:var(--beam);font-size:11px}.identity p{max-width:520px;margin:0;color:var(--muted);font-size:13px;line-height:1.65}.about-section{margin-top:19px;border-top:1px solid var(--line)}.link-row{display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:11px;padding:14px 2px;border-bottom:1px solid var(--line);color:var(--ink);text-decoration:none}.row-icon{display:grid;width:38px;height:38px;place-items:center;border-radius:8px;color:var(--beam);background:var(--beam-soft)}.link-row>span:nth-child(2){display:grid;min-width:0;gap:3px}.link-row strong{font-size:14px}.link-row small{overflow:hidden;color:var(--muted);font-size:11px;text-overflow:ellipsis;white-space:nowrap}.link-row>svg{color:var(--dim)}.contributors-section{margin-top:32px}.section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px}.section-heading h2{gap:8px;margin:0;font-family:var(--font-body);font-size:14px}.section-heading span{color:var(--dim);font-size:11px}.contributors{display:flex;flex-wrap:wrap;gap:9px}.contributors a{display:flex;min-width:150px;max-width:220px;flex:1 1 160px;align-items:center;gap:10px;padding:10px;border:1px solid var(--line);border-radius:9px;color:var(--ink);text-decoration:none}.contributors img{width:34px;height:34px;flex:0 0 auto;border-radius:50%;background:var(--surface-raised)}.contributors a>span{display:grid;min-width:0;gap:2px}.contributors strong,.contributors small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.contributors strong{font-size:12px}.contributors small{color:var(--dim);font-size:9px}.contributors-status,.contributors-note,.project-note{color:var(--dim);font-size:11px;line-height:1.65}.contributors-status{padding:14px 0}.contributors-note{margin-top:9px}.project-note{max-width:600px;margin:29px 0 0;padding-top:18px;border-top:1px solid var(--line)}@media(max-width:520px){.identity>img{width:64px;height:64px}.link-row small{white-space:normal}.contributors a{min-width:calc(50% - 5px);max-width:none;flex-basis:calc(50% - 5px)}}@media(prefers-reduced-motion:no-preference){.link-row,.contributors a{transition:background-color .18s ease,border-color .18s ease}.link-row:hover{background:var(--surface)}.contributors a:hover{border-color:var(--beam)}}
</style>
