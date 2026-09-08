const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

// Execute the real menu callbacks without mounting the GPU-dependent editor.
const moduleExports = {}
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, 'buildMenuDefinitions.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText, {
  exports: moduleExports,
  require: name => name.includes('video-editor-utils')
    ? { getShortcutLabel: () => '' }
    : { TEXT_PRESETS: [] },
})

function setup(clips = []) {
  const state = { clips, tracks: [], history: [] }
  const params = {
    selectedClip: clips[0], selectedClipIds: new Set(), clips, tracks: [], subtitles: [],
    pushUndo: () => state.history.push('clips'),
    pushTrackUndo: () => state.history.push('tracks'),
    setTracks: update => { state.tracks = update(state.tracks) },
    setClips: update => { state.clips = update(state.clips) },
    updateClip: (id, updates) => { state.clips = state.clips.map(clip => clip.id === id ? { ...clip, ...updates } : clip) },
  }
  const items = moduleExports.buildMenuDefinitions(params).flatMap(menu => menu.items)
  return { state, item: id => items.find(item => item.id === id) }
}

test('adding video and audio tracks saves track history for Undo', () => {
  for (const kind of ['video', 'audio']) {
    const { state, item } = setup()
    item(`add-${kind}-track`).action()
    assert.equal(state.tracks[0].kind, kind)
    assert.deepEqual(state.history, ['tracks'])
  }
})

test('Link Audio links matching clips in both directions', () => {
  const { state, item } = setup([
    { id: 'video', type: 'video', assetId: 'asset', startTime: 0 },
    { id: 'audio', type: 'audio', assetId: 'asset', startTime: 0 },
    { id: 'unrelated', type: 'audio', assetId: 'other', startTime: 0 },
  ])
  assert.equal(item('link-audio').disabled, false)
  item('link-audio').action()
  assert.equal(state.clips[0].linkedClipIds[0], 'audio')
  assert.equal(state.clips[1].linkedClipIds[0], 'video')
  assert.equal(state.clips[2].linkedClipIds, undefined)
  assert.deepEqual(state.history, ['clips'])
})

test('Link Audio is disabled without a matching audio clip', () => {
  const { state, item } = setup([{ id: 'video', type: 'video', assetId: 'asset', startTime: 0 }])
  assert.equal(item('link-audio').disabled, true)
  item('link-audio').action()
  assert.equal(state.history.length, 0)
})

test('Unlink Audio removes reciprocal links', () => {
  const { state, item } = setup([
    { id: 'video', type: 'video', linkedClipIds: ['audio'] },
    { id: 'audio', type: 'audio', linkedClipIds: ['video'] },
  ])
  item('link-audio').action()
  assert.equal(state.clips[0].linkedClipIds, undefined)
  assert.equal(state.clips[1].linkedClipIds.length, 0)
})

test('speed menu keeps the same source interval by adjusting timeline duration', () => {
  const { state, item } = setup([{ id: 'video', type: 'video', duration: 10, speed: 1 }])
  item('speed-200').action()
  assert.equal(state.clips[0].speed, 2)
  assert.equal(state.clips[0].duration, 5)
})

test('duplicate creates a separate linked group without linking copies to originals', () => {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'useClipOperations.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, crypto: require('node:crypto').webcrypto, require: name => name === 'react' ? { useCallback: fn => fn } : {} })
  const clips = [
    { id: 'video', type: 'video', startTime: 0, duration: 5, linkedClipIds: ['audio'] },
    { id: 'audio', type: 'audio', startTime: 0, duration: 5, linkedClipIds: ['video'] },
  ]
  let result = []
  let history = 0
  const hook = exports.useClipOperations({ clips, tracks: [], setClips: value => { result = value }, pushUndo: () => { history++ } })
  hook.duplicateClip('video')
  assert.equal(result.length, 4)
  assert.equal(result[2].linkedClipIds[0], result[3].id)
  assert.equal(result[3].linkedClipIds[0], result[2].id)
  assert.equal(result[0].linkedClipIds[0], 'audio')
  assert.equal(result[2].startTime, 5)
  assert.equal(history, 1)
})
