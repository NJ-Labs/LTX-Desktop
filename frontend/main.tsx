import React from 'react'
import ReactDOM from 'react-dom/client'
import { installWebElectronShim } from './lib/electron-web-shim'
import App from './App'
import './index.css'

installWebElectronShim()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
