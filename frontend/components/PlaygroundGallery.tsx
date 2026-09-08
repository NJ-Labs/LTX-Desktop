import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Trash2, Download, Heart, Volume2, VolumeX, X,
  ChevronLeft, ChevronRight, Sparkles, Copy, Check, Music,
} from 'lucide-react'
import { useProjects } from '../contexts/ProjectContext'
import type { Asset } from '../types/project'

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

function PlaygroundCard({ asset, onPlay, onDelete, onToggleFavorite }: {
  asset: Asset
  onPlay: () => void
  onDelete: () => void
  onToggleFavorite: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [isMuted, setIsMuted] = useState(true)
  const isFavorite = asset.favorite || false

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (isHovered) {
      video.play().catch(() => {})
    } else {
      video.pause()
      video.currentTime = 0
      setCurrentTime(0)
    }
  }, [isHovered])

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    const a = document.createElement('a')
    a.href = asset.url
    a.download = asset.path.split('/').pop() || `video-${asset.id}`
    a.click()
  }

  return (
    <div
      className="relative group cursor-pointer rounded-xl overflow-hidden bg-zinc-900"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {asset.type === 'image' ? <img src={asset.url} alt={asset.prompt || 'Generated image'} className="w-full aspect-video object-contain" /> : asset.type === 'audio' ? <div className="w-full aspect-video flex items-center justify-center text-zinc-400"><Music className="h-10 w-10" aria-label="Audio" /></div> : <video
        ref={videoRef}
        src={asset.url}
        className="w-full aspect-video object-contain"
        muted={isMuted}
        loop
        preload="metadata"
        onTimeUpdate={() => videoRef.current && setCurrentTime(videoRef.current.currentTime)}
      />}

      <button
        type="button"
        aria-label={`Preview ${asset.type}: ${asset.prompt || 'Generated media'}`}
        onClick={onPlay}
        className="absolute inset-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-purple-400"
      />

      {/* Favorite heart - always visible when favorited */}
      {isFavorite && !isHovered && (
        <button
          tabIndex={-1}
          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={isFavorite}
          onClick={(e) => { e.stopPropagation(); onToggleFavorite() }}
          className="absolute top-2 left-2 p-1.5 rounded-lg bg-black/40 backdrop-blur-md text-white z-10 group-focus-within:hidden"
        >
          <Heart className="h-3.5 w-3.5 fill-current" />
        </button>
      )}

      {/* Hover overlay */}
      <div className={`absolute inset-0 pointer-events-none group-focus-within:opacity-100 bg-gradient-to-t from-black/60 via-transparent to-black/30 transition-opacity duration-200 ${
        isHovered ? 'opacity-100' : 'opacity-0'
      }`}>
        {/* Top buttons */}
        <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
          <button
            aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={isFavorite}
            onClick={(e) => { e.stopPropagation(); onToggleFavorite() }}
            className={`pointer-events-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-white p-1.5 rounded-lg backdrop-blur-md transition-colors ${
              isFavorite ? 'bg-white/20 text-white' : 'bg-black/40 text-white hover:bg-black/60'
            }`}
          >
            <Heart className={`h-3.5 w-3.5 ${isFavorite ? 'fill-current' : ''}`} />
          </button>
          <button
            aria-label="Download media"
            onClick={handleDownload}
            className="pointer-events-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-white p-1.5 rounded-lg bg-black/40 backdrop-blur-md text-white hover:bg-black/60 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Bottom controls */}
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
          {asset.type === 'video' ? <div className="flex items-center gap-1.5">
            <div className="px-2 py-1 rounded-lg bg-black/50 backdrop-blur-md text-white text-xs font-mono">
              {formatTime(currentTime)}
            </div>
            <button
              aria-label={isMuted ? 'Unmute preview' : 'Mute preview'}
              aria-pressed={!isMuted}
              onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted) }}
              className="pointer-events-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-white p-1.5 rounded-lg bg-black/40 backdrop-blur-md text-white hover:bg-black/60 transition-colors"
            >
              {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
          </div> : <span className="text-xs text-zinc-300">{asset.type === 'image' ? 'Image' : 'Audio'}</span>}
          <button
            aria-label="Delete media"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="pointer-events-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-white p-1.5 rounded-lg bg-black/40 backdrop-blur-md text-white/70 hover:bg-red-500/80 hover:text-white transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

export function PlaygroundGallery() {
  const { playgroundAssets, deletePlaygroundAsset, togglePlaygroundFavorite } = useProjects()
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const previewOpen = selectedAsset !== null
  const [copyError, setCopyError] = useState('')
  const [copiedPrompt, setCopiedPrompt] = useState(false)

  const selectedIndex = selectedAsset ? playgroundAssets.findIndex(a => a.id === selectedAsset.id) : -1
  const canGoPrev = selectedIndex > 0
  const canGoNext = selectedIndex >= 0 && selectedIndex < playgroundAssets.length - 1

  const goToPrev = useCallback(() => {
    if (canGoPrev) setSelectedAsset(playgroundAssets[selectedIndex - 1])
  }, [canGoPrev, playgroundAssets, selectedIndex])

  const goToNext = useCallback(() => {
    if (canGoNext) setSelectedAsset(playgroundAssets[selectedIndex + 1])
  }, [canGoNext, playgroundAssets, selectedIndex])

  // Keep the open preview in sync if its asset is deleted
  useEffect(() => {
    if (selectedAsset && selectedIndex === -1) setSelectedAsset(null)
  }, [selectedAsset, selectedIndex])

  useEffect(() => {
    if (!previewOpen) return
    const previous = document.activeElement as HTMLElement | null
    const preview = previewRef.current
    preview?.focus()
    const containFocus = (event: FocusEvent) => {
      if (preview && !preview.contains(event.target as Node)) preview.focus()
    }
    document.addEventListener('focusin', containFocus)
    return () => { document.removeEventListener('focusin', containFocus); previous?.focus() }
  }, [previewOpen])

  // Keyboard navigation for the preview modal
  useEffect(() => {
    if (!selectedAsset) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const controls = previewRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], video[controls], audio[controls], [tabindex="0"]')
        if (!controls?.length) { e.preventDefault(); return }
        const first = controls[0], last = controls[controls.length - 1]
        if (e.shiftKey && (document.activeElement === first || document.activeElement === previewRef.current)) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goToPrev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goToNext() }
      else if (e.key === 'Escape') setSelectedAsset(null)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectedAsset, goToPrev, goToNext])

  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-white">Playground</h2>
      </div>

      {playgroundAssets.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-zinc-800 rounded-xl">
          <Sparkles className="h-10 w-10 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-500">Videos you generate in the Playground will appear here</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {playgroundAssets.map(asset => (
            <PlaygroundCard
              key={asset.id}
              asset={asset}
              onPlay={() => setSelectedAsset(asset)}
              onDelete={() => deletePlaygroundAsset(asset.id)}
              onToggleFavorite={() => togglePlaygroundFavorite(asset.id)}
            />
          ))}
        </div>
      )}

      {/* Preview modal */}
      {selectedAsset && (
        <div
          ref={previewRef}
          role="dialog"
          aria-modal="true"
          aria-label="Media preview"
          tabIndex={-1}
          className="outline-none fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setSelectedAsset(null)}
        >
          {/* Previous button */}
          <button
            aria-label="Previous media"
            onClick={(e) => { e.stopPropagation(); goToPrev() }}
            disabled={!canGoPrev}
            className={`absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full backdrop-blur-md transition-all ${
              canGoPrev
                ? 'bg-white/10 text-white hover:bg-white/20 cursor-pointer'
                : 'bg-white/5 text-zinc-600 cursor-default'
            }`}
          >
            <ChevronLeft className="h-6 w-6" />
          </button>

          {/* Next button */}
          <button
            aria-label="Next media"
            onClick={(e) => { e.stopPropagation(); goToNext() }}
            disabled={!canGoNext}
            className={`absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full backdrop-blur-md transition-all ${
              canGoNext
                ? 'bg-white/10 text-white hover:bg-white/20 cursor-pointer'
                : 'bg-white/5 text-zinc-600 cursor-default'
            }`}
          >
            <ChevronRight className="h-6 w-6" />
          </button>

          {/* Content area */}
          <div className="relative max-w-5xl w-full max-h-full px-20 py-8" onClick={e => e.stopPropagation()}>
            {/* Top bar: counter + close */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-zinc-500 font-medium">
                {selectedIndex + 1} / {playgroundAssets.length}
              </span>
              <button
                aria-label="Close preview"
                onClick={() => setSelectedAsset(null)}
                className="p-2 rounded-md text-zinc-400 hover:text-white transition-colors"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {selectedAsset.type === 'image' ? <img src={selectedAsset.url} alt={selectedAsset.prompt || 'Generated image'} className="w-full object-contain max-h-[75vh]" /> : selectedAsset.type === 'audio' ? <audio src={selectedAsset.url} controls autoPlay className="w-full" /> : <video
              key={selectedAsset.id}
              src={selectedAsset.url}
              controls
              autoPlay
              className="w-full rounded-xl object-contain max-h-[75vh]"
            />}

            <div className="mt-4 text-center">
              {copyError && <p role="alert" className="text-sm text-red-300">{copyError}</p>}
              {selectedAsset.prompt && (
                <div className="inline-flex items-start gap-2 max-w-full">
                  <p className="text-zinc-300">{selectedAsset.prompt}</p>
                  <button
                    onClick={async () => {
                      setCopyError(''); setCopiedPrompt(false)
                      try { await navigator.clipboard.writeText(selectedAsset.prompt); setCopiedPrompt(true); setTimeout(() => setCopiedPrompt(false), 2000) }
                      catch { setCopyError('Could not copy the prompt. Select the text and copy it manually.') }
                    }}
                    className="shrink-0 p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                    aria-label={copiedPrompt ? 'Prompt copied' : 'Copy prompt'}
                    title="Copy prompt"
                  >
                    {copiedPrompt ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              )}
              {(selectedAsset.resolution || selectedAsset.duration) && (
                <p className="text-zinc-500 text-sm mt-1">
                  {[selectedAsset.resolution, selectedAsset.duration ? `${selectedAsset.duration}s` : null]
                    .filter(Boolean)
                    .join(' • ')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
