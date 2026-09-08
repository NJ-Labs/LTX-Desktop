const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

function configuredPolicy(isDev, initialBackend = '') {
  let listener
  let backend = initialBackend
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'csp.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, URL,
    require(name) {
      if (name === 'electron') return { session: { defaultSession: { webRequest: { onHeadersReceived(callback) { listener = callback } } } } }
      if (name === './config') return { isDev }
      if (name === './python-backend') return { getBackendUrl: () => backend }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  })
  exports.setupCSP()
  assert.equal(typeof listener, 'function')
  return {
    setBackend(value) { backend = value },
    headers(url) {
      let response
      listener({ url, responseHeaders: { 'Content-Type': ['text/html'], 'X-Test': ['preserved'] } }, value => { response = value })
      assert.equal(response.responseHeaders['X-Test'][0], 'preserved')
      const policy = response.responseHeaders['Content-Security-Policy'][0]
      return Object.fromEntries(policy.split(';').map(directive => { const [key, ...values] = directive.trim().split(/\s+/); return [key, values] }))
    },
  }
}

for (const isDev of [true, false]) {
  test(`${isDev ? 'development' : 'production'} renderer permits loopback media before backend startup`, () => {
    const setup = configuredPolicy(isDev)
    const csp = setup.headers(isDev ? 'http://localhost:5173/' : 'file:///D:/Studio/index.html')
    for (const directive of ['img-src', 'media-src']) {
      assert.ok(csp[directive].includes('http://127.0.0.1:*'))
      assert.ok(csp[directive].includes('http://localhost:*'))
    }
    assert.ok(!csp['script-src'].includes("'unsafe-eval'"))
    assert.deepEqual(csp['frame-ancestors'], ["'none'"])
  })
}

test('managed Comfy editor permits its compiler, embedded WASM, websocket and Studio parent', () => {
  const setup = configuredPolicy(false)
  setup.setBackend('http://127.0.0.1:8123')
  const csp = setup.headers('http://127.0.0.1:8123/comfyui-server/')
  assert.ok(csp['script-src'].includes("'unsafe-eval'"))
  for (const source of ["'self'", 'data:', 'blob:', 'ws://127.0.0.1:8123']) assert.ok(csp['connect-src'].includes(source))
  for (const parent of ["'self'", 'http://localhost:5173', 'file:']) assert.ok(csp['frame-ancestors'].includes(parent))
  assert.ok(!csp['frame-ancestors'].includes("'none'"))
  assert.deepEqual(csp['object-src'], ["'none'"])
})

test('Comfy permissions do not escape the managed backend path and origin', () => {
  const setup = configuredPolicy(false, 'http://127.0.0.1:8123')
  for (const url of ['http://127.0.0.1:8123/api/health', 'http://127.0.0.1:9000/comfyui-server/', 'https://example.com/comfyui-server/']) {
    const csp = setup.headers(url)
    assert.ok(!csp['script-src'].includes("'unsafe-eval'"))
    assert.ok(!csp['connect-src'].includes('data:'))
    assert.deepEqual(csp['frame-ancestors'], ["'none'"])
  }
})
