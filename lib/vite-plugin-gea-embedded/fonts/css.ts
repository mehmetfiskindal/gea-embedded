import { resolve } from 'path'
import type { FontFaceEntry } from '../types'

export function parseFontFaceDeclarations(cssText: string, cssDir: string): FontFaceEntry[] {
  const entries: FontFaceEntry[] = []
  const re = /@font-face\s*\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cssText)) !== null) {
    const block = m[1]
    const familyMatch = block.match(/font-family\s*:\s*['"]([^'"]+)['"]/)
    const srcMatch = block.match(/src\s*:\s*url\(['"]?([^'")]+)['"]?\)/)
    if (familyMatch && srcMatch) {
      entries.push({ family: familyMatch[1], src: resolve(cssDir, srcMatch[1]) })
    }
  }
  return entries
}
