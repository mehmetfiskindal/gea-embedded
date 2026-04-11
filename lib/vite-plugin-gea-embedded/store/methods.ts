import * as t from '@babel/types'
import type { StoreField, StoreMethodInfo } from '../types'
import { findFieldByName } from './fields'
import { stmtToC } from './method-statements'
import { getWrittenField } from './method-writes'
import type { MethodCtx } from './method-context'

export function methodParamCDecl(param: t.Identifier): string {
  return `${methodParamLocalType(param)} ${param.name}`
}

export function methodParamLocalType(param: t.Identifier): string {
  const annotation = param.typeAnnotation
  const typeAnnotation = annotation && t.isTSTypeAnnotation(annotation) ? annotation.typeAnnotation : null
  return typeAnnotation && t.isTSStringKeyword(typeAnnotation) ? 'const char *' : 'int'
}

export function inferReturnType(body: t.BlockStatement, storeFields: StoreField[]): string {
  let hasReturn = false
  let isChar = false
  let isInt = false

  function walk(node: t.Node) {
    if (t.isReturnStatement(node) && node.argument) {
      hasReturn = true
      const arg = node.argument
      if (t.isStringLiteral(arg)) {
        if (arg.value.length <= 1) isChar = true
        else isInt = false
      } else if (
        t.isMemberExpression(arg) &&
        arg.computed &&
        t.isMemberExpression(arg.object) &&
        !arg.object.computed &&
        t.isThisExpression(arg.object.object) &&
        t.isIdentifier(arg.object.property)
      ) {
        const fi = findFieldByName(storeFields, arg.object.property.name)
        if (fi && fi.cSize > 1 && fi.cType === 'char') isChar = true
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue
      const child = (node as any)[key]
      if (child && typeof child === 'object') {
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item.type === 'string') walk(item)
          }
        } else if (typeof child.type === 'string') {
          walk(child)
        }
      }
    }
  }

  walk(body)
  if (!hasReturn) return 'void'
  if (isChar) return 'char'
  return 'int'
}

export function compileMethod(
  methodName: string,
  params: t.Identifier[],
  body: t.BlockStatement,
  returnType: string,
  storeName: string,
  storeFields: StoreField[],
  allMethods: Map<string, { returnType: string; cName: string }>,
  bitmaskOne: string,
  hasBatch: boolean,
  crossStoreMethods?: Map<string, Map<string, { returnType: string; cName: string }>>,
  accelerometerVars: Set<string> = new Set(),
  fieldOffset: number = 0,
  moduleConstants?: Map<string, number | string>
): string[] {
  const cName = `${storeName}_${methodName}`
  const paramList = params.length > 0 ? params.map(methodParamCDecl).join(', ') : 'void'
  const sig = `static ${returnType} ${cName}(${paramList})`

  const ctx: MethodCtx = {
    storeName,
    storeFields,
    allMethods,
    returnType,
    moduleConstants,
    localTypes: new Map(params.map(p => [p.name, methodParamLocalType(p)])),
    bitmaskOne,
    fieldOffset,
    arrayAliases: new Map(),
    audioOscillatorVars: new Set(),
    crossStoreMethods,
    accelerometerVars
  }

  const lines: string[] = []
  lines.push(`${sig} {`)
  if (hasBatch) lines.push('    batch_begin();')

  for (const stmt of body.body) {
    const result = stmtToC(stmt, ctx, '    ', hasBatch)
    lines.push(...result.lines)
  }

  if (hasBatch) {
    const lastStmt = body.body[body.body.length - 1]
    if (!t.isReturnStatement(lastStmt)) {
      lines.push('    batch_end();')
    }
  }
  lines.push('}')
  return lines
}

/* ---- Main plugin ---- */
