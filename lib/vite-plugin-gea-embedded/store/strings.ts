import * as t from '@babel/types'
import type { StoreField } from '../types'

export function flattenConcat(node: t.Expression): t.Expression[] {
  if (t.isBinaryExpression(node, { operator: '+' })) {
    return [...flattenConcat(node.left as t.Expression), ...flattenConcat(node.right as t.Expression)]
  }
  if (t.isTemplateLiteral(node)) {
    const parts: t.Expression[] = []
    for (let i = 0; i < node.quasis.length; i++) {
      const text = node.quasis[i].value.cooked ?? node.quasis[i].value.raw
      if (text.length > 0) parts.push(t.stringLiteral(text))
      if (i < node.expressions.length) parts.push(node.expressions[i] as t.Expression)
    }
    return parts
  }
  return [node]
}

export function isSubstringCall(node: t.Expression): boolean {
  return t.isCallExpression(node) && t.isMemberExpression(node.callee) && !node.callee.computed && t.isIdentifier(node.callee.property, { name: 'substring' })
}

export function concatToSnprintf(
  node: t.Expression,
  exprStr: (e: t.Expression) => string,
  typeOf: (e: t.Expression) => StoreField | undefined
): { format: string; args: string[]; maxLen: number } {
  const parts = flattenConcat(node)
  let format = ''
  let maxLen = 0
  const args: string[] = []

  for (const part of parts) {
    if (t.isStringLiteral(part)) {
      format += part.value.replace(/%/g, '%%')
      maxLen += part.value.length
    } else if (isSubstringCall(part)) {
      const call = part as t.CallExpression
      const callee = call.callee as t.MemberExpression
      const cObj = exprStr(callee.object as t.Expression)
      const srcFi = typeOf(callee.object as t.Expression)
      if (call.arguments.length >= 2) {
        const start = exprStr(call.arguments[0] as t.Expression)
        const end = exprStr(call.arguments[1] as t.Expression)
        format += '%.*s'
        args.push(`(${end}) - (${start})`, `${cObj} + (${start})`)
      } else if (call.arguments.length === 1) {
        format += '%s'
        args.push(`${cObj} + (${exprStr(call.arguments[0] as t.Expression)})`)
      }
      maxLen += srcFi ? Math.max(srcFi.cSize - 1, 0) : 64
    } else {
      const fi = typeOf(part)
      if (fi && fi.cType === 'char' && fi.cSize === 1) {
        format += '%c'; maxLen += 1
      } else if (fi && fi.cSize > 1) {
        format += '%s'; maxLen += fi.cSize - 1
      } else {
        format += '%d'; maxLen += 11
      }
      args.push(exprStr(part))
    }
  }

  return { format, args, maxLen: maxLen + 1 }
}
