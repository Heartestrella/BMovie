import { Capacitor, registerPlugin } from '@capacitor/core'

export interface OpenListStatus {
  running: boolean
  baseUrl: string
}

export interface OpenListFile {
  name: string
  size: number
  is_dir: boolean
  modified: string
  sign?: string
  thumb?: string
  type?: number
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

interface OpenListPlugin {
  start(): Promise<OpenListStatus>
  stop(): Promise<OpenListStatus>
  getStatus(): Promise<OpenListStatus>
  setAdminPassword(options: { password: string }): Promise<void>
}

const OpenList = registerPlugin<OpenListPlugin>('OpenList')

export const isNativePlatform = () => Capacitor.isNativePlatform()

export async function openListRequest<T>(
  baseUrl: string,
  endpoint: string,
  body: Record<string, unknown>,
  token = '',
): Promise<T> {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
    },
    body: JSON.stringify(body),
  })
  const result = (await response.json()) as ApiResponse<T>
  if (!response.ok || result.code !== 200) {
    throw new Error(result.message || `OpenList 请求失败 (${response.status})`)
  }
  return result.data
}

export async function openListGet<T>(baseUrl: string, endpoint: string, token = ''): Promise<T> {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    headers: token ? { Authorization: token } : {},
  })
  const result = (await response.json()) as ApiResponse<T>
  if (!response.ok || result.code !== 200) {
    throw new Error(result.message || `OpenList 请求失败 (${response.status})`)
  }
  return result.data
}

export default OpenList
