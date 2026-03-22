import { AlertCircle, CheckCircle2, CircleDashed, FolderSearch, TriangleAlert, X } from 'lucide-react'
import { Button } from './ui/button'
import type { ModelAvailabilityState } from '../hooks/use-model-availability'

interface ModelStatusDialogProps {
  isOpen: boolean
  state: ModelAvailabilityState
  onClose: () => void
  onOpenSettings: () => void
}

function StatusIcon({ level }: { level: ModelAvailabilityState['level'] }) {
  if (level === 'active') {
    return <CheckCircle2 className="h-5 w-5 text-emerald-400" />
  }
  if (level === 'partial') {
    return <TriangleAlert className="h-5 w-5 text-amber-400" />
  }
  return <AlertCircle className="h-5 w-5 text-red-400" />
}

function titleFor(level: ModelAvailabilityState['level']): string {
  if (level === 'active') return 'Models are active'
  if (level === 'partial') return 'Models are partially active'
  return 'Models are not active'
}

export function ModelStatusDialog({ isOpen, state, onClose, onOpenSettings }: ModelStatusDialogProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <StatusIcon level={state.level} />
            <div>
              <h3 className="text-base font-semibold">{titleFor(state.level)}</h3>
              <p className="mt-1 text-sm text-zinc-300">{state.summary}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
            aria-label="Close model status dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">Required models</span>
            <span className="font-medium text-zinc-100">
              {state.requiredDownloaded} / {state.requiredTotal}
            </span>
          </div>
          {state.modelsPath && (
            <div className="mt-3 flex items-start gap-2 text-sm text-zinc-300">
              <FolderSearch className="mt-0.5 h-4 w-4 flex-shrink-0 text-zinc-500" />
              <div>
                <div className="text-zinc-400">Models path</div>
                <div className="break-all text-zinc-200">{state.modelsPath}</div>
              </div>
            </div>
          )}
          {state.startupMessage && (
            <div className="mt-3 text-sm text-zinc-300">
              <span className="text-zinc-400">Startup status:</span> {state.startupMessage}
            </div>
          )}
        </div>

        {state.requiredModels.length > 0 && (
          <div className="mt-4">
            <div className="text-sm font-medium text-zinc-100">Required model inventory</div>
            <div className="mt-2 space-y-2">
              {state.requiredModels.map((model) => (
                <div key={model.id} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-zinc-100">{model.name}</div>
                      <div className="mt-1 text-xs text-zinc-400">Expected path</div>
                      <div className="break-all text-xs text-zinc-200">{model.relativePath || 'Unknown'}</div>
                      <div className="mt-2 text-xs text-zinc-400">Resolved path</div>
                      <div className="break-all text-xs text-zinc-200">{model.resolvedPath || state.modelsPath || 'Unknown'}</div>
                    </div>
                    <div
                      className={
                        model.downloaded
                          ? 'inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-300'
                          : 'inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-300'
                      }
                    >
                      {model.downloaded ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}
                      {model.downloaded ? 'Found' : 'Missing'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {state.missingRequired.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-100">
            Missing required models: {state.missingRequired.join(', ')}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Dismiss</Button>
          <Button onClick={onOpenSettings}>Open Settings</Button>
        </div>
      </div>
    </div>
  )
}