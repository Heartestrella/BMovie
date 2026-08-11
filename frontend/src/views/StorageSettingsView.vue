<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ArrowLeft, Check, Cloud, LoaderCircle, LogIn, Plus, ShieldCheck, Trash2, X } from '@lucide/vue'
import { Capacitor } from '@capacitor/core'
import { useRouter } from 'vue-router'
import { useOpenListStore } from '../stores/openlist'
import { openListGet, openListRequest } from '../services/openlist'
import { CloudAuth, type CloudAuthProvider } from '../services/cloudAuth'
import { driverLabel, fieldLabel, helpLabel, optionLabel, statusLabel, t } from '../i18n'

interface DriverField {
  name: string
  type: 'string' | 'text' | 'number' | 'float' | 'bool' | 'select'
  default: string
  options: string
  required: boolean
  help: string
}
interface DriverDefinition {
  common: DriverField[]
  additional: DriverField[]
  config: { name: string; alert?: string }
}
interface StorageItem { id: number; mount_path: string; driver: string; status: string; disabled: boolean }

const router = useRouter()
const openlist = useOpenListStore()
const drivers = ref<Record<string, DriverDefinition>>({})
const storages = ref<StorageItem[]>([])
const selectedDriver = ref('')
const form = reactive<Record<string, string | boolean>>({})
const adding = ref(false)
const loading = ref(true)
const saving = ref(false)
const authenticating = ref(false)
const authSucceeded = ref(false)
const error = ref('')

const popular = ['AliyundriveOpen', 'Quark', '115 Cloud', 'BaiduNetdisk', 'Onedrive', 'GoogleDrive', 'WebDav', 'Local', 'S3']
const driverNames = computed(() => Object.keys(drivers.value).sort((a, b) => {
  const ai = popular.indexOf(a), bi = popular.indexOf(b)
  return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || driverLabel(a).localeCompare(driverLabel(b), 'zh-CN')
}))
const definition = computed(() => drivers.value[selectedDriver.value])
const credentialPattern = /(?:user(?:name)?|password|passcode|cookie|token|secret|client_?id|client_?secret|share_code|receive_code|authorization)/i
interface AuthConfig { provider: CloudAuthProvider; targetField: 'cookie' | 'refresh_token' | 'authorization'; title: string; description: string }
const authConfig = computed<AuthConfig | undefined>(() => {
  if (selectedDriver.value === 'Quark') return {
    provider: 'quark', targetField: 'cookie', title: t('storage.authQuark'), description: t('storage.authQuarkNote'),
  }
  if (selectedDriver.value === 'BaiduNetdisk') return {
    provider: 'baidu', targetField: 'refresh_token', title: t('storage.authBaidu'), description: t('storage.authOAuthNote'),
  }
  if (selectedDriver.value === 'AliyundriveOpen') return {
    provider: 'aliyun', targetField: 'refresh_token', title: t('storage.authAliyun'), description: t('storage.authOAuthNote'),
  }
  if (selectedDriver.value === '139Yun') return {
    provider: 'cmcc', targetField: 'authorization', title: '登录中国移动云盘', description: '在移动云盘官方页面登录，BMovie 会自动读取当前会话的授权字段',
  }
  return undefined
})

function needsInput(field: DriverField) {
  return field.required && field.type !== 'bool' && !String(field.default ?? '').trim()
}
function isCredential(field: DriverField) {
  return credentialPattern.test(field.name) && /required|one of/i.test(field.help || '')
}
const basicFields = computed(() => {
  if (!definition.value) return []
  return definition.value.common.filter((field) => field.name === 'mount_path')
})
const driverFields = computed(() => {
  if (!definition.value) return []
  const alternatives = new Set<string>()
  if (selectedDriver.value === '139Yun') ['authorization', 'username', 'password', 'mail_cookies'].forEach((name) => alternatives.add(name))
  else if (authConfig.value?.targetField) alternatives.add(authConfig.value.targetField)
  return definition.value.additional.filter((field) => !alternatives.has(field.name) && (needsInput(field) || isCredential(field)))
})
const advancedFields = computed(() => {
  if (!definition.value) return []
  const visible = new Set([...basicFields.value, ...driverFields.value].map((field) => field.name))
  const hidden = selectedDriver.value === '139Yun' ? new Set(['authorization', 'username', 'password', 'mail_cookies']) : new Set<string>()
  return [...definition.value.common, ...definition.value.additional].filter((field) => !visible.has(field.name) && !hidden.has(field.name))
})

function initialValue(field: DriverField): string | boolean {
  return field.type === 'bool' ? field.default === 'true' : field.default
}
function resetForm() {
  for (const key of Object.keys(form)) delete form[key]
  if (!definition.value) return
  for (const field of [...definition.value.common, ...definition.value.additional]) form[field.name] = initialValue(field)
  form.mount_path = form.mount_path || `/${driverLabel(selectedDriver.value).replace(/[（）/]/g, '')}`
  authSucceeded.value = false
}
watch(selectedDriver, resetForm)

async function load() {
  if (openlist.state !== 'ready') await openlist.start()
  if (openlist.state !== 'ready') return
  loading.value = true
  error.value = ''
  try {
    const [driverData, storageData] = await Promise.all([
      openListGet<Record<string, DriverDefinition>>(openlist.baseUrl, '/api/admin/driver/list', openlist.token),
      openListGet<{ content: StorageItem[] }>(openlist.baseUrl, '/api/admin/storage/list', openlist.token),
    ])
    drivers.value = driverData
    storages.value = storageData.content ?? []
    if (!selectedDriver.value) selectedDriver.value = driverNames.value[0] ?? ''
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { loading.value = false }
}

function typed(field: DriverField) {
  const value = form[field.name]
  if (field.type === 'bool') return Boolean(value)
  if (field.type === 'number' || field.type === 'float') return value === '' ? 0 : Number(value)
  return String(value ?? '')
}

async function createStorage() {
  if (!definition.value) return
  error.value = ''
  saving.value = true
  try {
    const common = Object.fromEntries(definition.value.common.map((field) => [field.name, typed(field)]))
    const addition = Object.fromEntries(definition.value.additional.map((field) => [field.name, typed(field)]))
    await openListRequest(openlist.baseUrl, '/api/admin/storage/create', {
      ...common,
      driver: selectedDriver.value,
      status: 'work',
      addition: JSON.stringify(addition),
    }, openlist.token)
    adding.value = false
    await load()
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { saving.value = false }
}

async function startCloudAuth() {
  if (!authConfig.value) return
  error.value = ''
  authSucceeded.value = false
  if (!Capacitor.isNativePlatform()) {
    error.value = t('storage.authAndroidOnly')
    return
  }
  authenticating.value = true
  try {
    const config = authConfig.value
    const result = await CloudAuth.login({ provider: config.provider })
    form[config.targetField] = result.credential
    if (config.targetField === 'refresh_token') form.use_online_api = true
    authSucceeded.value = true
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (!message.includes('已取消登录')) error.value = message
  } finally { authenticating.value = false }
}

async function removeStorage(item: StorageItem) {
  if (!confirm(t('storage.deleteConfirm', { path: item.mount_path }))) return
  try {
    await openListRequest(openlist.baseUrl, `/api/admin/storage/delete?id=${item.id}`, {}, openlist.token)
    await load()
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
}

onMounted(load)
</script>

<template>
  <section class="page storage-page">
    <header class="page-header">
      <div class="title-row"><button class="icon-button" aria-label="返回" @click="router.back()"><ArrowLeft :size="20" /></button><div><p class="eyebrow">OpenList</p><h1>{{ t('storage.title') }}</h1></div></div>
      <button v-if="!adding" class="primary-button" @click="adding = true"><Plus :size="17" />{{ t('storage.add') }}</button>
    </header>
    <p v-if="error" class="error-banner">{{ error }}</p>
    <div v-if="loading" class="empty-state"><div><LoaderCircle class="spin" /><p>{{ t('storage.loading') }}</p></div></div>
    <form v-else-if="adding" class="storage-form" @submit.prevent="createStorage">
      <div class="form-heading"><h2>{{ t('storage.addStorage') }}</h2><button type="button" class="icon-button" :aria-label="t('storage.cancel')" @click="adding = false"><X :size="18" /></button></div>
      <label class="field"><span>{{ t('storage.driver') }}</span><select v-model="selectedDriver"><option v-for="name in driverNames" :key="name" :value="name">{{ driverLabel(name) }}</option></select></label>
      <p v-if="definition?.config.alert" class="field-help">此存储类型有额外使用要求，请在填写前确认对应服务商的授权方式</p>
      <section v-if="authConfig" class="auth-panel">
        <span class="auth-mark"><ShieldCheck :size="21" /></span>
        <div><strong>{{ authConfig.title }}</strong><p>{{ authConfig.description }}</p><small v-if="authSucceeded"><Check :size="13" />{{ t('storage.authReady') }}</small></div>
        <button type="button" class="auth-button" :disabled="authenticating" @click="startCloudAuth">
          <LoaderCircle v-if="authenticating" class="spin" :size="16" /><LogIn v-else :size="16" />
          {{ authenticating ? t('storage.authorizing') : authSucceeded ? t('storage.reauthorize') : t('storage.authorize') }}
        </button>
      </section>
      <label v-for="field in basicFields" :key="`basic-${field.name}`" class="field">
        <span>{{ fieldLabel(field.name) }}</span>
        <input v-if="field.type === 'bool'" v-model="form[field.name]" type="checkbox" />
        <select v-else-if="field.type === 'select'" :value="String(form[field.name] ?? '')" @change="form[field.name] = ($event.target as HTMLSelectElement).value"><option v-for="option in field.options.split(',')" :key="option" :value="option">{{ optionLabel(option) }}</option></select>
        <textarea v-else-if="field.type === 'text'" :value="String(form[field.name] ?? '')" rows="3" @input="form[field.name] = ($event.target as HTMLTextAreaElement).value" />
        <input v-else v-model="form[field.name]" :type="field.type === 'number' || field.type === 'float' ? 'number' : /password|token|secret|cookie/i.test(field.name) ? 'password' : 'text'" />
        <small v-if="helpLabel(field.name, field.help)">{{ helpLabel(field.name, field.help) }}</small>
      </label>
      <h2 v-if="driverFields.length" class="driver-heading">{{ t('storage.advanced') }}</h2>
      <label v-for="field in driverFields" :key="`driver-${field.name}`" class="field">
        <span>{{ fieldLabel(field.name) }}</span>
        <input v-if="field.type === 'bool'" v-model="form[field.name]" type="checkbox" />
        <select v-else-if="field.type === 'select'" :value="String(form[field.name] ?? '')" @change="form[field.name] = ($event.target as HTMLSelectElement).value"><option v-for="option in field.options.split(',')" :key="option" :value="option">{{ optionLabel(option) }}</option></select>
        <textarea v-else-if="field.type === 'text'" :value="String(form[field.name] ?? '')" rows="3" @input="form[field.name] = ($event.target as HTMLTextAreaElement).value" />
        <input v-else v-model="form[field.name]" :type="field.type === 'number' || field.type === 'float' ? 'number' : /password|token|secret|cookie/i.test(field.name) ? 'password' : 'text'" />
        <small v-if="helpLabel(field.name, field.help)">{{ helpLabel(field.name, field.help) }}</small>
      </label>
      <details v-if="advancedFields.length" class="advanced-settings">
        <summary>高级设置 <small>{{ advancedFields.length }} 项</small></summary>
        <div class="advanced-content">
          <label v-for="field in advancedFields" :key="`advanced-${field.name}`" class="field">
            <span>{{ fieldLabel(field.name) }}</span>
            <input v-if="field.type === 'bool'" v-model="form[field.name]" type="checkbox" />
            <select v-else-if="field.type === 'select'" :value="String(form[field.name] ?? '')" @change="form[field.name] = ($event.target as HTMLSelectElement).value"><option v-for="option in field.options.split(',')" :key="option" :value="option">{{ optionLabel(option) }}</option></select>
            <textarea v-else-if="field.type === 'text'" :value="String(form[field.name] ?? '')" rows="3" @input="form[field.name] = ($event.target as HTMLTextAreaElement).value" />
            <input v-else v-model="form[field.name]" :type="field.type === 'number' || field.type === 'float' ? 'number' : /password|token|secret|cookie/i.test(field.name) ? 'password' : 'text'" />
            <small v-if="helpLabel(field.name, field.help)">{{ helpLabel(field.name, field.help) }}</small>
          </label>
        </div>
      </details>
      <button class="primary-button save" :disabled="saving"><Check :size="17" />{{ saving ? t('storage.saving') : t('storage.save') }}</button>
    </form>
    <div v-else-if="storages.length" class="storage-list">
      <article v-for="item in storages" :key="item.id" class="storage-card"><Cloud :size="22" /><div><strong>{{ item.mount_path }}</strong><small>{{ driverLabel(item.driver) }} · {{ statusLabel(item.disabled ? 'disabled' : item.status) }}</small></div><button class="delete" :aria-label="t('storage.delete')" @click="removeStorage(item)"><Trash2 :size="18" /></button></article>
    </div>
    <div v-else class="empty-state"><div><span class="empty-icon"><Cloud :size="24" /></span><h2>{{ t('storage.emptyTitle') }}</h2><p>{{ t('storage.emptyBody') }}</p><button class="primary-button" @click="adding = true"><Plus :size="17" />{{ t('storage.first') }}</button></div></div>
  </section>
</template>

<style scoped>
.title-row { display: flex; align-items: center; gap: 14px; }.title-row .icon-button { margin-top: 3px; }.error-banner { padding: 12px 14px; border: 1px solid rgba(255,113,109,.35); border-radius: 7px; color: var(--danger); background: rgba(255,113,109,.08); }.storage-form { max-width: 680px; }.form-heading { display: flex; align-items: center; justify-content: space-between; }.driver-heading { margin: 26px 0 16px; padding-top: 22px; border-top: 1px solid var(--line); }.field { display: grid; gap: 7px; margin-bottom: 16px; }.field > span { font-size: 13px; font-weight: 650; }.field input:not([type=checkbox]),.field select,.field textarea { width: 100%; padding: 12px; border: 1px solid var(--line); border-radius: 7px; color: var(--ink); background: var(--surface); }.field input[type=checkbox] { width: 22px; height: 22px; accent-color: var(--beam); }.field small,.field-help { color: var(--dim); font-size: 11px; line-height: 1.5; }.advanced-settings { margin: 24px 0 18px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }.advanced-settings summary { padding: 16px 2px; color: var(--ink); font-size: 14px; font-weight: 650; cursor: pointer; }.advanced-settings summary small { margin-left: 6px; color: var(--dim); font-weight: 400; }.advanced-content { padding-top: 8px; }.save { margin: 10px 0 30px; }.storage-list { display: grid; gap: 10px; }.storage-card { display: grid; grid-template-columns: 34px 1fr auto; align-items: center; padding: 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }.storage-card div { display: grid; gap: 4px; }.storage-card small { color: var(--muted); }.delete { display: grid; width: 40px; height: 40px; place-items: center; border: 0; color: var(--danger); background: transparent; }.spin { margin: 0 auto 12px; animation: spin 1s linear infinite; }@keyframes spin { to { transform: rotate(360deg); } }
.auth-panel{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:13px;margin:4px 0 18px;padding:15px;border:1px solid color-mix(in srgb,var(--beam) 35%,var(--line));border-radius:8px;background:color-mix(in srgb,var(--beam-soft) 55%,var(--surface))}.auth-mark{display:grid;width:38px;height:38px;place-items:center;border-radius:50%;color:var(--beam);background:var(--surface-raised)}.auth-panel>div{display:grid;min-width:0;gap:4px}.auth-panel strong{font-size:13px}.auth-panel p{margin:0;color:var(--dim);font-size:11px;line-height:1.5}.auth-panel small{display:flex;align-items:center;gap:4px;color:#82d9a5;font-size:11px}.auth-button{display:flex;align-items:center;justify-content:center;gap:7px;min-height:40px;padding:0 13px;border:1px solid var(--beam);border-radius:7px;color:var(--ink);background:var(--beam-soft);font-size:12px;font-weight:650}.auth-button:disabled{opacity:.6}.auth-button .spin{margin:0}@media(max-width:520px){.auth-panel{grid-template-columns:auto 1fr}.auth-button{grid-column:1/-1;width:100%}}
</style>
