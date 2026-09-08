import { useEffect, useRef, useState } from 'react'
import { backendFetch } from '../../lib/backend'
import { isGatewayTimeoutStatus, waitForGenerationTerminal } from '../../lib/generation-poll'
import { pathToBrowserUrl } from '../../lib/web-mode'

interface ExtensionLimits {
  max_additional_seconds: number
  minimum_additional_seconds: number
  can_extend: boolean
}

interface Props {
  source: { path: string; url: string }
  sourceDuration: number
  disabledReason?: string
  onClose: () => void
  onComplete: (path: string, duration: number | undefined, prompt: string, replace: boolean) => Promise<void>
}

function mediaDuration(url: string): Promise<number | undefined> {
  return new Promise(resolve => {
    const video = document.createElement('video')
    const finish = (value?: number) => { clearTimeout(timer); video.onloadedmetadata = null; video.onerror = null; video.removeAttribute('src'); video.load(); resolve(value) }
    const timer = setTimeout(() => finish(), 10000)
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? video.duration : undefined)
    video.onerror = () => finish()
    video.preload = 'metadata'
    video.src = url
  })
}

export function ExtendVideoModal({ source, sourceDuration, disabledReason, onClose, onComplete }: Props) {
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState('4')
  const [limits, setLimits] = useState<ExtensionLimits | null>(null)
  const [limitsError, setLimitsError] = useState('')
  const [limitsAttempt, setLimitsAttempt] = useState(0)
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [complete, setComplete] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)
  const controller = useRef<AbortController | null>(null)
  const requestStarted = useRef(false)
  const generationFinished = useRef(false)
  const completionRef = useRef(onComplete)
  completionRef.current = onComplete
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => { controller.current?.abort(); previous?.focus() }
  }, [])
  useEffect(() => {
    let active = true
    setLimits(null); setLimitsError('')
    if (disabledReason || !source.path) return
    void backendFetch('/api/extend/limits?video_path=' + encodeURIComponent(source.path)).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || data.detail || 'Could not check the source video limits.')
      if (!Number.isFinite(data.max_additional_seconds) || data.minimum_additional_seconds !== 2) throw new Error('The backend returned invalid extension limits.')
      if (!active) return
      setLimits(data)
      if (data.can_extend) setDuration(previous => String(Math.min(Number(previous) || 4, Math.floor(data.max_additional_seconds * 1000) / 1000)))
    }).catch(cause => { if (active) setLimitsError(cause instanceof Error ? cause.message : 'Could not check source limits.') })
    return () => { active = false }
  }, [source.path, disabledReason, limitsAttempt])
  const maximumDuration = limits ? Math.floor(limits.max_additional_seconds * 1000) / 1000 : 0
  const validDuration = !!limits?.can_extend && Number.isFinite(Number(duration)) && Number(duration) >= 2 && Number(duration) <= maximumDuration
  const cancel = async () => {
    if (saving || generationFinished.current) return
    if (!requestStarted.current) { controller.current?.abort(); setStatus('Cancelled'); return }
    setCancelling(true)
    try {
      const response = await backendFetch('/api/generate/cancel', { method: 'POST' })
      if (!response.ok) throw new Error('Could not cancel. Try again; generation is still being tracked.')
      setStatus('Cancellation requested…')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Cancellation failed') }
    finally { setCancelling(false) }
  }
  const generate = async () => {
    if (busy || !validDuration || !prompt.trim() || disabledReason) return
    setBusy(true); setSaving(false); generationFinished.current = false; setError(''); setStatus('Preparing extension…')
    const abort = new AbortController()
    controller.current = abort
    requestStarted.current = false
    let poll: ReturnType<typeof setInterval> | undefined
    try {
      const originalDuration = await mediaDuration(source.url || pathToBrowserUrl(source.path))
      if (abort.signal.aborted) return
      if (!originalDuration) throw new Error('Could not read the source video. Reimport it before extending.')
      if (Math.abs(originalDuration - sourceDuration) > 0.15) throw new Error('This clip does not use the full source video. Render the trimmed clip or use the full clip before extending.')
      poll = setInterval(() => {
        void backendFetch('/api/generation/progress').then(async response => {
          if (!response.ok || abort.signal.aborted) return
          const progress = await response.json()
          if (progress.status === 'running') setStatus(`${progress.phase || 'Extending video'} ${Math.round(progress.progress || 0)}%`)
        }).catch(() => { /* The generation response owns errors and recovery. */ })
      }, 1000)
      requestStarted.current = true
      const response = await backendFetch('/api/extend', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ video_path: source.path, duration: Number(duration), prompt: prompt.trim(), mode: 'end' }) })
      clearInterval(poll)
      let result = await response.json().catch(() => ({}))
      if (!response.ok && !isGatewayTimeoutStatus(response.status)) throw new Error(result.error || result.detail || `Extension failed (${response.status})`)
      if (isGatewayTimeoutStatus(response.status) || result.status === 'started') {
        const terminal = await waitForGenerationTerminal(abort.signal, progress => setStatus(`${progress.phase || 'Extending video'} ${Math.round(progress.progress)}%`))
        result = { status: terminal.status, video_path: terminal.videoPath, error: terminal.error }
      }
      requestStarted.current = false
      generationFinished.current = true
      if (result.status === 'cancelled') { setStatus('Cancelled'); return }
      if (result.status !== 'complete' || !result.video_path) throw new Error(result.error || 'The extension did not return a video.')
      setSaving(true)
      setStatus('Saving to project library…')
      const actualDuration = await mediaDuration(pathToBrowserUrl(result.video_path))
      // The completed generation must not be repeated if optional placement fails.
      setComplete(true)
      await completionRef.current(result.video_path, actualDuration, prompt.trim(), replace)
      setStatus('Extended video saved to your project library.')
    } catch (cause) { if (!abort.signal.aborted) { setStatus(''); setError(cause instanceof Error ? cause.message : 'Extension failed') } }
    finally { requestStarted.current = false; clearInterval(poll); setBusy(false); setSaving(false) }
  }
  return <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4" onKeyDown={event => {
    event.stopPropagation()
    if (event.key === 'Escape' && !busy) onClose()
    if (event.key === 'Tab') {
      const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')
      if (!elements?.length) return
      const first = elements[0], last = elements[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
  }}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="extend-title" className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-6 space-y-4 outline-none">
      <h2 id="extend-title" className="text-lg font-semibold">Extend video from end</h2>
      <p className="text-sm text-zinc-400">Continue from the final frames of this {sourceDuration.toFixed(1)} second clip. The result includes the original video and its continuation at the source resolution and frame rate.</p>
      <p className="text-xs text-zinc-500">Local LTX 2.3. The complete result is limited to 20 seconds. Up to 7 trailing source frames may be trimmed to fit the model frame grid.</p>
      {disabledReason && <p role="alert" className="text-sm text-amber-300">{disabledReason}</p>}
      <label className="block text-sm">Continuation prompt<textarea disabled={busy || complete} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Describe what happens next…" className="mt-2 w-full min-h-24 rounded bg-zinc-800 border border-zinc-700 p-2" /></label>
      {!disabledReason && !limits && !limitsError && <p role="status" className="text-sm text-zinc-400">Checking source frame limits…</p>}
      {limitsError && <div role="alert" className="text-sm text-red-400">{limitsError} <button className="underline" onClick={() => setLimitsAttempt(previous => previous + 1)}>Retry source check</button></div>}
      {limits && !limits.can_extend && <p role="alert" className="text-sm text-amber-300">This source leaves less than 2 seconds for continuation within the 20-second total limit. Render a shorter clip first.</p>}
      <label className="block text-sm">Additional seconds{limits?.can_extend ? ` (2–${maximumDuration})` : ''}<input type="number" min={2} max={maximumDuration || 2} step="any" disabled={busy || complete || !limits?.can_extend} value={duration} onChange={event => setDuration(event.target.value)} aria-invalid={!validDuration} className="mt-2 block w-28 rounded bg-zinc-800 border border-zinc-700 p-2" /></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={replace} disabled={busy || complete} onChange={event => setReplace(event.target.checked)} />Replace this timeline clip and move following clips and subtitles on all tracks. Otherwise, save to library only.</label>
      <p className="text-xs text-zinc-500">Matching linked source audio is replaced too. Independent audio keeps its original sound. Overlapping clips are not stretched.</p>
      {status && <p role="status" className="text-sm text-zinc-300">{status}</p>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        {busy ? <button disabled={cancelling || saving} onClick={() => void cancel()} className="px-4 py-2 rounded border border-zinc-600 disabled:opacity-50">{saving ? 'Saving…' : cancelling ? 'Requesting…' : 'Cancel generation'}</button> : <button onClick={onClose} className="px-4 py-2 rounded border border-zinc-600">{complete ? 'Done' : 'Close'}</button>}
        {!complete && <button disabled={busy || !validDuration || !prompt.trim() || !!disabledReason} onClick={() => void generate()} className="px-4 py-2 rounded bg-purple-600 disabled:opacity-40">{busy ? 'Extending…' : error ? 'Retry extension' : 'Extend video'}</button>}
      </div>
    </div>
  </div>
}
