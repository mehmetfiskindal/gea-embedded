import * as t from '@babel/types'
import { findFieldByName } from './fields'
import { concatToSnprintf, flattenConcat, isSubstringCall } from './strings'
import { getPushedField, getWrittenField } from './method-writes'
import { variableDeclarationToCLines } from './method-variables'
import {
  isNativeStringReturnCall,
  methodExprToC,
  methodExprToCTruthy,
  methodExprType,
  methodFieldLookup,
  type MethodCtx
} from './method-context'

export function stmtToC(
  node: t.Statement,
  ctx: MethodCtx,
  indent: string,
  inBatch: boolean
): { lines: string[]; dirty: Set<string> } {
  const lines: string[] = []
  const dirty = new Set<string>()

  if (t.isExpressionStatement(node)) {
    const expr = node.expression
    const pushedField = t.isCallExpression(expr) ? emitArrayPush(lines, expr, ctx, indent) : undefined
    if (pushedField) {
      markDirtyField(lines, dirty, ctx, pushedField, indent)
    } else if (t.isAssignmentExpression(expr)) {
      if (emitAudioAssignment(lines, expr, ctx, indent)) return { lines, dirty }
      const field = getWrittenField(expr.left, ctx.storeFields)
      const fi = field ? findFieldByName(ctx.storeFields, field) : undefined

      if (fi && fi.cSize > 1 && isSubstringCall(expr.right as t.Expression)) {
        const lhs = methodExprToC(expr.left as t.Expression, ctx)
        const call = expr.right as t.CallExpression
        const callee = call.callee as t.MemberExpression
        const src = methodExprToC(callee.object as t.Expression, ctx)
        const start = call.arguments[0] ? methodExprToC(call.arguments[0] as t.Expression, ctx) : '0'
        const end = call.arguments[1] ? methodExprToC(call.arguments[1] as t.Expression, ctx) : undefined
        lines.push(`${indent}{`)
        lines.push(`${indent}    const char *_src = ${src};`)
        lines.push(`${indent}    int _start = ${start};`)
        lines.push(`${indent}    int _len = (int)strlen(_src);`)
        lines.push(`${indent}    if (_start < 0) _start = 0;`)
        lines.push(`${indent}    if (_start > _len) _start = _len;`)
        if (end !== undefined) {
          lines.push(`${indent}    int _end = ${end};`)
          lines.push(`${indent}    if (_end < _start) _end = _start;`)
          lines.push(`${indent}    if (_end > _len) _end = _len;`)
        }
        lines.push(`${indent}    char _tmp[sizeof(${lhs})];`)
        if (end !== undefined) {
          lines.push(`${indent}    snprintf(_tmp, sizeof(_tmp), "%.*s", _end - _start, _src + _start);`)
        } else {
          lines.push(`${indent}    snprintf(_tmp, sizeof(_tmp), "%s", _src + _start);`)
        }
        lines.push(`${indent}    strcpy(${lhs}, _tmp);`)
        lines.push(`${indent}}`)
        markDirtyField(lines, dirty, ctx, field!, indent)
      } else if (
        fi &&
        fi.cSize > 1 &&
        (t.isBinaryExpression(expr.right, { operator: '+' }) || t.isTemplateLiteral(expr.right))
      ) {
        const lhs = methodExprToC(expr.left as t.Expression, ctx)
        const { maxLen } = concatToSnprintf(
          expr.right as t.Expression,
          e => methodExprToC(e, ctx),
          e => methodFieldLookup(e, ctx.storeFields)
        )
        if (maxLen > fi.cSize) fi.cSize = maxLen
        lines.push(`${indent}{`)
        lines.push(`${indent}    char _tmp[sizeof(${lhs})];`)
        lines.push(`${indent}    _tmp[0] = '\\0';`)
        for (const part of flattenConcat(expr.right as t.Expression)) {
          emitStringAppendPart(lines, part, ctx, `${indent}    `)
        }
        lines.push(`${indent}    strcpy(${lhs}, _tmp);`)
        lines.push(`${indent}}`)
        markDirtyField(lines, dirty, ctx, field!, indent)
      } else if (fi && fi.cSize > 1 && t.isStringLiteral(expr.right)) {
        const lhs = methodExprToC(expr.left as t.Expression, ctx)
        const strVal = expr.right.value
        const needed = strVal.length + 1
        if (needed > fi.cSize) fi.cSize = needed
        lines.push(`${indent}strcpy(${lhs}, ${JSON.stringify(strVal)});`)
        markDirtyField(lines, dirty, ctx, field!, indent)
      } else if (fi && fi.cSize > 1 && methodExprType(expr.right as t.Expression, ctx) === 'const char *') {
        const lhs = methodExprToC(expr.left as t.Expression, ctx)
        const rhs = methodExprToC(expr.right as t.Expression, ctx)
        const maxLen = maxStaticStringLength(expr.right as t.Expression, ctx)
        if (maxLen !== undefined && maxLen + 1 > fi.cSize) fi.cSize = maxLen + 1
        lines.push(`${indent}snprintf(${lhs}, sizeof(${lhs}), "%s", ${rhs});`)
        markDirtyField(lines, dirty, ctx, field!, indent)
      } else if (
        fi &&
        fi.cSize > 1 &&
        t.isIdentifier(expr.right) &&
        ctx.localTypes.get(expr.right.name) === 'const char *'
      ) {
        const lhs = methodExprToC(expr.left as t.Expression, ctx)
        const rhs = methodExprToC(expr.right as t.Expression, ctx)
        lines.push(`${indent}snprintf(${lhs}, sizeof(${lhs}), "%s", ${rhs});`)
        markDirtyField(lines, dirty, ctx, field!, indent)
      } else if (fi && fi.cSize > 1 && isNativeStringReturnCall(expr.right as t.Expression)) {
        const lhs = methodExprToC(expr.left as t.Expression, ctx)
        const rhs = methodExprToC(expr.right as t.Expression, ctx)
        lines.push(`${indent}snprintf(${lhs}, sizeof(${lhs}), "%s", ${rhs});`)
        markDirtyField(lines, dirty, ctx, field!, indent)
      } else if (
        fi &&
        fi.cSize > 1 &&
        t.isCallExpression(expr.right) &&
        t.isMemberExpression(expr.right.callee) &&
        t.isThisExpression(expr.right.callee.object) &&
        t.isIdentifier(expr.right.callee.property)
      ) {
        const mName = expr.right.callee.property.name
        const info = ctx.allMethods.get(mName)
        if (info && info.returnType === 'char') {
          const lhs = methodExprToC(expr.left as t.Expression, ctx)
          const cArgs = expr.right.arguments.map(a => methodExprToC(a as t.Expression, ctx)).join(', ')
          lines.push(`${indent}${lhs}[0] = ${info.cName}(${cArgs});`)
          lines.push(`${indent}${lhs}[1] = '\\0';`)
          markDirtyField(lines, dirty, ctx, field!, indent)
        } else {
          lines.push(`${indent}${methodExprToC(expr as t.Expression, ctx)};`)
          if (field) markDirtyField(lines, dirty, ctx, field, indent)
        }
      } else {
        lines.push(`${indent}${methodExprToC(expr as t.Expression, ctx)};`)
        if (field) markDirtyField(lines, dirty, ctx, field, indent)
      }
    } else if (t.isUpdateExpression(expr)) {
      lines.push(`${indent}${methodExprToC(expr, ctx)};`)
      const field = getWrittenField(expr.argument as t.Expression, ctx.storeFields)
      if (field) markDirtyField(lines, dirty, ctx, field, indent)
    } else {
      lines.push(`${indent}${methodExprToC(expr as t.Expression, ctx)};`)
    }
  } else if (t.isIfStatement(node)) {
    const testC = methodExprToCTruthy(node.test as t.Expression, ctx)
    if (
      inBatch &&
      !node.alternate &&
      ((t.isReturnStatement(node.consequent) && !node.consequent.argument) ||
        (t.isBlockStatement(node.consequent) &&
          node.consequent.body.length === 1 &&
          t.isReturnStatement(node.consequent.body[0]) &&
          !node.consequent.body[0].argument))
    ) {
      lines.push(`${indent}if (${testC}) { batch_end(); return; }`)
    } else {
      lines.push(`${indent}if (${testC}) {`)
      if (t.isBlockStatement(node.consequent)) {
        for (const s of (node.consequent as t.BlockStatement).body) {
          const r = stmtToC(s, ctx, indent + '    ', inBatch)
          lines.push(...r.lines)
          r.dirty.forEach(d => dirty.add(d))
        }
      } else {
        const r = stmtToC(node.consequent, ctx, indent + '    ', inBatch)
        lines.push(...r.lines)
        r.dirty.forEach(d => dirty.add(d))
      }
      lines.push(`${indent}}`)
      if (node.alternate) {
        if (t.isIfStatement(node.alternate)) {
          const alt = stmtToC(node.alternate, ctx, indent, inBatch)
          lines[lines.length - 1] = `${lines[lines.length - 1]} else ${alt.lines[0].trimStart()}`
          lines.push(...alt.lines.slice(1))
          alt.dirty.forEach(d => dirty.add(d))
        } else if (t.isBlockStatement(node.alternate)) {
          lines[lines.length - 1] += ' else {'
          for (const s of node.alternate.body) {
            const r = stmtToC(s, ctx, indent + '    ', inBatch)
            lines.push(...r.lines)
            r.dirty.forEach(d => dirty.add(d))
          }
          lines.push(`${indent}}`)
        } else {
          lines[lines.length - 1] += ' else {'
          const r = stmtToC(node.alternate, ctx, indent + '    ', inBatch)
          lines.push(...r.lines)
          lines.push(`${indent}}`)
          r.dirty.forEach(d => dirty.add(d))
        }
      }
    }
  } else if (t.isForStatement(node)) {
    let initC = ''
    let loopVar = ''
    if (node.init) {
      if (t.isVariableDeclaration(node.init)) {
        const decl = node.init.declarations[0]
        const vName = (decl.id as t.Identifier).name
        loopVar = vName
        ctx.localTypes.set(vName, 'int')
        const initVal = decl.init ? methodExprToC(decl.init as t.Expression, ctx) : '0'
        initC = `int ${vName} = ${initVal}`
      } else {
        initC = methodExprToC(node.init as t.Expression, ctx)
      }
    }
    const testC = node.test ? methodExprToC(node.test as t.Expression, ctx) : ''
    const updateC = node.update ? methodExprToC(node.update as t.Expression, ctx) : ''

    let arrayAlias: { arrName: string; elemType: string; ptrName: string } | null = null
    if (
      loopVar &&
      node.test &&
      t.isBinaryExpression(node.test, { operator: '<' }) &&
      t.isIdentifier(node.test.left, { name: loopVar }) &&
      t.isMemberExpression(node.test.right) &&
      !node.test.right.computed &&
      t.isIdentifier(node.test.right.property, { name: 'length' }) &&
      t.isMemberExpression(node.test.right.object) &&
      !node.test.right.object.computed &&
      t.isThisExpression(node.test.right.object.object) &&
      t.isIdentifier(node.test.right.object.property)
    ) {
      const arrName = node.test.right.object.property.name
      const f = findFieldByName(ctx.storeFields, arrName)
      if (f?.isArray && f.subFields && f.subFields.length > 0) {
        const ptrName = `_${arrName.charAt(0)}`
        arrayAlias = { arrName, elemType: `${arrName}_elem_t`, ptrName }
        ctx.arrayAliases.set(arrName, { iterVar: loopVar, ptrName, elemType: arrayAlias.elemType })
      }
    }

    lines.push(`${indent}for (${initC}; ${testC}; ${updateC}) {`)
    if (arrayAlias) {
      lines.push(
        `${indent}    ${arrayAlias.elemType} *${arrayAlias.ptrName} = &${ctx.storeName}.${arrayAlias.arrName}[${loopVar}];`
      )
    }
    if (t.isBlockStatement(node.body)) {
      for (const s of node.body.body) {
        const r = stmtToC(s, ctx, indent + '    ', inBatch)
        lines.push(...r.lines)
        r.dirty.forEach(d => dirty.add(d))
      }
    } else {
      const r = stmtToC(node.body, ctx, indent + '    ', inBatch)
      lines.push(...r.lines)
      r.dirty.forEach(d => dirty.add(d))
    }
    lines.push(`${indent}}`)
    if (arrayAlias) {
      ctx.arrayAliases.delete(arrayAlias.arrName)
    }
  } else if (t.isForOfStatement(node)) {
    const right = node.right
    if (!t.isIdentifier(right)) {
      lines.push(`${indent}/* unsupported for...of */`)
      return { lines, dirty }
    }
    const arrName = right.name
    const arrType = ctx.localTypes.get(arrName)

    if (
      t.isArrayPattern(node.left) ||
      (t.isVariableDeclaration(node.left) && t.isArrayPattern(node.left.declarations[0].id))
    ) {
      const pattern = t.isArrayPattern(node.left) ? node.left : (node.left.declarations[0].id as t.ArrayPattern)
      const elems = pattern.elements.filter(e => t.isIdentifier(e)) as t.Identifier[]
      const iterVar = '_i'
      ctx.localTypes.set(iterVar, 'int')
      for (const e of elems) ctx.localTypes.set(e.name, 'int')

      const sizeMatch = arrType?.match(/\[(\d+)\]\[(\d+)\]/)
      const outerSize = sizeMatch ? sizeMatch[1] : '0'

      lines.push(`${indent}for (int ${iterVar} = 0; ${iterVar} < ${outerSize}; ${iterVar}++) {`)
      const assigns = elems
        .map((e, idx) => `${idx === 0 ? 'int ' : ''}${e.name} = ${arrName}[${iterVar}][${idx}]`)
        .join(', ')
      lines.push(`${indent}    ${assigns};`)
      if (t.isBlockStatement(node.body)) {
        for (const s of node.body.body) {
          const r = stmtToC(s, ctx, indent + '    ', inBatch)
          lines.push(...r.lines)
          r.dirty.forEach(d => dirty.add(d))
        }
      }
      lines.push(`${indent}}`)
    }
  } else if (t.isReturnStatement(node)) {
    if (node.argument) {
      const retExpr =
        ctx.returnType === 'char' && t.isStringLiteral(node.argument) && node.argument.value.length === 0
          ? "'\\0'"
          : methodExprToC(node.argument as t.Expression, ctx)
      if (inBatch) {
        lines.push(`${indent}batch_end(); return ${retExpr};`)
      } else {
        lines.push(`${indent}return ${retExpr};`)
      }
    } else {
      if (inBatch) {
        lines.push(`${indent}batch_end(); return;`)
      } else {
        lines.push(`${indent}return;`)
      }
    }
  } else if (t.isContinueStatement(node)) {
    lines.push(`${indent}continue;`)
  } else if (t.isBreakStatement(node)) {
    lines.push(`${indent}break;`)
  } else if (t.isVariableDeclaration(node)) {
    lines.push(...variableDeclarationToCLines(node, ctx, indent))
  } else if (t.isBlockStatement(node)) {
    lines.push(`${indent}{`)
    for (const s of node.body) {
      const r = stmtToC(s, ctx, indent + '    ', inBatch)
      lines.push(...r.lines)
      r.dirty.forEach(d => dirty.add(d))
    }
    lines.push(`${indent}}`)
  }

  return { lines, dirty }
}

function markDirtyField(lines: string[], dirty: Set<string>, ctx: MethodCtx, field: string, indent: string): void {
  dirty.add(field)
  if (ctx.suppressDirtyMarks?.has(field)) return
  const fi = findFieldByName(ctx.storeFields, field)
  if (!fi) return
  const fieldIdx = ctx.storeFields.indexOf(fi) + ctx.fieldOffset
  lines.push(`${indent}mark_dirty_field(${fieldIdx});`)
}

function emitAudioAssignment(lines: string[], expr: t.AssignmentExpression, ctx: MethodCtx, indent: string): boolean {
  if (expr.operator !== '=') return false
  if (!t.isMemberExpression(expr.left) || expr.left.computed) return false

  if (
    t.isIdentifier(expr.left.object) &&
    ctx.audioOscillatorVars.has(expr.left.object.name) &&
    t.isIdentifier(expr.left.property, { name: 'type' })
  ) {
    lines.push(
      `${indent}gea_embedded_audio_oscillator_set_type(${expr.left.object.name}, ${audioOscillatorTypeToC(expr.right as t.Expression)});`
    )
    return true
  }

  if (
    t.isIdentifier(expr.left.property, { name: 'value' }) &&
    t.isMemberExpression(expr.left.object) &&
    !expr.left.object.computed &&
    t.isIdentifier(expr.left.object.object) &&
    ctx.audioOscillatorVars.has(expr.left.object.object.name) &&
    t.isIdentifier(expr.left.object.property, { name: 'frequency' })
  ) {
    lines.push(
      `${indent}gea_embedded_audio_oscillator_set_frequency(${expr.left.object.object.name}, ${methodExprToC(expr.right as t.Expression, ctx)});`
    )
    return true
  }

  return false
}

function audioOscillatorTypeToC(expr: t.Expression): string {
  if (t.isStringLiteral(expr)) {
    if (expr.value === 'square') return 'GEA_EMBEDDED_OSCILLATOR_SQUARE'
    if (expr.value === 'sawtooth') return 'GEA_EMBEDDED_OSCILLATOR_SAWTOOTH'
    if (expr.value === 'triangle') return 'GEA_EMBEDDED_OSCILLATOR_TRIANGLE'
  }
  return 'GEA_EMBEDDED_OSCILLATOR_SINE'
}

function emitArrayPush(lines: string[], expr: t.CallExpression, ctx: MethodCtx, indent: string): string | undefined {
  const fieldName = getPushedField(expr, ctx.storeFields)
  if (!fieldName) return undefined

  const field = findFieldByName(ctx.storeFields, fieldName)
  if (!field?.isArray || !field.subFields || field.subFields.length === 0) return undefined

  const arg = expr.arguments[0]
  if (!t.isObjectExpression(arg)) return undefined

  const propValues = new Map<string, t.Expression>()
  for (const prop of arg.properties) {
    if (!t.isObjectProperty(prop)) continue
    const key = t.isIdentifier(prop.key) ? prop.key.name : t.isStringLiteral(prop.key) ? prop.key.value : ''
    if (!key || !t.isExpression(prop.value)) continue
    propValues.set(key, prop.value)
  }

  const capacity = field.arrayCapacity || 64
  lines.push(`${indent}if (${ctx.storeName}.${fieldName}_len < ${capacity}) {`)
  lines.push(`${indent}    int _idx = ${ctx.storeName}.${fieldName}_len;`)
  for (const subField of field.subFields) {
    const value = propValues.get(subField.name)
    const rhs = value ? methodExprToC(value, ctx) : subField.initLiteral || '0'
    lines.push(`${indent}    ${ctx.storeName}.${fieldName}[_idx].${subField.name} = ${rhs};`)
  }
  lines.push(`${indent}    ${ctx.storeName}.${fieldName}_len = ${ctx.storeName}.${fieldName}_len + 1;`)
  lines.push(`${indent}}`)
  return fieldName
}

function maxStaticStringLength(node: t.Expression, ctx: MethodCtx): number | undefined {
  if (t.isStringLiteral(node)) return node.value.length
  if (t.isIdentifier(node)) {
    const value = ctx.moduleConstants?.get(node.name)
    if (typeof value === 'string') return value.length
  }
  if (t.isConditionalExpression(node)) {
    const consequent = maxStaticStringLength(node.consequent, ctx)
    const alternate = maxStaticStringLength(node.alternate, ctx)
    if (consequent !== undefined && alternate !== undefined) return Math.max(consequent, alternate)
  }
  return undefined
}

function emitStringAppendPart(lines: string[], part: t.Expression, ctx: MethodCtx, indent: string): void {
  if (t.isStringLiteral(part)) {
    if (part.value.length > 0) {
      lines.push(`${indent}gea_embedded_string_append(_tmp, sizeof(_tmp), ${JSON.stringify(part.value)});`)
    }
    return
  }

  if (isSubstringCall(part)) {
    const call = part as t.CallExpression
    const callee = call.callee as t.MemberExpression
    const src = methodExprToC(callee.object as t.Expression, ctx)
    const start = call.arguments[0] ? methodExprToC(call.arguments[0] as t.Expression, ctx) : '0'
    const end = call.arguments[1] ? methodExprToC(call.arguments[1] as t.Expression, ctx) : undefined
    lines.push(`${indent}{`)
    lines.push(`${indent}    const char *_src = ${src};`)
    lines.push(`${indent}    int _start = ${start};`)
    lines.push(`${indent}    int _len = (int)strlen(_src);`)
    lines.push(`${indent}    if (_start < 0) _start = 0;`)
    lines.push(`${indent}    if (_start > _len) _start = _len;`)
    if (end !== undefined) {
      lines.push(`${indent}    int _end = ${end};`)
      lines.push(`${indent}    if (_end < _start) _end = _start;`)
      lines.push(`${indent}    if (_end > _len) _end = _len;`)
      lines.push(`${indent}    gea_embedded_string_append_n(_tmp, sizeof(_tmp), _src + _start, _end - _start);`)
    } else {
      lines.push(`${indent}    gea_embedded_string_append(_tmp, sizeof(_tmp), _src + _start);`)
    }
    lines.push(`${indent}}`)
    return
  }

  const fi = methodFieldLookup(part, ctx.storeFields)
  const cPart = methodExprToC(part, ctx)
  const localType = t.isIdentifier(part) ? ctx.localTypes.get(part.name) : undefined
  if (fi && fi.cType === 'char' && fi.cSize === 1) {
    lines.push(`${indent}gea_embedded_string_append_char(_tmp, sizeof(_tmp), ${cPart});`)
  } else if (localType === 'char') {
    lines.push(`${indent}gea_embedded_string_append_char(_tmp, sizeof(_tmp), ${cPart});`)
  } else if ((fi && fi.cSize > 1) || isNativeStringReturnCall(part) || localType === 'const char *') {
    lines.push(`${indent}gea_embedded_string_append(_tmp, sizeof(_tmp), ${cPart});`)
  } else {
    lines.push(`${indent}{`)
    lines.push(`${indent}    char _part[16];`)
    lines.push(`${indent}    snprintf(_part, sizeof(_part), "%d", ${cPart});`)
    lines.push(`${indent}    gea_embedded_string_append(_tmp, sizeof(_tmp), _part);`)
    lines.push(`${indent}}`)
  }
}
