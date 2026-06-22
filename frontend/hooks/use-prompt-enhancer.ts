import { useCallback, useState } from 'react'
import { useAppSettings } from '../contexts/AppSettingsContext'
import { backendFetch } from '../lib/backend'
import { logger } from '../lib/logger'

export type EnhanceMode = 'video' | 'image'

interface ErrorResponse {
  error?: unknown
  message?: unknown
}

/**
 * Calls the backend prompt-enhancer endpoint, which forwards the prompt to the
 * user-configured OpenAI-compatible LLM and returns an enhanced prompt tuned for
 * either LTX 2.3 video generation or Z-Image-Turbo image generation.
 */
export function usePromptEnhancer() {
  const { settings } = useAppSettings()
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The local LLM lives behind the base URL; the API key is optional (many
  // local servers such as Ollama/LM Studio require none). "Configured" == a
  // base URL has been set, which is what drives the button's bright/available state.
  const isConfigured = settings.promptEnhancerBaseUrl.trim() !== ''

  const enhancePrompt = useCallback(
    async (prompt: string, mode: EnhanceMode, onDelta?: (text: string) => void): Promise<string | null> => {
      const trimmed = prompt.trim()
      if (!trimmed || isEnhancing) return null

      setIsEnhancing(true)
      setError(null)
      try {
        const response = await backendFetch('/api/prompt-enhancer/enhance/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: trimmed, mode }),
        })

        if (!response.ok) {
          let detail = `Request failed (${response.status})`
          try {
            const data = (await response.json()) as ErrorResponse
            if (typeof data.error === 'string') detail = data.error
            else if (typeof data.message === 'string') detail = data.message
          } catch {
            // Non-JSON error body; keep the status-based message.
          }
          throw new Error(detail)
        }

        if (!response.body) throw new Error('Streaming response is unavailable')
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let enhanced = ''
        while (true) {
          const { value, done } = await reader.read()
          buffer += decoder.decode(value, { stream: !done })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            const event = JSON.parse(line) as { delta?: unknown }
            if (typeof event.delta === 'string') {
              enhanced += event.delta
              onDelta?.(enhanced)
            }
          }
          if (done) break
        }
        enhanced = enhanced.trim()
        if (!enhanced) throw new Error('Empty response from prompt enhancer')
        return enhanced
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to enhance prompt'
        setError(message)
        logger.error(`Prompt enhancement failed: ${message}`)
        return null
      } finally {
        setIsEnhancing(false)
      }
    },
    [isEnhancing],
  )

  const clearError = useCallback(() => setError(null), [])

  return { isConfigured, isEnhancing, error, enhancePrompt, clearError }
}
