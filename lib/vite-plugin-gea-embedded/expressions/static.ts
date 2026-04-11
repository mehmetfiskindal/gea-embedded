import * as t from '@babel/types'
import type { ExprCtx } from '../types'

export function resolveStaticExpression(node: t.Expression, ctx: ExprCtx, seen: Set<string> = new Set()): t.Expression | undefined {
  if (t.isIdentifier(node)) {
    if (ctx.constVals.has(node.name)) {
      const value = ctx.constVals.get(node.name)!
      return typeof value === 'number' ? t.numericLiteral(value) : t.stringLiteral(value)
    }
    if (ctx.localExprs.has(node.name) && !seen.has(node.name)) {
      seen.add(node.name)
      return resolveStaticExpression(ctx.localExprs.get(node.name)!, ctx, seen) ?? ctx.localExprs.get(node.name)!
    }
  }

  if (t.isMemberExpression(node) && !node.computed && t.isIdentifier(node.property)) {
    return resolveStaticMember(node.object as t.Expression, node.property.name, ctx, seen)
  }

  if (t.isMemberExpression(node) && node.computed && t.isExpression(node.property)) {
    return resolveStaticComputedMember(node.object as t.Expression, node.property, ctx, seen)
  }

  return undefined
}

export function resolveStaticNumber(node: t.Expression, ctx: ExprCtx): number | undefined {
  const resolved = resolveStaticExpression(node, ctx) ?? node
  if (t.isNumericLiteral(resolved)) return resolved.value
  if (t.isUnaryExpression(resolved, { operator: '-' }) && t.isNumericLiteral(resolved.argument)) return -resolved.argument.value
  if (t.isBinaryExpression(resolved)) {
    const left = resolveStaticNumber(resolved.left as t.Expression, ctx)
    const right = resolveStaticNumber(resolved.right as t.Expression, ctx)
    if (left === undefined || right === undefined) return undefined
    if (resolved.operator === '+') return left + right
    if (resolved.operator === '-') return left - right
    if (resolved.operator === '*') return left * right
    if (resolved.operator === '/') return right === 0 ? undefined : left / right
  }
  return undefined
}

export function resolveStaticString(node: t.Expression, ctx: ExprCtx): string | undefined {
  const resolved = resolveStaticExpression(node, ctx) ?? node
  return t.isStringLiteral(resolved) ? resolved.value : undefined
}

export function resolveStaticIterableElements(node: t.Expression, ctx: ExprCtx): t.Expression[] | undefined {
  const resolved = resolveStaticExpression(node, ctx) ?? node
  if (t.isArrayExpression(resolved)) return resolved.elements.filter(t.isExpression)
  if (t.isStringLiteral(resolved)) return [...resolved.value].map(ch => t.stringLiteral(ch))
  if (t.isCallExpression(resolved) && t.isMemberExpression(resolved.callee) && !resolved.callee.computed) {
    const prop = resolved.callee.property
    if (t.isIdentifier(prop, { name: 'split' }) && resolved.arguments.length === 1 && t.isStringLiteral(resolved.arguments[0], { value: '' })) {
      const source = resolveStaticString(resolved.callee.object as t.Expression, ctx)
      if (source !== undefined) return [...source].map(ch => t.stringLiteral(ch))
    }
  }
  return undefined
}

export function bindStaticLoopValue(ctx: ExprCtx, name: string, value: t.Expression): void {
  if (t.isNumericLiteral(value)) {
    ctx.constVals.set(name, value.value)
    ctx.localExprSources?.delete(name)
  } else if (t.isStringLiteral(value)) {
    ctx.constVals.set(name, value.value)
    ctx.localExprSources?.delete(name)
  } else {
    ctx.localExprs.set(name, value)
    if (ctx.srcCode) ctx.localExprSources?.set(name, ctx.srcCode)
  }
}

export function cloneExprCtx(ctx: ExprCtx): ExprCtx {
  return {
    ...ctx,
    constVals: new Map(ctx.constVals),
    localExprs: new Map(ctx.localExprs),
    localExprSources: new Map(ctx.localExprSources),
    absentLocals: new Set(ctx.absentLocals)
  }
}

function resolveStaticMember(object: t.Expression, prop: string, ctx: ExprCtx, seen: Set<string>): t.Expression | undefined {
  const resolvedObject = resolveStaticExpression(object, ctx, seen) ?? object

  if (prop === 'length') {
    if (t.isStringLiteral(resolvedObject)) return t.numericLiteral(resolvedObject.value.length)
    if (t.isArrayExpression(resolvedObject)) return t.numericLiteral(resolvedObject.elements.length)
  }

  if (t.isObjectExpression(resolvedObject)) {
    for (const property of resolvedObject.properties) {
      if (!t.isObjectProperty(property)) continue
      const key = t.isIdentifier(property.key) ? property.key.name : t.isStringLiteral(property.key) ? property.key.value : ''
      if (key === prop && t.isExpression(property.value)) return property.value
    }
  }

  return undefined
}

function resolveStaticComputedMember(object: t.Expression, property: t.Expression, ctx: ExprCtx, seen: Set<string>): t.Expression | undefined {
  const resolvedObject = resolveStaticExpression(object, ctx, seen) ?? object
  const index = resolveStaticNumber(property, ctx)
  if (index === undefined) return undefined
  if (t.isArrayExpression(resolvedObject)) {
    const element = resolvedObject.elements[index]
    return t.isExpression(element) ? element : undefined
  }
  if (t.isStringLiteral(resolvedObject)) {
    const ch = resolvedObject.value[index]
    return ch === undefined ? undefined : t.stringLiteral(ch)
  }
  return undefined
}
