const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

function load(file, assets = [], selected = null) {
  const exports = {}
  let stateIndex = 0
  const render = (type, props) => typeof type === 'function' ? type(props) : ({ type, props })
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: name => {
      if (name === 'react') return { useState: initial => [stateIndex++ === 0 && initial === null ? selected : initial, () => {}], useRef: current => ({ current }), useEffect: () => {}, useCallback: fn => fn }
      if (name === 'react/jsx-runtime') return { jsx: render, jsxs: render }
      if (name.includes('ProjectContext')) return { useProjects: () => ({ playgroundAssets: assets }) }
      if (name.includes('ui/button')) return { Button: 'button' }
      return {}
    },
  })
  return exports
}
function flatten(node, result = []) {
  if (Array.isArray(node)) node.forEach(child => flatten(child, result))
  else if (node && typeof node === 'object') { result.push(node); flatten(node.props?.children, result) }
  return result
}
test('image result edit and favorite buttons invoke their actions', () => {
  const actions = []
  const component = load('ImageResult.tsx').ImageResult
  const nodes = flatten(component({ imageUrl: '/image.png', isGenerating: false, onEdit: () => actions.push('edit'), onToggleFavorite: () => actions.push('favorite'), onCreateVideo: () => actions.push('video') }))
  nodes.find(node => node.props?.title === 'Edit image').props.onClick()
  nodes.find(node => node.props?.['aria-label'] === 'Favorite image').props.onClick()
  assert.deepEqual(actions, ['edit', 'favorite'])
  assert.equal(nodes.some(node => node.props?.title === 'More options'), false)
})
test('Playground gallery renders saved image and audio with their media elements', () => {
  const assets = [{ id: 'image', type: 'image', url: '/image.png', path: '/image.png' }, { id: 'audio', type: 'audio', url: '/audio.wav', path: '/audio.wav' }]
  for (const asset of assets) {
    const nodes = flatten(load('PlaygroundGallery.tsx', assets, asset).PlaygroundGallery())
    assert.equal(nodes.some(node => node.type === 'video'), false)
    assert.equal(nodes.some(node => node.type === (asset.type === 'image' ? 'img' : 'audio') && node.props.src === asset.url), true)
  }
})
