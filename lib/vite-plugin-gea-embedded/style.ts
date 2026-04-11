import type { CssClassRules } from './types'

export function hexToRgb565(hex: string): number {
  hex = hex.replace('#', '')
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
}

export const ENUM_MAPS: Record<string, Record<string, number>> = {
  flexDirection: { column: 0, row: 1 },
  flexWrap: { nowrap: 0, wrap: 1 },
  justifyContent: { 'flex-start': 0, center: 1, 'flex-end': 2, 'space-between': 3, 'space-around': 4 },
  alignItems: { stretch: 0, 'flex-start': 1, center: 2, 'flex-end': 3 },
  alignSelf: { auto: -1, 'flex-start': 1, center: 2, 'flex-end': 3, stretch: 0 },
  position: { relative: 0, absolute: 1 },
  textAlign: { left: 0, center: 1, right: 2 },
  overflow: { hidden: 0, visible: 1, scroll: 2 },
  display: { flex: 0, none: 1 },
  fit: { fill: 0, contain: 1, cover: 2, none: 3, 'scale-down': 4 }
}

export const COLOR_PROPS = new Set(['backgroundColor', 'color', 'borderColor'])
export const LENGTH_PROPS = new Set([
  'gap',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'top',
  'right',
  'bottom',
  'left',
  'borderWidth',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
  'fontSize'
])

export const TRANSFORM_PROPS = new Set(['transform', 'rotate'])

export const PROP_MAP: Record<string, string> = {
  display: 'UI_PROP_DISPLAY',
  flexDirection: 'UI_PROP_FLEX_DIRECTION',
  flexWrap: 'UI_PROP_FLEX_WRAP',
  justifyContent: 'UI_PROP_JUSTIFY_CONTENT',
  alignItems: 'UI_PROP_ALIGN_ITEMS',
  alignSelf: 'UI_PROP_ALIGN_SELF',
  gap: 'UI_PROP_GAP',
  width: 'UI_PROP_WIDTH',
  height: 'UI_PROP_HEIGHT',
  minWidth: 'UI_PROP_MIN_WIDTH',
  minHeight: 'UI_PROP_MIN_HEIGHT',
  maxWidth: 'UI_PROP_MAX_WIDTH',
  maxHeight: 'UI_PROP_MAX_HEIGHT',
  flex: 'UI_PROP_FLEX',
  paddingTop: 'UI_PROP_PADDING_TOP',
  paddingRight: 'UI_PROP_PADDING_RIGHT',
  paddingBottom: 'UI_PROP_PADDING_BOTTOM',
  paddingLeft: 'UI_PROP_PADDING_LEFT',
  marginTop: 'UI_PROP_MARGIN_TOP',
  marginRight: 'UI_PROP_MARGIN_RIGHT',
  marginBottom: 'UI_PROP_MARGIN_BOTTOM',
  marginLeft: 'UI_PROP_MARGIN_LEFT',
  position: 'UI_PROP_POSITION',
  top: 'UI_PROP_TOP',
  right: 'UI_PROP_RIGHT',
  bottom: 'UI_PROP_BOTTOM',
  left: 'UI_PROP_LEFT',
  zIndex: 'UI_PROP_Z_INDEX',
  backgroundColor: 'UI_PROP_BG_COLOR',
  color: 'UI_PROP_COLOR',
  opacity: 'UI_PROP_OPACITY',
  blinkInterval: 'UI_PROP_BLINK_INTERVAL',
  borderWidth: 'UI_PROP_BORDER_WIDTH',
  borderColor: 'UI_PROP_BORDER_COLOR',
  borderTopLeftRadius: 'UI_PROP_BORDER_RADIUS_TL',
  borderTopRightRadius: 'UI_PROP_BORDER_RADIUS_TR',
  borderBottomRightRadius: 'UI_PROP_BORDER_RADIUS_BR',
  borderBottomLeftRadius: 'UI_PROP_BORDER_RADIUS_BL',
  fontFamily: 'UI_PROP_FONT_ID',
  fontSize: 'UI_PROP_FONT_SIZE',
  textAlign: 'UI_PROP_TEXT_ALIGN',
  overflow: 'UI_PROP_OVERFLOW',
  fit: 'UI_PROP_IMAGE_FIT',
  transform: 'UI_PROP_TRANSFORM_ROTATE',
  rotate: 'UI_PROP_TRANSFORM_ROTATE',
  transformOriginX: 'UI_PROP_TRANSFORM_ORIGIN_X',
  transformOriginY: 'UI_PROP_TRANSFORM_ORIGIN_Y'
}

export const SHORTHAND_MAP: Record<string, string[]> = {
  padding: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
  margin: ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'],
  borderRadius: ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius']
}

const KEBAB_TO_CAMEL: Record<string, string> = {
  display: 'display',
  'flex-direction': 'flexDirection',
  'flex-wrap': 'flexWrap',
  'justify-content': 'justifyContent',
  'align-items': 'alignItems',
  'align-self': 'alignSelf',
  gap: 'gap',
  width: 'width',
  height: 'height',
  'min-width': 'minWidth',
  'min-height': 'minHeight',
  'max-width': 'maxWidth',
  'max-height': 'maxHeight',
  flex: 'flex',
  padding: 'padding',
  'padding-top': 'paddingTop',
  'padding-right': 'paddingRight',
  'padding-bottom': 'paddingBottom',
  'padding-left': 'paddingLeft',
  margin: 'margin',
  'margin-top': 'marginTop',
  'margin-right': 'marginRight',
  'margin-bottom': 'marginBottom',
  'margin-left': 'marginLeft',
  position: 'position',
  top: 'top',
  right: 'right',
  bottom: 'bottom',
  left: 'left',
  'z-index': 'zIndex',
  'background-color': 'backgroundColor',
  color: 'color',
  opacity: 'opacity',
  'blink-interval': 'blinkInterval',
  'border-width': 'borderWidth',
  'border-color': 'borderColor',
  'border-radius': 'borderRadius',
  'border-top-left-radius': 'borderTopLeftRadius',
  'border-top-right-radius': 'borderTopRightRadius',
  'border-bottom-right-radius': 'borderBottomRightRadius',
  'border-bottom-left-radius': 'borderBottomLeftRadius',
  'font-family': 'fontFamily',
  'font-size': 'fontSize',
  'text-align': 'textAlign',
  overflow: 'overflow',
  transform: 'transform',
  rotate: 'rotate',
  'transform-origin': 'transformOrigin'
}

export function parseCssClassRules(cssText: string): CssClassRules {
  const normal = new Map<string, Record<string, string>>()
  const active = new Map<string, Record<string, string>>()
  const stripped = cssText.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = /\.([a-zA-Z_][\w-]*)(:active)?\s*\{([^}]*)\}/g
  let m: RegExpExecArray | null

  while ((m = re.exec(stripped)) !== null) {
    const className = m[1]
    const isActive = m[2] === ':active'
    const props: Record<string, string> = {}
    const declRe = /([\w-]+)\s*:\s*([^;]+)/g
    let dm: RegExpExecArray | null

    while ((dm = declRe.exec(m[3])) !== null) {
      const camelProp = KEBAB_TO_CAMEL[dm[1].trim()]
      if (camelProp) props[camelProp] = dm[2].trim()
    }

    if (Object.keys(props).length > 0) {
      const target = isActive ? active : normal
      const existing = target.get(className) || {}
      target.set(className, { ...existing, ...props })
    }
  }

  return { normal, active }
}

export function mergeCssClassRules(target: CssClassRules, source: CssClassRules): void {
  for (const [cls, props] of source.normal) {
    const existing = target.normal.get(cls) || {}
    target.normal.set(cls, { ...existing, ...props })
  }
  for (const [cls, props] of source.active) {
    const existing = target.active.get(cls) || {}
    target.active.set(cls, { ...existing, ...props })
  }
}

export function resolveRawStyleValue(prop: string, rawValue: string): string | null {
  if (TRANSFORM_PROPS.has(prop)) return resolveRawTransformRotateValue(prop, rawValue)
  if (COLOR_PROPS.has(prop)) {
    if (rawValue.startsWith('#')) return `0x${hexToRgb565(rawValue).toString(16).toUpperCase().padStart(4, '0')}`
    return null
  }
  if (prop in ENUM_MAPS) {
    const val = ENUM_MAPS[prop][rawValue]
    return val !== undefined ? String(val) : null
  }
  if (prop === 'opacity') {
    const n = parseRawNumber(rawValue, false)
    return isNaN(n) ? null : String(Math.round(n * 255))
  }
  const n = parseRawNumber(rawValue, LENGTH_PROPS.has(prop))
  return isNaN(n) ? null : String(Math.round(n))
}

export function resolveRawTransformRotateValue(prop: string, rawValue: string): string | null {
  const raw = rawValue.trim()
  if (raw === 'none') return '0'
  if (prop === 'rotate') return parseAngleToTenths(raw)

  const m = raw.match(/(?:^|\s)rotate\(\s*([^)]+?)\s*\)/)
  if (!m) return null
  return parseAngleToTenths(m[1])
}

export function resolveRawTransformOriginValues(rawValue: string): [string, string] | null {
  const parts = rawValue.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (parts.length === 0 || parts.length > 2) return null

  if (parts.length === 1) {
    const token = parts[0]
    if (token === 'left') return ['0', '500']
    if (token === 'right') return ['1000', '500']
    if (token === 'top') return ['500', '0']
    if (token === 'bottom') return ['500', '1000']
    if (token === 'center') return ['500', '500']
    const pct = parseOriginPercent(token)
    return pct == null ? null : [pct, pct]
  }

  const firstX = parseOriginX(parts[0])
  const firstY = parseOriginY(parts[0])
  const secondX = parseOriginX(parts[1])
  const secondY = parseOriginY(parts[1])

  if (firstX != null && secondY != null) return [firstX, secondY]
  if (firstY != null && secondX != null) return [secondX, firstY]
  return null
}

export function resolveRawShorthandValues(prop: string, rawValue: string): string[] | null {
  const longhands = SHORTHAND_MAP[prop]
  if (!longhands) return null

  const parts = rawValue.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0 || parts.length > 4) return null

  const expanded = [
    parts[0],
    parts[1] ?? parts[0],
    parts[2] ?? parts[0],
    parts[3] ?? parts[1] ?? parts[0]
  ]

  const values = expanded.map((part, index) => resolveRawStyleValue(longhands[index], part))
  return values.every(value => value != null) ? (values as string[]) : null
}

function parseRawNumber(rawValue: string, allowPx: boolean): number {
  const m = rawValue.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))([pP][xX])?$/)
  if (!m || (m[2] && !allowPx)) return NaN
  return Number(m[1])
}

function parseAngleToTenths(rawValue: string): string | null {
  const m = rawValue.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(deg|rad|turn)?$/i)
  if (!m) return null
  const n = Number(m[1])
  const unit = (m[2] || 'deg').toLowerCase()
  if (unit === 'deg') return String(Math.round(n * 10))
  if (unit === 'rad') return String(Math.round((n * 1800) / Math.PI))
  if (unit === 'turn') return String(Math.round(n * 3600))
  return null
}

function parseOriginPercent(token: string): string | null {
  const m = token.match(/^(-?(?:\d+\.?\d*|\.\d+))%$/)
  if (!m) return null
  return String(Math.round(Number(m[1]) * 10))
}

function parseOriginX(token: string): string | null {
  if (token === 'left') return '0'
  if (token === 'center') return '500'
  if (token === 'right') return '1000'
  return parseOriginPercent(token)
}

function parseOriginY(token: string): string | null {
  if (token === 'top') return '0'
  if (token === 'center') return '500'
  if (token === 'bottom') return '1000'
  return parseOriginPercent(token)
}
