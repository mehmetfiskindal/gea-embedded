import * as t from '@babel/types'
import { hexToRgb565 } from '../style'
import { methodExprToC, methodExprType, type MethodCtx } from './method-context'

export function variableDeclarationToCLines(node: t.VariableDeclaration, ctx: MethodCtx, indent: string): string[] {
  const lines: string[] = []
  for (const decl of node.declarations) {
    if (!t.isIdentifier(decl.id) || !decl.init) continue
    const vName = decl.id.name
    if (t.isArrayExpression(decl.init) && decl.init.elements.every(e => t.isArrayExpression(e))) {
      emitMatrixDeclaration(lines, vName, decl.init, ctx, indent)
    } else if (t.isArrayExpression(decl.init) && decl.init.elements.every(e => isNumericArrayElement(e))) {
      emitNumericArrayDeclaration(lines, vName, decl.init, ctx, indent)
    } else if (
      t.isArrayExpression(decl.init) &&
      decl.init.elements.every(e => t.isStringLiteral(e) && /^#[0-9a-fA-F]{3,6}$/.test(e.value))
    ) {
      emitColorArrayDeclaration(lines, vName, decl.init, ctx, indent)
    } else if (isAudioOscillatorCreate(decl.init as t.Expression)) {
      ctx.audioOscillatorVars.add(vName)
      ctx.localTypes.set(vName, 'int')
      lines.push(`${indent}int ${vName} = gea_embedded_audio_context_create_oscillator();`)
    } else {
      const cType = inferLocalCType(decl.init as t.Expression, ctx)
      ctx.localTypes.set(vName, cType)
      lines.push(`${indent}${cType} ${vName} = ${methodExprToC(decl.init as t.Expression, ctx)};`)
    }
  }
  return lines
}

function inferLocalCType(init: t.Expression, ctx: MethodCtx): string {
  const inferred = methodExprType(init, ctx)
  if (inferred === 'double' || inferred === 'float' || inferred === 'const char *' || inferred === 'char')
    return inferred
  if (
    t.isCallExpression(init) &&
    t.isMemberExpression(init.callee) &&
    !init.callee.computed &&
    t.isThisExpression(init.callee.object) &&
    t.isIdentifier(init.callee.property)
  ) {
    const info = ctx.allMethods.get(init.callee.property.name)
    if (info?.returnType === 'char') return 'char'
  }
  if (isAudioTimeExpression(init)) return 'double'
  return 'int'
}

function isAudioOscillatorCreate(init: t.Expression): boolean {
  return (
    t.isCallExpression(init) &&
    t.isMemberExpression(init.callee) &&
    !init.callee.computed &&
    t.isIdentifier(init.callee.object, { name: 'audioContext' }) &&
    t.isIdentifier(init.callee.property, { name: 'createOscillator' })
  )
}

function isAudioTimeExpression(init: t.Expression): boolean {
  if (
    t.isMemberExpression(init) &&
    !init.computed &&
    t.isIdentifier(init.object, { name: 'audioContext' }) &&
    t.isIdentifier(init.property, { name: 'currentTime' })
  ) {
    return true
  }
  if (t.isBinaryExpression(init)) {
    return isAudioTimeExpression(init.left as t.Expression) || isAudioTimeExpression(init.right as t.Expression)
  }
  return false
}

function emitMatrixDeclaration(
  lines: string[],
  vName: string,
  init: t.ArrayExpression,
  ctx: MethodCtx,
  indent: string
): void {
  const outer = init.elements as t.ArrayExpression[]
  const inner = outer[0].elements.length
  ctx.localTypes.set(vName, `[${outer.length}][${inner}]`)
  const vals = outer.map(row => '{' + row.elements.map(numericArrayElementToC).join(',') + '}').join(', ')
  lines.push(`${indent}static const int ${vName}[${outer.length}][${inner}] = { ${vals} };`)
}

function emitNumericArrayDeclaration(
  lines: string[],
  vName: string,
  init: t.ArrayExpression,
  ctx: MethodCtx,
  indent: string
): void {
  const elems = init.elements
  ctx.localTypes.set(vName, `[${elems.length}]`)
  lines.push(
    `${indent}static const int ${vName}[${elems.length}] = { ${elems.map(numericArrayElementToC).join(', ')} };`
  )
}

function isNumericArrayElement(node: t.ArrayExpression['elements'][number]): boolean {
  return t.isNumericLiteral(node) || (t.isUnaryExpression(node, { operator: '-' }) && t.isNumericLiteral(node.argument))
}

function numericArrayElementToC(node: t.ArrayExpression['elements'][number]): string {
  if (t.isNumericLiteral(node)) return String(node.value)
  if (t.isUnaryExpression(node, { operator: '-' }) && t.isNumericLiteral(node.argument))
    return String(-node.argument.value)
  return '0'
}

function emitColorArrayDeclaration(
  lines: string[],
  vName: string,
  init: t.ArrayExpression,
  ctx: MethodCtx,
  indent: string
): void {
  const elems = init.elements as t.StringLiteral[]
  ctx.localTypes.set(vName, `[${elems.length}]`)
  const vals = elems.map(e => `0x${hexToRgb565(e.value).toString(16).toUpperCase().padStart(4, '0')}`).join(', ')
  lines.push(`${indent}static const int ${vName}[${elems.length}] = { ${vals} };`)
}
