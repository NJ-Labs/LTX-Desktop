import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { backendFetch, resetBackendCredentials } from '../lib/backend'
import { isWebMode } from '../lib/web-mode'

export interface InferenceSettings {
  steps: number
  useUpscaler: boolean
}

export interface FastModelSettings {
  useUpscaler: boolean
}

export interface AppSettings {
  useTorchCompile: boolean
  loadOnStartup: boolean
  hasLtxApiKey: boolean
  ltxApiBaseUrl: string
  userPrefersLtxApiVideoGenerations: boolean
  hasFalApiKey: boolean
  falApiBaseUrl: string
  useLocalTextEncoder: boolean
  fastModel: FastModelSettings
  proModel: InferenceSettings
  promptCacheSize: number
  promptEnhancerEnabledT2V: boolean
  promptEnhancerEnabledI2V: boolean
  promptEnhancerBaseUrl: string
  promptEnhancerModel: string
  hasPromptEnhancerApiKey: boolean
  seedLocked: boolean
  lockedSeed: number
  modelsDir: string
  localDurationCapEnabled: boolean
  localDurationCaps: Record<string, number>
}

export const DEFAULT_LOCAL_DURATION_CAPS: Record<string, number> = { '540p': 20, '720p': 10, '1080p': 5, '1440p': 5, '2160p': 5 }

export const DEFAULT_APP_SETTINGS: AppSettings = {
  useTorchCompile: false,
  loadOnStartup: true,
  hasLtxApiKey: false,
  ltxApiBaseUrl: 'https://api.ltx.video',
  userPrefersLtxApiVideoGenerations: false,
  hasFalApiKey: false,
  falApiBaseUrl: 'https://fal.run',
  useLocalTextEncoder: false,
  fastModel: { useUpscaler: true },
  proModel: { steps: 20, useUpscaler: true },
  promptCacheSize: 1,
  promptEnhancerEnabledT2V: false,
  promptEnhancerEnabledI2V: false,
  promptEnhancerBaseUrl: '',
  promptEnhancerModel: '',
  hasPromptEnhancerApiKey: false,
  seedLocked: false,
  lockedSeed: 42,
  modelsDir: '',
  localDurationCapEnabled: true,
  localDurationCaps: DEFAULT_LOCAL_DURATION_CAPS,
}

type BackendProcessStatus = 'alive' | 'restarting' | 'dead'

interface AppSettingsContextValue {
  settings: AppSettings
  isLoaded: boolean
  runtimePolicyLoaded: boolean
  updateSettings: (patch: Partial<AppSettings> | ((prev: AppSettings) => AppSettings)) => void
  refreshSettings: () => Promise<void>
  saveLtxApiKey: (value: string) => Promise<void>
  saveFalApiKey: (value: string) => Promise<void>
  saveLtxApiConfig: (apiKey: string, baseUrl: string) => Promise<void>
  saveFalApiConfig: (apiKey: string, baseUrl: string) => Promise<void>
  savePromptEnhancerApiKey: (value: string) => Promise<void>
  forceApiGenerations: boolean
  offlineMode: boolean
  serverDataDir: string
  shouldVideoGenerateWithLtxApi: boolean
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null)

function toBackendProcessStatus(value: unknown): BackendProcessStatus | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as { status?: unknown }
  if (record.status === 'alive' || record.status === 'restarting' || record.status === 'dead') {
    return record.status
  }
  return null
}

function normalizeAppSettings(data: Partial<AppSettings>): AppSettings {
  return {
    useTorchCompile: data.useTorchCompile ?? DEFAULT_APP_SETTINGS.useTorchCompile,
    loadOnStartup: data.loadOnStartup ?? DEFAULT_APP_SETTINGS.loadOnStartup,
    hasLtxApiKey: data.hasLtxApiKey ?? DEFAULT_APP_SETTINGS.hasLtxApiKey,
    ltxApiBaseUrl: data.ltxApiBaseUrl ?? DEFAULT_APP_SETTINGS.ltxApiBaseUrl,
    userPrefersLtxApiVideoGenerations: data.userPrefersLtxApiVideoGenerations ?? DEFAULT_APP_SETTINGS.userPrefersLtxApiVideoGenerations,
    hasFalApiKey: data.hasFalApiKey ?? DEFAULT_APP_SETTINGS.hasFalApiKey,
    falApiBaseUrl: data.falApiBaseUrl ?? DEFAULT_APP_SETTINGS.falApiBaseUrl,
    useLocalTextEncoder: data.useLocalTextEncoder ?? DEFAULT_APP_SETTINGS.useLocalTextEncoder,
    fastModel: data.fastModel ?? DEFAULT_APP_SETTINGS.fastModel,
    proModel: data.proModel ?? DEFAULT_APP_SETTINGS.proModel,
    promptCacheSize: data.promptCacheSize ?? DEFAULT_APP_SETTINGS.promptCacheSize,
    promptEnhancerEnabledT2V: data.promptEnhancerEnabledT2V ?? DEFAULT_APP_SETTINGS.promptEnhancerEnabledT2V,
    promptEnhancerEnabledI2V: data.promptEnhancerEnabledI2V ?? DEFAULT_APP_SETTINGS.promptEnhancerEnabledI2V,
    promptEnhancerBaseUrl: data.promptEnhancerBaseUrl ?? DEFAULT_APP_SETTINGS.promptEnhancerBaseUrl,
    promptEnhancerModel: data.promptEnhancerModel ?? DEFAULT_APP_SETTINGS.promptEnhancerModel,
    hasPromptEnhancerApiKey: data.hasPromptEnhancerApiKey ?? DEFAULT_APP_SETTINGS.hasPromptEnhancerApiKey,
    seedLocked: data.seedLocked ?? DEFAULT_APP_SETTINGS.seedLocked,
    lockedSeed: data.lockedSeed ?? DEFAULT_APP_SETTINGS.lockedSeed,
    modelsDir: data.modelsDir ?? DEFAULT_APP_SETTINGS.modelsDir,
    localDurationCapEnabled: data.localDurationCapEnabled ?? DEFAULT_APP_SETTINGS.localDurationCapEnabled,
    localDurationCaps: { ...DEFAULT_LOCAL_DURATION_CAPS, ...(data.localDurationCaps ?? {}) },
  }
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)
  const [isLoaded, setIsLoaded] = useState(false)
  const [runtimePolicyLoaded, setRuntimePolicyLoaded] = useState(false)
  const [forceApiGenerations, setForceApiGenerations] = useState(true)
  const [offlineMode, setOfflineMode] = useState(false)
  const [serverDataDir, setServerDataDir] = useState('')
  const [backendProcessStatus, setBackendProcessStatus] = useState<BackendProcessStatus | null>(null)

  useEffect(() => {
    if (backendProcessStatus !== 'alive') return

    let cancelled = false
    setRuntimePolicyLoaded(false)

    const fetchRuntimePolicy = async () => {
      try {
        const response = await backendFetch('/api/runtime-policy')
        if (!response.ok) {
          throw new Error(`Runtime policy fetch failed with status ${response.status}`)
        }

        const payload = (await response.json()) as { force_api_generations?: unknown; offline_mode?: unknown; data_dir?: unknown }
        if (typeof payload.force_api_generations !== 'boolean') {
          throw new Error('Runtime policy response missing force_api_generations boolean')
        }
        if (typeof payload.offline_mode !== 'boolean') {
          throw new Error('Runtime policy response missing offline_mode boolean')
        }

        if (!cancelled) {
          setForceApiGenerations(payload.force_api_generations)
          setOfflineMode(payload.offline_mode)
          setServerDataDir(typeof payload.data_dir === 'string' ? payload.data_dir : '')
        }
      } catch {
        if (!cancelled) {
          // Fail closed until policy can be read.
          setForceApiGenerations(true)
          setOfflineMode(false)
        }
      } finally {
        if (!cancelled) {
          setRuntimePolicyLoaded(true)
        }
      }
    }

    void fetchRuntimePolicy()

    return () => {
      cancelled = true
    }
  }, [backendProcessStatus])

  useEffect(() => {
    let cancelled = false

    const applyStatus = (value: unknown) => {
      const nextStatus = toBackendProcessStatus(value)
      if (!nextStatus || cancelled) {
        return
      }
      if (nextStatus === 'alive') {
        resetBackendCredentials()
      }
      setBackendProcessStatus(nextStatus)
    }

    const unsubscribe = window.electronAPI.onBackendHealthStatus((data) => {
      applyStatus(data)
    })

    void window.electronAPI.getBackendHealthStatus()
      .then((snapshot) => {
        applyStatus(snapshot)
      })
      .catch(() => {
        // Snapshot is optional at startup; subscription continues to listen for pushes.
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const refreshSettings = useCallback(async () => {
    const response = await backendFetch('/api/settings')
    if (!response.ok) {
      throw new Error(`Settings fetch failed with status ${response.status}`)
    }
    const data = await response.json()
    setSettings(normalizeAppSettings(data))
    setIsLoaded(true)
  }, [])

  useEffect(() => {
    if (isLoaded || backendProcessStatus !== 'alive') return

    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const fetchSettings = async () => {
      try {
        await refreshSettings()
        if (cancelled) return
      } catch {
        if (!cancelled) {
          if (isWebMode()) {
            setSettings(DEFAULT_APP_SETTINGS)
            setIsLoaded(true)
            return
          }
          retryTimer = setTimeout(fetchSettings, 1000)
        }
      }
    }

    fetchSettings()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [backendProcessStatus, isLoaded, refreshSettings])

  useEffect(() => {
    if (!isLoaded || backendProcessStatus !== 'alive') return
    const syncTimer = setTimeout(async () => {
      try {
        const { hasLtxApiKey: _a, hasFalApiKey: _b, modelsDir: _c, hasPromptEnhancerApiKey: _d, ...syncPayload } = settings
        await backendFetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(syncPayload),
        })
      } catch {
        // Best-effort settings sync.
      }
    }, 150)
    return () => clearTimeout(syncTimer)
  }, [backendProcessStatus, isLoaded, settings])

  const updateSettings = useCallback((patch: Partial<AppSettings> | ((prev: AppSettings) => AppSettings)) => {
    if (typeof patch === 'function') {
      setSettings((prev) => patch(prev))
      return
    }
    setSettings((prev) => ({ ...prev, ...patch }))
  }, [])

  const saveLtxApiConfig = useCallback(async (apiKey: string, baseUrl: string) => {
    const response = await backendFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ltxApiKey: apiKey, ltxApiBaseUrl: baseUrl }),
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(detail || 'Failed to save LTX API key.')
    }
    await refreshSettings()
  }, [refreshSettings])

  const saveLtxApiKey = useCallback(async (value: string) => {
    await saveLtxApiConfig(value, settings.ltxApiBaseUrl)
  }, [saveLtxApiConfig, settings.ltxApiBaseUrl])

  const saveFalApiConfig = useCallback(async (apiKey: string, baseUrl: string) => {
    const response = await backendFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ falApiKey: apiKey, falApiBaseUrl: baseUrl }),
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(detail || 'Failed to save FAL API key.')
    }
    await refreshSettings()
  }, [refreshSettings])

  const saveFalApiKey = useCallback(async (value: string) => {
    await saveFalApiConfig(value, settings.falApiBaseUrl)
  }, [saveFalApiConfig, settings.falApiBaseUrl])

  const savePromptEnhancerApiKey = useCallback(async (value: string) => {
    const response = await backendFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptEnhancerApiKey: value }),
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(detail || 'Failed to save Prompt Enhancer API key.')
    }
    await refreshSettings()
  }, [refreshSettings])

  const shouldVideoGenerateWithLtxApi =
    !offlineMode && (forceApiGenerations || (settings.userPrefersLtxApiVideoGenerations && settings.hasLtxApiKey))

  const contextValue = useMemo<AppSettingsContextValue>(
    () => ({
      settings,
      isLoaded,
      runtimePolicyLoaded,
      updateSettings,
      refreshSettings,
      saveLtxApiKey,
      saveFalApiKey,
      saveLtxApiConfig,
      saveFalApiConfig,
      savePromptEnhancerApiKey,
      forceApiGenerations,
      offlineMode,
      serverDataDir,
      shouldVideoGenerateWithLtxApi,
    }),
    [forceApiGenerations, isLoaded, offlineMode, refreshSettings, runtimePolicyLoaded, saveFalApiConfig, saveFalApiKey, saveLtxApiConfig, saveLtxApiKey, savePromptEnhancerApiKey, serverDataDir, settings, shouldVideoGenerateWithLtxApi, updateSettings],
  )

  return <AppSettingsContext.Provider value={contextValue}>{children}</AppSettingsContext.Provider>
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext)
  if (!context) {
    throw new Error('useAppSettings must be used within AppSettingsProvider')
  }
  return context
}
