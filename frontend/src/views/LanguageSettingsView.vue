<script setup lang="ts">
import { ArrowLeft, Check, Languages } from '@lucide/vue'
import { useRouter } from 'vue-router'
import { currentLocale, setLocale, supportedLocales, t, type AppLocale } from '../i18n'

const router = useRouter()
function choose(locale: AppLocale) { setLocale(locale) }
</script>

<template>
  <section class="page language-page">
    <header class="page-header compact-header">
      <button class="back-button" :aria-label="t('settings.back')" @click="router.back()"><ArrowLeft :size="20" /></button>
      <div><p class="eyebrow">Language</p><h1>{{ t('settings.interfaceLanguage') }}</h1></div>
    </header>

    <p class="lead">{{ t('settings.languageDescription') }}</p>
    <div class="language-list" role="radiogroup" :aria-label="t('settings.interfaceLanguage')">
      <button v-for="locale in supportedLocales" :key="locale.code" role="radio" :aria-checked="currentLocale === locale.code" @click="choose(locale.code)">
        <span class="language-icon"><Languages :size="19" /></span>
        <span><strong>{{ locale.nativeName }}</strong><small>{{ locale.code }}</small></span>
        <Check v-if="currentLocale === locale.code" :size="19" class="selected" />
      </button>
    </div>
    <p class="note">{{ t('settings.metadataLanguageNote') }}</p>
  </section>
</template>

<style scoped>
.language-page{max-width:680px}.compact-header{display:flex;align-items:center;justify-content:flex-start;gap:13px}.back-button{display:grid;width:42px;height:42px;place-items:center;border:1px solid var(--line);border-radius:50%;color:var(--ink);background:transparent}.lead{max-width:65ch;margin:-6px 0 20px;color:var(--muted);font-size:13px;line-height:1.7}.language-list{border-top:1px solid var(--line)}.language-list button{display:grid;width:100%;grid-template-columns:42px minmax(0,1fr) 24px;align-items:center;gap:12px;padding:14px 2px;border:0;border-bottom:1px solid var(--line);color:var(--ink);background:transparent;text-align:left}.language-list button:focus-visible{outline:2px solid var(--beam);outline-offset:3px}.language-icon{display:grid;width:38px;height:38px;place-items:center;border-radius:8px;color:var(--beam);background:var(--beam-soft)}.language-list button>span:nth-child(2){display:grid;gap:3px}.language-list strong{font-size:14px}.language-list small{color:var(--dim);font-size:10px}.selected{color:var(--beam)}.note{margin-top:18px;color:var(--dim);font-size:11px;line-height:1.65}
</style>
