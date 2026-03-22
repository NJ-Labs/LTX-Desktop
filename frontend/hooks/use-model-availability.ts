import { useEffect, useState } from 'react'
import { backendFetch } from '../lib/backend'
import { logger } from '../lib/logger'

type StartupProbeStatus = 'ready' | 'loading' | 'pending' | 'error' | 'unknown'
type ModelAvailabilityLevel = 'active' | 'partial' | 'inactive'

interface ReadyProbeResponse {
  status?: StartupProbeStatus
  message?: string
  error?: string
  current_step?: string
  progress?: number
}

interface HealthResponse {
  models_loaded?: boolean
  active_model?: string | null
}

interface ModelStatusItem {
  id: string
  name: string
  description: string
  downloaded: boolean
  required: boolean
  relative_path?: string
  resolved_path?: string
}

interface ModelsStatusResponse {
  all_downloaded?: boolean
  models_path?: string
  models?: ModelStatusItem[]
}

export interface ModelAvailabilityState {
  isLoaded: boolean
  level: ModelAvailabilityLevel
  label: string
  summary: string
  modelsPath: string
  requiredTotal: number
  requiredDownloaded: number
  missingRequired: string[]
  requiredModels: Array<{
    id: string
    name: string
    downloaded: boolean
    relativePath: string
    resolvedPath: string
  }>
  startupStatus: StartupProbeStatus
  startupMessage: string | null
  modelsLoaded: boolean
  activeModel: string | null
}

const DEFAULT_STATE: ModelAvailabilityState = {
  isLoaded: false,
  level: 'inactive',
  label: 'Checking',
  summary: 'Checking model availability.',
  modelsPath: '',
  requiredTotal: 0,
  requiredDownloaded: 0,
  missingRequired: [],
  requiredModels: [],
  startupStatus: 'unknown',
  startupMessage: null,
  modelsLoaded: false,
  activeModel: null,
}

function deriveAvailability(
  modelsStatus: ModelsStatusResponse,
  health: HealthResponse,
  readyProbe: ReadyProbeResponse,
): ModelAvailabilityState {
  const requiredModels = (modelsStatus.models ?? []).filter((model) => model.required)
  const requiredDownloaded = requiredModels.filter((model) => model.downloaded).length
  const missingRequired = requiredModels.filter((model) => !model.downloaded).map((model) => model.name)
  const requiredModelEntries = requiredModels.map((model) => ({
    id: model.id,
    name: model.name,
    downloaded: model.downloaded,
    relativePath: model.relative_path ?? '',
    resolvedPath: model.resolved_path ?? '',
  }))
  const startupStatus = readyProbe.status ?? 'unknown'
  const startupMessage = readyProbe.error ?? readyProbe.message ?? readyProbe.current_step ?? null
  const modelsLoaded = health.models_loaded === true
  const activeModel = typeof health.active_model === 'string' ? health.active_model : null
  const allDownloaded = modelsStatus.all_downloaded === true

  let level: ModelAvailabilityLevel = 'inactive'
  let label = 'Not Active'
  let summary = 'Models were not found or did not load correctly.'

  if (startupStatus === 'ready' && allDownloaded && modelsLoaded) {
    level = 'active'
    label = 'Active'
    summary = activeModel
      ? `All required models are active. Current model: ${activeModel}.`
      : 'All required models are active.'
  } else if (
    requiredDownloaded > 0 ||
    startupStatus === 'loading' ||
    startupStatus === 'pending' ||
    (allDownloaded && !modelsLoaded)
  ) {
    level = 'partial'
    label = 'Partial'
    if (missingRequired.length > 0) {
      summary = 'Some required models are missing or still unavailable.'
    } else if (startupStatus === 'loading') {
      summary = startupMessage ? `Models are loading: ${startupMessage}` : 'Models are still loading.'
    } else if (startupStatus === 'pending') {
      summary = startupMessage ?? 'Models are present only partially and are not fully active yet.'
    } else {
      summary = 'Models are available, but not all of them are active yet.'
    }
  }

  if (startupStatus === 'error') {
    level = requiredDownloaded > 0 ? 'partial' : 'inactive'
    label = level === 'partial' ? 'Partial' : 'Not Active'
    summary = startupMessage ?? 'Models were found, but one or more failed to load.'
  }

  return {
    isLoaded: true,
    level,
    label,
    summary,
    modelsPath: modelsStatus.models_path ?? '',
    requiredTotal: requiredModels.length,
    requiredDownloaded,
    missingRequired,
    requiredModels: requiredModelEntries,
    startupStatus,
    startupMessage,
    modelsLoaded,
    activeModel,
  }
}

export function useModelAvailability(enabled: boolean, pollIntervalMs = 5000): ModelAvailabilityState {
  const [state, setState] = useState<ModelAvailabilityState>(DEFAULT_STATE)

  useEffect(() => {
    if (!enabled) {
      setState(DEFAULT_STATE)
      return
    }

    let cancelled = false

    const fetchAvailability = async () => {
      try {
        const [modelsResponse, healthResponse, readyResponse] = await Promise.all([
          backendFetch('/api/models/status'),
          backendFetch('/health'),
          backendFetch('/readyz'),
        ])

        if (!modelsResponse.ok) {
          throw new Error(`Model status fetch failed with status ${modelsResponse.status}`)
        }
        if (!healthResponse.ok) {
          throw new Error(`Health fetch failed with status ${healthResponse.status}`)
        }

        const modelsStatus = (await modelsResponse.json()) as ModelsStatusResponse
        const health = (await healthResponse.json()) as HealthResponse

        let readyProbe: ReadyProbeResponse = { status: 'unknown' }
        try {
          readyProbe = (await readyResponse.json()) as ReadyProbeResponse
        } catch {
          readyProbe = {
            status: readyResponse.ok ? 'ready' : 'unknown',
          }
        }

        if (!cancelled) {
          setState(deriveAvailability(modelsStatus, health, readyProbe))
        }
      } catch (error) {
        logger.error(`Failed to fetch model availability: ${error}`)
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            isLoaded: true,
            level: 'inactive',
            label: 'Not Active',
            summary: 'Unable to verify model availability.',
            startupStatus: 'unknown',
            startupMessage: error instanceof Error ? error.message : 'Unknown error',
            modelsLoaded: false,
          }))
        }
      }
    }

    void fetchAvailability()
    const interval = setInterval(() => {
      void fetchAvailability()
    }, pollIntervalMs)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [enabled, pollIntervalMs])

  return state
}