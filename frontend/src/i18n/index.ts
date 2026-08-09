import { ref } from 'vue'
import { zhCN, driverNames, fieldHelp, fieldNames } from './zh-CN'
import { enUS } from './en-US'

export type AppLocale = 'zh-CN' | 'en-US'
export const currentLocale = ref<AppLocale>('zh-CN')
const localeMessages: Record<AppLocale, Record<string, unknown>> = { 'zh-CN': zhCN, 'en-US': enUS }

function lookup(source: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined, source)
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  const value = lookup(localeMessages[currentLocale.value], key) ?? lookup(zhCN, key)
  const text = typeof value === 'string' ? value : key
  return Object.entries(params).reduce((result, [name, replacement]) => result.replaceAll(`{${name}}`, String(replacement)), text)
}

export function driverLabel(name: string): string { return driverNames[name] ?? `其他存储（${name}）` }
export function fieldLabel(name: string): string { return fieldNames[name] ?? `自定义参数（${name}）` }
export function helpLabel(name: string, help = ''): string {
  if (fieldHelp[name]) return fieldHelp[name]
  if (/one of.+required/i.test(help)) return '以下授权方式任选其一填写即可'
  return help ? t('storage.customFieldHelp') : ''
}
export function optionLabel(value: string): string { return t(`option.${value || 'default'}`) === `option.${value || 'default'}` ? value || t('option.default') : t(`option.${value || 'default'}`) }
export function statusLabel(value: string): string { const label = t(`status.${value || 'unknown'}`); return label.startsWith('status.') ? t('status.unknown') : label }
