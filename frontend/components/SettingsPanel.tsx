import { Select } from './ui/select'
import type { GenerationMode } from './ModeTabs'
import {
  FORCED_API_VIDEO_FPS,
  FORCED_API_VIDEO_RESOLUTIONS,
  getAllowedForcedApiDurations,
  sanitizeForcedApiVideoSettings,
} from '../lib/api-video-options'
import { clampLocalDuration, getLocalDurationOptions, LOCAL_RESOLUTIONS, LOCAL_VIDEO_FPS } from '../lib/local-video-options'
import { useAppSettings } from '../contexts/AppSettingsContext'

export interface GenerationSettings {
  model: 'fast' | 'pro'
  duration: number
  videoResolution: string
  fps: number
  audio: boolean
  cameraMotion: string
  aspectRatio?: string
  // Image-specific settings
  imageResolution: string
  imageAspectRatio: string
  imageSteps: number
  variations?: number  // Number of image variations to generate
}

interface SettingsPanelProps {
  settings: GenerationSettings
  onSettingsChange: (settings: GenerationSettings) => void
  disabled?: boolean
  mode?: GenerationMode
  forceApiGenerations?: boolean
  hasAudio?: boolean
}

export function SettingsPanel({
  settings,
  onSettingsChange,
  disabled,
  mode = 'text-to-video',
  forceApiGenerations = false,
  hasAudio = false,
}: SettingsPanelProps) {
  const isImageMode = mode === 'text-to-image'
  const { settings: appSettings } = useAppSettings()
  const localCapConfig = {
    enabled: appSettings.localDurationCapEnabled,
    caps: appSettings.localDurationCaps,
  }

  const handleChange = (key: keyof GenerationSettings, value: string | number | boolean) => {
    const nextSettings = { ...settings, [key]: value } as GenerationSettings
    if (forceApiGenerations && !isImageMode) {
      onSettingsChange(sanitizeForcedApiVideoSettings(nextSettings, { hasAudio }))
      return
    }

    // Re-clamp local duration when resolution or fps changes (cap is fps-aware).
    if ((key === 'videoResolution' || key === 'fps') && !forceApiGenerations) {
      nextSettings.duration = clampLocalDuration(
        nextSettings.duration,
        nextSettings.videoResolution,
        nextSettings.fps,
        localCapConfig,
      )
    }

    onSettingsChange(nextSettings)
  }

  const durationOptions = forceApiGenerations
    ? [...getAllowedForcedApiDurations(settings.model, settings.videoResolution, settings.fps)]
    : getLocalDurationOptions(settings.videoResolution, settings.fps, localCapConfig)
  const resolutionOptions = forceApiGenerations
    ? (hasAudio ? ['1080p'] : [...FORCED_API_VIDEO_RESOLUTIONS])
    : [...LOCAL_RESOLUTIONS]
  const fpsOptions = forceApiGenerations ? [...FORCED_API_VIDEO_FPS] : [...LOCAL_VIDEO_FPS]

  // Image mode settings
  if (isImageMode) {
    return (
      <div className="space-y-4">
        {/* Aspect Ratio and Quality side by side */}
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Aspect Ratio"
            value={settings.imageAspectRatio || '16:9'}
            onChange={(e) => handleChange('imageAspectRatio', e.target.value)}
            disabled={disabled}
          >
            <option value="1:1">1:1 (Square)</option>
            <option value="16:9">16:9 (Landscape)</option>
            <option value="9:16">9:16 (Portrait)</option>
            <option value="4:3">4:3 (Standard)</option>
            <option value="3:4">3:4 (Portrait Standard)</option>
            <option value="21:9">21:9 (Cinematic)</option>
          </Select>

          <Select
            label="Quality"
            value={settings.imageSteps || 4}
            onChange={(e) => handleChange('imageSteps', parseInt(e.target.value))}
            disabled={disabled}
          >
            <option value={4}>Fast</option>
            <option value={8}>Balanced</option>
            <option value={12}>High</option>
          </Select>
        </div>
      </div>
    )
  }

  // Video mode settings
  return (
    <div className="space-y-4">
      {/* Model Selection */}
      {!forceApiGenerations ? (
        <Select
          label="Model"
          value={settings.model}
          onChange={(e) => handleChange('model', e.target.value)}
          disabled={disabled}
        >
          <option value="fast">LTX 2.3 Fast</option>
          <option value="pro">LTX 2.3 Pro</option>
        </Select>
      ) : (
        <Select
          label="Model"
          value={settings.model}
          onChange={(e) => handleChange('model', e.target.value)}
          disabled={disabled}
        >
          <option value="fast" disabled={hasAudio}>LTX-2.3 Fast (API)</option>
          <option value="pro">LTX-2.3 Pro (API)</option>
        </Select>
      )}

      {/* Duration, Resolution, FPS Row */}
      <div className="grid grid-cols-3 gap-3">
        <Select
          label="Duration"
          value={settings.duration}
          onChange={(e) => handleChange('duration', parseInt(e.target.value))}
          disabled={disabled}
        >
          {durationOptions.map((duration) => (
            <option key={duration} value={duration}>
              {duration} sec
            </option>
          ))}
        </Select>

        <Select
          label="Resolution"
          value={settings.videoResolution}
          onChange={(e) => handleChange('videoResolution', e.target.value)}
          disabled={disabled}
        >
          {resolutionOptions.map((resolution) => (
            <option key={resolution} value={resolution}>
              {resolution}
            </option>
          ))}
        </Select>

        <Select
          label="FPS"
          value={settings.fps}
          onChange={(e) => handleChange('fps', parseInt(e.target.value))}
          disabled={disabled}
        >
          {fpsOptions.map((fps) => (
            <option key={fps} value={fps}>
              {fps}
            </option>
          ))}
        </Select>
      </div>

      {/* Aspect Ratio */}
      <Select
        label="Aspect Ratio"
        value={settings.aspectRatio || '16:9'}
        onChange={(e) => handleChange('aspectRatio', e.target.value)}
        disabled={disabled}
      >
        {hasAudio ? (
          <option value="16:9">16:9 Landscape</option>
        ) : (
          <>
            <option value="16:9">16:9 Landscape</option>
            <option value="9:16">9:16 Portrait</option>
          </>
        )}
      </Select>

      {/* Audio and Camera Motion Row */}
      <div className="flex gap-3">
        <div className="w-[140px] flex-shrink-0">
          <Select
            label="Audio"
            badge="PREVIEW"
            value={settings.audio ? 'on' : 'off'}
            onChange={(e) => handleChange('audio', e.target.value === 'on')}
            disabled={disabled}
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </Select>
        </div>

        <div className="flex-1">
          <Select
            label="Camera Motion"
            value={settings.cameraMotion}
            onChange={(e) => handleChange('cameraMotion', e.target.value)}
            disabled={disabled}
          >
            <option value="none">None</option>
            <option value="static">Static</option>
            <option value="focus_shift">Focus Shift</option>
            <option value="dolly_in">Dolly In</option>
            <option value="dolly_out">Dolly Out</option>
            <option value="dolly_left">Dolly Left</option>
            <option value="dolly_right">Dolly Right</option>
            <option value="jib_up">Jib Up</option>
            <option value="jib_down">Jib Down</option>
          </Select>
        </div>
      </div>
    </div>
  )
}
