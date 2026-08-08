import { Capacitor, registerPlugin } from '@capacitor/core'
import type { MediaWork } from '../stores/media'

interface NativeHttpApi {
  prefetchImage(options: { url: string }): Promise<void>
}

const NativeHttp = registerPlugin<NativeHttpApi>('NativeHttp')

const MAX_CONCURRENT = 4
const MAX_ASSETS_PER_SESSION = 320
const EPISODES_PER_WORK = 6
const CAST_PER_WORK = 8
const REQUEST_TIMEOUT = 20_000

const queue: string[] = []
const scheduled = new Set<string>()
const activeImages = new Map<string, HTMLImageElement>()
let activeCount = 0

export function prefetchDetailArtwork(works: MediaWork[]) {
  if (typeof Image === 'undefined' || !works.length || scheduled.size >= MAX_ASSETS_PER_SESSION) return

  const prioritized = [
    ...works.map((work) => work.backdrop),
    ...roundRobin(works, EPISODES_PER_WORK, (work, index) => work.items[index]?.episodeImage),
    ...roundRobin(works, CAST_PER_WORK, (work, index) => work.cast[index]?.image),
  ]

  for (const url of prioritized) {
    if (!url || scheduled.has(url) || scheduled.size >= MAX_ASSETS_PER_SESSION) continue
    scheduled.add(url)
    queue.push(url)
  }
  pump()
}

function roundRobin(works: MediaWork[], limit: number, select: (work: MediaWork, index: number) => string | undefined) {
  const urls: Array<string | undefined> = []
  for (let index = 0; index < limit; index += 1) {
    for (const work of works) urls.push(select(work, index))
  }
  return urls
}

function pump() {
  while (activeCount < MAX_CONCURRENT && queue.length) {
    const url = queue.shift()!
    activeCount += 1
    void prefetchUrl(url).finally(() => {
      activeCount -= 1
      pump()
    })
  }
}

async function prefetchUrl(url: string) {
  if (Capacitor.isNativePlatform() && /^https:\/\/images?\.tmdb\.org\//.test(url)) {
    await NativeHttp.prefetchImage({ url }).catch(() => undefined)
    return
  }
  await new Promise<void>((resolve) => {
    const image = new Image()
    activeImages.set(url, image)
    image.decoding = 'async'
    const finish = () => {
      window.clearTimeout(timeout)
      image.onload = null
      image.onerror = null
      activeImages.delete(url)
      resolve()
    }
    const timeout = window.setTimeout(finish, REQUEST_TIMEOUT)
    image.onload = finish
    image.onerror = finish
    image.src = url
  })
}
