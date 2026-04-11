import type { Plugin } from 'vite'
import { compileGeaEmbeddedTsx } from './compile'
import type { GeaEmbeddedPluginOptions } from './types'

export function geaEmbeddedPlugin(options: GeaEmbeddedPluginOptions): Plugin {
  let projectRoot = ''
  return {
    name: 'vite-plugin-gea-embedded',
    enforce: 'pre' as const,
    configResolved(config) {
      projectRoot = config.root
    },
    transform(code: string, id: string) {
      return compileGeaEmbeddedTsx(code, id, projectRoot, options)
    }
  }
}

export type { GeaEmbeddedPluginOptions }
