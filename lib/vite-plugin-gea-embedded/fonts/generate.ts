import type { BakedFont } from '../types'

export function generateFontC(bakedFonts: BakedFont[]): { cSource: string; hSource: string } {
  const hLines: string[] = [
    '#pragma once',
    '#define GEA_EMBEDDED_HAS_GENERATED_FONTS 1',
    '#include <stdint.h>',
    '',
    'typedef struct {',
    '\tuint8_t codepoint;',
    '\tuint16_t atlas_x, atlas_y;',
    '\tuint8_t width, height;',
    '\tuint8_t advance;',
    '\tint8_t bearing_x, bearing_y;',
    '} gea_embedded_glyph_t;',
    '',
    'typedef struct {',
    '\tint id;',
    '\tint size_px;',
    '\tint line_height;',
    '\tint ascender;',
    '\tint descender;',
    '\tint glyph_count;',
    '\tconst gea_embedded_glyph_t *glyphs;',
    '\tint atlas_w, atlas_h;',
    '\tconst uint8_t *atlas;',
    '} gea_embedded_font_t;',
    '',
    `#define GEA_EMBEDDED_FONT_COUNT ${bakedFonts.length}`,
    'extern const gea_embedded_font_t gea_embedded_fonts[GEA_EMBEDDED_FONT_COUNT];',
    '',
    'const gea_embedded_font_t *gea_embedded_font_lookup(int font_id);',
    ''
  ]

  const cLines: string[] = ['#include "gea_embedded_font_generated.h"', '']

  for (const bf of bakedFonts) {
    const atlasName = `font_atlas_${bf.id}`
    cLines.push(`static const uint8_t ${atlasName}[${bf.atlasData.length}] = {`)
    for (let i = 0; i < bf.atlasData.length; i += 32) {
      const chunk = Array.from(bf.atlasData.slice(i, Math.min(i + 32, bf.atlasData.length)))
      cLines.push('\t' + chunk.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(',') + ',')
    }
    cLines.push('};', '')

    const glyphsName = `font_glyphs_${bf.id}`
    cLines.push(`static const gea_embedded_glyph_t ${glyphsName}[${bf.glyphs.length}] = {`)
    for (const g of bf.glyphs) {
      cLines.push(
        `\t{ ${g.codepoint}, ${g.atlasX}, ${g.atlasY}, ${g.width}, ${g.height}, ${g.advance}, ${g.bearingX}, ${g.bearingY} },`
      )
    }
    cLines.push('};', '')
  }

  cLines.push(`const gea_embedded_font_t gea_embedded_fonts[GEA_EMBEDDED_FONT_COUNT] = {`)
  for (const bf of bakedFonts) {
    cLines.push(
      `\t{ ${bf.id}, ${bf.sizePx}, ${bf.lineHeight}, ${bf.ascender}, ${bf.descender}, ${bf.glyphs.length}, font_glyphs_${bf.id}, ${bf.atlasWidth}, ${bf.atlasHeight}, font_atlas_${bf.id} },`
    )
  }
  cLines.push('};', '')
  cLines.push('const gea_embedded_font_t *gea_embedded_font_lookup(int font_id) {')
  cLines.push('\tfor (int i = 0; i < GEA_EMBEDDED_FONT_COUNT; i++) {')
  cLines.push('\t\tif (gea_embedded_fonts[i].id == font_id) return &gea_embedded_fonts[i];')
  cLines.push('\t}')
  cLines.push('\treturn &gea_embedded_fonts[0];')
  cLines.push('}', '')

  return { cSource: cLines.join('\n'), hSource: hLines.join('\n') }
}
