import type { Asset, TimelineClip } from '../../types/project'
import { pathToBrowserUrl } from '../../lib/web-mode'
import { fileUrlToPath } from '../../lib/url-to-path'

export function extensionSource(clip: TimelineClip, asset: Asset | null | undefined) {
  if (!asset || clip.type !== 'video') throw new Error('Select a video clip first.')
  if (clip.reversed || Math.abs((clip.speed ?? 1) - 1) > 0.001) throw new Error('Render the reversed or retimed clip before extending it.')
  if (clip.trimStart > 0.01 || clip.trimEnd > 0.01) throw new Error('Render the trimmed clip or use the full clip before extending it.')
  const take = asset.takes?.[Math.max(0, Math.min(clip.takeIndex ?? asset.activeTakeIndex ?? Math.max(0, (asset.takes?.length ?? 1) - 1), (asset.takes?.length ?? 1) - 1))]
  const rawPath = take ? take.path : asset.path
  const sourceUrl = take ? take.url : asset.url
  const path = fileUrlToPath(rawPath || '') || rawPath || fileUrlToPath(sourceUrl || '')
  if (!path || /^(https?:|blob:|data:)/i.test(path)) throw new Error('Import this video locally before extending it.')
  return { path, url: sourceUrl || pathToBrowserUrl(path) }
}

export function replaceWithExtension(clips: TimelineClip[], source: TimelineClip, asset: Asset): TimelineClip[] {
  const current = clips.find(clip => clip.id === source.id)
  if (!current || current.assetId !== source.assetId || current.startTime !== source.startTime || current.duration !== source.duration || current.trimStart !== source.trimStart || current.trimEnd !== source.trimEnd || current.takeIndex !== source.takeIndex || current.speed !== source.speed || current.reversed !== source.reversed) {
    throw new Error('The source clip changed. The extension is saved in your library; add it to the timeline manually.')
  }
  if (!asset.duration || asset.duration <= source.duration) throw new Error('The returned video is not longer than the source. It was saved to your library.')
  const end = source.startTime + source.duration
  const delta = asset.duration - source.duration
  const sourceGroup = new Set([source.id, ...(source.linkedClipIds || [])])
  // Replace only matching linked source audio. Independent sound stays intact.
  return clips.map(clip => clip.id === source.id || (sourceGroup.has(clip.id) && clip.type === 'audio' && clip.assetId === source.assetId && clip.startTime === source.startTime && clip.duration === source.duration && clip.trimStart === source.trimStart)
    ? { ...clip, assetId: asset.id, asset, duration: asset.duration!, trimStart: 0, trimEnd: 0, takeIndex: undefined }
    : clip.startTime >= end - 0.001 ? { ...clip, startTime: clip.startTime + delta } : clip)
}
