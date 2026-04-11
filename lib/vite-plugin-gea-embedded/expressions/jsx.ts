import * as t from '@babel/types'
import type { ExprCtx, StoreField } from '../types'
import { COLOR_PROPS, ENUM_MAPS, TRANSFORM_PROPS, hexToRgb565, resolveRawStyleValue } from '../style'
import { nativeSingletonMethodCName } from '../native-api'
import { exprToC, exprToCTruthy, type CCtx } from './core'
import { accelerometerMemberToC } from './accelerometer'
import { resolveStaticExpression } from './static'

export function jsxCCtx(ctx: ExprCtx): CCtx {
  return {
    resolveIdentifier(name: string) {
      if (ctx.absentLocals?.has(name)) return '0'
      if (ctx.constVals.has(name)) {
        const v = ctx.constVals.get(name)!
        if (typeof v === 'number') return String(v)
        if (typeof v === 'string' && v.length === 1) return `'${v}'`
        return JSON.stringify(v)
      }
      if (ctx.localExprs.has(name)) return exprToC(ctx.localExprs.get(name)!, jsxCCtx(ctx))
      return undefined
    },
    inferType(node: t.Expression) {
      return inferJsxExpressionType(node, ctx)
    },
    resolveMember(node: t.MemberExpression) {
      if (t.isIdentifier(node.object) && ctx.accelerometerVars?.has(node.object.name)) {
        return accelerometerMemberToC((node.property as t.Identifier).name)
      }
      const staticValue = resolveStaticExpression(node, ctx)
      if (staticValue) return exprToC(staticValue, jsxCCtx(ctx))
      if (t.isIdentifier(node.object) && ctx.storeMap.has(node.object.name)) {
        return `${ctx.storeMap.get(node.object.name)!}.${(node.property as t.Identifier).name}`
      }
      return undefined
    },
    resolveCall(node: t.CallExpression, recurse: (n: t.Expression | t.SpreadElement) => string) {
      const callee = node.callee
      if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.object) && t.isIdentifier(callee.property)) {
        const nativeName = nativeSingletonMethodCName(callee.object.name, callee.property.name)
        if (nativeName) return `${nativeName}(${node.arguments.map(a => recurse(a as t.Expression)).join(', ')})`
      }
      return undefined
    },
    isStringField: ctx.storeFieldsMap ? node => isStringField(node, ctx) : undefined,
    fieldLookup: ctx.storeFieldsMap ? node => fieldLookup(node, ctx) : undefined
  }
}

export function jsxExprToC(node: t.Expression | t.SpreadElement, ctx: ExprCtx): string {
  return exprToC(node, jsxCCtx(ctx))
}

export function jsxTruthyExprToC(node: t.Expression, ctx: ExprCtx): string {
  return exprToCTruthy(node, jsxCCtx(ctx))
}

export function jsxFieldLookup(node: t.Expression, ctx: ExprCtx): StoreField | undefined {
  return jsxCCtx(ctx).fieldLookup?.(node)
}

export function resolveStyleValue(prop: string, node: t.Expression, ctx: ExprCtx): string {
  const staticNode = resolveStaticExpression(node, ctx) ?? node
  if (TRANSFORM_PROPS.has(prop)) {
    if (t.isCallExpression(staticNode) && t.isIdentifier(staticNode.callee, { name: 'rotate' }) && staticNode.arguments.length > 0) {
      return angleExpressionToTenths(staticNode.arguments[0] as t.Expression, 'deg', ctx)
    }
    if (t.isTemplateLiteral(staticNode)) return resolveTemplateTransformValue(staticNode, ctx) ?? '0'
    if (t.isStringLiteral(staticNode)) return resolveRawStyleValue(prop, staticNode.value) ?? '0'
    return jsxExprToC(staticNode, ctx)
  }

  if (COLOR_PROPS.has(prop)) {
    if (t.isStringLiteral(staticNode) && staticNode.value.startsWith('#')) {
      return `0x${hexToRgb565(staticNode.value).toString(16).toUpperCase().padStart(4, '0')}`
    }
    if (t.isConditionalExpression(staticNode)) {
      const rawTest = jsxTruthyExprToC(staticNode.test, ctx)
      const test = rawTest.startsWith('(') && rawTest.endsWith(')') ? rawTest : `(${rawTest})`
      return `(${test} ? ${resolveStyleValue(prop, staticNode.consequent, ctx)} : ${resolveStyleValue(prop, staticNode.alternate, ctx)})`
    }
    return jsxExprToC(staticNode, ctx)
  }

  if (prop in ENUM_MAPS) {
    if (t.isStringLiteral(staticNode)) {
      const val = ENUM_MAPS[prop][staticNode.value]
      return val !== undefined ? String(val) : '0'
    }
    if (t.isConditionalExpression(staticNode)) {
      const rawTest = jsxTruthyExprToC(staticNode.test, ctx)
      const test = rawTest.startsWith('(') && rawTest.endsWith(')') ? rawTest : `(${rawTest})`
      return `(${test} ? ${resolveStyleValue(prop, staticNode.consequent, ctx)} : ${resolveStyleValue(prop, staticNode.alternate, ctx)})`
    }
    return jsxExprToC(staticNode, ctx)
  }

  if (prop === 'opacity' && t.isNumericLiteral(staticNode)) return String(Math.round(staticNode.value * 255))
  if (t.isNumericLiteral(staticNode)) return String(staticNode.value)
  if (t.isStringLiteral(staticNode)) return resolveRawStyleValue(prop, staticNode.value) ?? '0'
  return jsxExprToC(staticNode, ctx)
}

function resolveTemplateTransformValue(node: t.TemplateLiteral, ctx: ExprCtx): string | null {
  if (node.expressions.length !== 1 || node.quasis.length !== 2) return null
  const before = node.quasis[0].value.cooked ?? node.quasis[0].value.raw
  const after = node.quasis[1].value.cooked ?? node.quasis[1].value.raw
  const prefix = before.trim().toLowerCase()
  const suffix = after.trim().toLowerCase()
  if (prefix !== 'rotate(' || !suffix.endsWith(')')) return null

  const unit = suffix.slice(0, -1).trim() || 'deg'
  if (unit !== 'deg' && unit !== 'rad' && unit !== 'turn') return null
  return angleExpressionToTenths(node.expressions[0] as t.Expression, unit, ctx)
}

function angleExpressionToTenths(expr: t.Expression, unit: string, ctx: ExprCtx): string {
  if (t.isNumericLiteral(expr)) {
    if (unit === 'deg') return String(Math.round(expr.value * 10))
    if (unit === 'turn') return String(Math.round(expr.value * 3600))
    if (unit === 'rad') return String(Math.round((expr.value * 1800) / Math.PI))
  }
  if (unit === 'deg' && t.isBinaryExpression(expr, { operator: '/' }) && t.isNumericLiteral(expr.right) && expr.right.value === 10) {
    return jsxExprToC(expr.left as t.Expression, ctx)
  }

  const c = jsxExprToC(expr, ctx)
  if (unit === 'deg') return `(${c} * 10)`
  if (unit === 'turn') return `(${c} * 3600)`
  return `((int)((${c} * 1800) / 3.14159265358979323846))`
}

export function collectStoreDeps(node: t.Node, storeVars: Set<string>, localExprs: Map<string, t.Expression>): Set<string> {
  const deps = new Set<string>()
  walkAst(node, n => {
    if (t.isIdentifier(n) && localExprs.has(n.name)) {
      collectStoreDeps(localExprs.get(n.name)!, storeVars, localExprs).forEach(dep => deps.add(dep))
      return false
    }
    if (t.isMemberExpression(n) && !n.computed && t.isIdentifier(n.object) && storeVars.has(n.object.name)) {
      deps.add((n.property as t.Identifier).name)
      return false
    }
    if (t.isMemberExpression(n) && n.computed) {
      if (t.isIdentifier(n.object) && storeVars.has(n.object.name)) {
        deps.add((n.property as t.Identifier)?.name || '_computed')
        return false
      }
      if (t.isMemberExpression(n.object) && !n.object.computed && t.isIdentifier(n.object.object) && storeVars.has(n.object.object.name)) {
        deps.add((n.object.property as t.Identifier).name)
      }
    }
    return true
  })
  return deps
}

export function isSimpleTextExpr(node: t.Expression, ctx: ExprCtx): boolean {
  if (t.isMemberExpression(node) && node.computed) {
    if (t.isMemberExpression(node.object) && !node.object.computed && t.isIdentifier(node.object.object) && ctx.storeMap.has(node.object.object.name)) return true
    if (t.isIdentifier(node.object) && ctx.storeMap.has(node.object.name)) return true
  }
  return false
}

export function hasStoreDeps(node: t.Expression, storeVars: Set<string>, localExprs: Map<string, t.Expression>): boolean {
  return collectStoreDeps(node, storeVars, localExprs).size > 0
}

function isStringField(node: t.Expression, ctx: ExprCtx): boolean {
  if (t.isIdentifier(node) && ctx.localExprs.has(node.name)) return !!jsxCCtx(ctx).isStringField?.(ctx.localExprs.get(node.name)!)
  if (t.isMemberExpression(node) && !node.computed && t.isIdentifier(node.object) && ctx.storeMap.has(node.object.name)) {
    const fields = ctx.storeFieldsMap!.get(node.object.name)
    const fi = fields?.find(f => f.name === (node.property as t.Identifier).name)
    return !!(fi && fi.cSize > 1)
  }
  return false
}

function fieldLookup(node: t.Expression, ctx: ExprCtx): StoreField | undefined {
  if (t.isIdentifier(node) && ctx.localExprs.has(node.name)) return jsxCCtx(ctx).fieldLookup?.(ctx.localExprs.get(node.name)!)
  if (t.isMemberExpression(node) && !node.computed && t.isIdentifier(node.object) && ctx.storeMap.has(node.object.name)) {
    return ctx.storeFieldsMap!.get(node.object.name)?.find(f => f.name === (node.property as t.Identifier).name)
  }
  return undefined
}

function inferJsxExpressionType(node: t.Expression, ctx: ExprCtx): string | undefined {
  if (t.isIdentifier(node)) {
    if (ctx.constVals.has(node.name)) {
      const value = ctx.constVals.get(node.name)!
      return typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'double') : value.length === 1 ? 'char' : 'const char *'
    }
    if (ctx.localExprs.has(node.name)) return inferJsxExpressionType(ctx.localExprs.get(node.name)!, ctx)
    if (ctx.absentLocals?.has(node.name)) return 'int'
  }
  if (t.isNumericLiteral(node)) return Number.isInteger(node.value) ? 'int' : 'double'
  if (t.isBooleanLiteral(node)) return 'int8_t'
  if (t.isStringLiteral(node)) return node.value.length === 1 ? 'char' : 'const char *'
  if (t.isUnaryExpression(node)) {
    if (node.operator === '!') return 'int'
    return inferJsxExpressionType(node.argument as t.Expression, ctx)
  }
  if (t.isConditionalExpression(node)) {
    return mergeExpressionTypes(
      inferJsxExpressionType(node.consequent, ctx),
      inferJsxExpressionType(node.alternate, ctx)
    )
  }
  if (t.isBinaryExpression(node)) return inferJsxBinaryExpressionType(node, ctx)
  if (t.isMemberExpression(node) && !node.computed) {
    if (t.isIdentifier(node.object) && ctx.accelerometerVars?.has(node.object.name)) return 'int'
    const field = ctx.storeFieldsMap ? fieldLookup(node, ctx) : undefined
    if (!field) return undefined
    if (field.cType === 'char' && field.cSize > 1) return 'const char *'
    return field.cType
  }
  if (t.isCallExpression(node)) return inferJsxCallExpressionType(node, ctx)
  return undefined
}

function inferJsxBinaryExpressionType(node: t.BinaryExpression, ctx: ExprCtx): string | undefined {
  if (
    node.operator === '==' ||
    node.operator === '===' ||
    node.operator === '!=' ||
    node.operator === '!==' ||
    node.operator === '<' ||
    node.operator === '<=' ||
    node.operator === '>' ||
    node.operator === '>=' ||
    node.operator === 'in' ||
    node.operator === 'instanceof'
  ) {
    return 'int'
  }
  if (
    node.operator === '|' ||
    node.operator === '&' ||
    node.operator === '^' ||
    node.operator === '<<' ||
    node.operator === '>>' ||
    node.operator === '>>>'
  ) {
    return 'int'
  }
  return mergeExpressionTypes(
    inferJsxExpressionType(node.left as t.Expression, ctx),
    inferJsxExpressionType(node.right, ctx)
  )
}

function inferJsxCallExpressionType(node: t.CallExpression, ctx: ExprCtx): string | undefined {
  const callee = node.callee
  if (t.isIdentifier(callee) && callee.name === 'String') return 'const char *'
  if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.object, { name: 'Date' }) && t.isIdentifier(callee.property, { name: 'now' })) return 'int'
  if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.object, { name: 'Math' }) && t.isIdentifier(callee.property)) {
    const method = callee.property.name
    if (method === 'random') return 'double'
    if (method === 'fround') return 'float'
    if (method === 'floor' || method === 'ceil' || method === 'round' || method === 'trunc' || method === 'imul' || method === 'sign') return 'int'
    if (method === 'abs') return node.arguments[0] && t.isExpression(node.arguments[0]) ? inferJsxExpressionType(node.arguments[0], ctx) : undefined
    return 'double'
  }
  return undefined
}

function mergeExpressionTypes(left: string | undefined, right: string | undefined): string | undefined {
  if (left === 'double' || right === 'double') return 'double'
  if (left === 'float' || right === 'float') return 'float'
  return left ?? right
}

export function walkAst(node: t.Node, visit: (node: t.Node) => boolean | void): void {
  if (visit(node) === false) return
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue
    const child = (node as any)[key]
    if (!child || typeof child !== 'object') continue
    if (Array.isArray(child)) {
      for (const item of child) if (item && typeof item.type === 'string') walkAst(item, visit)
    } else if (typeof child.type === 'string') {
      walkAst(child, visit)
    }
  }
}
