import { useState, useEffect, useRef } from 'react'
import { X, Upload, Sparkles, Loader2, Trash2, Image as ImageIcon } from 'lucide-react'
import { Button } from './ui/button'
import type { GenerationSettings } from './SettingsPanel'
import { useGeneration } from '../hooks/use-generation'
import type { ProjectDetails } from '../types/project'
import { isWebMode } from '../lib/web-mode'

// Settings used when generating a project cover image from its description.
// Produces a 16:9 image to match the project card / landing aspect ratio.
const COVER_GENERATION_SETTINGS: GenerationSettings = {
  model: 'fast',
  duration: 5,
  videoResolution: '720p',
  fps: 24,
  audio: false,
  cameraMotion: 'none',
  imageResolution: '1080p',
  imageAspectRatio: '16:9',
  imageSteps: 4,
  variations: 1,
}

interface ProjectDetailsModalProps {
  mode: 'create' | 'edit'
  initialName?: string
  initialDescription?: string
  initialCoverImage?: string
  onClose: () => void
  onSubmit: (details: ProjectDetails) => void
}

export function ProjectDetailsModal({
  mode,
  initialName = '',
  initialDescription = '',
  initialCoverImage,
  onClose,
  onSubmit,
}: ProjectDetailsModalProps) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [coverImage, setCoverImage] = useState<string | undefined>(initialCoverImage)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const {
    generateImage,
    isGenerating,
    progress,
    statusMessage,
    imageUrl: generatedImageUrl,
    error: generationError,
  } = useGeneration()

  // When a cover is generated, use it as the project cover.
  useEffect(() => {
    if (generatedImageUrl) {
      setCoverImage(generatedImageUrl)
    }
  }, [generatedImageUrl])

  const trimmedName = name.trim()
  const trimmedDescription = description.trim()
  const canSubmit = trimmedName.length > 0 && !isGenerating
  const canGenerateCover = trimmedDescription.length > 0 && !isGenerating

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type.startsWith('image/')) {
      // In Electron, File objects expose a .path with the full filesystem path.
      const filePath = (file as { path?: string }).path
      if (filePath) {
        const normalized = filePath.replace(/\\/g, '/')
        setCoverImage(normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`)
      } else if (isWebMode()) {
        // Web/self-hosted: a blob: URL is per-session and would not survive a
        // page reload or container restart. Embed the image as a data URL so it
        // persists inside the project library JSON.
        const reader = new FileReader()
        reader.onload = () => {
          if (typeof reader.result === 'string') setCoverImage(reader.result)
        }
        reader.readAsDataURL(file)
      } else {
        setCoverImage(URL.createObjectURL(file))
      }
    }
    // Allow selecting the same file again later
    e.target.value = ''
  }

  const handleGenerateCover = () => {
    if (!canGenerateCover) return
    void generateImage(trimmedDescription, COVER_GENERATION_SETTINGS)
  }

  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit({
      name: trimmedName,
      description: trimmedDescription || undefined,
      coverImage,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-md border border-zinc-800 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">
            {mode === 'create' ? 'Create New Project' : 'Edit Project'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Name */}
        <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          Project name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project name"
          className="w-full px-4 py-3 rounded-lg bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
          autoFocus
        />

        {/* Description */}
        <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mt-5 mb-2">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe your project. Used to generate a cover image."
          rows={3}
          className="w-full px-4 py-3 rounded-lg bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 resize-none"
        />

        {/* Cover image */}
        <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mt-5 mb-2">
          Cover image
        </label>
        <div className="rounded-lg border border-zinc-700 bg-zinc-800 overflow-hidden">
          <div className="aspect-video bg-zinc-950 flex items-center justify-center relative">
            {coverImage ? (
              <>
                <img src={coverImage} alt="Project cover" className="w-full h-full object-cover" />
                <button
                  onClick={() => setCoverImage(undefined)}
                  className="absolute top-2 right-2 p-1.5 rounded-md bg-black/60 text-white hover:bg-red-500/80 transition-colors"
                  aria-label="Remove cover image"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            ) : isGenerating ? (
              <div className="flex flex-col items-center gap-2 text-zinc-400">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-xs">{statusMessage || 'Generating cover...'}</span>
                {progress > 0 && (
                  <div className="w-32 h-1 rounded-full bg-zinc-700 overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1 text-zinc-600">
                <ImageIcon className="h-8 w-8" />
                <span className="text-xs">No cover image</span>
              </div>
            )}
          </div>

          <div className="flex gap-2 p-2 border-t border-zinc-700/60">
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isGenerating}
              className="flex-1 border-zinc-700 text-xs h-8"
            >
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Upload
            </Button>
            <Button
              variant="outline"
              onClick={handleGenerateCover}
              disabled={!canGenerateCover}
              title={trimmedDescription ? 'Generate a cover from the description' : 'Add a description to generate a cover'}
              className="flex-1 border-zinc-700 text-xs h-8"
            >
              {isGenerating ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              )}
              Generate
            </Button>
          </div>
        </div>
        {!trimmedDescription && (
          <p className="text-xs text-zinc-500 mt-1.5">
            Add a description to generate a cover image.
          </p>
        )}
        {generationError && (
          <p className="text-xs text-red-400 mt-1.5">{generationError}</p>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <Button variant="outline" onClick={onClose} className="flex-1 border-zinc-700">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex-1 bg-blue-600 hover:bg-blue-500"
          >
            {mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}
