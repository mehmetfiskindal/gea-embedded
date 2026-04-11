import { mkdirSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { collectCompilerDefinitions } from './definitions'
import { loadCssAssets } from './css-assets'
import { emitTemplate } from './template'
import { generateCSource } from './c/generate'
import { generateThinJs } from './thin-js'
import { writeGeneratedFonts } from './fonts/write'
import type { CompilerDefinitions, EmbeddedDefaults, GeaEmbeddedPluginOptions } from './types'

export interface CompileResult {
  code: string
  map: null
  meta: { geaEmbeddedGeneratedC: string }
}

export function compileGeaEmbeddedTsx(
  code: string,
  id: string,
  projectRoot: string,
  options: GeaEmbeddedPluginOptions
): CompileResult | null {
  if (!id.endsWith('.tsx')) return null

  const defs = collectCompilerDefinitions(code, id)
  if (!defs.hasGeaEmbeddedImport) return null
  if (!defs.mountTarget || !defs.componentClasses.has(defs.mountTarget)) return null

  const { cssClassRules, fontFaces } = loadCssAssets(defs.cssImports)
  const template = emitTemplate(code, defs, cssClassRules, fontFaces)
  const generatedC = generateCSource(defs, template)
  writeGeneratedFiles(projectRoot, options, defs, generatedC, template.fontTuples, fontFaces)

  return {
    code: generateThinJs(defs, template),
    map: null,
    meta: { geaEmbeddedGeneratedC: generatedC }
  }
}

function writeGeneratedFiles(
  projectRoot: string,
  options: GeaEmbeddedPluginOptions,
  defs: CompilerDefinitions,
  generatedC: string,
  fontTuples: Parameters<typeof writeGeneratedFonts>[0],
  fontFaces: Map<string, string>
): void {
  const cOutputPath = resolve(projectRoot, process.env.GEA_EMBEDDED_C_OUTPUT || options.cOutput)
  mkdirSync(dirname(cOutputPath), { recursive: true })
  writeFileSync(cOutputPath, generatedC)
  writeFileSync(resolve(dirname(cOutputPath), 'gea_embedded_app_config.h'), generateAppConfigHeader(options, defs))
  writeGeneratedFonts(
    fontTuples,
    fontFaces,
    resolve(dirname(cOutputPath), 'gea_embedded_font_generated.c'),
    resolve(dirname(cOutputPath), 'gea_embedded_font_generated.h')
  )
}

function generateAppConfigHeader(options: GeaEmbeddedPluginOptions, defs: CompilerDefinitions): string {
  const defaults = mergeDefaults(options, defs.embeddedDefaults)
  const lines = ['#pragma once', '#define GEA_EMBEDDED_PURE_C 1']
  const flushChunkRows = positiveInteger(defaults.display?.flushChunkRows)
  const flushQueueDepth = positiveInteger(defaults.display?.flushQueueDepth)
  if (flushChunkRows) lines.push(`#define GEA_EMBEDDED_DISPLAY_FLUSH_CHUNK_MAX ${flushChunkRows}`)
  if (flushQueueDepth) lines.push(`#define GEA_EMBEDDED_DISPLAY_FLUSH_QUEUE_DEPTH ${flushQueueDepth}`)
  if (defaults.mirror === false) lines.push('#define GEA_EMBEDDED_MIRROR_DISABLED 1')
  if (defaults.wifi === false) lines.push('#define GEA_EMBEDDED_WIFI_DISABLED 1')
  return `${lines.join('\n')}\n`
}

function mergeDefaults(options: GeaEmbeddedPluginOptions, appDefaults: EmbeddedDefaults): EmbeddedDefaults {
  return {
    display: {
      ...options.display,
      ...appDefaults.display
    },
    mirror: appDefaults.mirror ?? options.mirror,
    wifi: appDefaults.wifi ?? options.wifi
  }
}

function positiveInteger(value: number | undefined): number | null {
  if (value === undefined) return null
  const rounded = Math.floor(value)
  return rounded > 0 ? rounded : null
}
