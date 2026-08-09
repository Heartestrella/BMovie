<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ArrowLeft, Check, ExternalLink, KeyRound, Languages, Radio, Tv } from '@lucide/vue'
import { useRouter } from 'vue-router'
import { loadMetadataSettings, saveMetadataSettings, verifyTmdbConnection, type MetadataSettings } from '../services/metadata'
import { useLibrarySourcesStore } from '../stores/librarySources'

const router = useRouter()
const librarySources = useLibrarySourcesStore()
const settings = reactive<MetadataSettings>({ tmdbEnabled: false, tmdbToken: '', bangumiEnabled: true, tvmazeEnabled: true, metadataLocale: 'auto' })
const saved = ref(false), testing = ref(false), error = ref('')

onMounted(async () => Object.assign(settings, await loadMetadataSettings()))

async function save() {
  testing.value = true; error.value = ''; saved.value = false
  try {
    settings.tmdbToken = settings.tmdbToken.trim().replace(/^Bearer\s+/i, '')
    if (settings.tmdbEnabled && settings.tmdbToken) {
      try { await verifyTmdbConnection(settings.tmdbToken) }
      catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason)
        throw new Error(/TMDB (401|403)/.test(message) ? 'TMDB Token 无效，请重新复制 API Read Access Token' : '当前网络无法连接 TMDB，请稍后重试')
      }
    }
    await saveMetadataSettings(settings)
    await librarySources.markDirty()
    saved.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <section class="page metadata-page">
    <header class="page-header"><div class="title-row"><button class="icon-button" aria-label="返回" @click="router.back()"><ArrowLeft :size="20" /></button><div><p class="eyebrow">Metadata</p><h1>元数据来源</h1></div></div></header>
    <p class="lead">扫描时只在标题能够可靠匹配时归类为电影或剧集，无法匹配的文件会进入“其他”</p>
    <p class="priority-note"><b>自动降级顺序</b><span>TMDB → Bangumi → TVmaze</span><small>仅使用已启用的来源；上一来源连接失败或没有可靠结果时，自动继续下一来源</small></p>

    <label class="language-field">
      <span><Languages :size="18" /><b>元数据语言</b><small>标题、简介、分集名优先使用此语言</small></span>
      <select v-model="settings.metadataLocale">
        <option value="auto">跟随界面语言（推荐）</option>
        <option value="zh-CN">简体中文</option>
        <option value="en-US">English</option>
        <option value="ja-JP">日本語</option>
      </select>
    </label>

    <article class="provider-card">
      <div class="provider-head"><span class="provider-icon"><Radio :size="20" /></span><div><h2>TMDB</h2><p>非商业使用免费 · 电影与剧集</p></div><label class="switch"><input v-model="settings.tmdbEnabled" type="checkbox" /><i><b /></i></label></div>
      <div v-if="settings.tmdbEnabled" class="token-field"><label for="tmdb-token"><KeyRound :size="15" />API Read Access Token</label><textarea id="tmdb-token" v-model="settings.tmdbToken" rows="4" placeholder="粘贴 TMDB API Read Access Token" /><small>Token 仅保存在本机留空时不会请求 TMDB</small></div>
      <p class="provider-note">依次尝试电影或剧集专用搜索、综合搜索，再使用翻译与别名二次校验Android 端会自动更新并缓存可用 IP，同时保持 HTTPS 证书校验</p>
      <a href="https://github.com/cnwikee/CheckTMDB" target="_blank">连通性方案参考 CheckTMDB <ExternalLink :size="14" /></a>
      <a href="https://www.themoviedb.org/settings/api" target="_blank">申请 TMDB API 凭证 <ExternalLink :size="14" /></a>
    </article>

    <article class="provider-card">
      <div class="provider-head"><span class="provider-icon"><Tv :size="20" /></span><div><h2>Bangumi</h2><p>免费、无需密钥 · 中文动漫元数据</p></div><label class="switch"><input v-model="settings.bangumiEnabled" type="checkbox" /><i><b /></i></label></div>
      <p class="provider-note">中文或日文模式下优先匹配动漫标题、简介、评分和中文分集名，缺少的图片与演员信息再由其他来源补全</p>
      <a href="https://bangumi.github.io/api/" target="_blank">查看 Bangumi API <ExternalLink :size="14" /></a>
    </article>

    <article class="provider-card">
      <div class="provider-head"><span class="provider-icon"><Tv :size="20" /></span><div><h2>TVmaze</h2><p>免费、无需密钥 · 用于剧集识别</p></div><label class="switch"><input v-model="settings.tvmazeEnabled" type="checkbox" /><i><b /></i></label></div>
      <p class="provider-note">适合按 S01E01 等规范命名的剧集数据按 CC BY-SA 许可提供</p>
      <a href="https://www.tvmaze.com/api" target="_blank">查看 TVmaze API <ExternalLink :size="14" /></a>
    </article>

    <p v-if="error" class="error-banner">{{ error }}</p>
    <p v-if="saved" class="success"><Check :size="16" />设置已保存</p>
    <button class="primary-button save-button" :disabled="testing" @click="save">{{ testing ? '正在验证并保存…' : '保存设置' }}</button>
    <p class="attribution">本产品使用 TMDB API，但未经 TMDB 认可或认证Bangumi 与 TVmaze 数据的使用遵循各自许可与署名要求</p>
  </section>
</template>

<style scoped>
.title-row,.provider-head,.token-field label,.provider-card a,.success,.language-field>span{display:flex;align-items:center}.title-row{gap:14px}.lead{max-width:640px;margin-bottom:16px;color:var(--muted);font-size:13px;line-height:1.75}.language-field{display:flex;max-width:680px;align-items:center;justify-content:space-between;gap:18px;margin-bottom:14px;padding:15px 17px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}.language-field>span{min-width:0;gap:8px}.language-field b{font-size:14px}.language-field small{color:var(--dim);font-size:11px}.language-field select{min-width:185px;padding:9px 30px 9px 10px;border:1px solid var(--line);border-radius:7px;color:var(--ink);background:var(--canvas)}.provider-card{max-width:680px;margin-bottom:14px;padding:17px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}.provider-head{gap:12px}.provider-icon{display:grid;width:38px;height:38px;flex:0 0 auto;place-items:center;border-radius:8px;color:var(--beam);background:var(--beam-soft)}.provider-head>div{min-width:0}.provider-head h2{margin:0 0 2px;font-size:16px}.provider-head p{margin:0;color:var(--dim);font-size:11px}.switch{margin-left:auto}.switch input{position:absolute;opacity:0}.switch i{position:relative;display:block;width:38px;height:22px;border-radius:12px;background:var(--line)}.switch b{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--muted);transition:transform .18s ease}.switch input:checked+i{background:var(--beam)}.switch input:checked+i b{background:white;transform:translateX(16px)}.provider-note{margin:14px 0 9px;color:var(--muted);font-size:12px;line-height:1.65}.provider-card a{width:max-content;gap:5px;color:var(--beam);font-size:12px;text-decoration:none}.provider-card a+a{margin-top:8px}.token-field{align-items:stretch;flex-direction:column;gap:7px;margin:16px 0 10px}.token-field label{gap:6px;color:var(--muted);font-size:12px}.token-field textarea{width:100%;padding:12px;border:1px solid var(--line);border-radius:7px;outline:none;color:var(--ink);background:var(--canvas);resize:vertical}.token-field textarea:focus{border-color:var(--beam)}.token-field small{color:var(--dim);font-size:10px}.error-banner{max-width:680px;padding:12px;border:1px solid rgba(255,113,109,.35);border-radius:7px;color:var(--danger);background:rgba(255,113,109,.07)}.success{gap:7px;color:#71d39a}.save-button{margin-top:5px}.save-button:disabled{opacity:.55}.attribution{max-width:680px;margin-top:20px;color:var(--dim);font-size:10px;line-height:1.6}@media(max-width:620px){.language-field{align-items:stretch;flex-direction:column}.language-field>span{flex-wrap:wrap}.language-field small{width:100%;padding-left:26px}.language-field select{width:100%}}
.priority-note{display:grid;max-width:680px;grid-template-columns:auto 1fr;align-items:baseline;gap:4px 12px;margin-bottom:16px;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
.priority-note b{font-size:12px}.priority-note span{color:var(--beam);font-size:12px}.priority-note small{grid-column:1/-1;color:var(--dim);font-size:10px;line-height:1.6}
</style>
