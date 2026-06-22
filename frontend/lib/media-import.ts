import { backendFetch } from './backend'
import { isWebMode } from './web-mode'
import { logger } from './logger'

export interface ImportedMedia {
  path: string
  url: string
}

export async function importMediaFile(file: File, folder: string): Promise<ImportedMedia | null> {
  try {
    if (isWebMode()) {
      const formData = new FormData()
      formData.append('file', file, file.name)
      formData.append('folder', folder)
      const response = await backendFetch('/api/media/upload', { method: 'POST', body: formData })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({} as { error?: string }))
        throw new Error(payload.error || `Upload failed (${response.status})`)
      }
      return await response.json() as ImportedMedia
    }

    const result = await window.electronAPI.importMediaData(file.name, await file.arrayBuffer(), folder)
    if (!result.success || !result.path || !result.url) throw new Error(result.error || 'unknown error')
    return { path: result.path, url: result.url }
  } catch (error) {
    logger.error(`Failed to import media: ${error}`)
    return null
  }
}

export async function importMediaPath(sourcePath: string, folder: string): Promise<ImportedMedia | null> {
  if (!sourcePath || !window.electronAPI?.importMediaAsset) return null
  const result = await window.electronAPI.importMediaAsset(sourcePath, folder)
  if (!result.success || !result.path || !result.url) {
    logger.error(`Failed to import media: ${result.error || 'unknown error'}`)
    return null
  }
  return { path: result.path, url: result.url }
}
