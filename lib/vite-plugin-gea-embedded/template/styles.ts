import * as t from '@babel/types'
import type { ExprCtx } from '../types'
import { COLOR_PROPS, ENUM_MAPS, PROP_MAP, SHORTHAND_MAP, resolveRawShorthandValues, resolveRawStyleValue, resolveRawTransformOriginValues } from '../style'
import { collectStoreDeps, resolveStyleValue } from '../expressions/jsx'
import { resolveStaticExpression } from '../expressions/static'
import { I, INHERITABLE_PROPS, type TemplateEmitContext } from './context'

export function emitStyleBinding(ctx: TemplateEmitContext, prop: string, value: t.Expression, nodeVar: string, nodeId: number, level: number, exprCtx: ExprCtx): void {
  const deps = collectStoreDeps(value, ctx.storeVars, exprCtx.localExprs)
  if (deps.size === 0) return emitStaticStyle(ctx, prop, value, nodeVar, level, exprCtx)

  const bindId = ctx.nextBindingId++
  const cProp = PROP_MAP[prop]
  if (!cProp) return
  const cVal = resolveStyleValue(prop, value, exprCtx)
  ctx.bindings.push({
    id: bindId,
    nodeId,
    targetType: 'style',
    styleProp: cProp,
    fieldDeps: [...deps],
    isSimple: true,
    cLines: [`static void update_binding_${bindId}(void) {`, `    gea_embedded_ui_set_style(bind_nodes[${bindId}], ${cProp}, ${cVal});`, `}`]
  })
  ctx.initLines.push(`${I(level)}bind_nodes[${bindId}] = ${nodeVar};`)
  ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, ${cProp}, ${cVal});`)
  if (prop === 'backgroundColor') ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, UI_PROP_HAS_BG, 1);`)
}

export function trackInheritableProp(ctx: TemplateEmitContext, nodeVar: string, prop: string, cValue: string): void {
  const nodeId = parseInt(nodeVar.slice(1))
  if (isNaN(nodeId) || !INHERITABLE_PROPS.has(prop)) return
  ctx.nodeExplicitProps.get(nodeId)?.set(prop, cValue)
}

export function emitCssClassStyles(ctx: TemplateEmitContext, classNames: string, nodeVar: string, level: number, target: 'init' | 'active'): void {
  const ruleMap = target === 'active' ? ctx.cssClassRules.active : ctx.cssClassRules.normal
  const merged: Record<string, string> = {}
  for (const cls of classNames.split(/\s+/)) {
    if (!cls) continue
    const rules = ruleMap.get(cls)
    if (rules) Object.assign(merged, rules)
  }

  for (const [prop, rawValue] of Object.entries(merged)) {
    if (prop in SHORTHAND_MAP) {
      emitRawShorthand(ctx, prop, rawValue, nodeVar, level, target)
      continue
    }
    if (prop === 'fontFamily') {
      emitCssFontFamily(ctx, rawValue, merged, nodeVar, level, target)
      continue
    }
    if (prop === 'fontSize') {
      emitCssFontSize(ctx, rawValue, merged, nodeVar, level, target)
      continue
    }
    if (prop === 'transformOrigin') {
      emitRawTransformOrigin(ctx, rawValue, nodeVar, level, target)
      continue
    }
    if (target === 'active') {
      emitActiveCssStyle(ctx, prop, rawValue, nodeVar, level)
      continue
    }
    emitRawCssStyle(ctx, prop, rawValue, nodeVar, level)
  }
}

export function emitStaticStyle(ctx: TemplateEmitContext, prop: string, value: t.Expression, nodeVar: string, level: number, exprCtx: ExprCtx): void {
  if (prop in SHORTHAND_MAP) {
    const staticValue = resolveStaticExpression(value, exprCtx) ?? value
    if (t.isStringLiteral(staticValue)) {
      const cVals = resolveRawShorthandValues(prop, staticValue.value)
      if (!cVals) return
      SHORTHAND_MAP[prop].forEach((expKey, index) => {
        const cProp = PROP_MAP[expKey]
        if (cProp) ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, ${cProp}, ${cVals[index]});`)
      })
      return
    }
    const cVal = resolveStyleValue(SHORTHAND_MAP[prop][0], staticValue, exprCtx)
    for (const expKey of SHORTHAND_MAP[prop]) {
      const cProp = PROP_MAP[expKey]
      if (cProp) ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, ${cProp}, ${cVal});`)
    }
    return
  }
  if (prop === 'backgroundColor') {
    const cVal = resolveStyleValue(prop, value, exprCtx)
    ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, UI_PROP_BG_COLOR, ${cVal});`)
    ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, UI_PROP_HAS_BG, 1);`)
    return
  }
  if (prop === 'transformOrigin') {
    if (t.isStringLiteral(value)) emitRawTransformOrigin(ctx, value.value, nodeVar, level, 'init')
    return
  }
  if (prop === 'opacity' && t.isNumericLiteral(value)) {
    ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, UI_PROP_OPACITY, ${Math.round(value.value * 255)});`)
    return
  }
  const cProp = PROP_MAP[prop]
  if (!cProp) return
  const cVal = resolveStyleValue(prop, value, exprCtx)
  ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, ${cProp}, ${cVal});`)
  trackInheritableProp(ctx, nodeVar, prop, cVal)
}

export function emitStyleObject(ctx: TemplateEmitContext, obj: t.ObjectExpression, nodeVar: string, nodeId: number, level: number, exprCtx: ExprCtx): void {
  const { styleFontFamily, styleFontSize } = collectStaticFontTuple(obj)
  if (styleFontFamily && styleFontSize) registerFontTuple(ctx, styleFontFamily, styleFontSize)

  for (const prop of obj.properties) {
    if (!t.isObjectProperty(prop) || (!t.isIdentifier(prop.key) && !t.isStringLiteral(prop.key))) continue
    const key = t.isIdentifier(prop.key) ? prop.key.name : prop.key.value
    const value = prop.value as t.Expression

    if (key in SHORTHAND_MAP) {
      emitStaticStyle(ctx, key, value, nodeVar, level, exprCtx)
    } else if (key === 'fontFamily') {
      if (!t.isStringLiteral(value)) throw new Error(`gea-embedded: fontFamily must be a static string literal, got dynamic expression`)
      if (styleFontSize) emitFontFamilyStyle(ctx, value.value, styleFontSize, nodeVar, level)
    } else if (key === 'fontSize') {
      const cVal = resolveStyleValue(key, value, exprCtx)
      ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, UI_PROP_FONT_SIZE, ${cVal});`)
      trackInheritableProp(ctx, nodeVar, 'fontSize', cVal)
    } else if (collectStoreDeps(value, ctx.storeVars, exprCtx.localExprs).size > 0) {
      emitStyleBinding(ctx, key, value, nodeVar, nodeId, level, exprCtx)
    } else {
      emitStaticStyle(ctx, key, value, nodeVar, level, exprCtx)
    }
  }
}

function emitRawShorthand(ctx: TemplateEmitContext, prop: string, rawValue: string, nodeVar: string, level: number, target: 'init' | 'active'): void {
  const cVals = resolveRawShorthandValues(prop, rawValue)
  if (!cVals) return
  SHORTHAND_MAP[prop].forEach((expKey, index) => {
    const cProp = PROP_MAP[expKey]
    const cVal = cVals[index]
    if (!cProp) return
    if (target === 'active') {
      if (prop === 'backgroundColor' || expKey === 'backgroundColor') {
        ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, UI_PROP_ACTIVE_BG_COLOR, ${cVal});`)
        ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, UI_PROP_HAS_ACTIVE_BG, 1);`)
      }
    } else {
      ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, ${cProp}, ${cVal});`)
    }
  })
}

function emitCssFontFamily(ctx: TemplateEmitContext, rawValue: string, merged: Record<string, string>, nodeVar: string, level: number, target: 'init' | 'active'): void {
  const family = rawValue.replace(/['"]/g, '')
  const fontSize = merged.fontSize ? parseInt(merged.fontSize) : null
  if (!fontSize || target === 'active') return
  emitFontFamilyStyle(ctx, family, fontSize, nodeVar, level)
}

function emitCssFontSize(ctx: TemplateEmitContext, rawValue: string, merged: Record<string, string>, nodeVar: string, level: number, target: 'init' | 'active'): void {
  if (target === 'active') return
  const sizePx = parseInt(rawValue)
  ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, UI_PROP_FONT_SIZE, ${sizePx});`)
  trackInheritableProp(ctx, nodeVar, 'fontSize', String(sizePx))
  if (!merged.fontFamily) maybeRegisterInheritedFont(ctx, nodeVar, sizePx, level)
}

function emitActiveCssStyle(ctx: TemplateEmitContext, prop: string, rawValue: string, nodeVar: string, level: number): void {
  if (prop !== 'backgroundColor') return
  const cVal = resolveRawStyleValue(prop, rawValue)
  if (cVal != null) {
    ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, UI_PROP_ACTIVE_BG_COLOR, ${cVal});`)
    ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, UI_PROP_HAS_ACTIVE_BG, 1);`)
  }
}

function emitRawCssStyle(ctx: TemplateEmitContext, prop: string, rawValue: string, nodeVar: string, level: number): void {
  if (prop === 'backgroundColor') {
    const cVal = resolveRawStyleValue(prop, rawValue)
    if (cVal != null) {
      ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, UI_PROP_BG_COLOR, ${cVal});`)
      ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, UI_PROP_HAS_BG, 1);`)
    }
    return
  }
  const cProp = PROP_MAP[prop]
  const cVal = resolveRawStyleValue(prop, rawValue)
  if (cProp && cVal != null) {
    ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, ${cProp}, ${cVal});`)
    trackInheritableProp(ctx, nodeVar, prop, cVal)
  }
}

function emitRawTransformOrigin(ctx: TemplateEmitContext, rawValue: string, nodeVar: string, level: number, target: 'init' | 'active'): void {
  if (target === 'active') return
  const values = resolveRawTransformOriginValues(rawValue)
  if (!values) return
  ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, UI_PROP_TRANSFORM_ORIGIN_X, ${values[0]});`)
  ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, UI_PROP_TRANSFORM_ORIGIN_Y, ${values[1]});`)
}

function emitFontFamilyStyle(ctx: TemplateEmitContext, family: string, fontSize: number, nodeVar: string, level: number): void {
  registerFontTuple(ctx, family, fontSize)
  const tupleIdx = [...ctx.fontTuples.keys()].indexOf(`${family}:${fontSize}`)
  ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, UI_PROP_FONT_ID, ${tupleIdx});`)
  trackInheritableProp(ctx, nodeVar, 'fontFamily', String(tupleIdx))
}

function registerFontTuple(ctx: TemplateEmitContext, family: string, sizePx: number): void {
  const tupleKey = `${family}:${sizePx}`
  if (!ctx.fontTuples.has(tupleKey)) ctx.fontTuples.set(tupleKey, { family, sizePx })
}

function collectStaticFontTuple(obj: t.ObjectExpression): { styleFontFamily: string | null; styleFontSize: number | null } {
  let styleFontFamily: string | null = null
  let styleFontSize: number | null = null
  for (const prop of obj.properties) {
    if (!t.isObjectProperty(prop) || (!t.isIdentifier(prop.key) && !t.isStringLiteral(prop.key))) continue
    const key = t.isIdentifier(prop.key) ? prop.key.name : prop.key.value
    if (key === 'fontFamily' && t.isStringLiteral(prop.value)) styleFontFamily = prop.value.value
    if (key === 'fontSize' && t.isNumericLiteral(prop.value)) styleFontSize = prop.value.value
  }
  return { styleFontFamily, styleFontSize }
}

function maybeRegisterInheritedFont(ctx: TemplateEmitContext, nodeVar: string, sizePx: number, level: number): void {
  let inheritedFamily: string | null = null
  let ancestor = ctx.nodeParentMap.get(parseInt(nodeVar.slice(1)))
  while (ancestor !== undefined) {
    const tupleIdx = ctx.nodeExplicitProps.get(ancestor)?.get('fontFamily')
    if (tupleIdx !== undefined) {
      const key = [...ctx.fontTuples.keys()][parseInt(tupleIdx)]
      inheritedFamily = key ? ctx.fontTuples.get(key)!.family : null
      break
    }
    ancestor = ctx.nodeParentMap.get(ancestor)
  }
  if (inheritedFamily) emitFontFamilyStyle(ctx, inheritedFamily, sizePx, nodeVar, level)
}

void COLOR_PROPS
void ENUM_MAPS
