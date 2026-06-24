import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, ArrowLeft, ExternalLink, Loader2, RefreshCw, Workflow } from 'lucide-react'
import { useProjects } from '../contexts/ProjectContext'
import { LtxLogo } from '../components/LtxLogo'
import { Button } from '../components/ui/button'
import { backendFetch } from '../lib/backend'
import { isWebMode } from '../lib/web-mode'

async function getComfyUIStatus(): Promise<ComfyUIStatus> {
  if (!isWebMode()) {
    return window.electronAPI.getComfyUIStatus()
  }
  const response = await backendFetch('/api/comfyui/status')
  if (!response.ok) {
    throw new Error(await response.text())
  }
  return await response.json() as ComfyUIStatus
}

async function startComfyUI(): Promise<ComfyUIStatus> {
  if (!isWebMode()) {
    return window.electronAPI.startComfyUI()
  }
  const response = await backendFetch('/api/comfyui/start', { method: 'POST' })
  if (!response.ok) {
    throw new Error(await response.text())
  }
  return await response.json() as ComfyUIStatus
}

export function ComfyUI() {
  const { goHome } = useProjects()
  const [status, setStatus] = useState<ComfyUIStatus | null>(null)
  const [isStarting, setIsStarting] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(async () => {
    setIsStarting(true)
    setError(null)
    try {
      const next = await startComfyUI()
      setStatus(next)
      if (next.state === 'error') {
        setError(next.error ?? 'ComfyUI failed to start.')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ComfyUI failed to start.'
      setError(message)
      const next = await getComfyUIStatus()
      setStatus(next)
    } finally {
      setIsStarting(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsStarting(true)
      setError(null)
      try {
        const initial = await getComfyUIStatus()
        if (!cancelled) setStatus(initial)

        const next = initial.state === 'running'
          ? initial
          : await startComfyUI()

        if (!cancelled) {
          setStatus(next)
          if (next.state === 'error') {
            setError(next.error ?? 'ComfyUI failed to start.')
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'ComfyUI failed to start.')
          const next = await getComfyUIStatus()
          setStatus(next)
        }
      } finally {
        if (!cancelled) setIsStarting(false)
      }
    }

    void load()
    const poll = window.setInterval(() => {
      void getComfyUIStatus().then((next) => {
        if (!cancelled) setStatus(next)
      })
    }, 2500)

    return () => {
      cancelled = true
      window.clearInterval(poll)
    }
  }, [])

  const isRunning = status?.state === 'running' && status.url

  return (
    <div className="h-screen bg-background flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-background">
        <div className="flex items-center gap-4 min-w-0">
          <button
            onClick={goHome}
            className="p-2 rounded-lg hover:bg-zinc-800 transition-colors"
            title="Back to Home"
          >
            <ArrowLeft className="h-5 w-5 text-zinc-400" />
          </button>
          <LtxLogo className="h-5 w-auto text-white" />
          <div className="flex items-center gap-2 min-w-0">
            <Workflow className="h-4 w-4 text-blue-300 flex-shrink-0" />
            <span className="text-white font-medium truncate">ComfyUI</span>
            {status?.port && (
              <span className="text-xs text-zinc-500 tabular-nums">:{status.port}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 pr-20">
          {isRunning && (
            <button
              onClick={() => window.open(status.url, '_blank', 'noopener,noreferrer')}
              className="h-8 w-8 flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              title="Open ComfyUI in browser"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => void start()}
            disabled={isStarting}
            className="h-8 w-8 flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
            title="Restart ComfyUI connection"
          >
            {isStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden bg-black">
        {isRunning ? (
          <iframe
            title="ComfyUI"
            src={status.url}
            className="h-full w-full border-0 bg-black"
            allow="clipboard-read; clipboard-write; fullscreen"
          />
        ) : (
          <div className="h-full flex items-center justify-center p-6 bg-background">
            <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-5">
              {error ? (
                <>
                  <AlertCircle className="h-8 w-8 text-red-400 mb-4" />
                  <h2 className="text-base font-semibold text-white">Could not start ComfyUI</h2>
                  <p className="mt-2 text-sm text-zinc-400 break-words">{error}</p>
                  <Button onClick={() => void start()} className="mt-5 bg-blue-600 hover:bg-blue-500">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Retry
                  </Button>
                </>
              ) : (
                <div className="flex items-center gap-3 text-zinc-200">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-300" />
                  <span className="text-sm">Starting ComfyUI...</span>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
