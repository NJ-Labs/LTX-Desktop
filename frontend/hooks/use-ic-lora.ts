import { useCallback, useState } from 'react'
import { backendFetch } from '../lib/backend'
import { isGatewayTimeoutStatus, waitForGenerationTerminal } from '../lib/generation-poll'
import { logger } from '../lib/logger'
import { pathToBrowserUrl } from '../lib/web-mode'

export type IcLoraAdapterType = 'union' | 'ingredients'
export type IcLoraConditioningType = 'canny' | 'depth' | 'pose' | 'reference_sheet'

export interface IcLoraSubmitParams {
  videoPath: string
  adapterType: IcLoraAdapterType
  conditioningType: IcLoraConditioningType
  conditioningStrength: number
  anchorImagePath?: string | null
  prompt: string
}

export interface IcLoraResult {
  videoPath: string
  videoUrl: string
}

interface UseIcLoraState {
  isGenerating: boolean
  status: string
  error: string | null
  result: IcLoraResult | null
}

export function useIcLora() {
  const [state, setState] = useState<UseIcLoraState>({
    isGenerating: false,
    status: '',
    error: null,
    result: null,
  })

  const submitIcLora = useCallback(async (params: IcLoraSubmitParams) => {
    if (!params.videoPath || !params.prompt.trim()) return

    setState({
      isGenerating: true,
      status: 'Generating',
      error: null,
      result: null,
    })

    // Recover the result by polling progress when the (blocking) request can't
    // be awaited to completion — e.g. a reverse-proxy gateway timeout (504) on
    // a long generation. The backend keeps generating, so we wait it out.
    const recoverByPolling = async (): Promise<boolean> => {
      try {
        const terminal = await waitForGenerationTerminal(
          new AbortController().signal,
          () => {
            setState(prev => ({ ...prev, isGenerating: true, status: 'Generating' }))
          },
        )
        if (terminal.status === 'complete' && terminal.videoPath) {
          setState({
            isGenerating: false,
            status: 'Generation complete!',
            error: null,
            result: {
              videoPath: terminal.videoPath,
              videoUrl: pathToBrowserUrl(terminal.videoPath),
            },
          })
          return true
        }
        if (terminal.status === 'cancelled') {
          setState({ isGenerating: false, status: '', error: null, result: null })
          return true
        }
        if (terminal.status === 'error') {
          setState({ isGenerating: false, status: '', error: terminal.error || 'IC-LoRA failed', result: null })
          return true
        }
      } catch (pollError) {
        logger.error(`IC-LoRA polling fallback failed: ${(pollError as Error).message}`)
      }
      return false
    }

    try {
      let response: Response
      try {
        response = await backendFetch('/api/ic-lora/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            video_path: params.videoPath,
            adapter_type: params.adapterType,
            conditioning_type: params.conditioningType,
            conditioning_strength: params.conditioningStrength,
            attention_strength: 1.0,
            images: params.anchorImagePath
              ? [{ path: params.anchorImagePath, frame: 0, strength: 1.0 }]
              : [],
            prompt: params.prompt,
          }),
        })
      } catch (networkError) {
        if (await recoverByPolling()) return
        throw networkError
      }

      if (!response.ok && isGatewayTimeoutStatus(response.status)) {
        if (await recoverByPolling()) return
      }

      const data = await response.json()
      if (response.ok && data.status === 'complete' && data.video_path) {
        setState({
          isGenerating: false,
          status: 'Generation complete!',
          error: null,
          result: {
            videoPath: data.video_path,
            videoUrl: pathToBrowserUrl(data.video_path),
          },
        })
        return
      }

      const errorMsg = data.error || 'Unknown error'
      logger.error(`IC-LoRA failed: ${errorMsg}`)
      setState({
        isGenerating: false,
        status: '',
        error: errorMsg,
        result: null,
      })
    } catch (error) {
      const message = (error as Error).message || 'Unknown error'
      logger.error(`IC-LoRA error: ${message}`)
      setState({
        isGenerating: false,
        status: '',
        error: message,
        result: null,
      })
    }
  }, [])

  const reset = useCallback(() => {
    setState({
      isGenerating: false,
      status: '',
      error: null,
      result: null,
    })
  }, [])

  return {
    submitIcLora,
    resetIcLora: reset,
    isIcLoraGenerating: state.isGenerating,
    icLoraStatus: state.status,
    icLoraError: state.error,
    icLoraResult: state.result,
  }
}
