import { getAuthToken, getBackendUrl } from './python-backend'

export interface ComfyUIStatus {
  state: 'stopped' | 'starting' | 'running' | 'error'
  url?: string
  port?: number
  error?: string
  ltxDataPath: string
  ltxModelsPath: string
  inputPath: string
  outputPath: string
  userPath: string
}

async function requestStatus(action: 'status' | 'start' | 'stop'): Promise<ComfyUIStatus> {
  const backend = getBackendUrl()
  if (!backend) throw new Error('Start the LTX backend before connecting to ComfyUI.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), action === 'start' ? 330_000 : 10_000)
  try {
    const token = getAuthToken()
    const response = await fetch(`${backend}/api/comfyui/${action}`, {
      method: action === 'status' ? 'GET' : 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`ComfyUI ${action} failed: ${await response.text()}`)
    return await response.json() as ComfyUIStatus
  } finally {
    clearTimeout(timeout)
  }
}

export function getComfyUIStatus(): Promise<ComfyUIStatus> {
  return requestStatus('status')
}

export function startComfyUI(): Promise<ComfyUIStatus> {
  return requestStatus('start')
}

export async function stopComfyUI(): Promise<void> {
  if (!getBackendUrl()) return
  try { await requestStatus('stop') }
  catch (error) { console.warn('Could not stop ComfyUI before backend shutdown:', error) }
}
