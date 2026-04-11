import { writeFileSync } from 'fs'
import type { BakedFont, FontTuple } from '../types'
import { generateFontC } from './generate'
import { rasterizeFont } from './rasterize'

export function writeGeneratedFonts(fontTuples: Map<string, FontTuple>, fontFaces: Map<string, string>, fontCPath: string, fontHPath: string): void {
  if (fontTuples.size > 0) {
    const bakedFonts: BakedFont[] = []
    let fontId = 0
    for (const [, tuple] of fontTuples) {
      const fontPath = fontFaces.get(tuple.family)
      if (!fontPath) {
        throw new Error(
          `gea-embedded: fontFamily '${tuple.family}' used in JSX but no matching @font-face declaration found. ` +
            `Import a CSS file with @font-face { font-family: '${tuple.family}'; src: url('./path/to/font.ttf'); }`
        )
      }
      bakedFonts.push(rasterizeFont(fontPath, tuple.family, tuple.sizePx, fontId++))
    }

    const { cSource, hSource } = generateFontC(bakedFonts)
    writeFileSync(fontCPath, cSource)
    writeFileSync(fontHPath, hSource)
    return
  }

  const stubH = [
    '#pragma once',
    '#define GEA_EMBEDDED_HAS_GENERATED_FONTS 1',
    '#include <stdint.h>',
    '',
    'typedef struct { uint8_t codepoint; uint16_t atlas_x, atlas_y; uint8_t width, height, advance; int8_t bearing_x, bearing_y; } gea_embedded_glyph_t;',
    'typedef struct { int id, size_px, line_height, ascender, descender, glyph_count; const gea_embedded_glyph_t *glyphs; int atlas_w, atlas_h; const uint8_t *atlas; } gea_embedded_font_t;',
    '#define GEA_EMBEDDED_FONT_COUNT 0',
    'extern const gea_embedded_font_t gea_embedded_fonts[1];',
    'const gea_embedded_font_t *gea_embedded_font_lookup(int font_id);',
    ''
  ].join('\n')
  const stubC = [
    '#include "gea_embedded_font_generated.h"',
    'const gea_embedded_font_t gea_embedded_fonts[1] = {{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }};',
    'const gea_embedded_font_t *gea_embedded_font_lookup(int font_id) { return &gea_embedded_fonts[0]; }',
    ''
  ].join('\n')
  writeFileSync(fontHPath, stubH)
  writeFileSync(fontCPath, stubC)
}
