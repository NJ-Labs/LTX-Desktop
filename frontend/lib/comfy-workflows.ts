import { backendFetch, getBackendCredentials } from './backend'

export type ComfyScalar = string | number | boolean
export type ComfyPrompt = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>
export interface ComfyInput { key: string; label: string; node_id: string; input_name: string }
export interface ComfyWorkflowDraft { name: string; description: string; prompt: ComfyPrompt; workflow: Record<string, unknown>; inputs: ComfyInput[] }
export interface ComfyWorkflow extends ComfyWorkflowDraft { id: string; updated_at: string }
export interface ComfyOutput { filename: string; path: string; url: string; media_type: 'image' | 'video' | 'audio' }
export interface ComfyRun { id: string; workflow_id: string; prompt_id: string; state: 'queued' | 'running' | 'complete' | 'error' | 'cancelled'; error: string | null; outputs: ComfyOutput[] }

export class ComfyRequestError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export function workflowDefaults(workflow: ComfyWorkflow): Record<string, ComfyScalar> {
  return Object.fromEntries(workflow.inputs.flatMap(input => {
    const value = workflow.prompt[input.node_id]?.inputs[input.input_name]
    return ['string', 'number', 'boolean'].includes(typeof value) ? [[input.key, value as ComfyScalar]] : []
  }))
}

export function preserveWorkflowInputs(inputs: ComfyInput[], prompt: ComfyPrompt): ComfyInput[] {
  return inputs.filter(input => ['string', 'number', 'boolean'].includes(typeof prompt[input.node_id]?.inputs[input.input_name]))
}

export function runValues(workflow: ComfyWorkflow, values: Record<string, ComfyScalar>): Record<string, ComfyScalar> {
  return Object.fromEntries(workflow.inputs.map(input => {
    const original = workflow.prompt[input.node_id]?.inputs[input.input_name]
    const value = values[input.key]
    if (typeof original === 'number') {
      if (typeof value === 'boolean' || String(value ?? '').trim() === '' || !Number.isFinite(Number(value))) throw new Error(`Enter a valid number for ${input.label}.`)
      return [input.key, Number(value)]
    }
    if (typeof original !== typeof value) throw new Error(`Check the value for ${input.label}.`)
    return [input.key, value]
  }))
}

export interface ComfyPanelSession { selected: string; updatedAt: string; values: Record<string, ComfyScalar>; runId: string | null; added: string[] }
export function restorePanelSession(raw: string | null, workflows: ComfyWorkflow[]): ComfyPanelSession | null {
  if (!raw) return null
  try {
    const saved = JSON.parse(raw) as ComfyPanelSession
    const workflow = workflows.find(item => item.id === saved.selected)
    if (!workflow) return null
    const defaults = workflowDefaults(workflow)
    const values = saved.updatedAt === workflow.updated_at && saved.values && typeof saved.values === 'object'
      ? Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, ['string', 'number', 'boolean'].includes(typeof saved.values[key]) ? saved.values[key] : value]))
      : defaults
    return { selected: workflow.id, updatedAt: workflow.updated_at, values, runId: typeof saved.runId === 'string' ? saved.runId : null, added: Array.isArray(saved.added) ? saved.added.filter(item => typeof item === 'string') : [] }
  } catch { return null }
}

export async function uploadComfyImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  const status = await comfyRequest<ComfyUIStatus>('/status')
  const ready = status.state === 'running' ? status : await comfyRequest<ComfyUIStatus>('/start', {})
  if (ready.state !== 'running') throw new Error(ready.error || 'ComfyUI is still starting. Try the upload again when it is ready.')
  const body = new FormData()
  body.append('image', file, file.name)
  const response = await backendFetch('/comfyui-server/upload/image', { method: 'POST', body })
  if (!response.ok) throw new Error(`Image upload failed (${response.status}). Check the ComfyUI connection and try again.`)
  const result = await response.json() as { name: string; subfolder?: string; type?: string }
  if (!result.name) throw new Error('ComfyUI did not return an uploaded image name.')
  return result.subfolder ? `${result.subfolder}/${result.name}` : result.name
}

export async function resolveRunMedia(run: ComfyRun): Promise<ComfyRun> {
  const { url } = await getBackendCredentials()
  return { ...run, outputs: run.outputs.map(output => ({ ...output, url: new URL(output.url, url).href })) }
}

export async function comfyRequest<T>(path: string, body?: unknown, method = 'POST', signal?: AbortSignal): Promise<T> {
  const response = await backendFetch(`/api/comfyui${path}`, body === undefined ? { signal } : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  })
  if (!response.ok) {
    const text = await response.text()
    let message = text
    try { const parsed = JSON.parse(text); message = typeof parsed.error === 'string' ? parsed.error : typeof parsed.detail === 'string' ? parsed.detail : text } catch { /* Plain error response */ }
    throw new ComfyRequestError(message || `ComfyUI request failed (${response.status}).`, response.status)
  }
  return response.json() as Promise<T>
}

export function scalarInputs(prompt: ComfyPrompt): ComfyInput[] {
  return Object.entries(prompt).flatMap(([node_id, node]) => Object.entries(node.inputs).flatMap(([input_name, value]) =>
    ['string', 'number', 'boolean'].includes(typeof value)
      ? [{ key: `${node_id}_${input_name}`, label: `${node._meta?.title || node.class_type}: ${input_name.replace(/_/g, ' ')}`, node_id, input_name }]
      : []))
}

export function parseGraph(value: unknown): { prompt: ComfyPrompt; workflow: Record<string, unknown> } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a ComfyUI API-format JSON file.')
  const record = value as Record<string, unknown>
  const prompt = record.prompt ?? value
  if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt) || !Object.keys(prompt).length ||
    Object.values(prompt).some(node => !node || typeof node !== 'object' || typeof node.class_type !== 'string' || !node.inputs || typeof node.inputs !== 'object' || Array.isArray(node.inputs))) {
    throw new Error('This is an editor graph. Export API-format JSON from ComfyUI, or use Save for Studio in the connected editor.')
  }
  return { prompt: prompt as ComfyPrompt, workflow: record.workflow && typeof record.workflow === 'object' && !Array.isArray(record.workflow) ? record.workflow as Record<string, unknown> : {} }
}
