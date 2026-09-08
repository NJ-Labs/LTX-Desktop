const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

function renderSettings({ tab = 'apiKeys', rejectSave = false } = {}) {
  const updates = []
  const exports = {}
  let stateIndex = 0
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useEffect: () => {}, useRef: current => ({ current }),
    useState: initial => {
      const index = stateIndex++
      const value = initial === 'general' ? tab : initial === '' ? 'typed-key' : initial
      return [value, next => updates.push({ index, next })]
    },
  }
  const settings = { hasLtxApiKey: true, ltxApiBaseUrl: '', falApiBaseUrl: '', fastModel: {}, proModel: {}, localDurationCaps: {}, promptEnhancerBaseUrl: '', promptEnhancerModel: '' }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'SettingsModal.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText, {
    exports, require: name => {
      if (name === 'react') return react
      if (name.includes('AppSettingsContext')) return { useAppSettings: () => ({ settings, updateSettings: next => updates.push({ settings: next }), saveLtxApiConfig: async () => { if (rejectSave) throw new Error('offline') } }) }
      if (name.includes('web-mode')) return { isWebMode: () => false }
      if (name.includes('local-video-options')) return { LOCAL_RESOLUTIONS: [], LOCAL_REFERENCE_FPS: 24 }
      return {}
    },
  })
  const tree = exports.SettingsModal({ isOpen: true, onClose: () => {} })
  const nodes = []
  const walk = node => { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; nodes.push(node); walk(node.props?.children) }
  walk(tree)
  return { nodes, updates }
}

test('failed API key save preserves input and exposes an error', async () => {
  const { nodes, updates } = renderSettings({ rejectSave: true })
  const save = nodes.find(node => node.type === 'button' && node.props.children.includes('Save Key'))
  await save.props.onClick()
  // The UI handler intentionally starts the async operation without blocking React.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(updates.some(update => update.next === ''), false)
  assert.equal(updates.some(update => typeof update.next === 'string' && update.next.includes('input is preserved')), true)
})
test('successful API key save clears input only after completion', async () => {
  const { nodes, updates } = renderSettings()
  const save = nodes.find(node => node.type === 'button' && node.props.children.includes('Save Key'))
  save.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(updates.some(update => update.next === ''), true)
})
test('zero prompt-cache capacity remains zero', () => {
  const { nodes, updates } = renderSettings({ tab: 'general' })
  const cache = nodes.find(node => node.type === 'input' && String(node.props.max) === '1000')
  cache.props.onChange({ target: { value: '0' } })
  assert.equal(updates.find(update => update.settings)?.settings.promptCacheSize, 0)
})

test('ordinary settings save exposes rejected HTTP responses', async () => {
  const exports = {}
  const effects = []
  const timers = []
  const updates = []
  let index = 0
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../contexts/AppSettingsContext.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, setTimeout: fn => { timers.push(fn); return 1 }, clearTimeout: () => {},
    require: name => {
      if (name === 'react') return {
        createContext: () => ({ Provider: 'provider' }), useCallback: fn => fn, useMemo: fn => fn(), useEffect: fn => effects.push(fn),
        useState: initial => { const current = index++; return [current === 3 ? true : current === 8 ? 'alive' : initial, value => updates.push({ index: current, value })] },
      }
      if (name === 'react/jsx-runtime') return { jsx: () => null }
      if (name.includes('backend')) return { backendFetch: async () => ({ ok: false, status: 503 }) }
      return {}
    },
  })
  exports.AppSettingsProvider({ children: null })
  effects.find(effect => effect.toString().includes('syncTimer'))()
  await timers[0]()
  assert.equal(updates.some(update => update.index === 1 && update.value.includes('not saved (503)')), true)
})
