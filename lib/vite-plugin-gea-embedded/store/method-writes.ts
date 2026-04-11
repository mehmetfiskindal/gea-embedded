import * as t from '@babel/types'
import type { StoreField } from '../types'
import { findFieldByName } from './fields'

export function getWrittenField(
  left: t.Expression | t.LVal | t.OptionalMemberExpression,
  storeFields: StoreField[]
): string | undefined {
  if (
    t.isMemberExpression(left) &&
    !left.computed &&
    t.isThisExpression(left.object) &&
    t.isIdentifier(left.property)
  ) {
    if (findFieldByName(storeFields, left.property.name)) return left.property.name
  }
  if (
    t.isMemberExpression(left) &&
    !left.computed &&
    t.isIdentifier(left.property, { name: 'length' }) &&
    t.isMemberExpression(left.object) &&
    !left.object.computed &&
    t.isThisExpression(left.object.object) &&
    t.isIdentifier(left.object.property)
  ) {
    const fn = left.object.property.name
    const field = findFieldByName(storeFields, fn)
    if (field?.isArray) return fn
  }
  if (t.isMemberExpression(left) && left.computed && t.isMemberExpression(left.object) && !left.object.computed) {
    if (t.isThisExpression(left.object.object) && t.isIdentifier(left.object.property)) {
      const fn = left.object.property.name
      if (findFieldByName(storeFields, fn)) return fn
    }
  }
  if (t.isMemberExpression(left) && !left.computed && t.isMemberExpression(left.object) && left.object.computed) {
    if (t.isMemberExpression(left.object.object) && !left.object.object.computed) {
      if (t.isThisExpression(left.object.object.object) && t.isIdentifier(left.object.object.property)) {
        return left.object.object.property.name
      }
    }
  }
  return undefined
}

export function getPushedField(call: t.CallExpression, storeFields: StoreField[]): string | undefined {
  if (!t.isMemberExpression(call.callee) || call.callee.computed) return undefined
  if (!t.isIdentifier(call.callee.property, { name: 'push' })) return undefined
  const target = call.callee.object
  if (!t.isMemberExpression(target) || target.computed) return undefined
  if (!t.isThisExpression(target.object) || !t.isIdentifier(target.property)) return undefined
  const field = findFieldByName(storeFields, target.property.name)
  return field?.isArray ? target.property.name : undefined
}

export function collectWrittenSubFields(body: t.BlockStatement, storeFields: StoreField[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  function walk(node: t.Node) {
    if (
      t.isAssignmentExpression(node) &&
      t.isMemberExpression(node.left) &&
      !node.left.computed &&
      t.isIdentifier(node.left.property) &&
      t.isMemberExpression(node.left.object) &&
      node.left.object.computed &&
      t.isMemberExpression(node.left.object.object) &&
      !node.left.object.object.computed &&
      t.isThisExpression(node.left.object.object.object) &&
      t.isIdentifier(node.left.object.object.property)
    ) {
      const arrName = node.left.object.object.property.name
      const subField = node.left.property.name
      const f = findFieldByName(storeFields, arrName)
      if (f?.isArray) {
        if (!result.has(arrName)) result.set(arrName, new Set())
        result.get(arrName)!.add(subField)
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
        } else if (typeof child.type === 'string') walk(child)
      }
    }
  }
  walk(body)
  return result
}
