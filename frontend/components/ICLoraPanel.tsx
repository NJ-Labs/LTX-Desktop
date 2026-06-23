import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  Upload, Loader2, Film, Sparkles,
  RefreshCw, Download, AlertCircle, Trash2, Image as ImageIcon, UserRound, X,
} from 'lucide-react'
import { backendFetch } from '../lib/backend'
import { logger } from '../lib/logger'
import { fileUrlToPath } from '../lib/url-to-path'
import { importMediaFile, importMediaPath } from '../lib/media-import'
import { isWebMode } from '../lib/web-mode'

export type ICLoraAdapterType = 'union' | 'ingredients'
export type ICLoraConditioningType = 'canny' | 'depth' | 'pose' | 'reference_sheet'

type DownloadStatus = 'idle' | 'downloading' | 'complete' | 'error'

interface IcLoraDownloadProgress {
  status: DownloadStatus
  current_downloading_file: string | null
  current_file_progress: number
  total_progress: number
  completed_files: string[]
  all_files: string[]
  error: string | null
}

interface ModelDownloadStartResponse {
  status?: string
  error?: string
  message?: string
  sessionId?: string
}

interface ModelsStatusModel {
  id: string
  downloaded: boolean
}

interface ModelsStatusResponse {
  models: ModelsStatusModel[]
}

interface ICLoraPanelProps {
  destinationFolder: string
  initialVideoUrl?: string | null
  initialVideoPath?: string | null
  resetKey?: number
  fillHeight?: boolean
  isProcessing?: boolean
  processingStatus?: string
  conditioningType?: ICLoraConditioningType
  onConditioningTypeChange?: (type: ICLoraConditioningType) => void
  conditioningStrength?: number
  onConditioningStrengthChange?: (strength: number) => void
  adapterType?: ICLoraAdapterType
  onAdapterTypeChange?: (type: ICLoraAdapterType) => void
  outputVideoUrl?: string | null
  outputVideoPath?: string | null
  onChange?: (data: {
    videoUrl: string | null
    videoPath: string | null
    adapterType: ICLoraAdapterType
    conditioningType: ICLoraConditioningType
    conditioningStrength: number
    anchorImagePath: string | null
    ready: boolean
  }) => void
}

export const CONDITIONING_TYPES: { value: ICLoraConditioningType; label: string; desc: string }[] = [
  { value: 'canny', label: 'Canny Edges', desc: 'Edge detection' },
  { value: 'depth', label: 'Depth Map', desc: 'Estimated depth' },
  { value: 'pose', label: 'Body Pose', desc: 'DWPose skeleton' },
]

export const IC_LORA_ADAPTERS: { value: ICLoraAdapterType; label: string; desc: string }[] = [
  { value: 'union', label: 'Motion Control', desc: 'Video structure with optional identity anchor' },
  { value: 'ingredients', label: 'Character Sheet', desc: 'Preserve identity, clothing, and proportions' },
]

const IC_LORA_MODEL_IDS = [
  'ic_lora',
  'ic_lora_ingredients',
  'depth_processor',
  'person_detector',
  'pose_processor',
] as const
type IcLoraModelId = typeof IC_LORA_MODEL_IDS[number]

const IC_LORA_MODEL_LABELS: Record<IcLoraModelId, string> = {
  ic_lora: 'IC-LoRA Union',
  ic_lora_ingredients: 'IC-LoRA Ingredients',
  depth_processor: 'Depth Processor',
  person_detector: 'Person Detector',
  pose_processor: 'DWPose Processor',
}

const EMPTY_IC_MODEL_STATUS: Record<IcLoraModelId, boolean> = {
  ic_lora: false,
  ic_lora_ingredients: false,
  depth_processor: false,
  person_detector: false,
  pose_processor: false,
}

export function ICLoraPanel({
  destinationFolder,
  initialVideoUrl,
  initialVideoPath,
  resetKey,
  fillHeight = false,
  isProcessing = false,
  processingStatus = '',
  conditioningType: conditioningTypeProp,
  onConditioningTypeChange,
  conditioningStrength: conditioningStrengthProp,
  onConditioningStrengthChange,
  adapterType: adapterTypeProp,
  onAdapterTypeChange,
  outputVideoUrl,
  outputVideoPath: _outputVideoPath,
  onChange,
}: ICLoraPanelProps) {
  const inputVideoRef = useRef<HTMLVideoElement>(null)
  const inputFileRef = useRef<HTMLInputElement>(null)
  const anchorFileRef = useRef<HTMLInputElement>(null)
  const [inputVideoUrl, setInputVideoUrl] = useState<string | null>(initialVideoUrl || null)
  const [inputVideoPath, setInputVideoPath] = useState<string | null>(initialVideoPath || null)
  const [inputTime, setInputTime] = useState(0)
  const [anchorImageUrl, setAnchorImageUrl] = useState<string | null>(null)
  const [anchorImagePath, setAnchorImagePath] = useState<string | null>(null)

  const [internalAdapterType, setInternalAdapterType] = useState<ICLoraAdapterType>('union')
  const [internalCondType, setInternalCondType] = useState<ICLoraConditioningType>('canny')
  const [internalCondStrength, setInternalCondStrength] = useState(1.0)
  const conditioningType = conditioningTypeProp ?? internalCondType
  const adapterType = adapterTypeProp ?? internalAdapterType
  const conditioningStrength = conditioningStrengthProp ?? internalCondStrength
  const [conditioningPreview, setConditioningPreview] = useState<string | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)

  const [icModelDownloaded, setIcModelDownloaded] = useState<Record<IcLoraModelId, boolean>>({ ...EMPTY_IC_MODEL_STATUS })
  const [isCheckingIcLora, setIsCheckingIcLora] = useState(false)
  const [isDownloadingIcLora, setIsDownloadingIcLora] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<IcLoraDownloadProgress | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [downloadSessionId, setDownloadSessionId] = useState<string | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const requiredModelIds = useMemo<IcLoraModelId[]>(() => {
    if (adapterType === 'ingredients') return ['ic_lora_ingredients']
    if (conditioningType === 'depth') return ['ic_lora', 'depth_processor']
    if (conditioningType === 'pose') return ['ic_lora', 'person_detector', 'pose_processor']
    return ['ic_lora']
  }, [adapterType, conditioningType])
  const icLoraReady = requiredModelIds.every(id => icModelDownloaded[id])

  useEffect(() => {
    if (resetKey === undefined) return
    setInputVideoUrl(initialVideoUrl || null)
    setInputVideoPath(initialVideoPath || null)
    setInputTime(0)
    setAnchorImageUrl(null)
    setAnchorImagePath(null)
    setInternalAdapterType('union')
    setInternalCondType('canny')
    setInternalCondStrength(1.0)
    onConditioningTypeChange?.('canny')
    onAdapterTypeChange?.('union')
    onConditioningStrengthChange?.(1.0)
    setConditioningPreview(null)
    setExtractError(null)
  }, [resetKey, initialVideoUrl, initialVideoPath]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ready = !!inputVideoPath && icLoraReady
    onChange?.({
      videoUrl: inputVideoUrl,
      videoPath: inputVideoPath,
      adapterType,
      conditioningType,
      conditioningStrength,
      anchorImagePath,
      ready,
    })
  }, [inputVideoUrl, inputVideoPath, adapterType, conditioningType, conditioningStrength, anchorImagePath, icLoraReady, onChange])

  const previousAdapterRef = useRef(adapterType)
  useEffect(() => {
    if (previousAdapterRef.current === adapterType) return
    previousAdapterRef.current = adapterType
    setInputVideoUrl(null)
    setInputVideoPath(null)
    setInputTime(0)
    setConditioningPreview(null)
    setExtractError(null)
  }, [adapterType])

  const checkIcLoraAvailability = useCallback(async () => {
    setIsCheckingIcLora(true)
    try {
      const statusResponse = await backendFetch('/api/models/status')
      if (!statusResponse.ok) {
        setDownloadError(`Failed to fetch model status (${statusResponse.status})`)
        return
      }

      const statusPayload = await statusResponse.json() as ModelsStatusResponse
      const nextStatus: Record<IcLoraModelId, boolean> = { ...EMPTY_IC_MODEL_STATUS }
      IC_LORA_MODEL_IDS.forEach(modelId => {
        nextStatus[modelId] = statusPayload.models.some(model => model.id === modelId && model.downloaded)
      })
      setIcModelDownloaded(nextStatus)
      const isReady = requiredModelIds.every(modelId => nextStatus[modelId])

      if (isReady) {
        setIsDownloadingIcLora(false)
        setDownloadProgress(null)
        setDownloadError(null)
        setDownloadSessionId(null)
      }
    } catch (e) {
      logger.warn(`Failed to fetch IC-LoRA model status: ${e}`)
      setDownloadError((e as Error).message)
    } finally {
      setIsCheckingIcLora(false)
    }
  }, [requiredModelIds])

  useEffect(() => {
    void checkIcLoraAvailability()
  }, [checkIcLoraAvailability])

  useEffect(() => {
    if (icLoraReady || !isDownloadingIcLora || !downloadSessionId) return

    const pollProgress = async () => {
      try {
        const progressResponse = await backendFetch(`/api/models/download/progress?sessionId=${downloadSessionId}`)
        if (!progressResponse.ok) {
          return
        }

        const progressPayload = await progressResponse.json() as IcLoraDownloadProgress
        setDownloadProgress(progressPayload)

        if (progressPayload.status === 'error') {
          setIsDownloadingIcLora(false)
          setDownloadError(progressPayload.error || 'Model download failed')
          return
        }

        if (progressPayload.status === 'complete') {
          setIsDownloadingIcLora(false)
          await checkIcLoraAvailability()
        }
      } catch (e) {
        logger.warn(`Failed polling IC-LoRA download progress: ${e}`)
      }
    }

    void pollProgress()
    const interval = setInterval(() => { void pollProgress() }, 1000)
    return () => clearInterval(interval)
  }, [icLoraReady, isDownloadingIcLora, downloadSessionId, checkIcLoraAvailability])

  const handleDownloadIcLora = useCallback(async () => {
    if (isDownloadingIcLora) return
    setDownloadError(null)

    try {
      const response = await backendFetch('/api/models/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelTypes: requiredModelIds }),
      })

      const payload = await response.json().catch(() => ({})) as ModelDownloadStartResponse
      if (!response.ok) {
        const errorMessage = payload.error || payload.message || `Download request failed (${response.status})`
        setDownloadError(errorMessage)
        return
      }

      if (payload.status === 'started') {
        if (payload.sessionId) {
          setDownloadSessionId(payload.sessionId)
        }
        setIsDownloadingIcLora(true)
        return
      }

      setDownloadError('Unexpected response while starting IC-LoRA download')
    } catch (e) {
      logger.warn(`Failed to start IC-LoRA download: ${e}`)
      setDownloadError((e as Error).message)
    }
  }, [isDownloadingIcLora, requiredModelIds])

  const isExtractingRef = useRef(false)
  const extractConditioning = useCallback(async () => {
    if (adapterType === 'ingredients' || !inputVideoPath || isExtractingRef.current || !icLoraReady) return
    isExtractingRef.current = true
    setIsExtracting(true)
    setExtractError(null)
    try {
      const response = await backendFetch('/api/ic-lora/extract-conditioning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_path: inputVideoPath,
          conditioning_type: conditioningType,
          frame_time: inputTime,
        }),
      })
      if (response.ok) {
        const payload = await response.json()
        setConditioningPreview(payload.conditioning)
        return
      }
      const payload = await response.json().catch(() => ({} as { error?: string }))
      setExtractError(payload.error || `Failed to extract conditioning (${response.status})`)
    } catch (e) {
      logger.warn(`Failed to extract conditioning: ${e}`)
      setExtractError((e as Error).message)
    } finally {
      isExtractingRef.current = false
      setIsExtracting(false)
    }
  }, [adapterType, inputVideoPath, conditioningType, inputTime, icLoraReady])

  const extractTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (adapterType === 'ingredients' || !inputVideoPath || !icLoraReady) return
    if (extractTimerRef.current) clearTimeout(extractTimerRef.current)
    extractTimerRef.current = setTimeout(() => {
      void extractConditioning()
    }, 300)
    return () => {
      if (extractTimerRef.current) clearTimeout(extractTimerRef.current)
    }
  }, [adapterType, inputTime, conditioningType, inputVideoPath, icLoraReady, extractConditioning])

  useEffect(() => {
    const video = inputVideoRef.current
    if (!video) return
    const onTime = () => setInputTime(video.currentTime)
    const onSeeked = () => setInputTime(video.currentTime)
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('seeked', onSeeked)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('seeked', onSeeked)
    }
  }, [inputVideoUrl, icLoraReady, isCheckingIcLora])

  const importInputFile = useCallback(async (file: File) => {
    const expectedKind = adapterType === 'ingredients' ? 'image/' : 'video/'
    if (!file.type.startsWith(expectedKind)) return
    const imported = await importMediaFile(file, destinationFolder)
    if (!imported) return
    setInputVideoPath(imported.path)
    setInputVideoUrl(imported.url)
    setConditioningPreview(null)
    setExtractError(null)
  }, [adapterType, destinationFolder])

  const importInputPath = useCallback(async (sourcePath: string) => {
    const imported = await importMediaPath(sourcePath, destinationFolder)
    if (!imported) return
    setInputVideoPath(imported.path)
    setInputVideoUrl(imported.url)
    setConditioningPreview(null)
    setExtractError(null)
  }, [destinationFolder])

  const importAnchorFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return
    const imported = await importMediaFile(file, destinationFolder)
    if (!imported) return
    setAnchorImagePath(imported.path)
    setAnchorImageUrl(imported.url)
  }, [destinationFolder])

  const importAnchorPath = useCallback(async (sourcePath: string) => {
    const imported = await importMediaPath(sourcePath, destinationFolder)
    if (!imported) return
    setAnchorImagePath(imported.path)
    setAnchorImageUrl(imported.url)
  }, [destinationFolder])

  const handleBrowse = useCallback(async () => {
    if (isWebMode() || !window.electronAPI?.showOpenFileDialog) {
      inputFileRef.current?.click()
      return
    }
    const paths = await window.electronAPI.showOpenFileDialog({
      title: adapterType === 'ingredients' ? 'Select Character Reference Sheet' : 'Select Driving Video',
      filters: adapterType === 'ingredients'
        ? [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
        : [{ name: 'Video', extensions: ['mp4', 'mov', 'avi', 'webm', 'mkv'] }],
    })
    if (paths && paths.length > 0) {
      await importInputPath(paths[0])
    }
  }, [adapterType, importInputPath])

  const handleBrowseAnchor = useCallback(async () => {
    if (isWebMode() || !window.electronAPI?.showOpenFileDialog) {
      anchorFileRef.current?.click()
      return
    }
    const paths = await window.electronAPI.showOpenFileDialog({
      title: 'Select Character Identity Anchor',
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (!paths || paths.length === 0) return
    await importAnchorPath(paths[0])
  }, [importAnchorPath])

  const handleInputFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) await importInputFile(file)
  }, [importInputFile])

  const handleAnchorFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) await importAnchorFile(file)
  }, [importAnchorFile])

  const handleClear = useCallback(() => {
    setInputVideoPath(null)
    setInputVideoUrl(null)
    setInputTime(0)
    setConditioningPreview(null)
    setExtractError(null)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    const assetData = e.dataTransfer.getData('asset')
    if (assetData) {
      try {
        const asset = JSON.parse(assetData) as { type?: string; url?: string; path?: string }
        const expectedType = adapterType === 'ingredients' ? 'image' : 'video'
        if (asset.type === expectedType && asset.url) {
          const path = asset.path || fileUrlToPath(asset.url) || null
          setInputVideoUrl(asset.url)
          setInputVideoPath(path)
          setConditioningPreview(null)
          setExtractError(null)
          return
        }
      } catch {
        // fall through
      }
    }

    const file = e.dataTransfer.files?.[0]
    if (file) {
      await importInputFile(file)
    }
  }, [adapterType, importInputFile])

  const showDownloadGate = isCheckingIcLora || !icLoraReady
  const gateItems = requiredModelIds.map(modelId => {
    const downloaded = icModelDownloaded[modelId]
    const isCompleted = downloadProgress?.completed_files?.includes(modelId) ?? false
    const isCurrentDownload = isDownloadingIcLora && downloadProgress?.current_downloading_file === modelId
    const progress = downloaded ? 100 : (isCompleted ? 100 : (isCurrentDownload ? (downloadProgress?.current_file_progress ?? 0) : 0))
    const status = downloaded ? 'Ready' : (isCompleted ? 'Complete' : (isCurrentDownload ? 'Downloading' : 'Missing'))
    return { id: modelId, label: IC_LORA_MODEL_LABELS[modelId], downloaded, progress, status }
  })

  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col ${fillHeight ? 'h-full min-h-0' : ''}`}>
      <input
        ref={inputFileRef}
        type="file"
        accept={adapterType === 'ingredients' ? 'image/png,image/jpeg,image/webp' : 'video/mp4,video/quicktime,video/x-msvideo,video/webm,video/x-matroska'}
        className="hidden"
        onChange={handleInputFileSelect}
      />
      <input
        ref={anchorFileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleAnchorFileSelect}
      />
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">Character Consistency</span>
        </div>
        <div className="flex items-center gap-2">
          {adapterType === 'union' && (
            <div className="flex items-center gap-1.5">
              {anchorImageUrl && (
                <img src={anchorImageUrl} alt="Character identity anchor" className="h-7 w-7 rounded-md object-cover border border-zinc-700" />
              )}
              <button
                onClick={handleBrowseAnchor}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-zinc-700 text-[10px] text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
                title="Add a clear face or full-body image at frame 0"
              >
                <UserRound className="h-3 w-3 text-amber-400" />
                {anchorImagePath ? 'Replace anchor' : 'Add identity anchor'}
              </button>
              {anchorImagePath && (
                <button
                  onClick={() => { setAnchorImagePath(null); setAnchorImageUrl(null) }}
                  className="p-1 rounded-md text-zinc-500 hover:text-white hover:bg-zinc-800"
                  title="Remove identity anchor"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          {inputVideoUrl && (
            <div className="flex items-center gap-2">
            <button
              onClick={handleClear}
              className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
              title="Clear video"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleBrowse}
              className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
              title="Replace video"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          )}
        </div>
      </div>

      {showDownloadGate ? (
        <div className="flex-1 flex items-center justify-center p-6 min-h-0 overflow-y-auto">
          <div className="w-full max-w-xl rounded-xl border border-zinc-700 bg-zinc-800/60 p-6">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-600/20 flex items-center justify-center mt-0.5">
                <Download className="h-4 w-4 text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-white">Download Required: Character Models</h3>
                <p className="text-xs text-zinc-400 mt-1">
                  The selected adapter and its preprocessing models must be available locally.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {isCheckingIcLora ? (
                <div className="flex items-center gap-2 text-xs text-zinc-300">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                  Checking model availability...
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    {gateItems.map(item => (
                      <div key={item.id} className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2">
                        <div className="flex items-center justify-between text-[11px] mb-1.5">
                          <span className="text-zinc-300">{item.label}</span>
                          <span className={item.downloaded ? 'text-blue-400' : 'text-zinc-500'}>
                            {item.status}
                          </span>
                        </div>
                        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full transition-all duration-300 bg-blue-500"
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                        <div className="mt-1 text-[10px] text-zinc-500">{item.progress}%</div>
                      </div>
                    ))}
                  </div>
                  {downloadError && (
                    <div className="text-[11px] text-red-400">{downloadError}</div>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={handleDownloadIcLora}
                      disabled={isDownloadingIcLora}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isDownloadingIcLora ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Downloading...
                        </>
                      ) : (
                        <>
                          <Download className="h-3 w-3" />
                          {downloadError ? 'Retry Download' : 'Download Models'}
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => { void checkIcLoraAvailability() }}
                      disabled={isCheckingIcLora}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-600 text-zinc-300 hover:text-white hover:border-zinc-500 text-xs transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3 w-3 ${isCheckingIcLora ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className="flex-1 flex flex-col border-r border-zinc-800 min-w-0">
            <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider shrink-0">Input</span>
              {inputVideoPath && (
                <span className="text-[10px] text-zinc-500 truncate min-w-0">
                  {inputVideoPath.split(/[\\/]/).pop()}
                </span>
              )}
              <button
                onClick={handleBrowse}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors shrink-0"
              >
                <Upload className="h-3 w-3" />
                Import
              </button>
            </div>
            <div
              className={`flex-1 min-h-0 bg-black flex items-center justify-center relative ${!inputVideoUrl ? 'border-2 border-dashed border-zinc-700 m-3 rounded-lg' : ''} ${isDragOver ? 'border-blue-500 bg-blue-500/10' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
            >
              {inputVideoUrl ? (
                adapterType === 'ingredients' ? (
                  <img src={inputVideoUrl} alt="Character reference sheet" className="w-full h-full object-contain" />
                ) : (
                  <video
                    ref={inputVideoRef}
                    src={inputVideoUrl}
                    className="w-full h-full object-contain"
                    controls
                  />
                )
              ) : (
                <div className="text-center p-4">
                  <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-2">
                    {adapterType === 'ingredients'
                      ? <ImageIcon className="h-6 w-6 text-zinc-600" />
                      : <Film className="h-6 w-6 text-zinc-600" />}
                  </div>
                  <p className="text-zinc-400 text-xs">
                    {adapterType === 'ingredients'
                      ? 'Drop or import a multi-view character sheet'
                      : 'Drop or import a driving video'}
                  </p>
                  <button
                    onClick={handleBrowse}
                    className="mt-2 px-3 py-1.5 text-[10px] text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-600/10 transition-colors"
                  >
                    {adapterType === 'ingredients' ? 'Import Reference Sheet' : 'Import Video'}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Conditioning</span>
              {adapterType === 'union' && (
                <button
                  onClick={() => { void extractConditioning() }}
                  disabled={!inputVideoPath || isExtracting}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${isExtracting ? 'animate-spin' : ''}`} />
                </button>
              )}
            </div>
            <div className="flex-1 bg-black flex items-center justify-center min-h-0 relative">
              {isExtracting && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                  <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
                </div>
              )}
              {adapterType === 'ingredients' && inputVideoUrl ? (
                <div className="h-full w-full p-4 flex flex-col items-center justify-center gap-3">
                  <img src={inputVideoUrl} alt="Reference-sheet conditioning" className="max-w-full max-h-[80%] object-contain" />
                  <p className="text-[10px] text-zinc-500 text-center">Static 768×448 · 121 frames · identity, clothing, and proportions</p>
                </div>
              ) : conditioningPreview ? (
                <img src={conditioningPreview} alt="Conditioning preview" className="w-full h-full object-contain" />
              ) : (
                <div className="text-center p-4">
                  <p className="text-zinc-600 text-xs">
                    {adapterType === 'ingredients'
                      ? 'Import a reference sheet to preview character conditioning'
                      : inputVideoUrl
                        ? 'Scrub the input video to see conditioning preview'
                        : 'Import a video to preview conditioning'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Output column */}
          <div className="flex-1 flex flex-col border-l border-zinc-800 min-w-0">
            <div className="px-3 py-2 border-b border-zinc-800 flex items-center">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Output</span>
            </div>
            <div className="flex-1 bg-black flex items-center justify-center min-h-0 relative">
              {outputVideoUrl ? (
                <video
                  src={outputVideoUrl}
                  className="w-full h-full object-contain"
                  controls
                />
              ) : isProcessing ? (
                <div className="text-center p-4">
                  <Loader2 className="h-6 w-6 text-blue-400 animate-spin mx-auto mb-2" />
                  <p className="text-zinc-400 text-xs">{processingStatus || 'Generating...'}</p>
                </div>
              ) : (
                <div className="text-center p-4">
                  <p className="text-zinc-600 text-xs">Output video will appear here</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {extractError && (
        <div className="px-4 py-3 border-t border-zinc-800 flex-shrink-0">
          <div className="flex items-center gap-2 text-xs text-red-400">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{extractError}</span>
          </div>
        </div>
      )}
    </div>
  )
}
