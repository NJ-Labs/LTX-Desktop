const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

function setup() {
  let stateIndex = 0
  const calls = []
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'useGapGeneration.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, console, require: name => {
    if (name === 'react') return {
      useState: initial => [[{ trackIndex: 0, startTime: 0, endTime: 5 }, 'text-to-video', 'A moving scene'][stateIndex++] ?? initial, () => {}],
      useRef: current => ({ current }), useEffect: () => {}, useCallback: fn => fn, useMemo: fn => fn(),
    }
    if (name.includes('url-to-path')) return { fileUrlToPath: value => value.startsWith('file://') ? value.slice(7) : null }
    return {}
  } })
  const hook = exports.useGapGeneration({ clips: [], tracks: [], currentProjectId: 'project', projectId: 'project', regenGenerate: async (...args) => { calls.push(args); return { success: true, videoPath: null } } })
  return { hook, calls }
}

test('gap sends selected start and end as native conditioning indices', async () => {
  const { hook, calls } = setup()
  await hook.handleGapGenerate({ start: 'file:///start.png', end: 'file:///end.png' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1], null)
  assert.equal(JSON.stringify(calls[0][4]), JSON.stringify([{ path: '/start.png', frame_idx: 0, strength: 1 }, { path: '/end.png', frame_idx: -1, strength: 1 }]))
})
test('disabled frames do not leak into generation', async () => {
  const { hook, calls } = setup()
  await hook.handleGapGenerate({ start: null, end: null })
  assert.equal(calls[0][4].length, 0)
})
test('unsupported selected image fails before generation starts', async () => {
  const { hook, calls } = setup()
  await assert.rejects(hook.handleGapGenerate({ start: 'https://example.test/image.png', end: null }), /Could not import/)
  assert.equal(calls.length, 0)
})

test('regeneration preserves saved native keyframes and image edit inputs', async () => {
  const exports = {}
  const calls = []
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'useRegeneration.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, console, require: name => {
    if (name === 'react') return { useState: initial => [initial, () => {}], useEffect: () => {}, useCallback: fn => fn }
    if (name.includes('url-to-path')) return { fileUrlToPath: value => value.slice(7) }
    return {}
  } })
  const keyframes = [{ path: '/end.png', frame_idx: -1, strength: 1 }]
  const common = { prompt: 'A scene', model: 'fast', duration: 5, resolution: '1080p', fps: 24, audio: false, cameraMotion: 'none' }
  const hook = exports.useRegeneration({
    currentProjectId: 'project', clips: [],
    assets: [{ id: 'video', generationParams: { ...common, mode: 'image-to-video', imageConditionings: keyframes } }, { id: 'image', generationParams: { ...common, mode: 'text-to-image', inputImageUrl: 'file:///source.png', imageStrength: 0.35 } }],
    regenGenerate: (...args) => calls.push(args), regenGenerateImage: (...args) => calls.push(args),
  })
  await hook.handleRegenerate('video')
  await hook.handleRegenerate('image')
  assert.equal(calls[0][4], keyframes)
  assert.equal(calls[1][2], '/source.png')
  assert.equal(calls[1][3], 0.35)
})
