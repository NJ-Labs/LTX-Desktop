import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowLeft, ExternalLink, Loader2, RefreshCw, Workflow } from 'lucide-react'
import { useProjects } from '../contexts/ProjectContext'
import { LtxLogo } from '../components/LtxLogo'
import { Button } from '../components/ui/button'
import { backendFetch } from '../lib/backend'
import { ComfyWorkflowPanel } from '../components/ComfyWorkflowPanel'
import { comfyRequest, parseGraph, preserveWorkflowInputs, scalarInputs, type ComfyWorkflow, type ComfyWorkflowDraft } from '../lib/comfy-workflows'

async function getComfyUIStatus(): Promise<ComfyUIStatus> {
  const response = await backendFetch('/api/comfyui/status')
  if (!response.ok) {
    throw new Error(await response.text())
  }
  return await response.json() as ComfyUIStatus
}

async function startComfyUI(): Promise<ComfyUIStatus> {
  const response = await backendFetch('/api/comfyui/start', { method: 'POST' })
  if (!response.ok) {
    throw new Error(await response.text())
  }
  return await response.json() as ComfyUIStatus
}

export function ComfyUI() {
  const { goHome } = useProjects()
  const [status, setStatus] = useState<ComfyUIStatus | null>(null)
  const [isStarting, setIsStarting] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const iframe = useRef<HTMLIFrameElement>(null)
  const pending = useRef<{ id: string; timer: number; workflow?: ComfyWorkflow } | null>(null)
  const [draft, setDraft] = useState<ComfyWorkflowDraft | null>(null)
  const draftFromEditor = useRef(false)
  const loadedWorkflow = useRef<ComfyWorkflow | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [workflowError, setWorkflowError] = useState('')
  const [saved, setSaved] = useState(0)
  const [showWorkflows, setShowWorkflows] = useState(false)
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!status?.url || event.source !== iframe.current?.contentWindow || event.origin !== new URL(status.url, window.location.href).origin || event.data?.requestId !== pending.current?.id) return
      if (!['ltx:graph', 'ltx:loaded', 'ltx:error'].includes(event.data.type)) return
      const requestedWorkflow = pending.current?.workflow
      window.clearTimeout(pending.current!.timer); pending.current = null; setRequesting(false)
      try {
        if (event.data.type === 'ltx:error') throw new Error(event.data.error || 'Editor request failed.')
        if (event.data.type === 'ltx:loaded' && requestedWorkflow) { loadedWorkflow.current = requestedWorkflow; setDraft(null); setDraftId(null) }
        if (event.data.type === 'ltx:graph') {
          draftFromEditor.current = true
          const graph = parseGraph(event.data)
          const previous = loadedWorkflow.current
          setDraftId(previous?.id ?? null)
          setDraft({ ...graph, name: previous?.name ?? '', description: previous?.description ?? '', inputs: preserveWorkflowInputs(previous?.inputs ?? [], graph.prompt) }); setShowWorkflows(true)
        }
      } catch (err) { setWorkflowError(err instanceof Error ? err.message : 'Could not read workflow.') }
    }
    window.addEventListener('message', receive)
    return () => { window.removeEventListener('message', receive); if (pending.current) window.clearTimeout(pending.current.timer) }
  }, [status?.url])
  function editorRequest(type: 'ltx:export' | 'ltx:load', workflow?: ComfyWorkflow) {
    if (!status?.url || !iframe.current?.contentWindow) return
    setWorkflowError(''); setRequesting(true); setShowWorkflows(true)
    if (pending.current) window.clearTimeout(pending.current.timer)
    const requestId = crypto.randomUUID()
    pending.current = { id: requestId, workflow, timer: window.setTimeout(() => { pending.current = null; setRequesting(false); setWorkflowError('The editor did not respond. Reconnect, or import an API-format JSON file.') }, 15000) }
    iframe.current.contentWindow.postMessage({ type, requestId, workflow: workflow?.workflow }, new URL(status.url, window.location.href).origin)
  }
  async function saveWorkflow(asCopy = false) {
    if (!draft) return
    if (!draft.name.trim() || draft.inputs.some(input => !input.label.trim()) || draft.inputs.length > 100) {
      setWorkflowError('Enter a workflow name and a label for each exposed input. Select up to 100 inputs.')
      return
    }
    const fromEditor = draftFromEditor.current
    setSaving(true); setWorkflowError('')
    try {
      const next = await comfyRequest<ComfyWorkflow>(draftId && !asCopy ? '/workflows/' + draftId : '/workflows', draft, draftId && !asCopy ? 'PUT' : 'POST')
      if (fromEditor) loadedWorkflow.current = next
      setDraft(null); setDraftId(null); setSaved(value => value + 1)
    }
    catch (err) { setWorkflowError(err instanceof Error ? err.message : 'Could not save workflow.') }
    finally { setSaving(false) }
  }

  const start = useCallback(async () => {
    setIsStarting(true)
    setError(null)
    try {
      const next = await startComfyUI()
      setStatus(next)
      if (next.state === 'error') {
        setError(next.error ?? 'ComfyUI failed to start.')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ComfyUI failed to start.'
      setError(message)
    } finally {
      setIsStarting(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsStarting(true)
      setError(null)
      try {
        const initial = await getComfyUIStatus()
        if (!cancelled) setStatus(initial)

        const next = initial.state === 'running'
          ? initial
          : await startComfyUI()

        if (!cancelled) {
          setStatus(next)
          if (next.state === 'error') {
            setError(next.error ?? 'ComfyUI failed to start.')
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'ComfyUI failed to start.')
        }
      } finally {
        if (!cancelled) setIsStarting(false)
      }
    }

    void load()
    const poll = window.setInterval(() => {
      void getComfyUIStatus().then((next) => {
        if (!cancelled) setStatus(next)
      }).catch(() => { /* Keep the last known status during a temporary disconnect. */ })
    }, 2500)

    return () => {
      cancelled = true
      window.clearInterval(poll)
    }
  }, [])

  const connectionError = error || (!isStarting && (status?.state === 'error' || status?.state === 'stopped') ? status.error || 'ComfyUI stopped. Retry to reconnect.' : null)
  const isRunning = status?.state === 'running' && status.url

  return (
    <div className="h-screen bg-background flex flex-col">
      <header className="flex flex-wrap items-center justify-between gap-y-2 pl-4 pr-64 py-3 border-b border-zinc-800 bg-background">
        <div className="flex items-center gap-4 min-w-0">
          <button
            onClick={goHome}
            className="p-2 rounded-lg hover:bg-zinc-800 transition-colors"
            title="Back to Home"
          >
            <ArrowLeft className="h-5 w-5 text-zinc-400" />
          </button>
          <LtxLogo className="h-5 w-auto text-white" />
          <div className="flex items-center gap-2 min-w-0">
            <Workflow className="h-4 w-4 text-blue-300 flex-shrink-0" />
            <span className="text-white font-medium truncate">ComfyUI</span>
            {status?.port && (
              <span className="text-xs text-zinc-500 tabular-nums">:{status.port}</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={!isRunning || requesting} onClick={() => editorRequest('ltx:export')}>{requesting ? 'Reading editor...' : 'Save for Studio'}</Button>
          <Button variant="ghost" aria-expanded={showWorkflows} onClick={() => setShowWorkflows(value => !value)}>Workflows</Button>
          {isRunning && (
            <button
              onClick={() => window.open(status.url, '_blank', 'noopener,noreferrer')}
              className="h-8 w-8 flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              title="Open ComfyUI in browser"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => void start()}
            disabled={isStarting}
            className="h-8 w-8 flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
            title="Check ComfyUI connection"
          >
            {isStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden bg-black">
        {showWorkflows && <aside className="w-full md:w-96 md:shrink-0 max-h-[55%] md:max-h-none overflow-y-auto bg-background border-r border-border p-4 space-y-6">
          <label className="block space-y-2 text-sm"><span>Import API-format workflow JSON</span><input type="file" accept=".json,application/json" disabled={saving} className="block w-full text-sm" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; try { const graph = parseGraph(JSON.parse(await file.text())); draftFromEditor.current = false; setDraftId(null); setDraft({ ...graph, name: file.name.replace(/\.json$/i, ''), description: '', inputs: [] }); setWorkflowError('') } catch (err) { setWorkflowError(err instanceof Error ? err.message : 'Could not import file.') } }} /></label>
          {draft && <form className="space-y-4 border-b border-border pb-6" onSubmit={event => { event.preventDefault(); void saveWorkflow() }}>
            <h2 className="font-semibold">{draftId ? 'Update saved workflow' : 'Save for Studio'}</h2>
            <label className="block space-y-1 text-sm"><span>Workflow name</span><input autoFocus required maxLength={120} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} className="w-full rounded-md border border-border bg-background p-2" /></label>
            <label className="block space-y-1 text-sm"><span>Description</span><textarea maxLength={2000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} className="w-full rounded-md border border-border bg-background p-2" /></label>
            <fieldset className="space-y-3"><legend className="text-sm mb-2">Choose the controls shown in Studio</legend><p className="text-xs text-muted-foreground">Unchecked values stay fixed at their saved settings.</p>{scalarInputs(draft.prompt).map(candidate => draft.inputs.find(item => item.node_id === candidate.node_id && item.input_name === candidate.input_name) ?? candidate).map(input => <div key={input.key} className="flex items-start gap-2"><input type="checkbox" aria-label={`Expose ${input.label}`} checked={draft.inputs.some(item => item.key === input.key)} onChange={event => setDraft({ ...draft, inputs: event.target.checked ? [...draft.inputs, input] : draft.inputs.filter(item => item.key !== input.key) })} /><label className="flex-1 min-w-0 text-xs"><span className="break-words">{input.label}</span>{draft.inputs.some(item => item.key === input.key) && <input aria-label={`Studio label for ${input.label}`} required className="w-full mt-1 rounded border border-border bg-background p-2 text-sm" value={draft.inputs.find(item => item.key === input.key)?.label ?? ''} onChange={event => setDraft({ ...draft, inputs: draft.inputs.map(item => item.key === input.key ? { ...item, label: event.target.value } : item) })} />}</label></div>)}</fieldset>
            <div className="flex flex-wrap gap-2"><Button type="submit" disabled={saving || !draft.name.trim() || draft.inputs.length > 100}>{saving ? 'Saving...' : draftId ? 'Update workflow' : 'Save workflow'}</Button>{draftId && <Button type="button" variant="outline" disabled={saving || !draft.name.trim() || draft.inputs.length > 100} onClick={() => void saveWorkflow(true)}>Save as copy</Button>}<Button type="button" variant="ghost" disabled={saving} onClick={() => setDraft(null)}>Discard</Button></div>
          </form>}
          {workflowError && <p role="alert" className="text-sm text-destructive break-words">{workflowError}</p>}
          <ComfyWorkflowPanel refreshKey={saved} onLoad={workflow => editorRequest('ltx:load', workflow)} />
        </aside>}
        <div className="flex-1 min-h-0 min-w-0">
        {isRunning ? (
          <iframe
            ref={iframe}
            title="ComfyUI"
            src={status.url}
            className="h-full w-full border-0 bg-black"
            allow="clipboard-read; clipboard-write; fullscreen"
          />
        ) : (
          <div className="h-full flex items-center justify-center p-6 bg-background">
            <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-5">
              {connectionError ? (
                <>
                  <AlertCircle className="h-8 w-8 text-red-400 mb-4" />
                  <h2 className="text-base font-semibold text-white">ComfyUI is unavailable</h2>
                  <p className="mt-2 text-sm text-zinc-400 break-words">{connectionError}</p>
                  <Button onClick={() => void start()} className="mt-5 bg-blue-600 hover:bg-blue-500">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Retry
                  </Button>
                </>
              ) : (
                <div className="flex items-center gap-3 text-zinc-200">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-300" />
                  <span className="text-sm">Starting ComfyUI...</span>
                </div>
              )}
            </div>
          </div>
        )}
        </div>
      </main>
    </div>
  )
}
