const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

test('zero required models never implies local models are available', async () => {
  const exports = {}
  let effect
  let state
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'use-model-availability.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, setInterval: () => 1, clearInterval: () => {}, require: name => {
      if (name === 'react') return { useEffect: fn => { effect = fn }, useState: initial => [initial, next => { state = next }] }
      if (name.includes('backend')) return { backendFetch: async url => ({ ok: true, json: async () => url.includes('/models/status') ? { all_downloaded: true, models: [{ id: 'missing', name: 'Missing', downloaded: false, required: false }] } : url === '/health' ? { models_loaded: false } : { status: 'ready' } }) }
      return { logger: { error: () => {} } }
    },
  })
  exports.useModelAvailability(true)
  effect()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.requiredTotal, 0)
  assert.equal(state.label, 'Not loaded')
  assert.match(state.summary, /Local pipelines are not loaded/)
})

test('model dialog heading agrees with the unloaded badge without hiding failures', () => {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components/ModelStatusDialog.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(code + '\nexports.titleFor = titleFor', { exports, require: () => ({}) })
  assert.equal(exports.titleFor({ level: 'partial', label: 'Not loaded' }), 'Local models are not loaded')
  assert.equal(exports.titleFor({ level: 'active', label: 'Active' }), 'Models are active')
  assert.equal(exports.titleFor({ level: 'inactive', label: 'Not Active' }), 'Models are not active')
})
