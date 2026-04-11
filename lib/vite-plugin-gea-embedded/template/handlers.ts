import * as t from '@babel/types'
import type { ElementTouchEventType, ExprCtx, OnPressEntry } from '../types'
import { jsxExprToC } from '../expressions/jsx'
import { resolveStaticExpression, resolveStaticNumber, resolveStaticString } from '../expressions/static'
import { I, type TemplateEmitContext } from './context'

export type DataAttributeMap = Map<string, { cValue: string; jsValue: string }>

export function ensurePressId(ctx: TemplateEmitContext, nodeVar: string, level: number, explicitPressId?: number): number {
  if (ctx.nodePressIds.has(nodeVar)) return ctx.nodePressIds.get(nodeVar)!
  let pressId = explicitPressId
  const usedPressIds = new Set(ctx.nodePressIds.values())
  if (pressId === undefined || usedPressIds.has(pressId)) {
    pressId = ctx.nextPressId
    while (usedPressIds.has(pressId)) pressId++
    ctx.nextPressId = pressId + 1
  }
  ctx.nodePressIds.set(nodeVar, pressId)
  ctx.initLines.push(`${I(level)}gea_embedded_ui_set_on_press(${nodeVar}, ${pressId});`)
  return pressId
}

export function collectDataAttributes(attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[], exprCtx: ExprCtx): DataAttributeMap {
  const dataAttrs: DataAttributeMap = new Map()

  for (const attr of attrs) {
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue
    const name = attr.name.name
    if (!name.startsWith('data-') || name.length <= 'data-'.length) continue
    dataAttrs.set(name, dataAttributeValue(attr.value, exprCtx, name))
  }

  return dataAttrs
}

export function resolveHandler(
  ctx: TemplateEmitContext,
  handler: t.Expression,
  exprCtx: ExprCtx,
  eventArgCName = 'press_id',
  eventArgJsName = 'id',
  dataAttrs: DataAttributeMap = new Map()
): { jsBody: string; methodCall?: OnPressEntry['methodCall'] } {
  let resolved = handler
  let resolvedSource = exprCtx.srcCode || ctx.code
  if (t.isIdentifier(resolved) && exprCtx.localExprs.has(resolved.name)) {
    resolvedSource = exprCtx.localExprSources?.get(resolved.name) || resolvedSource
    resolved = exprCtx.localExprs.get(resolved.name)!
  }
  let jsBody = ''
  let methodCall: OnPressEntry['methodCall']

  if (t.isArrowFunctionExpression(resolved) || t.isFunctionExpression(resolved)) {
    const body = resolved.body
    const fnSrc = resolved !== handler ? resolvedSource : exprCtx.srcCode || ctx.code
    const pressParamName = resolved.params.length > 0 && t.isIdentifier(resolved.params[0]) ? resolved.params[0].name : undefined
    jsBody = t.isBlockStatement(body) ? body.body.map(s => fnSrc.slice(s.start!, s.end!)).join('\n    ') : fnSrc.slice(body.start!, body.end!)
    const callBody = t.isBlockStatement(body) ? (body.body.length === 1 ? body.body[0] : null) : null
    const callExpr = callBody && t.isExpressionStatement(callBody) ? callBody.expression : !t.isBlockStatement(body) && t.isCallExpression(body) ? body : null
    const indirect = callExpr && t.isCallExpression(callExpr) ? resolveIndirectHandlerCall(ctx, callExpr, exprCtx, pressParamName, eventArgCName, eventArgJsName, dataAttrs) : undefined

    if (indirect) {
      jsBody = indirect.jsBody
      methodCall = indirect.methodCall
    } else if (callExpr && t.isCallExpression(callExpr) && t.isMemberExpression(callExpr.callee) && t.isIdentifier(callExpr.callee.object) && t.isIdentifier(callExpr.callee.property)) {
      const direct = resolveDirectStoreHandler(ctx, callExpr, exprCtx, pressParamName, eventArgCName, eventArgJsName, dataAttrs)
      if (direct) {
        jsBody = direct.jsBody
        methodCall = direct.methodCall
      }
    }
  } else if (t.isMemberExpression(resolved) && !resolved.computed && t.isIdentifier(resolved.object) && t.isIdentifier(resolved.property)) {
    const direct = resolveStoreMethodReference(ctx, resolved.object.name, resolved.property.name, eventArgCName)
    if (direct) {
      jsBody = `${resolved.object.name}.${resolved.property.name}(${direct.methodCall!.arg ? eventArgJsName : ''})`
      methodCall = direct.methodCall
    }
  } else {
    const src = resolved !== handler ? resolvedSource : exprCtx.srcCode || ctx.code
    jsBody = `(${src.slice(resolved.start!, resolved.end!)})()`
  }

  for (const [name, val] of exprCtx.constVals) {
    if (typeof val === 'number') jsBody = jsBody.replace(new RegExp(`\\b${name}\\b`, 'g'), String(val))
  }

  return { jsBody, methodCall }
}

export function resolveIndirectHandlerCall(
  ctx: TemplateEmitContext,
  callExpr: t.CallExpression,
  exprCtx: ExprCtx,
  eventParamName?: string,
  eventArgCName = 'press_id',
  eventArgJsName = 'id',
  dataAttrs: DataAttributeMap = new Map()
): { jsBody: string; methodCall: OnPressEntry['methodCall'] } | undefined {
  if (!t.isIdentifier(callExpr.callee)) return undefined
  const callback = exprCtx.localExprs.get(callExpr.callee.name)
  if (!callback || (!t.isArrowFunctionExpression(callback) && !t.isFunctionExpression(callback))) return undefined
  const callbackExpr = callbackBodyCall(callback.body)
  if (!callbackExpr || !t.isMemberExpression(callbackExpr.callee)) return undefined
  const callbackCallee = callbackExpr.callee
  if (!t.isIdentifier(callbackCallee.object) || !t.isIdentifier(callbackCallee.property)) return undefined
  const callbackObject = callbackCallee.object as t.Identifier
  const callbackProperty = callbackCallee.property as t.Identifier

  const si = ctx.storeInstances.find(s => s.jsVar === callbackObject.name)
  if (!si) return undefined

  const replacements = new Map<string, t.Expression>()
  for (let i = 0; i < callback.params.length; i++) {
    if (t.isIdentifier(callback.params[i]) && callExpr.arguments[i] && t.isExpression(callExpr.arguments[i])) {
      replacements.set((callback.params[i] as t.Identifier).name, callExpr.arguments[i] as t.Expression)
    }
  }

  const jsArgs = callbackExpr.arguments.map(arg => {
    if (t.isIdentifier(arg) && replacements.has(arg.name)) return exprToJs(ctx, replacements.get(arg.name)!, exprCtx, eventParamName, eventArgJsName, dataAttrs)
    return exprToJs(ctx, arg as t.Expression, exprCtx, eventParamName, eventArgJsName, dataAttrs)
  })
  const argStr = callbackExpr.arguments.length > 0 ? handlerArgToC(ctx, callbackExpr.arguments[0] as t.Expression, replacements, exprCtx, eventParamName, eventArgCName, dataAttrs) : ''

  return {
    jsBody: `${si.jsVar}.${callbackProperty.name}(${jsArgs.join(', ')})`,
    methodCall: { storeVar: si.jsVar, cStruct: si.cStruct, methodName: callbackProperty.name, arg: argStr }
  }
}

export function emitOnPress(ctx: TemplateEmitContext, handler: t.Expression, nodeVar: string, level: number, exprCtx: ExprCtx, explicitPressId?: number, dataAttrs: DataAttributeMap = new Map()): void {
  const pressId = ensurePressId(ctx, nodeVar, level, explicitPressId)
  const { jsBody, methodCall } = resolveHandler(ctx, handler, exprCtx, 'press_id', 'id', dataAttrs)
  ctx.onPressHandlers.push(rewriteDuplicatePressValue({ pressId, jsBody, methodCall }, explicitPressId))
}

export function emitTouchHandler(ctx: TemplateEmitContext, eventType: ElementTouchEventType, handler: t.Expression, nodeVar: string, level: number, exprCtx: ExprCtx, explicitPressId?: number, dataAttrs: DataAttributeMap = new Map()): void {
  const pressId = ensurePressId(ctx, nodeVar, level, explicitPressId)
  const { jsBody, methodCall } = resolveHandler(ctx, handler, exprCtx, 'press_id', 'id', dataAttrs)
  let resolved = handler
  if (t.isIdentifier(resolved) && exprCtx.localExprs.has(resolved.name)) resolved = exprCtx.localExprs.get(resolved.name)!
  const hasCoords = (t.isArrowFunctionExpression(resolved) || t.isFunctionExpression(resolved)) && resolved.params.length >= 2
  const list = eventType === 'onTouchStart' ? ctx.onTouchStartHandlers : ctx.onTouchEndHandlers
  list.push({ pressId, jsBody, methodCall, hasCoords })
}

function resolveStoreMethodReference(ctx: TemplateEmitContext, storeVar: string, methodName: string, eventArgCName: string): { methodCall: OnPressEntry['methodCall'] } | undefined {
  const si = ctx.storeInstances.find(s => s.jsVar === storeVar)
  if (!si) return undefined
  const method = ctx.stores.get(si.className)?.methods.find(m => m.name === methodName)
  const arg = method && method.params.length > 0 ? eventArgCName : ''
  return { methodCall: { storeVar, cStruct: si.cStruct, methodName, arg } }
}

function resolveDirectStoreHandler(
  ctx: TemplateEmitContext,
  callExpr: t.CallExpression,
  exprCtx: ExprCtx,
  pressParamName?: string,
  eventArgCName = 'press_id',
  eventArgJsName = 'id',
  dataAttrs: DataAttributeMap = new Map()
): { jsBody: string; methodCall: OnPressEntry['methodCall'] } | undefined {
  const callee = callExpr.callee as t.MemberExpression
  const storeVar = (callee.object as t.Identifier).name
  const si = ctx.storeInstances.find(s => s.jsVar === storeVar)
  if (!si) return undefined
  const mName = (callee.property as t.Identifier).name
  let argStr = ''
  const jsArgs: string[] = []
  if (callExpr.arguments.length > 0) {
    const argNode = callExpr.arguments[0] as t.Expression
    argStr = directHandlerArgToC(argNode, exprCtx, pressParamName, eventArgCName, dataAttrs)
  }
  for (const arg of callExpr.arguments) {
    if (!t.isExpression(arg)) continue
    jsArgs.push(pressParamName && t.isIdentifier(arg, { name: pressParamName }) ? eventArgJsName : exprToJs(ctx, arg, exprCtx, pressParamName, eventArgJsName, dataAttrs))
  }
  return {
    jsBody: `${si.jsVar}.${mName}(${jsArgs.join(', ')})`,
    methodCall: { storeVar, cStruct: si.cStruct, methodName: mName, arg: argStr }
  }
}

function directHandlerArgToC(argNode: t.Expression, exprCtx: ExprCtx, pressParamName?: string, eventArgCName = 'press_id', dataAttrs: DataAttributeMap = new Map()): string {
  if (isEventPressIdExpression(argNode, pressParamName)) return eventArgCName
  if (isEventPayloadExpression(argNode, pressParamName)) return eventArgCName
  const dataValue = resolveEventDataAttribute(argNode, pressParamName, dataAttrs)
  if (dataValue) return dataValue.cValue
  if (pressParamName && t.isIdentifier(argNode, { name: pressParamName })) return eventArgCName
  if (t.isIdentifier(argNode) && exprCtx.constVals.has(argNode.name)) return String(exprCtx.constVals.get(argNode.name))
  if (t.isNumericLiteral(argNode)) return String(argNode.value)
  return jsxExprToC(argNode, exprCtx)
}

function rewriteDuplicatePressValue(handler: OnPressEntry, explicitPressId?: number): OnPressEntry {
  if (explicitPressId === undefined || handler.pressId === explicitPressId) return handler
  return {
    ...handler,
    jsBody: handler.jsBody.replace(/\bid\b/g, String(explicitPressId)),
    methodCall: handler.methodCall?.arg === 'press_id'
      ? { ...handler.methodCall, arg: String(explicitPressId) }
      : handler.methodCall
  }
}

function callbackBodyCall(body: t.BlockStatement | t.Expression): t.CallExpression | null {
  if (t.isCallExpression(body)) return body
  if (t.isBlockStatement(body) && body.body.length === 1) {
    const stmt = body.body[0]
    if (t.isExpressionStatement(stmt) && t.isCallExpression(stmt.expression)) return stmt.expression
    if (t.isReturnStatement(stmt) && stmt.argument && t.isCallExpression(stmt.argument)) return stmt.argument
  }
  return null
}

function exprToJs(ctx: TemplateEmitContext, expr: t.Expression, exprCtx: ExprCtx, eventParamName?: string, eventArgJsName = 'id', dataAttrs: DataAttributeMap = new Map()): string {
  if (isEventPressIdExpression(expr, eventParamName)) return eventArgJsName
  if (isEventPayloadExpression(expr, eventParamName)) return eventArgJsName
  const dataValue = resolveEventDataAttribute(expr, eventParamName, dataAttrs)
  if (dataValue) return dataValue.jsValue
  if (eventParamName && t.isIdentifier(expr, { name: eventParamName })) return eventArgJsName
  const numeric = resolveStaticNumber(expr, exprCtx)
  if (numeric !== undefined) return String(numeric)
  const stringValue = resolveStaticString(expr, exprCtx)
  if (stringValue !== undefined) return JSON.stringify(stringValue)
  const resolved = resolveStaticExpression(expr, exprCtx)
  if (resolved && resolved !== expr) return exprToJs(ctx, resolved, exprCtx, eventParamName, eventArgJsName, dataAttrs)
  if (t.isNumericLiteral(expr)) return String(expr.value)
  if (t.isStringLiteral(expr)) return JSON.stringify(expr.value)
  if (t.isIdentifier(expr) && exprCtx.constVals.has(expr.name)) {
    const v = exprCtx.constVals.get(expr.name)!
    return typeof v === 'string' ? JSON.stringify(v) : String(v)
  }
  return (exprCtx.srcCode || ctx.code).slice(expr.start!, expr.end!)
}

function handlerArgToC(ctx: TemplateEmitContext, rawArg: t.Expression, replacements: Map<string, t.Expression>, exprCtx: ExprCtx, eventParamName?: string, eventArgCName = 'press_id', dataAttrs: DataAttributeMap = new Map()): string {
  let argNode = rawArg
  if (t.isIdentifier(argNode) && replacements.has(argNode.name)) argNode = replacements.get(argNode.name)!
  if (isEventPressIdExpression(argNode, eventParamName)) return eventArgCName
  if (isEventPayloadExpression(argNode, eventParamName)) return eventArgCName
  const dataValue = resolveEventDataAttribute(argNode, eventParamName, dataAttrs)
  if (dataValue) return dataValue.cValue
  if (t.isIdentifier(argNode) && exprCtx.constVals.has(argNode.name)) return String(exprCtx.constVals.get(argNode.name))
  if (t.isNumericLiteral(argNode)) return String(argNode.value)
  return jsxExprToC(argNode, exprCtx)
}

function dataAttributeValue(value: t.JSXAttribute['value'], exprCtx: ExprCtx, attrName: string): { cValue: string; jsValue: string } {
  if (!value) return { cValue: JSON.stringify('true'), jsValue: JSON.stringify('true') }
  if (t.isStringLiteral(value)) return stringDataAttributeValue(value.value)
  if (!t.isJSXExpressionContainer(value) || !t.isExpression(value.expression)) throw new Error(`${attrName} must be a statically resolvable string, number, or boolean`)

  const expr = value.expression
  if (t.isBooleanLiteral(expr)) return { cValue: expr.value ? '1' : '0', jsValue: expr.value ? 'true' : 'false' }

  const numeric = resolveStaticNumber(expr, exprCtx)
  if (numeric !== undefined) return { cValue: String(numeric), jsValue: String(numeric) }

  const stringValue = resolveStaticString(expr, exprCtx)
  if (stringValue !== undefined) return stringDataAttributeValue(stringValue)

  throw new Error(`${attrName} must be a statically resolvable string, number, or boolean`)
}

function stringDataAttributeValue(value: string): { cValue: string; jsValue: string } {
  const literal = JSON.stringify(value)
  return { cValue: literal, jsValue: literal }
}

function resolveEventDataAttribute(expr: t.Expression, eventParamName: string | undefined, dataAttrs: DataAttributeMap): { cValue: string; jsValue: string } | undefined {
  if (!eventParamName || dataAttrs.size === 0) return undefined
  const attrName = eventDataAttributeName(expr, eventParamName)
  if (!attrName) return undefined
  const value = dataAttrs.get(attrName) || (!attrName.startsWith('data-') ? dataAttrs.get(`data-${attrName}`) : undefined)
  if (!value) throw new Error(`${attrName} is not defined on this element`)
  return value
}

function isEventPressIdExpression(expr: t.Expression, eventParamName: string | undefined): boolean {
  return (
    !!eventParamName &&
    t.isMemberExpression(expr) &&
    !expr.computed &&
    t.isIdentifier(expr.object, { name: eventParamName }) &&
    (t.isIdentifier(expr.property, { name: 'pressId' }) || t.isIdentifier(expr.property, { name: 'id' }))
  )
}

function isEventPayloadExpression(expr: t.Expression, eventParamName: string | undefined): boolean {
  if (!eventParamName || !t.isMemberExpression(expr) || expr.computed || !t.isIdentifier(expr.property)) return false
  const prop = expr.property.name
  if ((prop === 'keyCode' || prop === 'which') && t.isIdentifier(expr.object, { name: eventParamName })) return true
  if (prop !== 'value') return false
  return isEventTargetExpression(expr.object as t.Expression, eventParamName)
}

function eventDataAttributeName(expr: t.Expression, eventParamName: string): string | undefined {
  if (t.isCallExpression(expr) && t.isMemberExpression(expr.callee) && !expr.callee.computed && t.isIdentifier(expr.callee.property, { name: 'getAttribute' })) {
    if (!isEventTargetExpression(expr.callee.object as t.Expression, eventParamName)) return undefined
    const attrArg = expr.arguments[0]
    if (t.isStringLiteral(attrArg)) return attrArg.value
    return undefined
  }

  if (t.isMemberExpression(expr)) {
    return eventDatasetAttributeName(expr, eventParamName)
  }

  return undefined
}

function eventDatasetAttributeName(expr: t.MemberExpression, eventParamName: string): string | undefined {
  const object = expr.object
  if (!t.isMemberExpression(object) || object.computed || !t.isIdentifier(object.property, { name: 'dataset' })) return undefined
  if (!isEventTargetExpression(object.object as t.Expression, eventParamName)) return undefined

  if (t.isIdentifier(expr.property)) return `data-${hyphenateDatasetKey(expr.property.name)}`
  if (expr.computed && t.isStringLiteral(expr.property)) return `data-${expr.property.value}`
  return undefined
}

function isEventTargetExpression(expr: t.Expression, eventParamName: string): boolean {
  return (
    t.isMemberExpression(expr) &&
    !expr.computed &&
    t.isIdentifier(expr.object, { name: eventParamName }) &&
    (t.isIdentifier(expr.property, { name: 'target' }) || t.isIdentifier(expr.property, { name: 'currentTarget' }))
  )
}

function hyphenateDatasetKey(key: string): string {
  return key.replace(/[A-Z]/g, ch => `-${ch.toLowerCase()}`)
}
