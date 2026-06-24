import { useCallback, useState } from 'react'
import { backendFetch } from '../lib/backend'
import { isGatewayTimeoutStatus, waitForGenerationTerminal } from '../lib/generation-poll'
import { logger } from '../lib/logger'
import { pathToBrowserUrl } from '../lib/web-mode'

export type RetakeMode = 'replace_audio_and_video' | 'replace_video' | 'replace_audio'

export interface RetakeSubmitParams {
  videoPath: string
  startTime: number
  duration: number
  prompt: string
  mode: RetakeMode
}

export interface RetakeResult {
  videoPath: string
  videoUrl: string
}

interface UseRetakeState {
  isRetaking: boolean
  retakeStatus: string
  retakeError: string | null
  result: RetakeResult | null
}

export function useRetake() {
  const [state, setState] = useState<UseRetakeState>({
    isRetaking: false,
    retakeStatus: '',
    retakeError: null,
    result: null,
  })

  const submitRetake = useCallback(async (params: RetakeSubmitParams) => {
    if (!params.videoPath) return

    setState({
      isRetaking: true,
      retakeStatus: 'Generating',
      retakeError: null,
      result: null,
    })

    // Recover the result by polling progress when the (blocking) request can't
    // be awaited to completion — e.g. a reverse-proxy gateway timeout (504) on
    // a long retake. The backend keeps generating, so we wait it out.
    const recoverByPolling = async (): Promise<boolean> => {
      try {
        const terminal = await waitForGenerationTerminal(
          new AbortController().signal,
          () => {
            setState(prev => ({ ...prev, isRetaking: true, retakeStatus: 'Generating' }))
          },
        )
        if (terminal.status === 'complete' && terminal.videoPath) {
          setState({
            isRetaking: false,
            retakeStatus: 'Retake complete!',
            retakeError: null,
            result: {
              videoPath: terminal.videoPath,
              videoUrl: pathToBrowserUrl(terminal.videoPath),
            },
          })
          return true
        }
        if (terminal.status === 'cancelled') {
          setState({ isRetaking: false, retakeStatus: '', retakeError: null, result: null })
          return true
        }
        if (terminal.status === 'error') {
          setState({ isRetaking: false, retakeStatus: '', retakeError: terminal.error || 'Retake failed', result: null })
          return true
        }
      } catch (pollError) {
        logger.error(`Retake polling fallback failed: ${(pollError as Error).message}`)
      }
      return false
    }

    try {
      let response: Response
      try {
        response = await backendFetch('/api/retake', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            video_path: params.videoPath,
            start_time: params.startTime,
            duration: params.duration,
            prompt: params.prompt,
            mode: params.mode,
          }),
        })
      } catch (networkError) {
        // The connection dropped (proxy/gateway) — the backend may still be
        // generating. Try to recover the outcome by polling.
        if (await recoverByPolling()) return
        throw networkError
      }

      if (!response.ok && isGatewayTimeoutStatus(response.status)) {
        if (await recoverByPolling()) return
      }

      const data = await response.json()

      if (response.ok && data.status === 'complete' && data.video_path) {
        setState({
          isRetaking: false,
          retakeStatus: 'Retake complete!',
          retakeError: null,
          result: {
            videoPath: data.video_path,
            videoUrl: pathToBrowserUrl(data.video_path),
          },
        })
        return
      }

      const errorMsg = data.error || 'Unknown error'
      setState({
        isRetaking: false,
        retakeStatus: '',
        retakeError: errorMsg,
        result: null,
      })
      logger.error(`Retake failed: ${errorMsg}`)
    } catch (error) {
      const message = (error as Error).message || 'Unknown error'
      logger.error(`Retake error: ${message}`)
      setState({
        isRetaking: false,
        retakeStatus: '',
        retakeError: message,
        result: null,
      })
    }
  }, [])

  const resetRetake = useCallback(() => {
    setState({
      isRetaking: false,
      retakeStatus: '',
      retakeError: null,
      result: null,
    })
  }, [])

  return {
    submitRetake,
    resetRetake,
    isRetaking: state.isRetaking,
    retakeStatus: state.retakeStatus,
    retakeError: state.retakeError,
    retakeResult: state.result,
  }
}
