export function isWebMode(): boolean {
  return typeof window !== 'undefined' && window.__LTX_WEB_MODE__ === true
}

export function pathToBrowserUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  if (isWebMode()) {
    return `/media?path=${encodeURIComponent(filePath)}`
  }
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
}
