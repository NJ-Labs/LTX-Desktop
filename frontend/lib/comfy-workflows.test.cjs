const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')
const api = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'comfy-workflows.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: api, URL, require: () => ({ getBackendCredentials: async () => ({ url: 'http://localhost:8001', token: '' }) }) })

test('API import preserves linked nodes but exposes only scalar controls', () => {
  const prompt = { '1': { class_type: 'Sampler', inputs: { seed: 42, positive: ['2', 0], enabled: true } }, '2': { class_type: 'Text', inputs: { text: 'hello' } } }
  const parsed = api.parseGraph(prompt)
  assert.equal(parsed.prompt, prompt)
  assert.equal(api.scalarInputs(prompt).length, 3)
  assert.equal(api.scalarInputs(prompt).some(input => input.input_name === 'positive'), false)
})
test('import rejects editor-only graphs and malformed node inputs', () => {
  assert.throws(() => api.parseGraph({ nodes: [] }), /API-format/)
  assert.throws(() => api.parseGraph({ '1': { class_type: 'Bad', inputs: [] } }), /API-format/)
})
test('wrapped exports retain their editable graph', () => {
  const workflow = { nodes: [{ id: 1 }] }
  assert.equal(api.parseGraph({ prompt: { '1': { class_type: 'Text', inputs: {} } }, workflow }).workflow, workflow)
})
test('desktop media resolves against backend rather than renderer origin', async () => {
  const run = await api.resolveRunMedia({ outputs: [{ url: '/media?path=output.mp4' }] })
  assert.equal(run.outputs[0].url, 'http://localhost:8001/media?path=output.mp4')
})

const savedWorkflow = {
  id: 'saved', updated_at: 'version-2', name: 'Example', description: '', workflow: {},
  prompt: { '1': { class_type: 'Sampler', inputs: { steps: 4, enabled: true } } },
  inputs: [{ key: 'steps', label: 'Steps', node_id: '1', input_name: 'steps' }],
}
test('cleared numeric inputs remain invalid and numeric text converts only at submission', () => {
  assert.throws(() => api.runValues(savedWorkflow, { steps: '' }), /valid number/)
  assert.throws(() => api.runValues(savedWorkflow, { steps: 'NaN' }), /valid number/)
  assert.equal(api.runValues(savedWorkflow, { steps: '12' }).steps, 12)
})
test('session restores a tracked run but resets inputs after graph changes', () => {
  const session = api.restorePanelSession(JSON.stringify({ selected: 'saved', updatedAt: 'version-1', values: { steps: 99 }, runId: 'run-1', added: ['/output.png'] }), [savedWorkflow])
  assert.equal(session.values.steps, 4)
  assert.equal(session.runId, 'run-1')
  assert.equal(session.added[0], '/output.png')
  assert.equal(api.restorePanelSession('invalid-json', [savedWorkflow]), null)
})
test('workflow updates discard removed or linked input bindings', () => {
  const prompt = { '1': { class_type: 'Sampler', inputs: { steps: ['2', 0] } } }
  assert.equal(api.preserveWorkflowInputs(savedWorkflow.inputs, prompt).length, 0)
})
test('image upload starts ComfyUI and uses its uploaded input filename', async () => {
  const requests = []
  const uploadApi = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'comfy-workflows.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: uploadApi, URL, FormData,
    require: () => ({ backendFetch: async (url, init) => {
      requests.push({ url, init })
      return { ok: true, json: async () => url.endsWith('/status') ? { state: 'stopped' } : url.endsWith('/start') ? { state: 'running' } : { name: 'photo.png', subfolder: 'uploads', type: 'input' } }
    } }),
  })
  assert.equal(await uploadApi.uploadComfyImage(new File(['png'], 'photo.png', { type: 'image/png' })), 'uploads/photo.png')
  assert.equal(requests[1].url, '/api/comfyui/start')
  assert.equal(requests[2].url, '/comfyui-server/upload/image')
  assert.equal(requests[2].init.body.get('image').name, 'photo.png')
  await assert.rejects(uploadApi.uploadComfyImage(new File(['text'], 'note.txt', { type: 'text/plain' })), /image file/)
  assert.equal(requests.length, 3)
})
