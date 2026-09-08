const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8')
function load(file, require, globals = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require, ...globals })
  return exports
}
const jsx = (type, props) => ({ type, props })
const flatten = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(flatten) : [node, ...flatten(node.props?.children)]

test('Comfy temporal output metadata preserves duration and rejects unreadable media', async () => {
  for (const kind of ['video', 'audio', 'failure']) {
    class Video {}
    const media = Object.assign(kind === 'video' ? new Video() : {}, { duration: 12.5, videoWidth: 1280, videoHeight: 720, removeAttribute() {}, load() {} })
    Object.defineProperty(media, 'src', { set() { queueMicrotask(() => kind === 'failure' ? media.onerror() : media.onloadedmetadata()) } })
    const api = load('ComfyWorkflowPanel.tsx', () => ({}), { document: { createElement: () => media }, window: { setTimeout }, clearTimeout, HTMLVideoElement: Video })
    const result = api.outputMetadata({ media_type: kind === 'audio' ? 'audio' : 'video', url: '/media' })
    if (kind === 'failure') await assert.rejects(result, /Could not read media duration/)
    else { const metadata = await result; assert.equal(metadata.duration, 12.5); assert.equal(metadata.resolution, kind === 'video' ? '1280x720' : '') }
  }
})

test('saving an imported workflow does not replace the iframe workflow association', async () => {
  for (const fromEditor of [false, true]) {
    let stateIndex = 0, refIndex = 0
    const previous = { id: 'editor-A' }, saved = { id: 'import-B' }, refs = []
    const api = load('../views/ComfyUI.tsx', name => {
      if (name === 'react') return { useState(initial) { const i = stateIndex++; return [i === 3 ? { name: 'B', inputs: [] } : i === 9 ? true : initial, () => {}] }, useRef(initial) { const i = refIndex++; return refs[i] = { current: i === 2 ? fromEditor : i === 3 ? previous : initial } }, useEffect() {}, useCallback: fn => fn }
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (name.includes('ProjectContext')) return { useProjects: () => ({}) }
      if (name.includes('comfy-workflows')) return { comfyRequest: async () => saved, scalarInputs: () => [] }
      return {}
    })
    const form = flatten(api.ComfyUI()).find(node => node.type === 'form')
    form.props.onSubmit({ preventDefault() {} })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(refs[3].current, fromEditor ? saved : previous)
  }
})

test('GenSpace clipboard failure never displays a copied success', async () => {
  const source = read('../views/GenSpace.tsx')
  const match = source.match(/onClick=\{(async \(\) => \{\s*setCopyPromptError[\s\S]*?)\}\}/)
  assert.ok(match)
  const values = []
  const action = vm.runInNewContext('(' + match[1] + '})', { selectedAsset: { prompt: 'test' }, navigator: { clipboard: { writeText: async () => { throw Error('denied') } } }, setCopyPromptError: value => values.push(value), setCopiedPrompt: value => values.push(value), setTimeout })
  await action()
  assert.equal(values.includes(true), false)
  assert.ok(values.some(value => typeof value === 'string' && value.includes('Could not copy')))
})

test('gallery repeat-copy failure clears the previous success indicator', async () => {
  const match = read('PlaygroundGallery.tsx').match(/onClick=\{(async \(\) => \{\s*setCopyError[\s\S]*?)\}\}/)
  assert.ok(match)
  let copied = false, error = '', reject = false
  const action = vm.runInNewContext('(' + match[1] + '})', {
    selectedAsset: { prompt: 'test' },
    navigator: { clipboard: { writeText: async () => { if (reject) throw Error('denied') } } },
    setCopyError: value => { error = value }, setCopiedPrompt: value => { copied = value }, setTimeout: () => 1,
  })
  await action()
  assert.equal(copied, true)
  reject = true
  await action()
  assert.equal(copied, false)
  assert.match(error, /Could not copy/)
})

test('gallery preview takes focus, wraps Tab and restores its opener', () => {
  const events = {}, effects = [], focus = []
  const controls = [{ focus: () => focus.push('first') }, { focus: () => focus.push('last') }]
  const opener = { focus: () => focus.push('opener') }
  const preview = { focus: () => focus.push('preview'), contains: () => true, querySelectorAll: () => controls }
  const document = { activeElement: opener, addEventListener() {}, removeEventListener() {} }
  let stateIndex = 0
  const asset = { id: 'one', type: 'image', url: '/image', prompt: '' }
  const api = load('PlaygroundGallery.tsx', name => {
    if (name === 'react') return { useState(initial) { return [stateIndex++ === 0 ? asset : initial, () => {}] }, useRef: () => ({ current: preview }), useEffect: fn => effects.push(fn), useCallback: fn => fn }
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (name.includes('ProjectContext')) return { useProjects: () => ({ playgroundAssets: [asset] }) }
    return {}
  }, { document, window: { addEventListener: (name, fn) => { events[name] = fn }, removeEventListener() {} } })
  const dialog = flatten(api.PlaygroundGallery()).find(node => node.props?.role === 'dialog')
  assert.equal(dialog.props['aria-modal'], 'true')
  const cleanups = effects.map(fn => fn())
  assert.ok(focus.includes('preview'))
  document.activeElement = controls[1]
  let prevented = false
  events.keydown({ key: 'Tab', preventDefault: () => { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(focus.at(-1), 'first')
  cleanups.forEach(fn => fn?.())
  assert.equal(focus.at(-1), 'opener')
})
