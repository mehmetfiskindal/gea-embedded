import * as t from '@babel/types'
import { dirname, resolve } from 'path'
import { existsSync, readFileSync } from 'fs'
import type { CompilerDefinitions, StoreClassDef, StoreField } from './types'
import { traverse, parseTsx } from './ast'
import { inferCType } from './store/fields'

export function collectCompilerDefinitions(code: string, id: string): CompilerDefinitions {
  const ast = parseTsx(code)
  const defs: CompilerDefinitions = {
    stores: new Map(),
    storeInstances: [],
    funcComponents: new Map(),
    mountTarget: '',
    rafCallSrc: '',
    rafStoreCalls: [],
    rafStoreCall: '',
    rafStoreCallArg: '',
    rafMethodName: '',
    rafClassName: '',
    initStoreCalls: [],
    moduleConstants: new Map(),
    hasGeaEmbeddedImport: false,
    geaEmbeddedImports: new Set(),
    geaEmbeddedDefaultVars: new Set(),
    embeddedDefaults: {},
    accelerometerVars: new Set(),
    cssImports: [],
    componentClasses: new Map(),
    byteArrayLiterals: new Map(),
    imageRegistrations: []
  }

  const localTsxImports: string[] = []
  discoverImports(ast, id, localTsxImports)

  const processedImports = new Set<string>()
  const allParsed: { code: string; ast: t.File; path: string }[] = []
  while (localTsxImports.length > 0) {
    const importPath = localTsxImports.shift()!
    if (processedImports.has(importPath)) continue
    processedImports.add(importPath)
    const importCode = readFileSync(importPath, 'utf8')
    const importAst = parseTsx(importCode)
    discoverImports(importAst, importPath, localTsxImports)
    allParsed.push({ code: importCode, ast: importAst, path: importPath })
  }

  for (const parsed of allParsed) collectByteArrayLiterals(defs, parsed.ast)
  collectByteArrayLiterals(defs, ast)

  for (const parsed of allParsed) collectFromAst(defs, parsed.code, parsed.ast, parsed.path, localTsxImports)
  collectFromAst(defs, code, ast, id, localTsxImports)
  applyArrayCapacities(defs)
  return defs
}

function collectByteArrayLiterals(defs: CompilerDefinitions, ast: t.File): void {
  traverse(ast, {
    VariableDeclaration(path: any) {
      if (path.parent.type !== 'Program' && path.parent.type !== 'ExportNamedDeclaration') return
      for (const decl of (path.node as t.VariableDeclaration).declarations) {
        if (!t.isIdentifier(decl.id) || !decl.init) continue
        if (t.isNewExpression(decl.init) && t.isIdentifier(decl.init.callee, { name: 'Uint8Array' })) {
          const bytes = extractUint8ArrayBytes(decl.init)
          if (bytes) defs.byteArrayLiterals.set(decl.id.name, bytes)
        }
      }
    }
  })
}

function discoverImports(ast: t.File, srcId: string, localTsxImports: string[]): void {
  traverse(ast, {
    ImportDeclaration(path: any) {
      const source = path.node.source.value as string
      if (source.includes('gea-embedded')) {
        for (const spec of path.node.specifiers) {
          if (t.isImportSpecifier(spec) && t.isIdentifier(spec.imported)) discoverGeaEmbeddedComponent(srcId, spec.imported.name, localTsxImports)
        }
      }
      discoverLocalTsxImport(source, srcId, localTsxImports)
    }
  })
}

function collectFromAst(defs: CompilerDefinitions, srcCode: string, srcAst: t.File, srcId: string, localTsxImports: string[]): void {
  traverse(srcAst, {
    ImportDeclaration(path: any) {
      const source = path.node.source.value as string
      if (source.includes('gea-embedded')) {
        defs.hasGeaEmbeddedImport = true
        for (const spec of path.node.specifiers) {
          if (t.isImportSpecifier(spec) && t.isIdentifier(spec.imported)) {
            defs.geaEmbeddedImports.add(spec.imported.name)
            if (spec.imported.name === 'defaults' && t.isIdentifier(spec.local)) defs.geaEmbeddedDefaultVars.add(spec.local.name)
            if ((spec.imported.name === 'Accelerometer' || spec.imported.name === 'accelerometer') && t.isIdentifier(spec.local)) defs.accelerometerVars.add(spec.local.name)
            discoverGeaEmbeddedComponent(srcId, spec.imported.name, localTsxImports)
          }
        }
      }
      if (source.endsWith('.css')) defs.cssImports.push(resolve(dirname(srcId), source))
      discoverLocalTsxImport(source, srcId, localTsxImports)
    },

    ClassDeclaration(path: any) {
      collectClass(defs, srcCode, path.node as t.ClassDeclaration)
    },

    FunctionDeclaration(path: any) {
      collectFunctionComponent(defs, srcCode, path)
    },

    VariableDeclaration(path: any) {
      if (path.parent.type !== 'Program' && path.parent.type !== 'ExportNamedDeclaration') return
      collectTopLevelVariable(defs, path.node as t.VariableDeclaration)
    },

    ExpressionStatement(path: any) {
      if (path.parent.type !== 'Program') return
      collectTopLevelExpression(defs, srcCode, path.node.expression as t.Expression)
    }
  })
}

function collectClass(defs: CompilerDefinitions, srcCode: string, node: t.ClassDeclaration): void {
  const name = node.id?.name
  if (!name || !node.superClass) return
  const superName = t.isIdentifier(node.superClass) ? node.superClass.name : ''

  if (superName === 'Store' || superName === 'BLEServer') {
    defs.stores.set(name, { className: name, fields: collectStoreFields(node), methods: collectStoreMethods(node, srcCode), isBLEServer: superName === 'BLEServer' })
  }

  if (superName === 'Component') {
    const template = collectComponentTemplate(node)
    if (template) defs.componentClasses.set(name, template)
  }
}

function collectStoreFields(node: t.ClassDeclaration): StoreField[] {
  const fields: StoreField[] = []
  for (const member of node.body.body) {
    if (t.isClassProperty(member) && t.isIdentifier(member.key) && member.value) {
      const typeInfo = inferCType(member.value)
      if (typeInfo) {
        typeInfo.name = member.key.name
        fields.push(typeInfo)
      }
    }
  }
  return fields
}

function collectStoreMethods(node: t.ClassDeclaration, srcCode: string): StoreClassDef['methods'] {
  const methods: StoreClassDef['methods'] = []
  for (const member of node.body.body) {
    if (!t.isClassMethod(member) || member.kind !== 'method' || !t.isIdentifier(member.key)) continue
    methods.push({
      name: member.key.name,
      src: srcCode.slice(member.start!, member.end!),
      isAsync: member.async,
      params: member.params
        .filter((p: any) => t.isIdentifier(p) || (t.isAssignmentPattern(p) && t.isIdentifier(p.left)))
        .map((p: any) => (t.isAssignmentPattern(p) ? p.left : p) as t.Identifier),
      bodyNode: member.body
    })
  }
  return methods
}

function collectComponentTemplate(node: t.ClassDeclaration) {
  for (const member of node.body.body) {
    if (!t.isClassMethod(member) || !t.isIdentifier(member.key, { name: 'template' })) continue
    const body = member.body.body
    for (const stmt of body) {
      if (!t.isReturnStatement(stmt) || !stmt.argument) continue
      if (t.isJSXElement(stmt.argument)) return { templateBody: body, templateJSX: stmt.argument }
      if (t.isParenthesizedExpression(stmt.argument) && t.isJSXElement(stmt.argument.expression as any)) {
        return { templateBody: body, templateJSX: stmt.argument.expression as any }
      }
    }
  }
  return null
}

function collectFunctionComponent(defs: CompilerDefinitions, srcCode: string, path: any): void {
  const name = path.node.id?.name
  if (!name) return
  let hasJSX = false
  path.traverse({
    JSXElement() {
      hasJSX = true
    },
    JSXFragment() {
      hasJSX = true
    }
  })
  if (!hasJSX) return

  const params: string[] = []
  const paramRenames = new Map<string, string>()
  for (const p of path.node.params) {
    if (t.isIdentifier(p)) params.push(p.name)
    else if (t.isObjectPattern(p)) {
      for (const prop of p.properties as any[]) {
        if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
          params.push(prop.key.name)
          if (t.isIdentifier(prop.value) && prop.value.name !== prop.key.name) paramRenames.set(prop.key.name, prop.value.name)
        }
      }
    }
  }
  defs.funcComponents.set(name, { name, params, paramRenames, body: path.node.body, srcCode })
}

function collectTopLevelVariable(defs: CompilerDefinitions, node: t.VariableDeclaration): void {
  for (const decl of node.declarations) {
    if (!t.isIdentifier(decl.id) || !decl.init) continue
    if (t.isNewExpression(decl.init) && t.isIdentifier(decl.init.callee)) {
      const className = decl.init.callee.name
      if (defs.stores.has(className)) defs.storeInstances.push({ jsVar: decl.id.name, className, cStruct: `${decl.id.name}_store` })
      if (className === 'Accelerometer') defs.accelerometerVars.add(decl.id.name)
    }
    if (node.kind === 'const') {
      const numeric = evalStaticNumeric(decl.init, defs.moduleConstants)
      if (numeric !== undefined) defs.moduleConstants.set(decl.id.name, numeric)
      else if (t.isStringLiteral(decl.init)) defs.moduleConstants.set(decl.id.name, decl.init.value)
    }
    if (node.kind === 'const' && t.isCallExpression(decl.init) && t.isIdentifier(decl.init.callee, { name: 'loadImage' })) {
      const arg = decl.init.arguments[0]
      if (arg && t.isIdentifier(arg)) {
        const bytes = defs.byteArrayLiterals.get(arg.name)
        if (bytes) {
          const id = defs.imageRegistrations.length
          defs.imageRegistrations.push({ id, jsName: decl.id.name, bytes })
          defs.moduleConstants.set(decl.id.name, id)
        }
      }
    }
  }
}

function evalStaticNumeric(node: t.Expression, consts: Map<string, number | string>): number | undefined {
  if (t.isNumericLiteral(node)) return node.value
  if (t.isUnaryExpression(node, { operator: '-' })) {
    const inner = evalStaticNumeric(node.argument as t.Expression, consts)
    if (inner !== undefined) return -inner
  }
  if (t.isUnaryExpression(node, { operator: '+' })) {
    return evalStaticNumeric(node.argument as t.Expression, consts)
  }
  if (t.isIdentifier(node)) {
    const v = consts.get(node.name)
    if (typeof v === 'number') return v
  }
  if (t.isBinaryExpression(node)) {
    const left = evalStaticNumeric(node.left as t.Expression, consts)
    const right = evalStaticNumeric(node.right as t.Expression, consts)
    if (left === undefined || right === undefined) return undefined
    if (node.operator === '+') return left + right
    if (node.operator === '-') return left - right
    if (node.operator === '*') return left * right
    if (node.operator === '/') return right === 0 ? undefined : left / right
    if (node.operator === '%') return right === 0 ? undefined : left % right
  }
  return undefined
}

function extractUint8ArrayBytes(expr: t.NewExpression): number[] | null {
  const arg = expr.arguments[0]
  if (!arg || !t.isArrayExpression(arg)) return null
  const bytes: number[] = []
  for (const el of arg.elements) {
    if (t.isNumericLiteral(el)) bytes.push(el.value & 0xff)
    else if (t.isUnaryExpression(el, { operator: '-' }) && t.isNumericLiteral(el.argument)) bytes.push((-el.argument.value) & 0xff)
    else return null
  }
  return bytes
}

function collectTopLevelExpression(defs: CompilerDefinitions, srcCode: string, expr: t.Expression): void {
  if (t.isCallExpression(expr) && t.isIdentifier(expr.callee, { name: 'mount' }) && expr.arguments.length > 0 && t.isIdentifier(expr.arguments[0])) {
    defs.mountTarget = expr.arguments[0].name
  }
  collectInitStoreCall(defs, srcCode, expr)
  collectRafCall(defs, srcCode, expr)
  collectDefaultsAssignment(defs, expr)
}

function collectInitStoreCall(defs: CompilerDefinitions, srcCode: string, expr: t.Expression): void {
  if (!t.isCallExpression(expr) || !t.isMemberExpression(expr.callee) || expr.arguments.length !== 0) return
  const callee = expr.callee
  if (!t.isIdentifier(callee.object) || !t.isIdentifier(callee.property)) return
  const calleeObject = callee.object as t.Identifier
  const calleeProperty = callee.property as t.Identifier
  const si = defs.storeInstances.find(s => s.jsVar === calleeObject.name)
  if (si) defs.initStoreCalls.push({ cCall: `${si.cStruct}_${calleeProperty.name}`, srcText: srcCode.slice(expr.start!, expr.end!) })
}

function collectRafCall(defs: CompilerDefinitions, srcCode: string, expr: t.Expression): void {
  if (!t.isCallExpression(expr) || !t.isIdentifier(expr.callee, { name: 'requestAnimationFrame' })) return
  defs.rafCallSrc = srcCode.slice(expr.start!, expr.end!)
  const cb = expr.arguments[0]
  if (!t.isFunctionExpression(cb) && !t.isArrowFunctionExpression(cb)) return
  const rafTimestampParam = cb.params.length > 0 && t.isIdentifier(cb.params[0]) ? cb.params[0].name : ''
  const body = t.isBlockStatement(cb.body) ? cb.body.body : [t.expressionStatement(cb.body)]
  for (const stmt of body) {
    if (!t.isExpressionStatement(stmt) || !t.isCallExpression(stmt.expression) || !t.isMemberExpression(stmt.expression.callee)) continue
    const callee = stmt.expression.callee
    const calleeObj = callee.object
    const calleeProp = callee.property
    if (!t.isIdentifier(calleeObj) || !t.isIdentifier(calleeProp)) continue
    const si = defs.storeInstances.find(s => s.jsVar === calleeObj.name)
    if (!si) continue
    const arg = rafTimestampParam && stmt.expression.arguments.length > 0 && t.isIdentifier(stmt.expression.arguments[0], { name: rafTimestampParam }) ? 'timestampMs' : ''
    const cCall = `${si.cStruct}_${calleeProp.name}`
    defs.rafStoreCalls.push({ cCall, arg, methodName: calleeProp.name, className: si.className })
    defs.rafStoreCall = cCall
    defs.rafStoreCallArg = arg
    defs.rafMethodName = calleeProp.name
    defs.rafClassName = si.className
  }
}

function collectDefaultsAssignment(defs: CompilerDefinitions, expr: t.Expression): void {
  if (!t.isAssignmentExpression(expr, { operator: '=' })) return
  const path = collectMemberPath(expr.left)
  if (!path || path.length < 2 || !defs.geaEmbeddedDefaultVars.has(path[0])) return

  const value = evalStaticLiteral(expr.right as t.Expression)
  if (value === undefined) return

  assignDefaultPath(defs.embeddedDefaults, path.slice(1), value)
}

function collectMemberPath(node: any): string[] | null {
  if (t.isIdentifier(node)) return [node.name]
  if (!t.isMemberExpression(node) || node.computed) return null
  const objectPath = collectMemberPath(node.object as t.Expression)
  if (!objectPath || !t.isIdentifier(node.property)) return null
  objectPath.push(node.property.name)
  return objectPath
}

function assignDefaultPath(target: any, path: string[], value: string | number | boolean | null): void {
  if (path.length === 0) return
  let cursor = target
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i]
    if (!cursor[segment] || typeof cursor[segment] !== 'object') cursor[segment] = {}
    cursor = cursor[segment]
  }
  cursor[path[path.length - 1]] = value
}

function evalStaticLiteral(node: t.Expression): string | number | boolean | null | undefined {
  if (t.isBooleanLiteral(node) || t.isNumericLiteral(node) || t.isStringLiteral(node)) return node.value
  if (t.isNullLiteral(node)) return null
  if (t.isUnaryExpression(node, { operator: '-' })) {
    const value = evalStaticLiteral(node.argument as t.Expression)
    if (typeof value === 'number') return -value
  }
  if (t.isUnaryExpression(node, { operator: '+' })) {
    const value = evalStaticLiteral(node.argument as t.Expression)
    if (typeof value === 'number') return value
  }
  return undefined
}

function discoverGeaEmbeddedComponent(srcId: string, componentName: string, localTsxImports: string[]): void {
  let dir = dirname(srcId)
  while (dir !== dirname(dir)) {
    const packageDir = resolve(dir, 'node_modules/gea-embedded')
    const componentPath = resolve(packageDir, componentName + '.tsx')
    const indexPath = resolve(packageDir, componentName, 'index.tsx')
    if (existsSync(componentPath)) {
      localTsxImports.push(componentPath)
      break
    }
    if (existsSync(indexPath)) {
      localTsxImports.push(indexPath)
      break
    }
    dir = dirname(dir)
  }
}

function discoverLocalTsxImport(source: string, srcId: string, localTsxImports: string[]): void {
  if (!source.startsWith('.') || source.endsWith('.css')) return
  for (const p of [resolve(dirname(srcId), source + '.tsx'), resolve(dirname(srcId), source + '.ts'), resolve(dirname(srcId), source, 'index.tsx'), resolve(dirname(srcId), source, 'index.ts')]) {
    if (existsSync(p) && (p.endsWith('.tsx') || p.endsWith('.ts'))) {
      localTsxImports.push(p)
      break
    }
  }
}

function applyArrayCapacities(defs: CompilerDefinitions): void {
  for (const [, storeDef] of defs.stores) {
    for (const m of storeDef.methods) {
      for (const stmt of m.bodyNode.body) {
        if (!isLengthAssignment(stmt)) continue
        const arrName = stmt.expression.left.object.property.name
        const rhs = stmt.expression.right
        const cap = t.isNumericLiteral(rhs) ? rhs.value : t.isIdentifier(rhs) ? defs.moduleConstants.get(rhs.name) : undefined
        if (cap != null && cap > 0) {
          const field = storeDef.fields.find(f => f.name === arrName && f.isArray)
          if (field) field.arrayCapacity = cap
        }
      }
    }
  }
}

function isLengthAssignment(stmt: t.Statement): stmt is t.ExpressionStatement & {
  expression: t.AssignmentExpression & { left: t.MemberExpression & { object: t.MemberExpression & { object: t.ThisExpression; property: t.Identifier }; property: t.Identifier } }
} {
  return (
    t.isExpressionStatement(stmt) &&
    t.isAssignmentExpression(stmt.expression, { operator: '=' }) &&
    t.isMemberExpression(stmt.expression.left) &&
    !stmt.expression.left.computed &&
    t.isIdentifier(stmt.expression.left.property, { name: 'length' }) &&
    t.isMemberExpression(stmt.expression.left.object) &&
    !stmt.expression.left.object.computed &&
    t.isThisExpression(stmt.expression.left.object.object) &&
    t.isIdentifier(stmt.expression.left.object.property)
  )
}
