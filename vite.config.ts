import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

const isWebBuild = process.env.BUILD_TARGET === 'web'

export default defineConfig({
  plugins: [
    react(),
    ...(!isWebBuild
      ? [
          electron([
            {
              entry: 'electron/main.ts',
              onstart(options) {
                if (process.env.ELECTRON_DEBUG) {
                  options.startup(['--inspect=9229', '--remote-debugging-port=9222', '.', '--no-sandbox'])
                } else {
                  options.startup()
                }
              },
              vite: {
                build: {
                  outDir: 'dist-electron',
                  sourcemap: true,
                  rollupOptions: {
                    external: ['electron']
                  }
                }
              }
            },
            {
              entry: 'electron/preload.ts',
              onstart(options) {
                options.reload()
              },
              vite: {
                build: {
                  outDir: 'dist-electron',
                  sourcemap: true,
                  rollupOptions: {
                    output: {
                      format: 'cjs'
                    }
                  }
                }
              }
            }
          ]),
          renderer(),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './frontend')
    }
  },
  server: isWebBuild
    ? {
        proxy: {
          '/api': {
            target: 'http://127.0.0.1:8001',
            changeOrigin: true,
          },
          '/health': {
            target: 'http://127.0.0.1:8001',
            changeOrigin: true,
          },
          '/readyz': {
            target: 'http://127.0.0.1:8001',
            changeOrigin: true,
          },
          '/media': {
            target: 'http://127.0.0.1:8001',
            changeOrigin: true,
          },
          '/comfyui-server': {
            target: 'http://127.0.0.1:8001',
            changeOrigin: true,
            ws: true,
          },
          '/ws': {
            target: 'ws://127.0.0.1:8001',
            changeOrigin: true,
            ws: true,
          },
        },
      }
    : undefined,
  base: isWebBuild ? '/' : './',
  build: {
    outDir: 'dist'
  }
})
