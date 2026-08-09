<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, Check, ExternalLink, FolderPlus, KeyRound, Tv2 } from '@lucide/vue'
import type { Component } from 'vue'
import { useRouter } from 'vue-router'
import { t } from '../i18n'

interface OnboardingStep {
  icon: Component
  title: string
  body: string
  tip: string
  action: string
  route: string
  tmdb?: boolean
}

const COMPLETE_KEY = 'bmovie-onboarding-completed-v1'
const STEP_KEY = 'bmovie-onboarding-step-v1'
const router = useRouter()
const restoredStep = Number(localStorage.getItem(STEP_KEY) ?? 0)
const current = ref(Number.isFinite(restoredStep) ? Math.max(0, Math.min(restoredStep, 2)) : 0)
const steps = computed<OnboardingStep[]>(() => [
  { icon: FolderPlus, title: t('onboarding.step1Title'), body: t('onboarding.step1Body'), tip: t('onboarding.step1Tip'), action: t('onboarding.step1Action'), route: '/settings/library' },
  { icon: KeyRound, title: t('onboarding.step2Title'), body: t('onboarding.step2Body'), tip: t('onboarding.step2Tip'), action: t('onboarding.step2Action'), route: '/settings/metadata', tmdb: true },
  { icon: Tv2, title: t('onboarding.step3Title'), body: t('onboarding.step3Body'), tip: t('onboarding.step3Tip'), action: t('onboarding.step3Action'), route: '/settings/discovery' },
])
const step = computed(() => steps.value[current.value]!)
const lastStep = computed(() => current.value === steps.value.length - 1)

function next() {
  if (lastStep.value) return complete()
  current.value += 1
  localStorage.setItem(STEP_KEY, String(current.value))
}

function configure() {
  localStorage.setItem(STEP_KEY, String(current.value))
  void router.push(step.value.route)
}

function complete() {
  localStorage.setItem(COMPLETE_KEY, 'true')
  localStorage.removeItem(STEP_KEY)
  void router.replace('/')
}
</script>

<template>
  <main class="onboarding-shell">
    <header class="onboarding-header">
      <span class="brand"><img src="/favicon.svg" alt="" /><strong>BMovie</strong></span>
      <button class="skip-button" @click="complete">{{ t('onboarding.skip') }}</button>
    </header>

    <section class="onboarding-content" aria-live="polite">
      <div class="step-visual" :key="`visual-${current}`">
        <span class="step-icon"><component :is="step.icon" :size="52" :stroke-width="1.45" /></span>
        <div class="progress-rail" aria-hidden="true"><i v-for="(_, index) in steps" :key="index" :class="{ active: index <= current }" /></div>
      </div>

      <div class="step-copy" :key="`copy-${current}`">
        <p class="step-count">{{ t('onboarding.progress', { current: current + 1, total: steps.length }) }}</p>
        <h1>{{ step.title }}</h1>
        <p class="step-body">{{ step.body }}</p>
        <p class="step-tip"><Check :size="16" />{{ step.tip }}</p>
        <div class="step-links">
          <button class="secondary-button" @click="configure">{{ step.action }}<ExternalLink :size="16" /></button>
          <a v-if="step.tmdb" class="text-link" href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer">{{ t('onboarding.registerTmdb') }}<ExternalLink :size="14" /></a>
        </div>
      </div>
    </section>

    <footer class="onboarding-footer">
      <p>{{ t('onboarding.optional') }}</p>
      <button class="primary-button" @click="next">{{ t(lastStep ? 'onboarding.finish' : 'onboarding.next') }}<ArrowRight :size="18" /></button>
    </footer>
  </main>
</template>

<style scoped>
.onboarding-shell{display:grid;min-height:100svh;grid-template-rows:auto 1fr auto;padding:calc(22px + env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(22px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left));background:var(--canvas)}.onboarding-header{display:flex;max-width:1120px;width:100%;margin:0 auto;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:9px;color:var(--ink);text-decoration:none}.brand img{width:34px;height:34px;border-radius:8px}.brand strong{font-family:var(--font-display);font-size:15px;letter-spacing:.04em}.skip-button{min-width:88px;min-height:44px;padding:0 12px;border:0;color:var(--muted);background:transparent;font-size:13px}.onboarding-content{display:grid;width:min(100%,980px);margin:auto;grid-template-columns:minmax(260px,.8fr) minmax(360px,1.2fr);align-items:center;gap:clamp(48px,8vw,112px);padding:48px 0}.step-visual{display:grid;justify-items:center;gap:32px}.step-icon{display:grid;width:190px;height:190px;place-items:center;border-radius:16px;color:var(--beam);background:var(--surface);box-shadow:inset 0 0 0 1px var(--line)}.progress-rail{display:flex;gap:8px}.progress-rail i{width:30px;height:3px;background:var(--line)}.progress-rail i.active{background:var(--beam)}.step-copy{max-width:590px}.step-count{margin:0 0 16px;color:var(--beam);font-size:12px;font-weight:700}.step-copy h1{max-width:14ch;margin:0 0 20px;font-size:48px;line-height:1.08;text-wrap:balance}.step-body{max-width:62ch;margin:0;color:var(--muted);font-size:15px;line-height:1.8;text-wrap:pretty}.step-tip{display:flex;align-items:flex-start;gap:8px;margin:22px 0 0;padding-top:18px;border-top:1px solid var(--line);color:var(--ink);font-size:12px;line-height:1.65}.step-tip svg{flex:0 0 auto;margin-top:2px;color:var(--beam)}.step-links{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-top:26px}.step-links .secondary-button{min-height:46px}.text-link{display:inline-flex;min-height:44px;align-items:center;gap:6px;padding:0 8px;color:var(--beam);font-size:12px;text-decoration:none}.onboarding-footer{display:flex;width:min(100%,1120px);margin:0 auto;align-items:center;justify-content:space-between;gap:24px;padding-top:18px;border-top:1px solid var(--line)}.onboarding-footer p{max-width:58ch;margin:0;color:var(--dim);font-size:11px;line-height:1.6}.onboarding-footer .primary-button{min-width:150px}.onboarding-footer .primary-button svg{transition:transform .18s cubic-bezier(.16,1,.3,1)}.onboarding-footer .primary-button:hover svg{transform:translateX(3px)}@media(max-width:700px){.onboarding-shell{padding-inline:20px}.onboarding-content{grid-template-columns:1fr;align-content:center;gap:32px;padding:32px 0}.step-visual{justify-items:start;gap:20px}.step-icon{width:88px;height:88px;border-radius:12px}.step-icon :deep(svg){width:38px;height:38px}.step-copy h1{font-size:34px}.step-body{font-size:14px;line-height:1.7}.onboarding-footer{align-items:stretch;flex-direction:column;gap:12px}.onboarding-footer .primary-button{width:100%}}@media(max-height:680px) and (min-width:701px){.onboarding-content{padding:24px 0}.step-icon{width:132px;height:132px}.step-copy h1{font-size:38px;margin-bottom:14px}.step-body{font-size:13px}.step-tip{margin-top:14px;padding-top:12px}.step-links{margin-top:16px}}@media(prefers-reduced-motion:no-preference){.step-copy{animation:step-in .24s cubic-bezier(.16,1,.3,1)}.step-icon{animation:icon-in .24s cubic-bezier(.16,1,.3,1)}.secondary-button,.skip-button,.text-link{transition:color .18s ease,background-color .18s ease,border-color .18s ease}@keyframes step-in{from{opacity:.25;transform:translateX(12px)}}@keyframes icon-in{from{opacity:.25;transform:scale(.96)}}}@media(prefers-reduced-motion:reduce){.step-copy,.step-icon{animation:none}.onboarding-footer .primary-button svg{transition:none}}
</style>
