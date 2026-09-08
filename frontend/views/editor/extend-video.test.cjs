const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')
const exported = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'extend-video.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exported, require: () => ({ fileUrlToPath: () => null, pathToBrowserUrl: path => `file:///${path}` }) })
const source = { id: 'clip', type: 'video', assetId: 'original', startTime: 3, duration: 5, trimStart: 0, trimEnd: 0, speed: 1, reversed: false, linkedClipIds: ['audio'], muted: true }
const asset = { id: 'original', path: 'D:/original.mp4', url: 'file:///D:/original.mp4', takes: [{ path: 'D:/first.mp4' }, { path: 'D:/second.mp4' }] }
test('extension uses selected take, otherwise latest active source', () => {
  assert.equal(exported.extensionSource(source, asset).path, 'D:/second.mp4')
  assert.equal(exported.extensionSource({ ...source, takeIndex: 0 }, asset).path, 'D:/first.mp4')
})
test('legacy pinned take derives its URL from its own path', () => {
  const result = exported.extensionSource({ ...source, takeIndex: 0 }, { ...asset, activeTakeIndex: 1 })
  assert.equal(result.path, 'D:/first.mp4')
  assert.equal(result.url, 'file:///D:/first.mp4')
})
test('trimmed, reversed, retimed and remote sources cannot silently extend the wrong frames', () => {
  for (const change of [{ trimStart: 1 }, { trimEnd: 1 }, { reversed: true }, { speed: 2 }]) assert.throws(() => exported.extensionSource({ ...source, ...change }, asset), /Render/)
  assert.throws(() => exported.extensionSource(source, { path: 'https://example.com/video.mp4', url: '' }), /Import/)
})
test('replace retains start, extends matching linked audio and ripples later clips', () => {
  const audio = { ...source, id: 'audio', type: 'audio', muted: false }
  const later = { ...source, id: 'later', startTime: 8 }
  const overlap = { ...source, id: 'overlap', startTime: 6 }
  const result = exported.replaceWithExtension([source, audio, later, overlap], source, { id: 'extended', duration: 9 })
  assert.equal(result[0].startTime, 3)
  assert.equal(result[0].duration, 9)
  assert.equal(result[0].muted, true)
  assert.equal(result[1].assetId, 'extended')
  assert.equal(result[1].duration, 9)
  assert.equal(result[2].startTime, 12)
  assert.equal(result[3].startTime, 6)
  assert.equal(source.duration, 5)
})
test('stale source and invalid returned duration cannot overwrite timeline', () => {
  assert.throws(() => exported.replaceWithExtension([{ ...source, duration: 4 }], source, { id: 'extended', duration: 9 }), /source clip changed/)
  assert.throws(() => exported.replaceWithExtension([source], source, { id: 'extended' }), /not longer/)
})
