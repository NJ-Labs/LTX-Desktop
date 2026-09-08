const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

function setup() {
  const requests = []
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'use-generation.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, AbortController, console, setInterval: () => 1, clearInterval: () => {},
    require: name => {
      if (name === 'react') return { useState: initial => [initial, () => {}], useCallback: fn => fn, useRef: current => ({ current }) }
      if (name.includes('AppSettingsContext')) return { useAppSettings: () => ({ settings: {}, forceApiGenerations: false }) }
      if (name.includes('backend')) return { backendFetch: async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ status: 'complete', image_paths: ['/result.png'], video_path: '/result.mp4' }) } } }
      if (name.includes('web-mode')) return { pathToBrowserUrl: value => value }
      return {}
    },
  })
  return { hook: exports.useGeneration(), requests }
}
const settings = { imageResolution: '1080p', imageAspectRatio: '1:1', imageSteps: 4, variations: 1 }
test('image edits send source and chosen strength to the real API request builder', async () => {
  const { hook, requests } = setup()
  await hook.generateImage('Change the sky', settings, '/source.png', 0.35)
  assert.equal(requests[0].url, '/api/generate-image')
  assert.equal(requests[0].body.imagePath, '/source.png')
  assert.equal(requests[0].body.strength, 0.35)
})
test('text-only images omit source conditioning', async () => {
  const { hook, requests } = setup()
  await hook.generateImage('A landscape', settings)
  assert.equal('imagePath' in requests[0].body, false)
  assert.equal('strength' in requests[0].body, false)
})
