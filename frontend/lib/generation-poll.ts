import { backendFetch } from './backend'

export interface GenerationProgressPayload {
  status: string
  phase: string
  progress: number
  currentStep: number | null
  totalSteps: number | null
  videoPath?: string | null
  imagePaths?: string[] | null
  error?: string | null
  heartbeatAgeMs?: number | null
}

// If the backend stops reporting progress for this long, surface a "still
// working" note so the user knows a long generation is alive ("live-check").
export const HEARTBEAT_STALL_WARNING_MS = 90_000

// How long the UI keeps polling while it cannot reach the backend (gateway
// timeout / proxy blip / backend busy) before declaring the generation failed.
// Each successful, non-idle progress read resets this window, so a generation
// that keeps reporting progress is never cut off — only a genuinely
// unreachable backend trips the limit.
export const POLL_GRACE_MS = 120_000

const POLL_INTERVAL_MS = 500

export class GenerationPollTimeoutError extends Error {
  constructor(message = 'Lost connection to the generation server.') {
    super(message)
    this.name = 'GenerationPollTimeoutError'
  }
}

function isTerminalStatus(status: string): boolean {
  return status === 'complete' || status === 'error' || status === 'cancelled'
}

// HTTP statuses emitted by a reverse proxy when the upstream request takes too
// long or the connection is dropped. When a blocking generation request returns
// one of these, the backend is typically still generating, so the client falls
// back to polling progress instead of failing.
export function isGatewayTimeoutStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504 || status === 408 || status === 524
}

/**
 * Poll /api/generation/progress until the generation reaches a terminal state.
 *
 * Used both by the non-blocking generate/image flow (POST returns "started")
 * and as a resilience fallback for the still-blocking retake / ic-lora flows
 * when their request hits a reverse-proxy gateway timeout (504): the backend is
 * still generating, so the client recovers the outcome by polling instead of
 * failing.
 *
 * The grace window tolerates a temporarily unreachable backend. A successful,
 * non-idle progress read resets the window; if the backend stays unreachable
 * (or reports only "idle") for longer than `graceMs`, a
 * {@link GenerationPollTimeoutError} is thrown.
 */
export async function waitForGenerationTerminal(
  signal: AbortSignal,
  onProgress: (data: GenerationProgressPayload) => void,
  options?: { graceMs?: number },
): Promise<GenerationProgressPayload> {
  const graceMs = options?.graceMs ?? POLL_GRACE_MS
  let lastReachableAt = Date.now()

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal.aborted) {
      return { status: 'cancelled', phase: '', progress: 0, currentStep: null, totalSteps: null }
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))

    let reachable = false
    try {
      const res = await backendFetch('/api/generation/progress')
      if (res.ok) {
        const data: GenerationProgressPayload = await res.json()
        // Treat "idle" as not-yet-reachable: it means generation has not
        // started, so it must not keep the grace window alive indefinitely.
        if (data.status && data.status !== 'idle') {
          reachable = true
          onProgress(data)
          if (isTerminalStatus(data.status)) {
            return data
          }
        }
      }
    } catch {
      // Unreachable (network/proxy error) — handled by the grace window below.
    }

    if (reachable) {
      lastReachableAt = Date.now()
    } else if (Date.now() - lastReachableAt > graceMs) {
      throw new GenerationPollTimeoutError()
    }
  }
}
