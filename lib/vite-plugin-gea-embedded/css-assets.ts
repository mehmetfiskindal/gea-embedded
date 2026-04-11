import { dirname } from 'path'
import { existsSync, readFileSync, realpathSync } from 'fs'
import type { CssClassRules } from './types'
import { mergeCssClassRules, parseCssClassRules } from './style'
import { parseFontFaceDeclarations } from './fonts/css'

export function loadCssAssets(cssImports: string[]): { cssClassRules: CssClassRules; fontFaces: Map<string, string> } {
  const cssClassRules: CssClassRules = { normal: new Map(), active: new Map() }
  const fontFaces = new Map<string, string>()

  for (const cssPath of cssImports) {
    if (!existsSync(cssPath)) continue
    const realCssPath = realpathSync(cssPath)
    const cssText = readFileSync(realCssPath, 'utf8')
    mergeCssClassRules(cssClassRules, parseCssClassRules(cssText))
    for (const face of parseFontFaceDeclarations(cssText, dirname(realCssPath))) fontFaces.set(face.family, face.src)
  }

  return { cssClassRules, fontFaces }
}
