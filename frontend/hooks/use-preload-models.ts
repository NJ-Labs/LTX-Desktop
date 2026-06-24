import { useCallback, useState } from 'react'
import { backendFetch } from '../lib/backend'
import { logger } from '../lib/logger'

interface PreloadModelsState {
  preload: () => Promise<void>
  isPreloading: boolean
  error: string | null
}

/**
 * Triggers a manual model preload (load + warm pipelines into memory) via the
 * backend. Progress is reflected through the existing model-availability/readyz
 * polling, so callers only need this for the in-flight request state.
 */
export function usePreloadModels(): PreloadModelsState {
  const [isPreloading, setIsPreloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const preload = useCallback(async () => {
    setIsPreloading(true)
    setError(null)
    try {
      const response = await backendFetch('/api/models/preload', { method: 'POST' })
      if (!response.ok && response.status !== 409) {
        let message = `Preload request failed with status ${response.status}`
        try {
          const body = (await response.json()) as { error?: string }
          if (body.error) message = body.error
        } catch {
          // Ignore JSON parse failures and keep the status-based message.
        }
        throw new Error(message)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to start model preload.'
      logger.error(`Failed to start model preload: ${message}`)
      setError(message)
    } finally {
      setIsPreloading(false)
    }
  }, [])

  return { preload, isPreloading, error }
}
