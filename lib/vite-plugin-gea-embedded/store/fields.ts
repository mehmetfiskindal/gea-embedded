import * as t from '@babel/types'
import type { StoreField } from '../types'
import { hexToRgb565 } from '../style'

export function findFieldByName(fields: StoreField[], name: string): StoreField | undefined {
  return fields.find(f => f.name === name)
}

export function inferCType(init: t.Expression): StoreField | null {
  if (t.isStringLiteral(init)) {
    const v = init.value
    if (/^#[0-9a-fA-F]{3,6}$/.test(v)) {
      const rgb565 = hexToRgb565(v)
      return { name: '', cType: 'int', cSize: 0, initLiteral: `0x${rgb565.toString(16).toUpperCase().padStart(4, '0')}` }
    }
    if (v.length === 1) return { name: '', cType: 'char', cSize: 1, initLiteral: `'${v}'` }
    return { name: '', cType: 'char', cSize: v.length === 0 ? 64 : v.length + 1, initLiteral: JSON.stringify(v) }
  }
  if (t.isNumericLiteral(init)) {
    const raw = (init.extra?.raw ?? '') as string
    const isFloat = !Number.isInteger(init.value) || raw.includes('.') || raw.includes('e') || raw.includes('E')
    const cType = isFloat ? 'double' : 'int'
    return { name: '', cType, cSize: 0, initLiteral: String(init.value) }
  }
  if (t.isUnaryExpression(init, { operator: '-' }) && t.isNumericLiteral(init.argument)) {
    const raw = (init.argument.extra?.raw ?? '') as string
    const value = -init.argument.value
    const isFloat = !Number.isInteger(value) || raw.includes('.') || raw.includes('e') || raw.includes('E')
    const cType = isFloat ? 'double' : 'int'
    return { name: '', cType, cSize: 0, initLiteral: String(value) }
  }
  if (t.isBooleanLiteral(init)) return { name: '', cType: 'int8_t', cSize: 0, initLiteral: init.value ? '1' : '0' }
  if (t.isArrayExpression(init) && init.elements.length > 0 && init.elements.every(e => t.isObjectExpression(e))) {
    return inferObjectArray(init)
  }
  return null
}

function inferObjectArray(init: t.ArrayExpression): StoreField | null {
  const firstObj = init.elements[0] as t.ObjectExpression
  const subFields: StoreField[] = []
  for (const prop of firstObj.properties) {
    if (!t.isObjectProperty(prop) || !t.isIdentifier(prop.key)) continue
    const sf = inferCType(prop.value as t.Expression)
    if (sf) {
      sf.name = prop.key.name
      subFields.push(sf)
    }
  }
  if (subFields.length === 0) return null

  const arrayInits: Record<string, string>[] = []
  for (const elem of init.elements) {
    if (!t.isObjectExpression(elem)) continue
    const vals: Record<string, string> = {}
    for (const prop of elem.properties) {
      if (!t.isObjectProperty(prop) || !t.isIdentifier(prop.key)) continue
      const sf = inferCType(prop.value as t.Expression)
      if (sf) vals[prop.key.name] = sf.initLiteral
    }
    arrayInits.push(vals)
  }

  return { name: '', cType: 'struct', cSize: 0, initLiteral: '', isArray: true, arrayCapacity: 64, subFields, arrayInits }
}
