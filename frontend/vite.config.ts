import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Get version and git info
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'))
const gitHash = execSync('git rev-parse --short HEAD').toString().trim()
const appVersion = `v${pkg.version.replace('-nightly', '')}+${gitHash}`

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:47778'
      }
    }
  }
})
