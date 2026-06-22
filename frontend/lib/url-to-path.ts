/**
 * Extract a backend-accessible filesystem path from a local media URL.
 * Desktop mode uses `file://` URLs, while web mode serves uploaded files as
 * `/media?path=...` URLs.
 */
export function fileUrlToPath(url: string): string | null {
  if (url.startsWith('file://')) {
    let p = decodeURIComponent(url.slice(7)) // file:///Users/x -> /Users/x
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
    return p
  }

  try {
    const parsed = new URL(url, 'http://localhost')
    if (parsed.pathname === '/media') {
      return parsed.searchParams.get('path')
    }
  } catch {
    // Invalid and unsupported URLs do not identify a backend filesystem path.
  }

  return null
}
