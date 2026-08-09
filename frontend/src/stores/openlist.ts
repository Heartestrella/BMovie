import { defineStore } from 'pinia'
import { ref } from 'vue'
import localforage from 'localforage'
import OpenList, { isNativePlatform, openListRequest } from '../services/openlist'

export type SidecarState = 'stopped' | 'starting' | 'ready' | 'error'

/** Owns the OpenList sidecar lifecycle and exposes its base URL to the rest of the app. */
export const useOpenListStore = defineStore('openlist', () => {
  const state = ref<SidecarState>('stopped')
  const baseUrl = ref('http://127.0.0.1:5244')
  const error = ref('')
  const token = ref('')
  let startRequest: Promise<void> | undefined

  async function login(password: string) {
    const data = await openListRequest<{ token: string }>(baseUrl.value, '/api/auth/login', {
      username: 'admin',
      password,
    })
    token.value = data.token
  }

  async function authenticate() {
    let password = await localforage.getItem<string>('openlist-admin-password')
    if (!password) {
      password = crypto.randomUUID().replaceAll('-', '')
      if (isNativePlatform()) {
        await OpenList.setAdminPassword({ password })
      }
      await localforage.setItem('openlist-admin-password', password)
    }
    try {
      await login(password)
    } catch (e) {
      // Existing installations may have been initialized before credentials were managed.
      if (!isNativePlatform()) throw e
      await OpenList.setAdminPassword({ password })
      await login(password)
    }
  }

  async function waitUntilReady(timeoutMs = 20_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${baseUrl.value}/ping`)
        if (res.ok) return true
      } catch {
        // Server not up yet; keep polling.
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    return false
  }

  function start() {
    if (state.value === 'ready') return Promise.resolve()
    if (startRequest) return startRequest
    error.value = ''
    state.value = 'starting'
    startRequest = (async () => {
      try {
        if (isNativePlatform()) {
          const status = await OpenList.start()
          baseUrl.value = status.baseUrl
        }
        if (!(await waitUntilReady())) throw new Error('服务启动超时')
        await authenticate()
        state.value = 'ready'
      } catch (e) {
        state.value = 'error'
        error.value = e instanceof Error ? e.message : String(e)
      } finally {
        startRequest = undefined
      }
    })()
    return startRequest
  }

  async function stop() {
    if (isNativePlatform()) await OpenList.stop()
    token.value = ''
    state.value = 'stopped'
  }

  return { state, baseUrl, token, error, start, stop }
})
