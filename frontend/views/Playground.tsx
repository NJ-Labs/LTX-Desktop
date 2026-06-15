import { useState, useRef, useEffect } from 'react'
import { Sparkles, Trash2, Square, ImageIcon, ArrowLeft, Scissors } from 'lucide-react'
import { logger } from '../lib/logger'
import { ImageUploader } from '../components/ImageUploader'
import { AudioUploader } from '../components/AudioUploader'
import { VideoPlayer } from '../components/VideoPlayer'
import { ImageResult } from '../components/ImageResult'
import { SettingsPanel, type GenerationSettings } from '../components/SettingsPanel'
import { ModeTabs, type GenerationMode } from '../components/ModeTabs'
import { LtxLogo } from '../components/LtxLogo'
import { ModelStatusDropdown } from '../components/ModelStatusDropdown'
import { Textarea } from '../components/ui/textarea'
import { Button } from '../components/ui/button'
import { useGeneration } from '../hooks/use-generation'
import { useRetake } from '../hooks/use-retake'
import { useIcLora } from '../hooks/use-ic-lora'
import { useBackend } from '../hooks/use-backend'
import { useProjects, PLAYGROUND_ASSET_FOLDER } from '../contexts/ProjectContext'
import { useAppSettings } from '../contexts/AppSettingsContext'
import { fileUrlToPath } from '../lib/url-to-path'
import { copyToAssetFolder } from '../lib/asset-copy'
import { sanitizeForcedApiVideoSettings } from '../lib/api-video-options'
import { RetakePanel } from '../components/RetakePanel'
import { ICLoraPanel, CONDITIONING_TYPES, type ICLoraConditioningType } from '../components/ICLoraPanel'
import { Tooltip } from '../components/ui/tooltip'
import { EnhanceIcon } from '../components/EnhanceIcon'
import { usePromptEnhancer } from '../hooks/use-prompt-enhancer'

const DEFAULT_SETTINGS: GenerationSettings = {
  model: 'fast',
  duration: 5,
  videoResolution: '540p',
  fps: 24,
  audio: true,
  cameraMotion: 'none',
  aspectRatio: '16:9',
  // Image settings
  imageResolution: '1080p',
  imageAspectRatio: '16:9',
  imageSteps: 4,
}

export function Playground() {
  const { goHome, addPlaygroundAsset } = useProjects()
  const { forceApiGenerations, shouldVideoGenerateWithLtxApi } = useAppSettings()
  const [mode, setMode] = useState<GenerationMode>('text-to-video')
  const [prompt, setPrompt] = useState('')
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [selectedAudio, setSelectedAudio] = useState<string | null>(null)
  const [settings, setSettings] = useState<GenerationSettings>(() => ({ ...DEFAULT_SETTINGS }))

  const { status, processStatus } = useBackend()

  useEffect(() => {
    if (!shouldVideoGenerateWithLtxApi || mode === 'text-to-image') return
    setSettings((prev) => sanitizeForcedApiVideoSettings({ ...prev, model: 'fast' }))
  }, [mode, shouldVideoGenerateWithLtxApi])

  useEffect(() => {
    if (forceApiGenerations && mode === 'ic-lora') {
      setMode('text-to-video')
    }
  }, [forceApiGenerations, mode])

  // Force pro model + resolution when audio is attached (A2V only supports pro @ 1080p 16:9)
  useEffect(() => {
    if (selectedAudio && mode !== 'text-to-image') {
      setSettings(prev => {
        if (shouldVideoGenerateWithLtxApi) {
          return sanitizeForcedApiVideoSettings({ ...prev, model: 'pro' }, { hasAudio: true })
        }
        return prev.model !== 'pro' ? { ...prev, model: 'pro' } : prev
      })
    }
  }, [mode, selectedAudio, shouldVideoGenerateWithLtxApi]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle mode change
  const handleModeChange = (newMode: GenerationMode) => {
    setMode(newMode)
  }
  const { 
    isGenerating, 
    progress, 
    statusMessage, 
    videoUrl,
    videoPath,
    imageUrl, 
    error: generationError,
    generate,
    generateImage,
    cancel,
    reset,
  } = useGeneration()

  const {
    isConfigured: promptEnhancerConfigured,
    isEnhancing: isEnhancingPrompt,
    enhancePrompt,
  } = usePromptEnhancer()

  const handleEnhancePrompt = async () => {
    if (!promptEnhancerConfigured) {
      window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'promptEnhancer' } }))
      return
    }
    if (!prompt.trim() || isEnhancingPrompt) return
    const enhanced = await enhancePrompt(prompt, mode === 'text-to-image' ? 'image' : 'video')
    if (enhanced) setPrompt(enhanced)
  }

  const {
    submitRetake,
    resetRetake,
    isRetaking,
    retakeStatus,
    retakeError,
    retakeResult,
  } = useRetake()

  const {
    submitIcLora,
    resetIcLora,
    isIcLoraGenerating,
    icLoraStatus,
    icLoraError,
    icLoraResult,
  } = useIcLora()

  const [retakeInput, setRetakeInput] = useState({
    videoUrl: null as string | null,
    videoPath: null as string | null,
    startTime: 0,
    duration: 0,
    videoDuration: 0,
    ready: false,
  })
  const [retakePanelKey, setRetakePanelKey] = useState(0)
  const [icLoraInput, setIcLoraInput] = useState({
    videoUrl: null as string | null,
    videoPath: null as string | null,
    conditioningType: 'canny' as 'canny' | 'depth',
    conditioningStrength: 1.0,
    ready: false,
  })
  const [icLoraPanelKey, setIcLoraPanelKey] = useState(0)
  const [icLoraCondType, setIcLoraCondType] = useState<ICLoraConditioningType>('canny')
  const [icLoraStrength, setIcLoraStrength] = useState(1.0)

  // Ref to store generated image URL for "Create video" flow
  const generatedImageRef = useRef<string | null>(null)

  // Persist completed Playground generations to the global Playground gallery (Home)
  const [lastPrompt, setLastPrompt] = useState('')
  const persistedVideoKeyRef = useRef<string | null>(null)
  const persistedRetakeKeyRef = useRef<string | null>(null)
  const persistedIcLoraKeyRef = useRef<string | null>(null)
  const videoSubmissionRef = useRef<{
    mode: 'text-to-video' | 'image-to-video' | 'audio-to-video'
    settings: GenerationSettings
    inputImageUrl?: string
    inputAudioUrl?: string
  } | null>(null)
  const retakeSubmissionRef = useRef<{ prompt: string; startTime: number; duration: number } | null>(null)
  const icLoraSubmissionRef = useRef<{ prompt: string; conditioningType: ICLoraConditioningType; conditioningStrength: number } | null>(null)

  const handleGenerate = () => {
    if (mode === 'ic-lora') {
      if (!icLoraInput.videoPath || !icLoraInput.ready || !prompt.trim()) return
      icLoraSubmissionRef.current = {
        prompt,
        conditioningType: icLoraCondType,
        conditioningStrength: icLoraStrength,
      }
      submitIcLora({
        videoPath: icLoraInput.videoPath,
        conditioningType: icLoraCondType,
        conditioningStrength: icLoraStrength,
        prompt,
      })
      return
    }

    if (mode === 'retake') {
      if (!retakeInput.videoPath || retakeInput.duration < 2) return
      retakeSubmissionRef.current = {
        prompt,
        startTime: retakeInput.startTime,
        duration: retakeInput.duration,
      }
      submitRetake({
        videoPath: retakeInput.videoPath,
        startTime: retakeInput.startTime,
        duration: retakeInput.duration,
        prompt,
        mode: 'replace_audio_and_video',
      })
      return
    }

    if (mode === 'text-to-image') {
      if (!prompt.trim()) return
      // Text-to-image behavior remains tied to raw forceApiGenerations in useGeneration.
      generateImage(prompt, settings)
    } else {
      const effectiveVideoSettings = shouldVideoGenerateWithLtxApi
        ? sanitizeForcedApiVideoSettings(settings)
        : settings
      // Auto-detect: if image is loaded → I2V, otherwise → T2V
      if (!prompt.trim()) return
      const imagePath = selectedImage ? fileUrlToPath(selectedImage) : null
      const audioPath = selectedAudio ? fileUrlToPath(selectedAudio) : null
      if (audioPath) effectiveVideoSettings.model = 'pro'
      setLastPrompt(prompt)
      videoSubmissionRef.current = {
        mode: audioPath ? 'audio-to-video' : imagePath ? 'image-to-video' : 'text-to-video',
        settings: effectiveVideoSettings,
        inputImageUrl: selectedImage || undefined,
        inputAudioUrl: selectedAudio || undefined,
      }
      generate(prompt, imagePath, effectiveVideoSettings, audioPath)
    }
  }
  
  // Handle "Create video" from generated image
  const handleCreateVideoFromImage = () => {
    if (!imageUrl) {
      logger.error('No image URL available')
      return
    }

    // imageUrl is already a file:// URL — just pass it as the selected image path
    setSelectedImage(imageUrl)
    setMode('image-to-video')
    generatedImageRef.current = imageUrl
  }

  const handleClearAll = () => {
    setPrompt('')
    setSelectedImage(null)
    setSelectedAudio(null)
    const baseDefaults = { ...DEFAULT_SETTINGS }
    const shouldSanitizeVideoSettings = shouldVideoGenerateWithLtxApi && mode !== 'text-to-image'
    setSettings(shouldSanitizeVideoSettings ? sanitizeForcedApiVideoSettings(baseDefaults) : baseDefaults)
    if (mode !== 'text-to-image') setMode('text-to-video')
    setRetakeInput({
      videoUrl: null,
      videoPath: null,
      startTime: 0,
      duration: 0,
      videoDuration: 0,
      ready: false,
    })
    setRetakePanelKey((prev) => prev + 1)
    setIcLoraInput({
      videoUrl: null,
      videoPath: null,
      conditioningType: 'canny',
      conditioningStrength: 1.0,
      ready: false,
    })
    setIcLoraPanelKey((prev) => prev + 1)
    setIcLoraCondType('canny')
    setIcLoraStrength(1.0)
    resetRetake()
    resetIcLora()
    reset()
  }

  // Persist completed video generations (T2V/I2V/A2V) to the Playground gallery
  useEffect(() => {
    if (!videoUrl || !videoPath || isGenerating) return
    const submission = videoSubmissionRef.current
    if (!submission) return
    const key = `${videoUrl}|${videoPath}`
    if (persistedVideoKeyRef.current === key) return
    persistedVideoKeyRef.current = key
    const promptUsed = lastPrompt
    const s = submission.settings
    void (async () => {
      try {
        const copied = await copyToAssetFolder(videoPath, PLAYGROUND_ASSET_FOLDER)
        const finalPath = copied?.path ?? videoPath
        const finalUrl = copied?.url ?? videoUrl
        addPlaygroundAsset({
          type: 'video',
          path: finalPath,
          url: finalUrl,
          prompt: promptUsed,
          resolution: s.videoResolution,
          duration: s.duration,
          generationParams: {
            mode: submission.mode,
            prompt: promptUsed,
            model: s.model,
            duration: s.duration,
            resolution: s.videoResolution,
            fps: s.fps,
            audio: s.audio || false,
            cameraMotion: 'none',
            imageAspectRatio: s.aspectRatio,
            imageSteps: 4,
            inputImageUrl: submission.inputImageUrl,
            inputAudioUrl: submission.inputAudioUrl,
          },
          takes: [{ url: finalUrl, path: finalPath, createdAt: Date.now() }],
          activeTakeIndex: 0,
        })
      } catch (err) {
        persistedVideoKeyRef.current = null
        logger.error(`Failed to persist Playground video: ${err}`)
      }
    })()
  }, [videoUrl, videoPath, isGenerating, lastPrompt, addPlaygroundAsset])

  // Persist completed Retake generations to the Playground gallery
  useEffect(() => {
    if (!retakeResult || isRetaking) return
    const key = `${retakeResult.videoUrl}|${retakeResult.videoPath}`
    if (persistedRetakeKeyRef.current === key) return
    persistedRetakeKeyRef.current = key
    const submission = retakeSubmissionRef.current
    const resultVideoPath = retakeResult.videoPath
    const resultVideoUrl = retakeResult.videoUrl
    void (async () => {
      try {
        const copied = await copyToAssetFolder(resultVideoPath, PLAYGROUND_ASSET_FOLDER)
        const finalPath = copied?.path ?? resultVideoPath
        const finalUrl = copied?.url ?? resultVideoUrl
        addPlaygroundAsset({
          type: 'video',
          path: finalPath,
          url: finalUrl,
          prompt: submission?.prompt ?? '',
          resolution: '',
          duration: submission?.duration,
          generationParams: {
            mode: 'retake',
            prompt: submission?.prompt ?? '',
            model: 'pro',
            duration: submission?.duration ?? 0,
            resolution: '',
            fps: 24,
            audio: true,
            cameraMotion: 'none',
            retakeStartTime: submission?.startTime,
            retakeDuration: submission?.duration,
            retakeMode: 'replace_audio_and_video',
          },
          takes: [{ url: finalUrl, path: finalPath, createdAt: Date.now() }],
          activeTakeIndex: 0,
        })
      } catch (err) {
        persistedRetakeKeyRef.current = null
        logger.error(`Failed to persist Playground retake video: ${err}`)
      }
    })()
  }, [retakeResult, isRetaking, addPlaygroundAsset])

  // Persist completed IC-LoRA generations to the Playground gallery
  useEffect(() => {
    if (!icLoraResult || isIcLoraGenerating) return
    const key = `${icLoraResult.videoUrl}|${icLoraResult.videoPath}`
    if (persistedIcLoraKeyRef.current === key) return
    persistedIcLoraKeyRef.current = key
    const submission = icLoraSubmissionRef.current
    const resultVideoPath = icLoraResult.videoPath
    const resultVideoUrl = icLoraResult.videoUrl
    void (async () => {
      try {
        const copied = await copyToAssetFolder(resultVideoPath, PLAYGROUND_ASSET_FOLDER)
        const finalPath = copied?.path ?? resultVideoPath
        const finalUrl = copied?.url ?? resultVideoUrl
        addPlaygroundAsset({
          type: 'video',
          path: finalPath,
          url: finalUrl,
          prompt: submission?.prompt ?? '',
          resolution: '',
          generationParams: {
            mode: 'ic-lora',
            prompt: submission?.prompt ?? '',
            model: 'pro',
            duration: 0,
            resolution: '',
            fps: 24,
            audio: false,
            cameraMotion: 'none',
            icLoraConditioningType: submission?.conditioningType,
            icLoraConditioningStrength: submission?.conditioningStrength,
          },
          takes: [{ url: finalUrl, path: finalPath, createdAt: Date.now() }],
          activeTakeIndex: 0,
        })
      } catch (err) {
        persistedIcLoraKeyRef.current = null
        logger.error(`Failed to persist Playground IC-LoRA video: ${err}`)
      }
    })()
  }, [icLoraResult, isIcLoraGenerating, addPlaygroundAsset])

  const isRetakeMode = mode === 'retake'
  const isIcLoraMode = mode === 'ic-lora'
  const isVideoMode = mode === 'text-to-video' || mode === 'image-to-video'
  const isBusy = isRetakeMode ? isRetaking : isIcLoraMode ? isIcLoraGenerating : isGenerating
  const canGenerate = processStatus === 'alive' && !isBusy && (
    isRetakeMode
      ? retakeInput.ready && !!retakeInput.videoPath
      : isIcLoraMode
        ? icLoraInput.ready && !!icLoraInput.videoPath && !!prompt.trim()
        : !!prompt.trim()
  )

  return (
    <div className="h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-4">
          <button 
            onClick={goHome}
            className="p-2 rounded-lg hover:bg-zinc-800 transition-colors"
            title="Back to Home"
          >
            <ArrowLeft className="h-5 w-5 text-zinc-400" />
          </button>
          <div className="flex items-center gap-2.5">
            <LtxLogo className="h-6 w-auto text-white" />
            <span className="text-zinc-400 text-base font-medium tracking-wide leading-none pt-1 pl-1.5">Playground</span>
          </div>
        </div>
        
        <div className="flex items-center gap-4 pr-20">
          {/* Model Status Dropdown */}
          {!forceApiGenerations && <ModelStatusDropdown />}
          
          {/* GPU Info */}
          {status.gpuInfo && (
            <div className="text-sm text-zinc-500">
              {status.gpuInfo.name} ({(status.gpuInfo.vramUsed / 1024).toFixed(1)}GB / {Math.round(status.gpuInfo.vram / 1024)}GB)
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left Panel - Controls */}
        <div className="w-[500px] border-r border-zinc-800 p-6 overflow-y-auto">
          <div className="space-y-6">
            {/* Mode Tabs */}
            <ModeTabs
              mode={mode}
              onModeChange={handleModeChange}
              disabled={isBusy}
              showIcLora={!forceApiGenerations}
            />

            {/* Image Upload - Always shown in video mode (optional: makes it I2V) */}
            {isVideoMode && !isRetakeMode && (
              <>
                <ImageUploader
                  selectedImage={selectedImage}
                  onImageSelect={setSelectedImage}
                />
                <AudioUploader
                  selectedAudio={selectedAudio}
                  onAudioSelect={setSelectedAudio}
                />
              </>
            )}

            {isRetakeMode && (
              <RetakePanel
                resetKey={retakePanelKey}
                isProcessing={isRetaking}
                processingStatus={retakeStatus}
                onChange={(data) => setRetakeInput(data)}
              />
            )}

            {isIcLoraMode && (
              <>
                <ICLoraPanel
                  resetKey={icLoraPanelKey}
                  isProcessing={isIcLoraGenerating}
                  processingStatus={icLoraStatus}
                  conditioningType={icLoraCondType}
                  onConditioningTypeChange={setIcLoraCondType}
                  conditioningStrength={icLoraStrength}
                  onConditioningStrengthChange={setIcLoraStrength}
                  outputVideoUrl={icLoraResult?.videoUrl || null}
                  outputVideoPath={icLoraResult?.videoPath || null}
                  onChange={setIcLoraInput}
                />

                {/* Conditioning controls */}
                <div className="space-y-3 p-4 bg-zinc-900 border border-zinc-800 rounded-2xl">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-400">Conditioning Type</label>
                    <select
                      value={icLoraCondType}
                      onChange={(e) => setIcLoraCondType(e.target.value as ICLoraConditioningType)}
                      className="bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      {CONDITIONING_TYPES.map(ct => (
                        <option key={ct.value} value={ct.value}>{ct.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-zinc-400">Strength</label>
                      <span className="text-xs text-zinc-400">{icLoraStrength.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.05"
                      value={icLoraStrength}
                      onChange={(e) => setIcLoraStrength(Number(e.target.value))}
                      className="w-full accent-blue-500"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Prompt Input */}
            <div className="relative">
              <Textarea
                label="Prompt"
                placeholder="Write a prompt..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                helperText="Longer, detailed prompts lead to better, more accurate results."
                charCount={prompt.length}
                maxChars={5000}
                disabled={isBusy}
              />
              {(mode === 'text-to-video' || mode === 'image-to-video' || mode === 'text-to-image') && (
                <div className="absolute top-0 right-0">
                  <Tooltip content={promptEnhancerConfigured ? 'Enhance Prompt' : 'Set up Prompt Enhancer'} side="left">
                    <button
                      onClick={handleEnhancePrompt}
                      disabled={isBusy || isEnhancingPrompt || (promptEnhancerConfigured && !prompt.trim())}
                      aria-label="Enhance Prompt"
                      className={`flex items-center justify-center h-7 w-7 rounded-md transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        isEnhancingPrompt ? 'cursor-wait ' : ''
                      }${
                        promptEnhancerConfigured
                          ? 'text-blue-300 hover:text-white hover:bg-zinc-700'
                          : 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800'
                      }`}
                    >
                      <EnhanceIcon className={`h-4 w-4 ${isEnhancingPrompt ? 'animate-pulse' : ''}`} />
                    </button>
                  </Tooltip>
                </div>
              )}
            </div>

            {/* Settings */}
            {!isRetakeMode && !isIcLoraMode && (
              <SettingsPanel
                settings={settings}
                onSettingsChange={setSettings}
                disabled={isBusy}
                mode={mode}
                forceApiGenerations={shouldVideoGenerateWithLtxApi}
                hasAudio={!!selectedAudio}
              />
            )}

            {/* Error Display */}
            {(generationError || retakeError || icLoraError) && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm">
                {(generationError || retakeError || icLoraError)!.includes('TEXT_ENCODING_NOT_CONFIGURED') ? (
                  <div className="space-y-2">
                    <p className="text-red-400 font-medium">Text encoding not configured</p>
                    <p className="text-red-400/80">
                      To generate videos, you need to set up text encoding in Settings.
                    </p>
                  </div>
                ) : (generationError || retakeError || icLoraError)!.includes('TEXT_ENCODER_NOT_DOWNLOADED') ? (
                  <div className="space-y-2">
                    <p className="text-red-400 font-medium">Text encoder not downloaded</p>
                    <p className="text-red-400/80">
                      The local text encoder needs to be downloaded (~25 GB).
                    </p>
                  </div>
                ) : (
                  <span className="text-red-400">{generationError || retakeError || icLoraError}</span>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={handleClearAll}
                disabled={isBusy}
                className="flex items-center gap-2 border-zinc-700 bg-zinc-800 text-white hover:bg-zinc-700"
              >
                <Trash2 className="h-4 w-4" />
                Clear all
              </Button>
              
              {isGenerating ? (
                <Button
                  onClick={cancel}
                  className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white"
                >
                  <Square className="h-4 w-4" />
                  Stop generation
                </Button>
              ) : (
                <Button
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                  className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white disabled:bg-zinc-700 disabled:text-zinc-500"
                >
                  {isRetakeMode ? (
                    <>
                      <Scissors className="h-4 w-4" />
                      {isRetaking ? 'Retaking...' : 'Retake'}
                    </>
                  ) : isIcLoraMode ? (
                    <>
                      <Sparkles className="h-4 w-4" />
                      {isIcLoraGenerating ? 'Generating...' : 'Generate IC-LoRA'}
                    </>
                  ) : mode === 'text-to-image' ? (
                    <>
                      <ImageIcon className="h-4 w-4" />
                      Generate image
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Generate video
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel - Result Preview */}
        <div className="flex-1 p-6">
          {mode === 'text-to-image' ? (
            <ImageResult
              imageUrl={imageUrl}
              isGenerating={isGenerating}
              progress={progress}
              statusMessage={statusMessage}
              onCreateVideo={handleCreateVideoFromImage}
            />
          ) : mode === 'retake' ? (
            <VideoPlayer
              videoUrl={retakeResult?.videoUrl || null}
              videoPath={retakeResult?.videoPath || null}
              videoResolution={settings.videoResolution}
              isGenerating={isRetaking}
              progress={0}
              statusMessage={retakeStatus}
            />
          ) : mode === 'ic-lora' ? (
            <VideoPlayer
              videoUrl={icLoraResult?.videoUrl || null}
              videoPath={icLoraResult?.videoPath || null}
              videoResolution={settings.videoResolution}
              isGenerating={isIcLoraGenerating}
              progress={0}
              statusMessage={icLoraStatus}
            />
          ) : (
            <VideoPlayer
              videoUrl={videoUrl}
              videoPath={videoPath}
              videoResolution={settings.videoResolution}
              isGenerating={isGenerating}
              progress={progress}
              statusMessage={statusMessage}
            />
          )}
        </div>
      </main>
    </div>
  )
}
