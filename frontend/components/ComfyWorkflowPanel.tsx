import { useEffect, useId, useRef, useState } from 'react'
import { useProjects } from '../contexts/ProjectContext'
import { getBackendCredentials } from '../lib/backend'
import { Button } from './ui/button'
import { comfyRequest, ComfyRequestError, resolveRunMedia, restorePanelSession, runValues, uploadComfyImage, workflowDefaults, type ComfyOutput, type ComfyRun, type ComfyScalar, type ComfyWorkflow } from '../lib/comfy-workflows'

export async function outputMetadata(output: ComfyOutput): Promise<{ duration?: number; resolution: string }> {
  if (output.media_type === 'image') return { resolution: '' }
  return new Promise((resolve, reject) => {
    const media = document.createElement(output.media_type === 'audio' ? 'audio' : 'video')
    const cleanup = () => { clearTimeout(timer); media.onloadedmetadata = null; media.onerror = null; media.removeAttribute('src'); media.load() }
    const fail = () => { cleanup(); reject(new Error('Could not read media duration. Check the preview and try adding it again.')) }
    const timer = window.setTimeout(fail, 10000)
    media.onloadedmetadata = () => {
      const duration = media.duration
      const resolution = media instanceof HTMLVideoElement ? `${media.videoWidth}x${media.videoHeight}` : ''
      if (!Number.isFinite(duration) || duration <= 0) { fail(); return }
      cleanup(); resolve({ duration, resolution })
    }
    media.onerror = fail
    media.preload = 'metadata'
    media.src = output.url
  })
}

export function ComfyWorkflowPanel({ projectId, refreshKey = 0, onLoad }: { projectId?: string; refreshKey?: number; onLoad?: (workflow: ComfyWorkflow) => void }) {
  const { addAsset, addPlaygroundAsset, openComfyUI } = useProjects()
  const id = useId()
  const [workflows, setWorkflows] = useState<ComfyWorkflow[]>([])
  const [selected, setSelected] = useState('')
  const [values, setValues] = useState<Record<string, ComfyScalar>>({})
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [run, setRun] = useState<ComfyRun | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])
  const [storageKey, setStorageKey] = useState('')
  const restoredKey = useRef('')
  const workflow = workflows.find(item => item.id === selected)
  const running = Boolean(runId && (!run || run.state === 'queued' || run.state === 'running'))
  const panelScope = projectId ? 'project:' + projectId : onLoad ? 'editor' : 'playground'
  let validationError = ''
  if (workflow) {
    try { runValues(workflow, values) } catch (err) { validationError = err instanceof Error ? err.message : 'Check the workflow inputs.' }
  }

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    Promise.all([getBackendCredentials(), comfyRequest<ComfyWorkflow[]>('/workflows', undefined, 'GET', controller.signal)]).then(([credentials, items]) => {
      if (controller.signal.aborted) return
      const key = 'ltx:comfy-panel:v1:' + encodeURIComponent(credentials.url) + ':' + panelScope
      setWorkflows(items); setError('')
      let session = null
      try { session = restorePanelSession(localStorage.getItem(key), items) } catch { /* Storage can be unavailable. */ }
      if (restoredKey.current !== key) {
        restoredKey.current = key
        setSelected(session?.selected ?? '')
        setValues(session?.values ?? {})
        setRunId(session?.runId ?? null)
        setRun(null)
        setAdded(session?.added ?? [])
        setStorageKey(key)
      } else {
        // Reconcile refreshed graphs without reusing controls whose schema changed.
        const previous = workflows.find(item => item.id === selected)
        const next = items.find(item => item.id === selected)
        if (previous?.updated_at !== next?.updated_at) {
          setValues(next ? workflowDefaults(next) : {})
          if (!next) setSelected('')
        }
      }
    }).catch(err => { if (!controller.signal.aborted) setError(String(err.message)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
    // Refresh is explicit; input edits must not refetch the workflow list.
  }, [refreshKey, refresh, panelScope])

  useEffect(() => {
    if (!storageKey) return
    try { localStorage.setItem(storageKey, JSON.stringify({ selected, updatedAt: workflow?.updated_at ?? '', values, runId, added })) }
    catch { /* Keep the current run usable when storage is full or unavailable. */ }
  }, [storageKey, selected, workflow?.updated_at, values, runId, added])

  useEffect(() => {
    if (!runId) return
    const controller = new AbortController()
    let timeout: number | undefined
    const poll = async () => {
      try {
        const next = await resolveRunMedia(await comfyRequest<ComfyRun>('/runs/' + runId, undefined, 'GET', controller.signal))
        if (controller.signal.aborted) return
        setRun(next); setError('')
        if (next.state === 'queued' || next.state === 'running') timeout = window.setTimeout(() => void poll(), 1500)
      } catch (err) {
        if (controller.signal.aborted) return
        if (err instanceof ComfyRequestError && err.status === 404) {
          setRunId(null); setRun(null); setError('This run is no longer available. You can run the workflow again.')
        } else setError((err instanceof Error ? err.message : 'Could not read run status.') + ' Use Refresh status to reconnect.')
      }
    }
    void poll()
    return () => { controller.abort(); window.clearTimeout(timeout) }
  }, [runId, refresh])

  function select(next: string) {
    setSelected(next); setRun(null); setRunId(null); setAdded([]); setError('')
    const item = workflows.find(entry => entry.id === next)
    setValues(item ? workflowDefaults(item) : {})
  }
  async function start() {
    if (!workflow || validationError) return
    setBusy(true); setError(''); setAdded([])
    try {
      const next = await resolveRunMedia(await comfyRequest<ComfyRun>('/workflows/' + workflow.id + '/run', { values: runValues(workflow, values) }))
      // The request may finish after navigation unmounts this panel.
      try { if (storageKey) localStorage.setItem(storageKey, JSON.stringify({ selected: workflow.id, updatedAt: workflow.updated_at, values, runId: next.id, added: [] })) }
      catch { /* The active view can still track the run without persistence. */ }
      setRun(next); setRunId(next.id)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not queue workflow. Try again.') }
    finally { setBusy(false) }
  }
  async function cancel() {
    if (!runId) return
    setBusy(true)
    try { setRun(await resolveRunMedia(await comfyRequest<ComfyRun>('/runs/' + runId + '/cancel', {}))) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not cancel. Refresh status and try again.') }
    finally { setBusy(false) }
  }
  async function upload(key: string, file?: File) {
    if (!file) return
    setBusy(true); setError('')
    try { const name = await uploadComfyImage(file); setValues(old => ({ ...old, [key]: name })) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not upload image.') }
    finally { setBusy(false) }
  }
  async function addOutput(output: ComfyOutput) {
    if (busy || added.includes(output.path)) return
    setBusy(true); setError('')
    try {
      const metadata = await outputMetadata(output)
      const asset = { type: output.media_type, path: output.path, url: output.url, prompt: workflow?.name ?? 'ComfyUI workflow', ...metadata, bin: 'ComfyUI' }
      if (projectId) addAsset(projectId, asset)
      else addPlaygroundAsset(asset)
      setAdded(old => [...old, output.path])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add media.') }
    finally { setBusy(false) }
  }
  return <section className="space-y-4 text-sm" aria-label="Saved ComfyUI workflows">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-foreground">Saved workflows</h2><Button variant="ghost" size="sm" disabled={loading} onClick={() => setRefresh(v => v + 1)}>Refresh{running ? ' status' : ''}</Button></div>
    {loading ? <p role="status" className="text-muted-foreground">Loading workflows...</p> : workflows.length === 0 ? <div className="space-y-3"><p className="text-muted-foreground">Save a workflow in ComfyUI to run it here with simple controls.</p>{!onLoad && <Button variant="outline" onClick={openComfyUI}>Open ComfyUI editor</Button>}</div> : <>
      <label className="block space-y-2" htmlFor={`${id}-workflow`}><span>Workflow</span><select id={`${id}-workflow`} className="w-full rounded-md border border-border bg-background p-2 focus-visible:ring-2 focus-visible:ring-ring" value={selected} disabled={busy || running} onChange={event => select(event.target.value)}><option value="">Choose a workflow</option>{workflows.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {workflow && <>
        {workflow.description && <p className="text-muted-foreground whitespace-pre-wrap break-words">{workflow.description}</p>}
        <fieldset disabled={busy || running} className="space-y-3">
          {workflow.inputs.length === 0 && <p className="text-muted-foreground">This workflow uses its saved settings.</p>}
          {workflow.inputs.map(input => {
            const node = workflow.prompt[input.node_id]
            const original = node?.inputs[input.input_name]
            const imageInput = node?.class_type === 'LoadImage' && input.input_name === 'image'
            return <label key={input.key} htmlFor={id + '-' + input.key} className="block space-y-1">
              <span className="break-words">{input.label}</span>
              {imageInput ? <><input id={id + '-' + input.key} type="file" accept="image/*" className="block w-full text-sm" onChange={event => { void upload(input.key, event.target.files?.[0]); event.target.value = '' }} /><span className="block text-xs text-muted-foreground break-words">{String(values[input.key] || 'Choose an image to upload.')}</span></>
                : typeof original === 'boolean' ? <input id={id + '-' + input.key} type="checkbox" className="ml-3 accent-primary" checked={Boolean(values[input.key])} onChange={event => setValues(old => ({ ...old, [input.key]: event.target.checked }))} />
                : typeof original === 'number' ? <input id={id + '-' + input.key} type="number" step="any" required aria-invalid={String(values[input.key] ?? '').trim() === '' || !Number.isFinite(Number(values[input.key]))} className="w-full rounded-md border border-border bg-background p-2 focus-visible:ring-2 focus-visible:ring-ring" value={String(values[input.key] ?? '')} onChange={event => setValues(old => ({ ...old, [input.key]: event.target.value }))} />
                : <textarea id={id + '-' + input.key} rows={3} className="w-full resize-y rounded-md border border-border bg-background p-2 focus-visible:ring-2 focus-visible:ring-ring" value={String(values[input.key] ?? '')} onChange={event => setValues(old => ({ ...old, [input.key]: event.target.value }))} />}
            </label>
          })}
        </fieldset>
        {validationError && <p role="status" className="text-destructive">{validationError}</p>}
        <div className="flex flex-wrap gap-2"><Button disabled={busy || running || Boolean(validationError)} onClick={() => void start()}>{busy ? 'Please wait...' : run?.state === 'error' ? 'Retry workflow' : 'Run workflow'}</Button>{running && <Button variant="outline" disabled={busy} onClick={() => void cancel()}>Cancel run</Button>}{onLoad && Object.keys(workflow.workflow).length > 0 && <Button variant="outline" disabled={busy || running} onClick={() => onLoad(workflow)}>Load in editor</Button>}</div>
      </>}
    </>}
    {error && <p role="alert" className="text-destructive break-words">{error}</p>}
    {run && <div role="status" className="space-y-3"><p>{run.state === 'complete' ? 'Workflow complete' : run.state === 'cancelled' ? 'Run cancelled' : run.state === 'error' ? 'Workflow failed' : run.state === 'queued' ? 'Workflow queued...' : 'Workflow running...'}</p>{run.error && <p className="text-destructive break-words">{run.error}</p>}{run.state === 'complete' && run.outputs.length === 0 && <p className="text-muted-foreground">No media output was produced. Check the workflow output nodes.</p>}{run.outputs.map(output => <div key={output.path} className="space-y-2">{output.media_type === 'image' ? <img src={output.url} alt={output.filename} className="max-h-64 w-full object-contain" /> : output.media_type === 'video' ? <video src={output.url} controls className="max-h-64 w-full" /> : <audio src={output.url} controls className="w-full" />}<Button variant="outline" disabled={busy || added.includes(output.path)} onClick={() => void addOutput(output)}>{added.includes(output.path) ? 'Added to library' : projectId ? 'Add to project' : 'Add to Playground'}</Button></div>)}</div>}
  </section>
}
