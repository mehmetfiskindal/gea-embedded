import { defineConfig } from 'vite'
import { resolve } from 'path'
import { geaEmbeddedPlugin } from '../../lib/vite-plugin-gea-embedded'
import { resolveAppPaths } from '../../lib/vite-plugin-gea-embedded/target-paths'

const paths = resolveAppPaths('tilt-breakout')

export default defineConfig({
  plugins: [
    geaEmbeddedPlugin({
      cOutput: paths.cOutput
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
      formats: [paths.format],
      ...(paths.libName ? { name: paths.libName } : {}),
      fileName: paths.fileName
    },
    outDir: paths.outDir,
    emptyOutDir: process.env.GEA_EMBEDDED_TARGET !== 'web',
    minify: false
  }
})
