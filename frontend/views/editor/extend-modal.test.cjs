const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

for (const limitsData of [
  { max_additional_seconds: 15, minimum_additional_seconds: 2, can_extend: true },
  { max_additional_seconds: 2.333333333, minimum_additional_seconds: 2, can_extend: true },
  { max_additional_seconds: 1.333333333, minimum_additional_seconds: 2, can_extend: false },
]) test(`frame cap ${limitsData.max_additional_seconds}: bounds submission and terminal cancellation`, async () => {
  const exports = {}, states = [], refs = [], requests = []
  let stateIndex = 0, refIndex = 0, effectIndex = 0, saveStarted = false, finishSave
  const effects = []
  const saving = new Promise(resolve => { finishSave = resolve })
  const jsx = (type, props) => ({ type, props })
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'ExtendVideoModal.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
    document: { createElement() { return { duration: 5, removeAttribute() {}, load() {}, set src(value) { this.duration = value.includes('result') ? 9 : 5; queueMicrotask(() => this.onloadedmetadata?.()) } } } },
    require(name) {
      if (name === 'react') return {
        useState(initial) { const i = stateIndex++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] },
        useRef(initial) { const i = refIndex++; return refs[i] ||= { current: initial } }, useEffect(fn) { const i = effectIndex++; if (!effects[i]) { effects[i] = true; fn() } },
      }
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (name.includes('backend')) return { backendFetch: async url => { requests.push(url); return { ok: true, status: 200, json: async () => url.includes('/limits?') ? limitsData : ({ status: 'complete', video_path: 'result.mp4' }) } } }
      if (name.includes('generation-poll')) return { isGatewayTimeoutStatus: () => false }
      if (name.includes('web-mode')) return { pathToBrowserUrl: path => path }
      return {}
    },
  })
  const props = { source: { path: 'source.mp4', url: 'source.mp4' }, sourceDuration: 5, onClose() {}, async onComplete() { saveStarted = true; await saving } }
  const flatten = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(flatten) : [node, ...flatten(node.props?.children)]
  const render = () => { stateIndex = 0; refIndex = 0; effectIndex = 0; return flatten(exports.ExtendVideoModal(props)) }
  let nodes = render()
  await new Promise(resolve => setImmediate(resolve))
  nodes = render()
  const numberInput = nodes.find(node => node.type === 'input' && node.props.type === 'number')
  assert.equal(numberInput.props.max, Math.floor(limitsData.max_additional_seconds * 1000) / 1000)
  if (!limitsData.can_extend) {
    assert.equal(numberInput.props.disabled, true)
    assert.equal(nodes.find(node => node.type === 'button' && node.props.children === 'Extend video').props.disabled, true)
    assert.equal(requests.some(url => url === '/api/extend'), false)
    return
  }
  assert.ok(Number(numberInput.props.value) <= numberInput.props.max)
  numberInput.props.onChange({ target: { value: String(numberInput.props.max + 0.001) } })
  assert.equal(render().find(node => node.type === 'button' && node.props.children === 'Extend video').props.disabled, true)
  numberInput.props.onChange({ target: { value: String(numberInput.props.max) } })
  nodes = render()
  nodes.find(node => node.type === 'textarea').props.onChange({ target: { value: 'Continue walking' } })
  nodes = render()
  nodes.find(node => node.type === 'button' && node.props.children === 'Extend video').props.onClick()
  const staleCancel = render().find(node => node.type === 'button' && node.props.children === 'Cancel generation').props.onClick
  for (let i = 0; i < 20 && !saveStarted; i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(saveStarted, true)
  const saveButton = render().find(node => node.type === 'button' && node.props.children === 'Saving…')
  assert.equal(saveButton.props.disabled, true)
  staleCancel()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.includes('/api/generate/cancel'), false)
  finishSave()
})
