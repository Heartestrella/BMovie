import { Capacitor, registerPlugin } from '@capacitor/core'

interface NativeHttpResult { status: number; body: string }
interface NativeHttpApi { request(options: { url: string; method?: string; headers?: Record<string, string> }): Promise<NativeHttpResult> }
const NativeHttp = registerPlugin<NativeHttpApi>('NativeHttp')

const ORIGIN = 'https://www.btbtla.com'

export interface ResourceSearchResult {
  title: string
  summary: string
  url: string
  image?: string
}

export interface ResourceDetail {
  title: string
  description: string
  image?: string
  sourceUrl: string
  facts: Array<{ label: string; value: string }>
  tags: string[]
}

export function resourceSearchUrl(keyword: string) {
  return `${ORIGIN}/search/${encodeURIComponent(keyword.trim())}`
}

export async function searchResources(keyword: string): Promise<ResourceSearchResult[]> {
  const url = resourceSearchUrl(keyword)
  const response = await requestPage(url)
  if (response.status < 200 || response.status >= 300) throw new Error(`资源网站返回 ${response.status}`)
  return parseSearchPage(response.body, url)
}

export async function loadResourceDetail(rawUrl: string): Promise<ResourceDetail> {
  const url = normalizeResourceUrl(rawUrl, ORIGIN)
  if (!url || !/^\/detail\/\d+\.html$/i.test(url.pathname)) throw new Error('无效的资源详情地址')
  const response = await requestPage(url.href)
  if (response.status < 200 || response.status >= 300) throw new Error(`资源网站返回 ${response.status}`)
  return parseDetailPage(response.body, url.href)
}

async function requestPage(url: string) {
  return Capacitor.isNativePlatform()
    ? NativeHttp.request({ url, method: 'GET' })
    : webRequest(url)
}

async function webRequest(url: string): Promise<NativeHttpResult> {
  const response = await fetch(url, { headers: { Accept: 'text/html' } })
  return { status: response.status, body: await response.text() }
}

function parseSearchPage(html: string, pageUrl: string): ResourceSearchResult[] {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const candidates = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .map((anchor) => parseAnchor(anchor, pageUrl))
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.score - a.score)
  const unique = new Map<string, ResourceSearchResult>()
  for (const { score: _score, ...item } of candidates) {
    const key = new URL(item.url).pathname.replace(/\/$/, '')
    if (!unique.has(key)) unique.set(key, item)
    if (unique.size >= 40) break
  }
  return [...unique.values()]
}

function parseDetailPage(html: string, sourceUrl: string): ResourceDetail {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const title = clean(meta(document, 'og:title') || document.querySelector('h1')?.textContent || document.title).replace(/[-_|].*BT影视.*$/i, '')
  const description = clean(meta(document, 'og:description') || meta(document, 'description') || document.querySelector('.summary,.description,.content,.intro')?.textContent || '')
  const image = absoluteImage(meta(document, 'og:image') || document.querySelector<HTMLImageElement>('.poster img,.cover img,article img')?.src, sourceUrl)
  const facts = new Map<string, string>()
  for (const row of document.querySelectorAll('dl,table tr,.info li,.detail-info li,.movie-info li')) {
    const label = clean(row.querySelector('dt,th,.label,b,strong')?.textContent || '')
    const value = clean(row.querySelector('dd,td,.value,span')?.textContent || '')
    if (label && value && label !== value && !/下载|磁力|种子|网盘/i.test(label)) facts.set(label.replace(/[：:]$/, ''), value)
    if (facts.size >= 16) break
  }
  const tags = (meta(document, 'keywords') || '').split(/[,，/]/).map(clean).filter((item) => item && item !== title).slice(0, 12)
  if (!title) throw new Error('详情页缺少标题')
  return { title, description, image, sourceUrl, facts: [...facts].map(([label, value]) => ({ label, value })), tags }
}

function meta(document: Document, name: string) {
  return document.querySelector<HTMLMetaElement>(`meta[property="${name}"],meta[name="${name}"]`)?.content || ''
}

function parseAnchor(anchor: HTMLAnchorElement, pageUrl: string) {
  const url = normalizeResourceUrl(anchor.getAttribute('href') || '', pageUrl)
  if (!url) return null
  const path = url.pathname.replace(/\/$/, '')
  if (!/^\/detail\/\d+\.html$/i.test(path)) return null
  const container = anchor.closest('article,li,.item,.card,.search-item,.media,.module-item') ?? anchor.parentElement
  const title = clean(anchor.getAttribute('title') || anchor.textContent || anchor.querySelector('img')?.getAttribute('alt') || container?.querySelector('h1,h2,h3,h4,.title')?.textContent || '')
  if (title.length < 2 || title.length > 180) return null
  if (/^(?:首页|电影|电视剧|动漫|综艺|登录|注册|更多|下一页|上一页)$/u.test(title)) return null

  const summary = clean(container?.textContent || '').replace(title, '').trim().slice(0, 260)
  const imageElement = container?.querySelector<HTMLImageElement>('img') ?? anchor.querySelector<HTMLImageElement>('img')
  const image = absoluteImage(imageElement?.getAttribute('data-src') || imageElement?.getAttribute('data-original') || imageElement?.src, pageUrl)
  const segments = path.split('/').filter(Boolean).length
  const score = Math.min(title.length, 40) + segments * 8 + (summary.length > 12 ? 20 : 0) + (image ? 12 : 0) + (/\d{4}|GB|MB|1080|2160|4K|蓝光/i.test(summary) ? 12 : 0)
  return { title, summary, url: url.href, image, score }
}

function normalizeResourceUrl(value: string, base: string) {
  try {
    const url = new URL(value, base)
    if (url.protocol !== 'https:' || !['btbtla.com', 'www.btbtla.com'].includes(url.hostname)) return null
    url.hostname = 'www.btbtla.com'
    return url
  } catch { return null }
}

function absoluteImage(value: string | null | undefined, pageUrl: string) {
  if (!value || value.startsWith('data:')) return undefined
  try {
    const url = new URL(value, pageUrl)
    return url.protocol === 'https:' ? url.href : undefined
  } catch { return undefined }
}

function clean(value: string) {
  return value.replace(/\s+/g, ' ').replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
}
