import { session } from 'electron'
import { isDev } from './config'
import { getBackendUrl } from './python-backend'

// Enforce Content Security Policy via response headers (tamper-proof from renderer)
export function setupCSP(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const backend = getBackendUrl()
    const backendOrigin = backend ? new URL(backend).origin : ''
    const target = new URL(details.url)
    const comfyFrame = target.origin === backendOrigin && target.pathname.startsWith('/comfyui-server/')
    if (comfyFrame) {
      // The editor is served by our authenticated backend and intentionally
      // embedded by Studio. Applying frame-ancestors 'none' here blocked it.
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [[
        // Comfy's Vue i18n compiler uses Function and its 3D bundle fetches an
        // embedded WASM data URL. These permissions apply only to this editor.
        "default-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'", "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:", "media-src 'self' blob:", "worker-src 'self' blob:",
        "connect-src 'self' data: blob: " + backendOrigin.replace(/^http/, 'ws'),
        "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self' http://localhost:5173 file:",
      ].join('; ')] } })
      return
    }
    const csp = isDev
      ? [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
          "frame-src 'self' http://localhost:* http://127.0.0.1:*",
          `img-src 'self' data: blob: file: http://127.0.0.1:* http://localhost:* ${backendOrigin}`,
          `media-src 'self' blob: file: http://127.0.0.1:* http://localhost:* ${backendOrigin}`,
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
        ].join('; ')
      : [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
          "frame-src 'self' http://localhost:* http://127.0.0.1:*",
          `img-src 'self' data: blob: file: http://127.0.0.1:* http://localhost:* ${backendOrigin}`,
          `media-src 'self' blob: file: http://127.0.0.1:* http://localhost:* ${backendOrigin}`,
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
        ].join('; ')

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })
}
