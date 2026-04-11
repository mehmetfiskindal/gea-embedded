import * as t from '@babel/types'
import type { StoreField } from '../types'

export interface CCtx {
  resolveIdentifier?: (name: string) => string | undefined
  resolveThis?: () => string
  resolveMember?: (node: t.MemberExpression) => string | undefined
  resolveCall?: (node: t.CallExpression, recurse: (n: t.Expression | t.SpreadElement) => string) => string | undefined
  resolveStringLiteral?: (value: string) => string | undefined
  inferType?: (node: t.Expression) => string | undefined
  isStringField?: (node: t.Expression) => boolean
  fieldLookup?: (node: t.Expression) => StoreField | undefined
}

function mathToC(method: string, args: string[], argNodes: (t.Expression | t.SpreadElement)[], ctx: CCtx): string | undefined {
  if (method === 'abs' && args.length === 1) return mathAbsToC(args[0], argNodes[0], ctx)
  if (method === 'acos' && args.length === 1) return `acos(${args[0]})`
  if (method === 'acosh' && args.length === 1) return `acosh(${args[0]})`
  if (method === 'asin' && args.length === 1) return `asin(${args[0]})`
  if (method === 'asinh' && args.length === 1) return `asinh(${args[0]})`
  if (method === 'atan' && args.length === 1) return `atan(${args[0]})`
  if (method === 'atan2' && args.length === 2) return `atan2(${args[0]}, ${args[1]})`
  if (method === 'atanh' && args.length === 1) return `atanh(${args[0]})`
  if (method === 'cbrt' && args.length === 1) return `cbrt(${args[0]})`
  if (method === 'round' && args.length === 1) {
    return `((int)floor((${args[0]}) + 0.5))`
  }
  if (method === 'floor' && args.length === 1) return `((int)floor(${args[0]}))`
  if (method === 'ceil' && args.length === 1) return `((int)ceil(${args[0]}))`
  if (method === 'cos' && args.length === 1) return `cos(${args[0]})`
  if (method === 'cosh' && args.length === 1) return `cosh(${args[0]})`
  if (method === 'exp' && args.length === 1) return `exp(${args[0]})`
  if (method === 'expm1' && args.length === 1) return `expm1(${args[0]})`
  if (method === 'fround' && args.length === 1) return `((float)(${args[0]}))`
  if (method === 'hypot') return foldMathCall('hypot', args, '0')
  if (method === 'imul' && args.length === 2) return `((int32_t)(${args[0]}) * (int32_t)(${args[1]}))`
  if (method === 'log' && args.length === 1) return `log(${args[0]})`
  if (method === 'log1p' && args.length === 1) return `log1p(${args[0]})`
  if (method === 'log10' && args.length === 1) return `log10(${args[0]})`
  if (method === 'log2' && args.length === 1) return `log2(${args[0]})`
  if (method === 'min') return foldMathCall('fmin', args, 'INFINITY')
  if (method === 'max') return foldMathCall('fmax', args, '-INFINITY')
  if (method === 'pow' && args.length === 2) return `pow(${args[0]}, ${args[1]})`
  if (method === 'random' && args.length === 0) return 'gea_embedded_math_random()'
  if (method === 'sign' && args.length === 1) return `(((${args[0]}) > 0) - ((${args[0]}) < 0))`
  if (method === 'sin' && args.length === 1) return `sin(${args[0]})`
  if (method === 'sinh' && args.length === 1) return `sinh(${args[0]})`
  if (method === 'sqrt' && args.length === 1) return `sqrt(${args[0]})`
  if (method === 'tan' && args.length === 1) return `tan(${args[0]})`
  if (method === 'tanh' && args.length === 1) return `tanh(${args[0]})`
  if (method === 'trunc' && args.length === 1) return `((int)(${args[0]}))`
  return undefined
}

function mathAbsToC(arg: string, argNode: t.Expression | t.SpreadElement | undefined, ctx: CCtx): string {
  const type = argNode && t.isExpression(argNode) ? ctx.inferType?.(argNode) : undefined
  if (type && isKnownUnsignedIntegerType(type)) return `(${arg})`
  if (type && isKnownSignedIntegerType(type)) return `abs(${arg})`
  return `fabs(${arg})`
}

function isKnownSignedIntegerType(type: string): boolean {
  const normalized = type.replace(/\s+/g, ' ').trim()
  if (normalized.startsWith('[') || normalized.includes('*')) return false
  if (normalized === 'float' || normalized === 'double') return false
  return /^(int8_t|int16_t|int32_t|int64_t|int|short|long|long long|char|signed char)$/.test(normalized)
}

function isKnownUnsignedIntegerType(type: string): boolean {
  const normalized = type.replace(/\s+/g, ' ').trim()
  return /^(uint8_t|uint16_t|uint32_t|uint64_t|unsigned|unsigned int|unsigned short|unsigned long|unsigned long long|unsigned char|bool)$/.test(normalized)
}

function foldMathCall(cName: string, args: string[], emptyValue: string): string {
  if (args.length === 0) return emptyValue
  if (args.length === 1) return args[0]
  return args.slice(1).reduce((acc, arg) => `${cName}(${acc}, ${arg})`, args[0])
}

function mathConstantToC(property: string): string | undefined {
  if (property === 'E') return '2.7182818284590452354'
  if (property === 'LN10') return '2.302585092994046'
  if (property === 'LN2') return '0.6931471805599453'
  if (property === 'LOG10E') return '0.4342944819032518'
  if (property === 'LOG2E') return '1.4426950408889634'
  if (property === 'PI') return '3.14159265358979323846'
  if (property === 'SQRT1_2') return '0.7071067811865476'
  if (property === 'SQRT2') return '1.4142135623730951'
  return undefined
}

export function exprToC(node: t.Expression | t.SpreadElement, ctx: CCtx): string {
  const recurse = (n: t.Expression | t.SpreadElement) => exprToC(n, ctx)

  if (t.isNumericLiteral(node)) return String(node.value)
  if (t.isStringLiteral(node)) {
    const custom = ctx.resolveStringLiteral?.(node.value)
    if (custom !== undefined) return custom
    if (node.value.length === 1) return `'${node.value}'`
    return JSON.stringify(node.value)
  }
  if (t.isIdentifier(node)) return ctx.resolveIdentifier?.(node.name) ?? node.name
  if (t.isThisExpression(node)) return ctx.resolveThis?.() ?? 'this'

  if (t.isMemberExpression(node) && !node.computed) {
    const custom = ctx.resolveMember?.(node)
    if (custom !== undefined) return custom
    if (t.isIdentifier(node.object, { name: 'Math' }) && t.isIdentifier(node.property)) {
      const constant = mathConstantToC(node.property.name)
      if (constant !== undefined) return constant
    }
    return `${recurse(node.object as t.Expression)}.${(node.property as t.Identifier).name}`
  }
  if (t.isMemberExpression(node) && node.computed) {
    return `${recurse(node.object as t.Expression)}[${recurse(node.property as t.Expression)}]`
  }
  if (t.isAssignmentExpression(node)) return `${recurse(node.left as t.Expression)} ${node.operator} ${recurse(node.right as t.Expression)}`
  if (t.isUpdateExpression(node)) {
    const arg = recurse(node.argument as t.Expression)
    return node.prefix ? `${node.operator}${arg}` : `${arg}${node.operator}`
  }
  if (t.isBinaryExpression(node)) return binaryExprToC(node, recurse, ctx)
  if (t.isConditionalExpression(node)) {
    return `(${exprToCTruthy(node.test, ctx)} ? ${recurse(node.consequent)} : ${recurse(node.alternate)})`
  }
  if (t.isUnaryExpression(node)) {
    if (node.operator === '!' && ctx.fieldLookup) return `!(${exprToCTruthy(node.argument as t.Expression, ctx)})`
    return `${node.operator}${recurse(node.argument as t.Expression)}`
  }
  if (t.isLogicalExpression(node)) {
    const leftC = exprToCTruthy(node.left as t.Expression, ctx)
    const rightC = exprToCTruthy(node.right as t.Expression, ctx)
    const l = t.isLogicalExpression(node.left) ? `(${leftC})` : leftC
    const r = t.isLogicalExpression(node.right) ? `(${rightC})` : rightC
    return `(${l} ${node.operator} ${r})`
  }
  if (t.isCallExpression(node)) return callExprToC(node, recurse, ctx)

  return `/* unknown */0`
}

function binaryExprToC(node: t.BinaryExpression, recurse: (n: t.Expression | t.SpreadElement) => string, ctx: CCtx): string {
  const l = recurse(node.left as t.Expression)
  const r = recurse(node.right)
  let op = node.operator
  if (op === '===') op = '=='
  if (op === '!==') op = '!='

  if ((op === '==' || op === '!=') && ctx.isStringField) {
    const leftIsString = ctx.isStringField(node.left as t.Expression)
    const isRightString = t.isStringLiteral(node.right) && node.right.value.length > 1
    if (leftIsString && isRightString) return op === '==' ? `(strcmp(${l}, ${r}) == 0)` : `(strcmp(${l}, ${r}) != 0)`
  }
  return `(${l} ${op} ${r})`
}

function callExprToC(node: t.CallExpression, recurse: (n: t.Expression | t.SpreadElement) => string, ctx: CCtx): string {
  if (t.isIdentifier(node.callee) && node.callee.name === 'String') return recurse(node.arguments[0] as t.Expression)
  if (
    t.isMemberExpression(node.callee) &&
    !node.callee.computed &&
    t.isIdentifier(node.callee.object, { name: 'Date' }) &&
    t.isIdentifier(node.callee.property, { name: 'now' }) &&
    node.arguments.length === 0
  ) {
    return 'gea_embedded_now_ms()'
  }
  if (
    t.isMemberExpression(node.callee) &&
    !node.callee.computed &&
    t.isIdentifier(node.callee.object, { name: 'Math' }) &&
    t.isIdentifier(node.callee.property)
  ) {
    const argNodes = node.arguments as (t.Expression | t.SpreadElement)[]
    const result = mathToC(node.callee.property.name, argNodes.map(a => recurse(a)), argNodes, ctx)
    if (result) return result
  }

  const custom = ctx.resolveCall?.(node, recurse)
  if (custom !== undefined) return custom
  const callee = recurse(node.callee as t.Expression)
  const cArgs = node.arguments.map(a => recurse(a as t.Expression)).join(', ')
  return `${callee}(${cArgs})`
}

function unwrapConditionParens(c: string): string {
  if (!c.startsWith('(') || !c.endsWith(')')) return c
  let depth = 0
  for (let i = 0; i < c.length; i++) {
    if (c[i] === '(') depth++
    else if (c[i] === ')') depth--
    if (depth === 0 && i < c.length - 1) return c
  }
  return c.slice(1, -1)
}

export function exprToCTruthy(node: t.Expression, ctx: CCtx): string {
  const c = exprToC(node, ctx)
  const fi = ctx.fieldLookup?.(node)
  if (!fi) return unwrapConditionParens(c)
  if (fi.cType === 'char' && fi.cSize === 1) return `(${c} != '\\0')`
  if (fi.cSize > 1) return `(${c}[0] != '\\0')`
  return `(${c} != 0)`
}
