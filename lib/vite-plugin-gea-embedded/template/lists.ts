import * as t from '@babel/types'
import type { ExprCtx, StoreField, StoreInstance } from '../types'
import { jsxExprToC, resolveStyleValue } from '../expressions/jsx'
import { PROP_MAP, SHORTHAND_MAP, resolveRawShorthandValues, resolveRawStyleValue, resolveRawTransformOriginValues } from '../style'
import { bindStaticLoopValue, cloneExprCtx, resolveStaticExpression, resolveStaticIterableElements } from '../expressions/static'
import { I, type TemplateEmitContext } from './context'

export function referencesIdent(node: t.Node, name: string): boolean {
  if (t.isIdentifier(node) && node.name === name) return true
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue
    const child = (node as any)[key]
    if (!child || typeof child !== 'object') continue
    if (Array.isArray(child)) {
      for (const item of child) if (item && typeof item.type === 'string' && referencesIdent(item, name)) return true
    } else if (typeof child.type === 'string' && referencesIdent(child, name)) return true
  }
  return false
}

export function emitMapUnrolled(ctx: TemplateEmitContext, call: t.CallExpression, parentVar: string | null, level: number, exprCtx: ExprCtx): void {
  const callee = call.callee as t.MemberExpression
  const arrExpr = callee.object

  if (t.isMemberExpression(arrExpr) && !arrExpr.computed) {
    const arrObj = arrExpr.object
    const arrProp = arrExpr.property
    if (t.isIdentifier(arrObj) && ctx.storeVars.has(arrObj.name) && t.isIdentifier(arrProp)) {
      const si = ctx.storeInstances.find(s => s.jsVar === arrObj.name)!
      const field = ctx.stores.get(si.className)!.fields.find(f => f.name === arrProp.name)
      if (field?.isArray) return emitListBinding(ctx, call, parentVar, si, field, level, exprCtx)
    }
  }

  if (!t.isExpression(arrExpr)) return
  const elements = resolveStaticIterableElements(arrExpr, exprCtx)
  if (!elements) return
  const callback = call.arguments[0]
  if (!t.isArrowFunctionExpression(callback) && !t.isFunctionExpression(callback)) return
  const bodyJSX = callbackToJsx(callback.body)
  if (!bodyJSX) return
  const iterVar = callback.params.length > 0 && t.isIdentifier(callback.params[0]) ? callback.params[0].name : 'i'
  const indexVar = callback.params.length > 1 && t.isIdentifier(callback.params[1]) ? callback.params[1].name : ''

  elements.forEach((el, index) => {
    const childCtx = cloneExprCtx(exprCtx)
    bindStaticLoopValue(childCtx, iterVar, el)
    if (indexVar) childCtx.constVals.set(indexVar, index)
    ctx.initLines.push(`${I(level)}{`)
    ctx.emitNode(bodyJSX, parentVar, level + 1, childCtx)
    ctx.initLines.push(`${I(level)}}`)
  })
}

export function emitListBinding(ctx: TemplateEmitContext, call: t.CallExpression, parentVar: string | null, si: StoreInstance, field: StoreField, level: number, exprCtx: ExprCtx): void {
  const callback = call.arguments[0]
  if (!t.isArrowFunctionExpression(callback) && !t.isFunctionExpression(callback)) return
  const bodyJSX = callbackToJsx(callback.body)
  if (!bodyJSX) return
  const iterParam = callback.params.length > 0 && t.isIdentifier(callback.params[0]) ? callback.params[0].name : '_item'
  const { staticCssStyles, staticStyles, dynamicStyles } = partitionListStyles(ctx, bodyJSX, iterParam, exprCtx)
  const bindId = ctx.nextBindingId++

  const tagName = t.isJSXIdentifier(bodyJSX.openingElement.name) ? bodyJSX.openingElement.name.name : ''
  const isImage = tagName === 'Image' || tagName === 'image'
  let staticImageSrc: string | undefined
  if (isImage) {
    for (const attr of bodyJSX.openingElement.attributes) {
      if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name, { name: 'src' })) continue
      if (attr.value && t.isJSXExpressionContainer(attr.value) && t.isExpression(attr.value.expression)) {
        staticImageSrc = jsxExprToC(attr.value.expression, exprCtx)
      }
    }
  }
  ctx.listBindings.push({
    bindId,
    fieldName: field.name,
    storeName: si.cStruct,
    arrayCapacity: field.arrayCapacity || 64,
    subFields: field.subFields || [],
    staticCssStyles,
    staticStyles,
    dynamicStyles,
    nodeKind: isImage ? 'image' : 'view',
    staticImageSrc
  })
  ctx.bindings.push({ id: bindId, nodeId: -1, targetType: 'style', fieldDeps: [field.name], isSimple: true, cLines: [] })
  if (parentVar) ctx.initLines.push(`${I(level)}${field.name}_parent_node = ${parentVar};`)
}

export function emitStaticListStyleLines(lines: string[], key: string, value: t.Expression, baseCtx: ExprCtx, indent: string): void {
  if (key in SHORTHAND_MAP) {
    const staticValue = resolveStaticExpression(value, baseCtx) ?? value
    if (t.isStringLiteral(staticValue)) {
      const cVals = resolveRawShorthandValues(key, staticValue.value)
      if (!cVals) return
      SHORTHAND_MAP[key].forEach((expKey, index) => {
        const cProp = PROP_MAP[expKey]
        if (cProp) lines.push(`${indent}gea_embedded_ui_set_style(n, ${cProp}, ${cVals[index]});`)
      })
      return
    }
    const cVal = resolveStyleValue(SHORTHAND_MAP[key][0], staticValue, baseCtx)
    for (const expKey of SHORTHAND_MAP[key]) {
      const cProp = PROP_MAP[expKey]
      if (cProp) lines.push(`${indent}gea_embedded_ui_set_style(n, ${cProp}, ${cVal});`)
    }
  } else if (key === 'backgroundColor') {
    lines.push(`${indent}gea_embedded_ui_set_style(n, UI_PROP_BG_COLOR, ${resolveStyleValue(key, value, baseCtx)});`)
    lines.push(`${indent}gea_embedded_ui_set_style(n, UI_PROP_HAS_BG, 1);`)
  } else if (key === 'transformOrigin') {
    if (t.isStringLiteral(value)) {
      const values = resolveRawTransformOriginValues(value.value)
      if (!values) return
      lines.push(`${indent}gea_embedded_ui_set_style(n, UI_PROP_TRANSFORM_ORIGIN_X, ${values[0]});`)
      lines.push(`${indent}gea_embedded_ui_set_style(n, UI_PROP_TRANSFORM_ORIGIN_Y, ${values[1]});`)
    }
  } else {
    const cProp = PROP_MAP[key]
    if (cProp) lines.push(`${indent}gea_embedded_ui_set_style(n, ${cProp}, ${resolveStyleValue(key, value, baseCtx)});`)
  }
}

export function emitRawListStyleLines(lines: string[], key: string, rawValue: string, indent: string): void {
  if (key in SHORTHAND_MAP) {
    const cVals = resolveRawShorthandValues(key, rawValue)
    if (!cVals) return
    SHORTHAND_MAP[key].forEach((expKey, index) => {
      const cProp = PROP_MAP[expKey]
      const cVal = cVals[index]
      if (cProp) lines.push(`${indent}gea_embedded_ui_set_style(n, ${cProp}, ${cVal});`)
    })
  } else if (key === 'backgroundColor') {
    const cVal = resolveRawStyleValue(key, rawValue)
    if (cVal == null) return
    lines.push(`${indent}gea_embedded_ui_set_style(n, UI_PROP_BG_COLOR, ${cVal});`)
    lines.push(`${indent}gea_embedded_ui_set_style(n, UI_PROP_HAS_BG, 1);`)
  } else if (key === 'transformOrigin') {
    const values = resolveRawTransformOriginValues(rawValue)
    if (!values) return
    lines.push(`${indent}gea_embedded_ui_set_style(n, UI_PROP_TRANSFORM_ORIGIN_X, ${values[0]});`)
    lines.push(`${indent}gea_embedded_ui_set_style(n, UI_PROP_TRANSFORM_ORIGIN_Y, ${values[1]});`)
  } else {
    const cProp = PROP_MAP[key]
    const cVal = resolveRawStyleValue(key, rawValue)
    if (cProp && cVal != null) lines.push(`${indent}gea_embedded_ui_set_style(n, ${cProp}, ${cVal});`)
  }
}

function callbackToJsx(body: t.BlockStatement | t.Expression): t.JSXElement | null {
  if (t.isJSXElement(body)) return body
  if (t.isBlockStatement(body)) {
    for (const stmt of body.body) if (t.isReturnStatement(stmt) && t.isJSXElement(stmt.argument)) return stmt.argument
  }
  if (t.isParenthesizedExpression(body) && t.isJSXElement(body.expression as any)) return body.expression as any
  return null
}

function partitionListStyles(ctx: TemplateEmitContext, bodyJSX: t.JSXElement, iterParam: string, exprCtx: ExprCtx) {
  const staticCssStyles = collectListCssStyles(ctx, bodyJSX, exprCtx)
  const staticStyles: { key: string; value: t.Expression }[] = []
  const dynamicStyles: { key: string; subField: string }[] = []
  for (const attr of bodyJSX.openingElement.attributes) {
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name) || attr.name.name !== 'style') continue
    if (!attr.value || !t.isJSXExpressionContainer(attr.value) || !t.isObjectExpression(attr.value.expression)) continue
    for (const prop of attr.value.expression.properties) {
      if (!t.isObjectProperty(prop)) continue
      const key = t.isIdentifier(prop.key) ? prop.key.name : t.isStringLiteral(prop.key) ? prop.key.value : ''
      if (!key) continue
      const value = prop.value as t.Expression
      if (referencesIdent(value, iterParam)) {
        if (t.isMemberExpression(value) && !value.computed && t.isIdentifier(value.object, { name: iterParam }) && t.isIdentifier(value.property)) {
          dynamicStyles.push({ key, subField: value.property.name })
        }
      } else {
        staticStyles.push({ key, value })
      }
    }
  }
  return { staticCssStyles, staticStyles, dynamicStyles }
}

function collectListCssStyles(ctx: TemplateEmitContext, bodyJSX: t.JSXElement, exprCtx: ExprCtx): { key: string; rawValue: string }[] {
  const classNames = listClassAttributeValue(bodyJSX.openingElement.attributes, exprCtx)
  if (!classNames) return []

  const merged: Record<string, string> = {}
  for (const cls of classNames.split(/\s+/)) {
    if (!cls) continue
    const rules = ctx.cssClassRules.normal.get(cls)
    if (rules) Object.assign(merged, rules)
  }
  return Object.entries(merged).map(([key, rawValue]) => ({ key, rawValue }))
}

function listClassAttributeValue(attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[], exprCtx: ExprCtx): string | null {
  for (const attr of attrs) {
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name) || attr.name.name !== 'class' || !attr.value) continue
    if (t.isStringLiteral(attr.value)) return attr.value.value
    if (t.isJSXExpressionContainer(attr.value) && t.isStringLiteral(attr.value.expression)) return attr.value.expression.value
    if (t.isJSXExpressionContainer(attr.value) && t.isIdentifier(attr.value.expression) && exprCtx.constVals.has(attr.value.expression.name)) {
      const value = exprCtx.constVals.get(attr.value.expression.name)
      return typeof value === 'string' ? value : null
    }
  }
  return null
}
