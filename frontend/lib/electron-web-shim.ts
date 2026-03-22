type BackendHealthStatus = {
  status: 'alive' | 'restarting' | 'dead'
  exitCode?: number | null
}

type ElectronApi = Window['electronAPI']

declare global {
  interface Window {
    __LTX_WEB_MODE__?: boolean
  }
}

function rejectUnsupported(action: string): Promise<never> {
  return Promise.reject(new Error(`${action} is not available in web mode.`))
}

function browserBackendUrl(): string {
  const explicit = import.meta.env.VITE_BACKEND_URL
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim().replace(/\/$/, '')
  }
  return window.location.origin
}

export function installWebElectronShim(): void {
  if (typeof window === 'undefined' || window.electronAPI) {
    return
  }

  const aliveStatus: BackendHealthStatus = { status: 'alive', exitCode: null }

  const shim: ElectronApi = {
    getBackend: async () => ({ url: browserBackendUrl(), token: '' }),
    getModelsPath: async () => '/models',
    readLocalFile: () => rejectUnsupported('readLocalFile'),
    checkGpu: async () => ({ available: false }),
    getAppInfo: async () => ({
      version: 'web',
      isPackaged: true,
      modelsPath: '/models',
      userDataPath: '/var/lib/ltx',
    }),
    checkFirstRun: async () => ({ needsSetup: false, needsLicense: false }),
    acceptLicense: async () => true,
    completeSetup: async () => true,
    fetchLicenseText: async () => 'License text is not available in web mode.',
    getNoticesText: async () => 'Notices are not available in web mode.',
    openLtxApiKeyPage: async () => {
      window.open('https://console.ltx.video/', '_blank', 'noopener,noreferrer')
      return true
    },
    openFalApiKeyPage: async () => {
      window.open('https://fal.ai/dashboard/keys', '_blank', 'noopener,noreferrer')
      return true
    },
    openParentFolderOfFile: () => rejectUnsupported('openParentFolderOfFile'),
    showItemInFolder: () => rejectUnsupported('showItemInFolder'),
    getLogs: async () => ({ logPath: '', lines: [] }),
    getLogPath: async () => ({ logPath: '', logDir: '' }),
    openLogFolder: async () => false,
    getResourcePath: async () => null,
    getDownloadsPath: async () => '',
    copyToProjectAssets: () => rejectUnsupported('copyToProjectAssets'),
    getProjectAssetsPath: async () => '',
    openProjectAssetsPathChangeDialog: async () => ({ success: false, error: 'Not available in web mode.' }),
    showSaveDialog: async () => null,
    saveFile: async () => ({ success: false, error: 'Not available in web mode.' }),
    saveBinaryFile: async () => ({ success: false, error: 'Not available in web mode.' }),
    showOpenDirectoryDialog: async () => null,
    checkFilesExist: async () => ({}),
    showOpenFileDialog: async () => null,
    searchDirectoryForFiles: async () => ({}),
    exportNative: async () => ({ error: 'Native export is not available in web mode.' }),
    exportCancel: async () => ({ ok: false }),
    checkPythonReady: async () => ({ ready: true }),
    startPythonSetup: async () => {},
    startPythonBackend: async () => {},
    getBackendHealthStatus: async () => aliveStatus,
    onPythonSetupProgress: () => {},
    removePythonSetupProgress: () => {},
    onBackendHealthStatus: () => () => {},
    extractVideoFrame: () => rejectUnsupported('extractVideoFrame'),
    writeLog: async () => {},
    openModelsDirChangeDialog: async () => ({ success: false, error: 'Not available in web mode.' }),
    getAnalyticsState: async () => ({ analyticsEnabled: false, installationId: 'web-mode' }),
    setAnalyticsEnabled: async () => {},
    sendAnalyticsEvent: async () => {},
    platform: 'web',
  }

  window.__LTX_WEB_MODE__ = true
  window.electronAPI = shim
}
