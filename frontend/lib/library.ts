import { backendFetch } from './backend'
import { logger } from './logger'

// Server-side project library used in web/self-hosted deployments where the
// renderer's localStorage is not a durable store. Mirrors the localStorage
// snapshot: the full project list plus Playground assets. Shapes are owned by
// the frontend; the backend stores them as opaque JSON.
export interface LibrarySnapshot {
  projects: unknown[]
  playgroundAssets: unknown[]
}

export async function loadLibrary(): Promise<LibrarySnapshot | null> {
  try {
    const res = await backendFetch('/api/library')
    if (!res.ok) {
      logger.warn(`Library load failed: HTTP ${res.status}`)
      return null
    }
    const data = await res.json()
    return {
      projects: Array.isArray(data?.projects) ? data.projects : [],
      playgroundAssets: Array.isArray(data?.playgroundAssets) ? data.playgroundAssets : [],
    }
  } catch (e) {
    logger.error(`Failed to load library: ${e}`)
    return null
  }
}

export async function saveLibrary(snapshot: LibrarySnapshot): Promise<void> {
  try {
    const res = await backendFetch('/api/library', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    })
    if (!res.ok) {
      logger.warn(`Library save failed: HTTP ${res.status}`)
    }
  } catch (e) {
    logger.error(`Failed to save library: ${e}`)
  }
}
