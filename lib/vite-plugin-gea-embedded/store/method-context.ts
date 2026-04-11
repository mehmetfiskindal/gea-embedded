import * as t from '@babel/types'
import type { StoreField, StoreMethodInfo } from '../types'
import { hexToRgb565 } from '../style'
import { exprToC, exprToCTruthy, type CCtx } from '../expressions/core'
import { accelerometerCallToC, accelerometerMemberToC } from '../expressions/accelerometer'
import { NATIVE_STRING_RETURN_FUNCS, nativeSingletonMethodCName } from '../native-api'
import { findFieldByName } from './fields'

export interface MethodCtx {
  storeName: string
  storeFields: StoreField[]
  allMethods: Map<string, StoreMethodInfo>
  returnType?: string
  moduleConstants?: Map<string, number | string>
  localTypes: Map<string, string>
  bitmaskOne: string
  fieldOffset: number
  arrayAliases: Map<string, { iterVar: string; ptrName: string; elemType: string }>
  audioOscillatorVars: Set<string>
  crossStoreMethods?: Map<string, Map<string, StoreMethodInfo>>
  accelerometerVars?: Set<string>
  suppressDirtyMarks?: Set<string>
}

export function methodCCtx(ctx: MethodCtx): CCtx {
  return {
    resolveIdentifier(name: string) {
      const value = ctx.moduleConstants?.get(name)
      if (typeof value === 'string') return value.length === 1 ? `'${value}'` : JSON.stringify(value)
      return undefined
    },
    resolveThis: () => ctx.storeName,
    resolveStringLiteral(value: string) {
      if (/^#[0-9a-fA-F]{3,6}$/.test(value))
        return `0x${hexToRgb565(value).toString(16).toUpperCase().padStart(4, '0')}`
      return undefined
    },
    inferType(node: t.Expression) {
      return inferMethodExpressionType(node, ctx)
    },
    resolveMember(node: t.MemberExpression) {
      if (node.computed) return undefined
      const prop = (node.property as t.Identifier).name
      if (t.isIdentifier(node.object) && ctx.accelerometerVars?.has(node.object.name))
        return accelerometerMemberToC(prop)
      if (t.isIdentifier(node.object, { name: 'audioContext' })) {
        if (prop === 'currentTime') return 'gea_embedded_audio_context_current_time()'
        if (prop === 'destination') return 'gea_embedded_audio_context_destination()'
      }
      const frequencyOwner = audioFrequencyOwner(node)
      if (frequencyOwner && ctx.audioOscillatorVars.has(frequencyOwner) && prop === 'value') {
        return `gea_embedded_audio_oscillator_get_frequency(${frequencyOwner})`
      }
      if (t.isThisExpression(node.object)) return `${ctx.storeName}.${prop}`
      if (isThisFieldMember(node.object)) {
        const fieldName = node.object.property.name
        const field = findFieldByName(ctx.storeFields, fieldName)
        if (field?.isArray && prop === 'length') return `${ctx.storeName}.${fieldName}_len`
        if (field && field.cSize > 1 && prop === 'length') return `(int)strlen(${ctx.storeName}.${fieldName})`
      }
      if (isThisArrayElementMember(node.object)) {
        const arrName = node.object.object.property.name
        const iterVar = node.object.property.name
        const alias = ctx.arrayAliases.get(arrName)
        if (alias && alias.iterVar === iterVar) return `${alias.ptrName}->${prop}`
      }
      return undefined
    },
    resolveCall(node: t.CallExpression, recurse: (n: t.Expression | t.SpreadElement) => string) {
      const callee = node.callee
      if (
        t.isMemberExpression(callee) &&
        !callee.computed &&
        t.isThisExpression(callee.object) &&
        t.isIdentifier(callee.property)
      ) {
        const info = ctx.allMethods.get(callee.property.name)
        if (info) return `${info.cName}(${node.arguments.map(a => recurse(a as t.Expression)).join(', ')})`
      }
      if (
        t.isMemberExpression(callee) &&
        !callee.computed &&
        t.isIdentifier(callee.object) &&
        t.isIdentifier(callee.property) &&
        ctx.accelerometerVars?.has(callee.object.name)
      ) {
        return accelerometerCallToC(
          callee.property.name,
          node.arguments.map(a => recurse(a as t.Expression))
        )
      }
      if (
        t.isMemberExpression(callee) &&
        !callee.computed &&
        t.isIdentifier(callee.object) &&
        t.isIdentifier(callee.property)
      ) {
        if (t.isIdentifier(callee.object, { name: 'audioContext' }) && callee.property.name === 'createOscillator') {
          return 'gea_embedded_audio_context_create_oscillator()'
        }
        if (ctx.audioOscillatorVars.has(callee.object.name)) {
          const args = node.arguments.map(a => recurse(a as t.Expression))
          if (callee.property.name === 'connect')
            return `gea_embedded_audio_oscillator_connect(${callee.object.name}, ${args[0] ?? '0'})`
          if (callee.property.name === 'start')
            return `gea_embedded_audio_oscillator_start(${callee.object.name}, ${args[0] ?? 'gea_embedded_audio_context_current_time()'})`
          if (callee.property.name === 'stop')
            return `gea_embedded_audio_oscillator_stop(${callee.object.name}, ${args[0] ?? 'gea_embedded_audio_context_current_time()'})`
        }
        const nativeName = nativeSingletonMethodCName(callee.object.name, callee.property.name)
        if (nativeName) return `${nativeName}(${node.arguments.map(a => recurse(a as t.Expression)).join(', ')})`
      }
      const frequencySetterOwner = audioFrequencySetterOwner(callee)
      if (frequencySetterOwner && ctx.audioOscillatorVars.has(frequencySetterOwner)) {
        const args = node.arguments.map(a => recurse(a as t.Expression))
        return `gea_embedded_audio_oscillator_frequency_set_value_at_time(${frequencySetterOwner}, ${args[0] ?? '0'}, ${args[1] ?? 'gea_embedded_audio_context_current_time()'})`
      }
      if (
        ctx.crossStoreMethods &&
        t.isMemberExpression(callee) &&
        !callee.computed &&
        t.isIdentifier(callee.object) &&
        t.isIdentifier(callee.property)
      ) {
        const info = ctx.crossStoreMethods.get(callee.object.name)?.get(callee.property.name)
        if (info) return `${info.cName}(${node.arguments.map(a => recurse(a as t.Expression)).join(', ')})`
      }
      return undefined
    },
    isStringField(node: t.Expression) {
      if (
        t.isMemberExpression(node) &&
        !node.computed &&
        t.isThisExpression(node.object) &&
        t.isIdentifier(node.property)
      ) {
        const fi = findFieldByName(ctx.storeFields, node.property.name)
        return !!(fi && fi.cSize > 1)
      }
      return false
    },
    fieldLookup(node: t.Expression) {
      if (
        t.isMemberExpression(node) &&
        !node.computed &&
        t.isThisExpression(node.object) &&
        t.isIdentifier(node.property)
      ) {
        return findFieldByName(ctx.storeFields, node.property.name)
      }
      return undefined
    }
  }
}

export function methodExprToC(node: t.Expression | t.SpreadElement, ctx: MethodCtx): string {
  return exprToC(node, methodCCtx(ctx))
}

export function methodExprToCTruthy(node: t.Expression, ctx: MethodCtx): string {
  return exprToCTruthy(node, methodCCtx(ctx))
}

export function methodExprType(node: t.Expression, ctx: MethodCtx): string | undefined {
  return inferMethodExpressionType(node, ctx)
}

export function isNativeStringReturnCall(node: t.Expression): boolean {
  if (!t.isCallExpression(node)) return false
  if (t.isIdentifier(node.callee)) return NATIVE_STRING_RETURN_FUNCS.has(node.callee.name)
  if (
    t.isMemberExpression(node.callee) &&
    !node.callee.computed &&
    t.isIdentifier(node.callee.object) &&
    t.isIdentifier(node.callee.property)
  ) {
    const nativeName = nativeSingletonMethodCName(node.callee.object.name, node.callee.property.name)
    return !!nativeName && NATIVE_STRING_RETURN_FUNCS.has(nativeName)
  }
  return false
}

export function methodFieldLookup(node: t.Expression, fields: StoreField[]): StoreField | undefined {
  if (
    t.isMemberExpression(node) &&
    !node.computed &&
    t.isThisExpression(node.object) &&
    t.isIdentifier(node.property)
  ) {
    return findFieldByName(fields, node.property.name)
  }
  return undefined
}

function inferMethodExpressionType(node: t.Expression, ctx: MethodCtx): string | undefined {
  if (t.isIdentifier(node)) {
    const constant = ctx.moduleConstants?.get(node.name)
    if (typeof constant === 'number') return Number.isInteger(constant) ? 'int' : 'double'
    if (typeof constant === 'string') return constant.length === 1 ? 'char' : 'const char *'
    return ctx.localTypes.get(node.name)
  }
  if (t.isNumericLiteral(node)) return Number.isInteger(node.value) ? 'int' : 'double'
  if (t.isBooleanLiteral(node)) return 'int8_t'
  if (t.isStringLiteral(node)) return node.value.length === 1 ? 'char' : 'const char *'
  if (t.isUnaryExpression(node)) {
    if (node.operator === '!') return 'int'
    return inferMethodExpressionType(node.argument as t.Expression, ctx)
  }
  if (t.isUpdateExpression(node)) return inferMethodExpressionType(node.argument as t.Expression, ctx)
  if (t.isAssignmentExpression(node)) return inferMethodExpressionType(node.right as t.Expression, ctx)
  if (t.isConditionalExpression(node)) {
    return mergeExpressionTypes(
      inferMethodExpressionType(node.consequent, ctx),
      inferMethodExpressionType(node.alternate, ctx)
    )
  }
  if (t.isBinaryExpression(node)) return inferBinaryExpressionType(node, ctx)
  if (t.isMemberExpression(node) && !node.computed) return inferMemberExpressionType(node, ctx)
  if (t.isCallExpression(node)) return inferCallExpressionType(node, ctx)
  return undefined
}

function inferBinaryExpressionType(node: t.BinaryExpression, ctx: MethodCtx): string | undefined {
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
    inferMethodExpressionType(node.left as t.Expression, ctx),
    inferMethodExpressionType(node.right, ctx)
  )
}

function inferMemberExpressionType(node: t.MemberExpression, ctx: MethodCtx): string | undefined {
  const prop = node.property as t.Identifier
  if (t.isIdentifier(node.object, { name: 'audioContext' })) {
    if (prop.name === 'currentTime') return 'double'
    if (prop.name === 'destination') return 'int'
  }
  const frequencyOwner = audioFrequencyOwner(node)
  if (frequencyOwner && ctx.audioOscillatorVars.has(frequencyOwner) && prop.name === 'value') return 'double'
  const field = methodFieldLookup(node, ctx.storeFields)
  if (!field) return undefined
  if (field.cType === 'char' && field.cSize > 1) return 'const char *'
  return field.cType
}

function inferCallExpressionType(node: t.CallExpression, ctx: MethodCtx): string | undefined {
  const callee = node.callee
  if (
    t.isMemberExpression(callee) &&
    !callee.computed &&
    t.isThisExpression(callee.object) &&
    t.isIdentifier(callee.property)
  ) {
    return ctx.allMethods.get(callee.property.name)?.returnType
  }
  if (
    t.isMemberExpression(callee) &&
    !callee.computed &&
    t.isIdentifier(callee.object, { name: 'Math' }) &&
    t.isIdentifier(callee.property)
  ) {
    return inferMathCallType(callee.property.name, node.arguments[0] as t.Expression | undefined, ctx)
  }
  if (
    t.isMemberExpression(callee) &&
    !callee.computed &&
    t.isIdentifier(callee.object, { name: 'audioContext' }) &&
    t.isIdentifier(callee.property, { name: 'createOscillator' })
  ) {
    return 'int'
  }
  if (t.isIdentifier(callee) && callee.name === 'String') return 'const char *'
  return undefined
}

function inferMathCallType(method: string, firstArg: t.Expression | undefined, ctx: MethodCtx): string | undefined {
  if (method === 'random') return 'double'
  if (method === 'fround') return 'float'
  if (
    method === 'floor' ||
    method === 'ceil' ||
    method === 'round' ||
    method === 'trunc' ||
    method === 'imul' ||
    method === 'sign'
  )
    return 'int'
  if (method === 'abs') return firstArg ? inferMethodExpressionType(firstArg, ctx) : undefined
  return 'double'
}

function mergeExpressionTypes(left: string | undefined, right: string | undefined): string | undefined {
  if (left === 'double' || right === 'double') return 'double'
  if (left === 'float' || right === 'float') return 'float'
  return left ?? right
}

function isThisFieldMember(
  node: t.Expression | t.PrivateName
): node is t.MemberExpression & { object: t.ThisExpression; property: t.Identifier } {
  return (
    t.isMemberExpression(node) && !node.computed && t.isThisExpression(node.object) && t.isIdentifier(node.property)
  )
}

function isThisArrayElementMember(node: t.Expression | t.PrivateName): node is t.MemberExpression & {
  object: t.MemberExpression & { object: t.ThisExpression; property: t.Identifier }
  property: t.Identifier
} {
  return (
    t.isMemberExpression(node) &&
    node.computed &&
    t.isMemberExpression(node.object) &&
    !node.object.computed &&
    t.isThisExpression(node.object.object) &&
    t.isIdentifier(node.object.property) &&
    t.isIdentifier(node.property)
  )
}

function audioFrequencyOwner(node: t.MemberExpression): string | undefined {
  if (
    t.isMemberExpression(node.object) &&
    !node.object.computed &&
    t.isIdentifier(node.object.object) &&
    t.isIdentifier(node.object.property, { name: 'frequency' })
  ) {
    return node.object.object.name
  }
  return undefined
}

function audioFrequencySetterOwner(callee: t.CallExpression['callee']): string | undefined {
  if (
    t.isMemberExpression(callee) &&
    !callee.computed &&
    t.isIdentifier(callee.property, { name: 'setValueAtTime' }) &&
    t.isMemberExpression(callee.object) &&
    !callee.object.computed &&
    t.isIdentifier(callee.object.object) &&
    t.isIdentifier(callee.object.property, { name: 'frequency' })
  ) {
    return callee.object.object.name
  }
  return undefined
}
