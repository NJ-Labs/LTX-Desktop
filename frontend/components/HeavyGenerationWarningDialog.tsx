import { AlertTriangle, X } from 'lucide-react'

interface HeavyGenerationWarningDialogProps {
  resolution: string
  duration: number
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirmation shown before extremely GPU-demanding local video generations
 * (high resolution + long duration). These can take many minutes and use a
 * large amount of VRAM, so the user is warned before committing the GPU.
 */
export function HeavyGenerationWarningDialog({
  resolution,
  duration,
  onConfirm,
  onCancel,
}: HeavyGenerationWarningDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[480px] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            <h2 className="text-base font-semibold text-zinc-100">High-demand generation</h2>
          </div>
          <button
            onClick={onCancel}
            aria-label="Cancel"
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-3">
          <p className="text-sm text-zinc-300 leading-relaxed">
            Generating a <span className="font-semibold text-zinc-100">{resolution}</span> video that is{' '}
            <span className="font-semibold text-zinc-100">{duration}s</span> long is extremely GPU-demanding.
            It can take several minutes and use a large amount of VRAM.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            If your GPU runs out of memory, try a lower resolution or a shorter duration. You can discard the
            generation at any time while it runs.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-zinc-800">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-amber-500 text-black hover:bg-amber-400 transition-colors"
          >
            Generate anyway
          </button>
        </div>
      </div>
    </div>
  )
}
