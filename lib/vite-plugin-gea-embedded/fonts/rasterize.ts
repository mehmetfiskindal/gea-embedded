import { readFileSync } from 'fs'
import opentype from 'opentype.js'
import type { BakedFont, GlyphMetrics } from '../types'

export function rasterizeFont(fontPath: string, family: string, sizePx: number, fontId: number): BakedFont {
  const fontBuffer = readFileSync(fontPath)
  const arrayBuffer = new ArrayBuffer(fontBuffer.length)
  new Uint8Array(arrayBuffer).set(fontBuffer)
  const font = opentype.parse(arrayBuffer)

  const scale = sizePx / font.unitsPerEm
  const ascender = Math.ceil(font.ascender * scale)
  const descender = Math.ceil(Math.abs(font.descender * scale))
  const lineHeight = ascender + descender
  const glyphs: GlyphMetrics[] = []
  const glyphBitmaps: { data: Uint8Array; w: number; h: number }[] = []

  for (let cp = 0x20; cp <= 0x7e; cp++) {
    const glyph = font.charToGlyph(String.fromCharCode(cp))
    const advance = Math.round((glyph.advanceWidth ?? 0) * scale)
    const bounds = glyph.getBoundingBox()
    const x0 = Math.floor(bounds.x1 * scale)
    const y0 = Math.floor(-bounds.y2 * scale)
    const x1 = Math.ceil(bounds.x2 * scale)
    const y1 = Math.ceil(-bounds.y1 * scale)
    const gw = Math.max(x1 - x0, 0)
    const gh = Math.max(y1 - y0, 0)
    const bitmap = new Uint8Array(gw * gh)

    if (gw > 0 && gh > 0) {
      rasterizeGlyph(glyph.getPath(0, 0, sizePx).commands, bitmap, gw, gh, x0, y0, sizePx)
    }

    glyphs.push({ codepoint: cp, atlasX: 0, atlasY: 0, width: gw, height: gh, advance, bearingX: x0, bearingY: -y0 })
    glyphBitmaps.push({ data: bitmap, w: gw, h: gh })
  }

  const { atlasWidth, atlasHeight } = packGlyphAtlas(glyphs)
  if (atlasWidth === 0 || atlasHeight === 0) {
    return { id: fontId, family, sizePx, lineHeight, ascender, descender, glyphs, atlasWidth: 1, atlasHeight: 1, atlasData: new Uint8Array(1) }
  }

  const atlasData = new Uint8Array(atlasWidth * atlasHeight)
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i]
    const bm = glyphBitmaps[i]
    for (let row = 0; row < bm.h; row++) {
      for (let col = 0; col < bm.w; col++) {
        atlasData[(g.atlasY + row) * atlasWidth + (g.atlasX + col)] = bm.data[row * bm.w + col]
      }
    }
  }

  return { id: fontId, family, sizePx, lineHeight, ascender, descender, glyphs, atlasWidth, atlasHeight, atlasData }
}

function rasterizeGlyph(
  cmds: opentype.PathCommand[],
  bitmap: Uint8Array,
  gw: number,
  gh: number,
  x0: number,
  y0: number,
  sizePx: number
): void {
  const SS = 4
  const ssW = gw * SS
  const ssH = gh * SS
  const hires = new Uint8Array(ssW * ssH)
  const segments = pathCommandsToSegments(cmds, x0, y0)
  const maxEdgesPerRow = 128
  const scanlines = new Float32Array(ssH * maxEdgesPerRow)
  const scanCounts = new Int32Array(ssH)
  void sizePx

  for (const [sx0, sy0, sx1, sy1] of segments) {
    const hsy0 = sy0 * SS, hsy1 = sy1 * SS
    const hsx0 = sx0 * SS, hsx1 = sx1 * SS
    const minRow = Math.max(0, Math.floor(Math.min(hsy0, hsy1)))
    const maxRow = Math.min(ssH - 1, Math.ceil(Math.max(hsy0, hsy1)))
    for (let row = minRow; row <= maxRow; row++) {
      const y = row + 0.5
      if ((hsy0 <= y && hsy1 > y) || (hsy1 <= y && hsy0 > y)) {
        const pos = hsx0 + ((y - hsy0) / (hsy1 - hsy0)) * (hsx1 - hsx0)
        const cnt = scanCounts[row]
        if (cnt < maxEdgesPerRow) scanlines[row * maxEdgesPerRow + scanCounts[row]++] = pos
      }
    }
  }

  for (let row = 0; row < ssH; row++) {
    const count = scanCounts[row]
    if (count < 2) continue
    const edges = Array.from(scanlines.slice(row * maxEdgesPerRow, row * maxEdgesPerRow + count)).sort((a, b) => a - b)
    for (let i = 0; i < edges.length - 1; i += 2) {
      const left = Math.max(0, Math.floor(edges[i]))
      const right = Math.min(ssW - 1, Math.ceil(edges[i + 1]))
      for (let col = left; col <= right; col++) hires[row * ssW + col] = 1
    }
  }

  for (let py = 0; py < gh; py++) {
    for (let px = 0; px < gw; px++) {
      let sum = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) sum += hires[(py * SS + sy) * ssW + (px * SS + sx)]
      }
      bitmap[py * gw + px] = Math.round((sum / (SS * SS)) * 255)
    }
  }
}

function pathCommandsToSegments(cmds: opentype.PathCommand[], x0: number, y0: number): [number, number, number, number][] {
  const segments: [number, number, number, number][] = []
  let curX = 0, curY = 0, startX = 0, startY = 0

  for (const cmd of cmds) {
    if (cmd.type === 'M') {
      curX = cmd.x! - x0; curY = cmd.y! - y0; startX = curX; startY = curY
    } else if (cmd.type === 'L') {
      const ex = cmd.x! - x0, ey = cmd.y! - y0
      segments.push([curX, curY, ex, ey]); curX = ex; curY = ey
    } else if (cmd.type === 'C') {
      for (let s = 1; s <= 12; s++) {
        const t = s / 12, mt = 1 - t
        const ex = mt ** 3 * curX + 3 * mt * mt * t * (cmd.x1! - x0) + 3 * mt * t * t * (cmd.x2! - x0) + t ** 3 * (cmd.x! - x0)
        const ey = mt ** 3 * curY + 3 * mt * mt * t * (cmd.y1! - y0) + 3 * mt * t * t * (cmd.y2! - y0) + t ** 3 * (cmd.y! - y0)
        segments.push([curX, curY, ex, ey]); curX = ex; curY = ey
      }
    } else if (cmd.type === 'Q') {
      for (let s = 1; s <= 8; s++) {
        const t = s / 8, mt = 1 - t
        const ex = mt * mt * curX + 2 * mt * t * (cmd.x1! - x0) + t * t * (cmd.x! - x0)
        const ey = mt * mt * curY + 2 * mt * t * (cmd.y1! - y0) + t * t * (cmd.y! - y0)
        segments.push([curX, curY, ex, ey]); curX = ex; curY = ey
      }
    } else if (cmd.type === 'Z') {
      if (curX !== startX || curY !== startY) segments.push([curX, curY, startX, startY])
      curX = startX; curY = startY
    }
  }
  return segments
}

function packGlyphAtlas(glyphs: GlyphMetrics[]): { atlasWidth: number; atlasHeight: number } {
  const padding = 1
  let atlasWidth = 0, curX = 0, curY = 0, maxRowH = 0
  const maxAtlasW = 512

  for (const g of glyphs) {
    if (curX + g.width + padding > maxAtlasW) {
      curX = 0; curY += maxRowH + padding; maxRowH = 0
    }
    g.atlasX = curX; g.atlasY = curY
    if (curX + g.width > atlasWidth) atlasWidth = curX + g.width
    if (g.height > maxRowH) maxRowH = g.height
    curX += g.width + padding
  }

  return { atlasWidth, atlasHeight: curY + maxRowH }
}
