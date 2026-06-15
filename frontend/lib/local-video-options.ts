// Helpers for local (on-device) video duration options.
//
// The maximum duration is FPS-aware: generated frames = duration * fps, and
// VRAM/compute scales with the total frame count. The per-resolution cap is
// authored in seconds at LOCAL_REFERENCE_FPS; at higher fps the effective max
// duration scales down so the frame budget (duration * fps) stays constant. The
// cap can also be disabled entirely (uncapped) for high-VRAM GPUs.

export const LOCAL_RESOLUTIONS = ['540p', '720p', '1080p', '1440p', '2160p'] as const

// Supported local capture rates.
export const LOCAL_VIDEO_FPS = [24, 25, 50] as const

// Discrete duration steps (seconds) offered to the user. Steps above 20 only
// appear when a resolution cap is raised above 20s or caps are disabled.
export const LOCAL_DURATION_LADDER = [5, 6, 8, 10, 12, 16, 20, 24, 30, 40, 50, 60] as const

// FPS at which a per-resolution second cap is authored. Higher fps scales the
// effective max down proportionally to keep the frame budget constant.
export const LOCAL_REFERENCE_FPS = 25

// Fallback cap (seconds) for an unknown resolution label.
const FALLBACK_CAP_SECONDS = 20

export interface LocalDurationCapConfig {
  enabled: boolean
  caps: Record<string, number>
}

/**
 * Effective maximum duration (seconds) for a resolution at a given fps, or
 * `null` when caps are disabled (i.e. duration is unlimited).
 */
export function getLocalEffectiveMaxSeconds(
  resolution: string,
  fps: number,
  config: LocalDurationCapConfig,
): number | null {
  if (!config.enabled) return null
  const capSeconds = config.caps[resolution] ?? FALLBACK_CAP_SECONDS
  const safeFps = fps > 0 ? fps : LOCAL_REFERENCE_FPS
  return capSeconds * (LOCAL_REFERENCE_FPS / safeFps)
}

/** Duration dropdown options (seconds) for local generation at a resolution + fps. */
export function getLocalDurationOptions(
  resolution: string,
  fps: number,
  config: LocalDurationCapConfig,
): number[] {
  const maxSeconds = getLocalEffectiveMaxSeconds(resolution, fps, config)
  if (maxSeconds === null) return [...LOCAL_DURATION_LADDER]
  const filtered = LOCAL_DURATION_LADDER.filter((d) => d <= maxSeconds + 1e-6)
  // Always offer at least the smallest step so the selector is never empty.
  return filtered.length > 0 ? filtered : [LOCAL_DURATION_LADDER[0]]
}

/**
 * Snap a duration to the largest valid option <= the requested value (fps-aware).
 * Falls back to the smallest available option when none qualify.
 */
export function clampLocalDuration(
  duration: number,
  resolution: string,
  fps: number,
  config: LocalDurationCapConfig,
): number {
  const options = getLocalDurationOptions(resolution, fps, config)
  let result = options[0]
  for (const option of options) {
    if (option <= duration) result = option
    else break
  }
  return result
}
