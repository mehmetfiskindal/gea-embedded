import { defineConfig } from 'vite'

const web = process.env.GEA_EMBEDDED_TARGET === 'web'
const appId = 'bouncing-balls'

export default defineConfig({
  build: {
    lib: {
      entry: 'index.ts',
      formats: [web ? 'es' : 'iife'],
      ...(web ? {} : { name: 'gea_embedded' }),
      fileName: () => (web ? 'app.js' : 'index.js')
    },
    outDir: web ? `../../simulator/public/apps/${appId}` : `../../targets/esp32-s3-touch-amoled-2.06/build/apps/${appId}/dist`,
    emptyOutDir: !web,
    minify: false
  }
})
