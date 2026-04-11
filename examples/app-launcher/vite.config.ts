import { defineConfig } from 'vite'
import { resolve } from 'path'
import { geaEmbeddedPlugin } from '../../lib/vite-plugin-gea-embedded'

const web = process.env.GEA_EMBEDDED_TARGET === 'web'
const appId = 'app-launcher'

export default defineConfig({
  plugins: [
    geaEmbeddedPlugin({
      cOutput: web
        ? `../../targets/web/generated/${appId}/gea_embedded_app_generated.c`
        : `../../targets/esp32-s3-touch-amoled-2.06/build/apps/${appId}/gea_embedded_app_generated.c`
    })
  ],
  resolve: {
    alias: {
      'gea-embedded': resolve(__dirname, '../../lib/gea-embedded')
    }
  },
  build: {
    lib: {
      entry: 'index.tsx',
      formats: [web ? 'es' : 'iife'],
      ...(web ? {} : { name: 'gea_embedded' }),
      fileName: () => (web ? 'app.js' : 'index.js')
    },
    outDir: web ? `../../simulator/public/apps/${appId}` : `../../targets/esp32-s3-touch-amoled-2.06/build/apps/${appId}/dist`,
    emptyOutDir: !web,
    minify: false
  }
})
