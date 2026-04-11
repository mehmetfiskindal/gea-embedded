import * as t from '@babel/types'
import type { ExprCtx } from '../types'
import { collectStoreDeps, isSimpleTextExpr, jsxExprToC, jsxFieldLookup, jsxTruthyExprToC } from '../expressions/jsx'
import { resolveStaticString } from '../expressions/static'
import { concatToSnprintf } from '../store/strings'
import { I, type TemplateEmitContext } from './context'

export function emitTextBinding(ctx: TemplateEmitContext, expr: t.Expression, parentVar: string, parentNodeId: number, level: number, exprCtx: ExprCtx): void {
  let resolvedExpr = expr
  let resolvedSource = exprCtx.srcCode || ctx.code
  if (t.isIdentifier(expr) && exprCtx.localExprs.has(expr.name)) {
    resolvedSource = exprCtx.localExprSources?.get(expr.name) || resolvedSource
    resolvedExpr = exprCtx.localExprs.get(expr.name)!
  }
  const deps = collectStoreDeps(resolvedExpr, ctx.storeVars, exprCtx.localExprs)

  if (deps.size === 0) {
    const isCharAccess = t.isMemberExpression(resolvedExpr) && resolvedExpr.computed
    const staticString = resolveStaticString(resolvedExpr, exprCtx)
    const cExpr = jsxExprToC(resolvedExpr, exprCtx)
    if (staticString !== undefined) {
      ctx.initLines.push(`${I(level)}gea_embedded_ui_set_text(${parentVar}, ${JSON.stringify(staticString)});`)
    } else if (isCharAccess) {
      ctx.initLines.push(`${I(level)}{`)
      ctx.initLines.push(`${I(level + 1)}char __buf[2] = { ${cExpr}, '\\0' };`)
      ctx.initLines.push(`${I(level + 1)}gea_embedded_ui_set_text(${parentVar}, __buf);`)
      ctx.initLines.push(`${I(level)}}`)
    } else {
      ctx.initLines.push(`${I(level)}gea_embedded_ui_set_text(${parentVar}, ${cExpr});`)
    }
    return
  }

  const bindId = ctx.nextBindingId++
  const localExpr = t.isIdentifier(expr) ? exprCtx.localExprs.get(expr.name) : undefined
  const sliceSource = localExpr ? resolvedSource : exprCtx.srcCode || ctx.code
  const jsSource = localExpr ? sliceSource.slice(localExpr.start!, localExpr.end!) : sliceSource.slice(expr.start!, expr.end!)

  ctx.bindings.push({
    id: bindId,
    nodeId: parentNodeId,
    targetType: 'text',
    fieldDeps: [...deps],
    isSimple: true,
    cLines: textBindingToCLines(resolvedExpr, bindId, exprCtx),
    jsExpr: jsSource
  })
  ctx.initLines.push(`${I(level)}bind_nodes[${bindId}] = ${parentVar};`)
}

export function textBindingToCLines(resolvedExpr: t.Expression, bindId: number, ctx: ExprCtx): string[] {
  const lines: string[] = [`static void update_binding_${bindId}(void) {`]
  const pushTextToBuffer = (target: t.Expression, indent: string) => {
    const fi = jsxFieldLookup(target, ctx)
    const cVal = jsxExprToC(target, ctx)
    const constVal = t.isIdentifier(target) ? ctx.constVals.get(target.name) : undefined
    const isStringLiteral = t.isStringLiteral(target) || typeof constVal === 'string'
    if (fi && fi.cType === 'char' && fi.cSize === 1) lines.push(`${indent}snprintf(buf, sizeof(buf), "%c", ${cVal});`)
    else if ((fi && fi.cSize > 1) || isStringLiteral) lines.push(`${indent}snprintf(buf, sizeof(buf), "%s", ${cVal});`)
    else lines.push(`${indent}snprintf(buf, sizeof(buf), "%d", ${cVal});`)
  }

  if (t.isConditionalExpression(resolvedExpr)) {
    emitConditionalTextBinding(lines, resolvedExpr, bindId, ctx, pushTextToBuffer)
  } else if (t.isBinaryExpression(resolvedExpr, { operator: '+' })) {
    const { format, args, maxLen } = concatToSnprintf(resolvedExpr, e => jsxExprToC(e, ctx), e => jsxFieldLookup(e, ctx))
    lines.push(`    char buf[${Math.max(128, maxLen)}];`)
    lines.push(`    snprintf(buf, sizeof(buf), "${format}", ${args.join(', ')});`)
    lines.push(`    gea_embedded_ui_set_text(bind_nodes[${bindId}], buf);`)
  } else if (isSimpleTextExpr(resolvedExpr, ctx)) {
    const cExpr = jsxExprToC(resolvedExpr, ctx)
    lines.push(`    char __buf[2] = { ${cExpr}, '\\0' };`)
    lines.push(`    gea_embedded_ui_set_text(bind_nodes[${bindId}], __buf);`)
  } else {
    emitScalarTextBinding(lines, resolvedExpr, bindId, ctx)
  }

  lines.push('}')
  return lines
}

function emitConditionalTextBinding(
  lines: string[],
  expr: t.ConditionalExpression,
  bindId: number,
  ctx: ExprCtx,
  pushTextToBuffer: (target: t.Expression, indent: string) => void
): void {
  const consResult = t.isBinaryExpression(expr.consequent, { operator: '+' }) ? concatToSnprintf(expr.consequent, e => jsxExprToC(e, ctx), e => jsxFieldLookup(e, ctx)) : undefined
  const altResult = t.isBinaryExpression(expr.alternate, { operator: '+' }) ? concatToSnprintf(expr.alternate, e => jsxExprToC(e, ctx), e => jsxFieldLookup(e, ctx)) : undefined
  const bufSize = Math.max(128, consResult?.maxLen ?? 0, altResult?.maxLen ?? 0)

  lines.push(`    char buf[${bufSize}];`)
  lines.push(`    if (${jsxTruthyExprToC(expr.test as t.Expression, ctx)}) {`)
  if (consResult) lines.push(`        snprintf(buf, sizeof(buf), "${consResult.format}", ${consResult.args.join(', ')});`)
  else pushTextToBuffer(expr.consequent, '        ')
  lines.push('    } else {')
  if (altResult) lines.push(`        snprintf(buf, sizeof(buf), "${altResult.format}", ${altResult.args.join(', ')});`)
  else pushTextToBuffer(expr.alternate, '        ')
  lines.push('    }')
  lines.push(`    gea_embedded_ui_set_text(bind_nodes[${bindId}], buf);`)
}

function emitScalarTextBinding(lines: string[], expr: t.Expression, bindId: number, ctx: ExprCtx): void {
  const fi = jsxFieldLookup(expr, ctx)
  const cExpr = jsxExprToC(expr, ctx)
  if (fi && fi.cType === 'char' && fi.cSize === 1) {
    lines.push(`    char __buf[2] = { ${cExpr}, '\\0' };`)
    lines.push(`    gea_embedded_ui_set_text(bind_nodes[${bindId}], __buf);`)
  } else if (fi && fi.cSize > 1) {
    lines.push(`    gea_embedded_ui_set_text(bind_nodes[${bindId}], ${cExpr});`)
  } else {
    lines.push('    char buf[32];')
    lines.push(`    snprintf(buf, sizeof(buf), "%d", ${cExpr});`)
    lines.push(`    gea_embedded_ui_set_text(bind_nodes[${bindId}], buf);`)
  }
}
