import * as t from '@babel/types'
import type { ExprCtx } from '../types'
import { ENUM_MAPS, PROP_MAP } from '../style'
import { collectStoreDeps, jsxExprToC } from '../expressions/jsx'
import { bindStaticLoopValue, cloneExprCtx, resolveStaticExpression, resolveStaticNumber, resolveStaticString } from '../expressions/static'
import { collectDataAttributes, emitOnPress, emitTouchHandler, ensurePressId, resolveHandler, type DataAttributeMap } from './handlers'
import { emitInputElement, emitInputKeyAttribute, emitInputKeyLabelAttribute, emitInputKeyboardPanelAttribute } from './input'
import { emitMapUnrolled } from './lists'
import { emitStyleObject, emitCssClassStyles } from './styles'
import { emitTextBinding } from './text'
import { I, INHERITABLE_PROPS, type TemplateEmitContext } from './context'

const TEXT_TAGS = new Set(['Text', 'text', 'span'])
const BLOCK_TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const HEADING_FONT_SIZES: Record<string, number> = {
  h1: 32,
  h2: 26,
  h3: 22,
  h4: 18,
  h5: 16,
  h6: 14
}
const HEADING_MARGINS: Record<string, number> = {
  h1: 14,
  h2: 12,
  h3: 10,
  h4: 8,
  h5: 6,
  h6: 6
}

export function emitNode(ctx: TemplateEmitContext, node: t.JSXElement | t.JSXFragment, parentVar: string | null, level: number, exprCtx: ExprCtx): void {
  if (t.isJSXFragment(node)) {
    for (const child of node.children) ctx.emitChild(child, parentVar, level, exprCtx)
    return
  }

  const opening = node.openingElement
  if (!t.isJSXIdentifier(opening.name)) return
  const tagName = opening.name.name
  if (tagName === 'input') {
    emitInputElement(ctx, opening.attributes, parentVar, level, exprCtx)
    return
  }
  if (tagName[0] === tagName[0].toUpperCase() && ctx.funcComponents.has(tagName)) {
    emitFuncComponent(ctx, tagName, opening.attributes, node.children, parentVar, level, exprCtx)
    return
  }

  const isText = TEXT_TAGS.has(tagName)
  const isImage = tagName === 'Image' || tagName === 'image'
  const nodeType = isText ? 1 : isImage ? 2 : 0
  const createNode = isText
    ? 'gea_embedded_ui_create_text'
    : isImage
      ? 'gea_embedded_ui_create_image'
      : 'gea_embedded_ui_create_view'
  const varName = `n${ctx.nodeCounter}`
  const varId = ctx.nodeCounter++

  ctx.initLines.push(`${I(level)}int ${varName} = ${createNode}();`)
  ctx.nodeExplicitProps.set(varId, new Map())
  ctx.nodeTypeMap.set(varId, nodeType)
  const dataAttrs = collectDataAttributes(opening.attributes, exprCtx)
  if (parentVar) {
    ctx.initLines.push(`${I(level)}gea_embedded_ui_set_parent(${varName}, ${parentVar});`)
    const parentId = parseInt(parentVar.slice(1))
    if (!isNaN(parentId)) ctx.nodeParentMap.set(varId, parentId)
  }

  emitDefaultElementStyles(ctx, tagName, varName, varId, level)
  emitClassAttributes(ctx, opening.attributes, varName, level, exprCtx)
  emitElementAttributes(ctx, opening.attributes, isImage, varName, varId, level, exprCtx, dataAttrs)
  resolveInheritance(ctx, varName, varId, level)
  for (const child of node.children) ctx.emitChild(child, varName, level, exprCtx, varId)
}

export function emitChild(ctx: TemplateEmitContext, child: t.JSXElement['children'][number], parentVar: string | null, level: number, exprCtx: ExprCtx, parentNodeId?: number): void {
  if (t.isJSXElement(child) || t.isJSXFragment(child)) {
    ctx.emitNode(child, parentVar, level, exprCtx)
  } else if (t.isJSXExpressionContainer(child)) {
    emitExpressionChild(ctx, child.expression, parentVar, level, exprCtx, parentNodeId)
  } else if (t.isJSXText(child)) {
    emitTextChild(ctx, child.value.trim(), parentVar, level, parentNodeId)
  }
}

export function resolveInheritance(ctx: TemplateEmitContext, varName: string, varId: number, level: number): void {
  const myProps = ctx.nodeExplicitProps.get(varId)
  if (!myProps) return
  for (const prop of INHERITABLE_PROPS) {
    if (myProps.has(prop)) continue
    let ancestor = ctx.nodeParentMap.get(varId)
    while (ancestor !== undefined) {
      const cVal = ctx.nodeExplicitProps.get(ancestor)?.get(prop)
      if (cVal !== undefined) {
        const inheritedValue = prop === 'fontFamily'
          ? resolveInheritedFontFamily(ctx, myProps, cVal)
          : cVal
        ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${varName}, ${PROP_MAP[prop]}, ${inheritedValue});`)
        myProps.set(prop, inheritedValue)
        break
      }
      ancestor = ctx.nodeParentMap.get(ancestor)
    }
  }
}

export function createImplicitTextNode(ctx: TemplateEmitContext, parentVar: string, parentNodeId: number, level: number): [string, number] {
  const varName = `n${ctx.nodeCounter}`
  const varId = ctx.nodeCounter++
  ctx.initLines.push(`${I(level)}int ${varName} = gea_embedded_ui_create_text();`)
  ctx.initLines.push(`${I(level)}gea_embedded_ui_set_parent(${varName}, ${parentVar});`)
  ctx.nodeExplicitProps.set(varId, new Map())
  ctx.nodeTypeMap.set(varId, 1)
  ctx.nodeParentMap.set(varId, parentNodeId)
  resolveInheritance(ctx, varName, varId, level)
  return [varName, varId]
}

function emitDefaultElementStyles(ctx: TemplateEmitContext, tagName: string, nodeVar: string, nodeId: number, level: number): void {
  if (!BLOCK_TEXT_TAGS.has(tagName)) return

  emitDefaultStyle(ctx, nodeVar, nodeId, level, 'flexDirection', ENUM_MAPS.flexDirection.row)
  emitDefaultStyle(ctx, nodeVar, nodeId, level, 'flexWrap', ENUM_MAPS.flexWrap.wrap)
  emitDefaultStyle(ctx, nodeVar, nodeId, level, 'alignItems', ENUM_MAPS.alignItems['flex-start'])
  emitDefaultStyle(ctx, nodeVar, nodeId, level, 'alignSelf', ENUM_MAPS.alignSelf.stretch)
  emitDefaultStyle(ctx, nodeVar, nodeId, level, 'marginBottom', tagName === 'p' ? 10 : (HEADING_MARGINS[tagName] ?? 0))

  const fontSize = HEADING_FONT_SIZES[tagName]
  if (fontSize !== undefined) emitDefaultStyle(ctx, nodeVar, nodeId, level, 'fontSize', fontSize)
}

function emitDefaultStyle(ctx: TemplateEmitContext, nodeVar: string, nodeId: number, level: number, prop: string, value: number): void {
  const cProp = PROP_MAP[prop]
  if (!cProp) return
  const cValue = String(value)
  ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, ${cProp}, ${cValue});`)
  if (INHERITABLE_PROPS.has(prop)) ctx.nodeExplicitProps.get(nodeId)?.set(prop, cValue)
}

function resolveInheritedFontFamily(ctx: TemplateEmitContext, myProps: Map<string, string>, inheritedFontId: string): string {
  const ownFontSize = myProps.get('fontSize')
  if (ownFontSize === undefined) return inheritedFontId

  const inheritedIndex = parseInt(inheritedFontId)
  const sizePx = parseInt(ownFontSize)
  if (isNaN(inheritedIndex) || isNaN(sizePx)) return inheritedFontId

  const inheritedKey = [...ctx.fontTuples.keys()][inheritedIndex]
  const inheritedTuple = inheritedKey ? ctx.fontTuples.get(inheritedKey) : undefined
  if (!inheritedTuple) return inheritedFontId

  const tupleKey = `${inheritedTuple.family}:${sizePx}`
  if (!ctx.fontTuples.has(tupleKey)) ctx.fontTuples.set(tupleKey, { family: inheritedTuple.family, sizePx })
  return String([...ctx.fontTuples.keys()].indexOf(tupleKey))
}

function emitClassAttributes(ctx: TemplateEmitContext, attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[], nodeVar: string, level: number, exprCtx: ExprCtx): void {
  for (const attr of attrs) {
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name) || attr.name.name !== 'class' || !attr.value) continue
    const classValue = classAttributeValue(attr.value, exprCtx)
    if (classValue) {
      emitCssClassStyles(ctx, classValue, nodeVar, level, 'init')
      emitCssClassStyles(ctx, classValue, nodeVar, level, 'active')
    }
  }
}

const PRESS_ID_PROPS = new Set(['pressId', 'pressValue'])

function emitElementAttributes(ctx: TemplateEmitContext, attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[], isImage: boolean, varName: string, varId: number, level: number, exprCtx: ExprCtx, dataAttrs: DataAttributeMap): void {
  const explicitPressId = resolveExplicitPressId(attrs, exprCtx)
  for (const attr of attrs) {
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue
    const attrName = attr.name.name
    if (isAbsentForwardedProp(attr, exprCtx)) continue
    if (attrName === 'class' || PRESS_ID_PROPS.has(attrName)) continue
    if (attrName === 'inputKey') {
      emitInputKeyAttribute(ctx, attr.value, varName, level, exprCtx)
      continue
    }
    if (attrName === 'inputKeyLabel') {
      emitInputKeyLabelAttribute(ctx, attr.value, varName, exprCtx)
      continue
    }
    if (attrName === 'inputKeyboardPanel') {
      emitInputKeyboardPanelAttribute(ctx, attr.value, varName, exprCtx)
      continue
    }
    if (attrName === 'style' && attr.value && t.isJSXExpressionContainer(attr.value) && t.isExpression(attr.value.expression)) {
      const styleExpr = resolveStaticExpression(attr.value.expression, exprCtx) ?? attr.value.expression
      if (t.isObjectExpression(styleExpr)) emitStyleObject(ctx, styleExpr, varName, varId, level, exprCtx)
    } else if ((attrName === 'onPress' || attrName === 'onClick') && attr.value && t.isJSXExpressionContainer(attr.value) && t.isExpression(attr.value.expression)) {
      emitOnPress(ctx, attr.value.expression, varName, level, exprCtx, explicitPressId, dataAttrs)
    } else if ((attrName === 'onTouchStart' || attrName === 'onTouchEnd') && attr.value && t.isJSXExpressionContainer(attr.value) && t.isExpression(attr.value.expression)) {
      emitTouchHandler(ctx, attrName, attr.value.expression, varName, level, exprCtx, explicitPressId, dataAttrs)
    } else if (attrName === 'onTouchMove' && attr.value && t.isJSXExpressionContainer(attr.value) && t.isExpression(attr.value.expression)) {
      const pressId = ensurePressId(ctx, varName, level, explicitPressId)
      const { jsBody, methodCall } = resolveHandler(ctx, attr.value.expression, exprCtx, 'press_id', 'id', dataAttrs)
      ctx.onTouchMoveHandlers.push({ pressId, jsBody, methodCall })
    } else if (isImage) {
      emitImageAttribute(ctx, attrName, attr.value, varName, level, exprCtx)
    }
  }
}

function resolveExplicitPressId(attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[], exprCtx: ExprCtx): number | undefined {
  for (const attr of attrs) {
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name) || !PRESS_ID_PROPS.has(attr.name.name) || !attr.value) continue
    if (t.isStringLiteral(attr.value)) {
      const value = Number(attr.value.value)
      if (Number.isFinite(value)) return value
    }
    if (t.isJSXExpressionContainer(attr.value) && t.isExpression(attr.value.expression)) {
      if (isAbsentForwardedExpression(attr.value.expression, exprCtx)) continue
      const value = resolveStaticNumber(attr.value.expression, exprCtx)
      if (value !== undefined) return value
      throw new Error(`${attr.name.name} must be a statically resolvable number`)
    }
  }
  return undefined
}

function emitFuncComponent(ctx: TemplateEmitContext, tagName: string, attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[], callSiteChildren: t.JSXElement['children'], parentVar: string | null, level: number, exprCtx: ExprCtx): void {
  const comp = ctx.funcComponents.get(tagName)!
  const compJsx = componentBodyToJsx(comp.body)
  if (!compJsx) return
  const childCtx: ExprCtx = { ...cloneExprCtx(exprCtx), srcCode: comp.srcCode }
  collectComponentLocals(comp.body, childCtx)

  const props = componentProps(attrs)
  for (const propName of comp.params) {
    if (props.has(propName)) continue
    const localName = comp.paramRenames.get(propName) || propName
    childCtx.absentLocals?.add(localName)
    childCtx.constVals.delete(localName)
    childCtx.localExprs.delete(localName)
  }

  for (const [propName, propExpr] of props) {
    const localName = comp.paramRenames.get(propName) || propName
    childCtx.absentLocals?.delete(localName)
    bindComponentProp(childCtx, localName, propExpr, exprCtx)
  }

  const prevSlotChildren = ctx.slotChildren
  const prevSlotChildrenCtx = ctx.slotChildrenCtx
  ctx.slotChildren = callSiteChildren
  ctx.slotChildrenCtx = exprCtx
  ctx.emitNode(compJsx, parentVar, level, childCtx)
  ctx.slotChildren = prevSlotChildren
  ctx.slotChildrenCtx = prevSlotChildrenCtx
}

function isAbsentForwardedProp(attr: t.JSXAttribute, exprCtx: ExprCtx): boolean {
  if (!attr.value || !t.isJSXExpressionContainer(attr.value) || !t.isExpression(attr.value.expression)) return false
  return isAbsentForwardedExpression(attr.value.expression, exprCtx)
}

function isAbsentForwardedExpression(expr: t.Expression, exprCtx: ExprCtx): boolean {
  return t.isIdentifier(expr) && !!exprCtx.absentLocals?.has(expr.name)
}

function emitExpressionChild(ctx: TemplateEmitContext, expr: t.JSXEmptyExpression | t.Expression, parentVar: string | null, level: number, exprCtx: ExprCtx, parentNodeId?: number): void {
  if (t.isJSXEmptyExpression(expr)) return
  if (t.isIdentifier(expr) && expr.name === 'children' && ctx.slotChildren) {
    const callerCtx: ExprCtx = ctx.slotChildrenCtx ? cloneExprCtx(ctx.slotChildrenCtx) : { ...exprCtx, srcCode: undefined }
    for (const sc of ctx.slotChildren) ctx.emitChild(sc, parentVar, level, callerCtx, parentNodeId)
    return
  }
  if (t.isCallExpression(expr) && t.isMemberExpression(expr.callee) && t.isIdentifier(expr.callee.property, { name: 'map' })) {
    emitMapUnrolled(ctx, expr, parentVar, level, exprCtx)
    return
  }
  if (t.isLogicalExpression(expr) && expr.operator === '&&') return emitLogicalChild(ctx, expr, parentVar, level, exprCtx)
  if (t.isConditionalExpression(expr) && (t.isJSXElement(expr.consequent) || t.isJSXElement(expr.alternate))) {
    return emitConditionalChild(ctx, expr, parentVar, level, exprCtx)
  }
  if (parentVar && parentNodeId !== undefined) {
    const parentIsText = ctx.nodeTypeMap.get(parentNodeId) === 1
    if (parentIsText) emitTextBinding(ctx, expr as t.Expression, parentVar, parentNodeId, level, exprCtx)
    else {
      const [textVar, textId] = createImplicitTextNode(ctx, parentVar, parentNodeId, level)
      emitTextBinding(ctx, expr as t.Expression, textVar, textId, level, exprCtx)
    }
  }
}

function emitLogicalChild(ctx: TemplateEmitContext, expr: t.LogicalExpression, parentVar: string | null, level: number, exprCtx: ExprCtx): void {
  if (!t.isJSXElement(expr.right)) return
  const deps = collectStoreDeps(expr.left as t.Expression, ctx.storeVars, exprCtx.localExprs)
  if (deps.size === 0) {
    const cond = jsxExprToC(expr.left as t.Expression, exprCtx)
    ctx.initLines.push(`${I(level)}if (${cond}) {`)
    ctx.emitNode(expr.right, parentVar, level + 1, exprCtx)
    ctx.initLines.push(`${I(level)}}`)
    return
  }
  const subtreeRootVar = `n${ctx.nodeCounter}`
  ctx.emitNode(expr.right, parentVar, level, exprCtx)
  const cond = jsxExprToC(expr.left as t.Expression, exprCtx)
  ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${subtreeRootVar}, UI_PROP_DISPLAY, ${cond} ? 0 : 1);`)
  pushDisplayBinding(ctx, subtreeRootVar, deps, cond, false, level)
}

function emitConditionalChild(ctx: TemplateEmitContext, expr: t.ConditionalExpression, parentVar: string | null, level: number, exprCtx: ExprCtx): void {
  const deps = collectStoreDeps(expr.test, ctx.storeVars, exprCtx.localExprs)
  const cond = jsxExprToC(expr.test, exprCtx)
  if (deps.size === 0) {
    ctx.initLines.push(`${I(level)}if (${cond}) {`)
    if (t.isJSXElement(expr.consequent)) ctx.emitNode(expr.consequent, parentVar, level + 1, exprCtx)
    ctx.initLines.push(`${I(level)}} else {`)
    if (t.isJSXElement(expr.alternate)) ctx.emitNode(expr.alternate, parentVar, level + 1, exprCtx)
    ctx.initLines.push(`${I(level)}}`)
    return
  }
  if (t.isJSXElement(expr.consequent)) {
    const consVar = `n${ctx.nodeCounter}`
    ctx.emitNode(expr.consequent, parentVar, level, exprCtx)
    ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${consVar}, UI_PROP_DISPLAY, ${cond} ? 0 : 1);`)
    pushDisplayBinding(ctx, consVar, deps, cond, false, level)
  }
  if (t.isJSXElement(expr.alternate)) {
    const altVar = `n${ctx.nodeCounter}`
    ctx.emitNode(expr.alternate, parentVar, level, exprCtx)
    ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${altVar}, UI_PROP_DISPLAY, ${cond} ? 1 : 0);`)
    pushDisplayBinding(ctx, altVar, deps, cond, true, level)
  }
}

function emitTextChild(ctx: TemplateEmitContext, text: string, parentVar: string | null, level: number, parentNodeId?: number): void {
  if (!text || !parentVar || parentNodeId === undefined) return
  const parentIsText = ctx.nodeTypeMap.get(parentNodeId) === 1
  if (parentIsText) ctx.initLines.push(`${I(level)}gea_embedded_ui_set_text(${parentVar}, ${JSON.stringify(text)});`)
  else {
    const [textVar] = createImplicitTextNode(ctx, parentVar, parentNodeId, level)
    ctx.initLines.push(`${I(level)}gea_embedded_ui_set_text(${textVar}, ${JSON.stringify(text)});`)
  }
}

function pushDisplayBinding(ctx: TemplateEmitContext, nodeVar: string, deps: Set<string>, cond: string, invert: boolean, level: number): void {
  const bindId = ctx.nextBindingId++
  ctx.initLines.push(`${I(level)}bind_nodes[${bindId}] = ${nodeVar};`)
  ctx.bindings.push({
    id: bindId,
    nodeId: parseInt(nodeVar.slice(1)),
    targetType: 'style',
    styleProp: 'UI_PROP_DISPLAY',
    fieldDeps: [...deps],
    isSimple: true,
    cLines: [`static void update_binding_${bindId}(void) {`, `    gea_embedded_ui_set_style(bind_nodes[${bindId}], UI_PROP_DISPLAY, ${cond} ? ${invert ? 1 : 0} : ${invert ? 0 : 1});`, `}`]
  })
}

function classAttributeValue(value: t.StringLiteral | t.JSXExpressionContainer | t.JSXElement | t.JSXFragment, exprCtx: ExprCtx): string | null {
  if (t.isStringLiteral(value)) return value.value
  if (t.isJSXExpressionContainer(value) && t.isIdentifier(value.expression) && exprCtx.constVals.has(value.expression.name)) {
    const v = exprCtx.constVals.get(value.expression.name)
    return typeof v === 'string' ? v : null
  }
  if (t.isJSXExpressionContainer(value) && t.isStringLiteral(value.expression)) return value.expression.value
  return null
}

function emitImageAttribute(ctx: TemplateEmitContext, attrName: string, value: t.JSXAttribute['value'], varName: string, level: number, exprCtx: ExprCtx): void {
  if (attrName === 'src' && value && t.isJSXExpressionContainer(value) && t.isExpression(value.expression)) {
    ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${varName}, UI_PROP_IMAGE_ID, ${jsxExprToC(value.expression, exprCtx)});`)
  } else if (attrName === 'src' && t.isStringLiteral(value)) {
    ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${varName}, UI_PROP_IMAGE_ID, ${value.value});`)
  } else if (attrName === 'fit' && value) {
    const fit = t.isStringLiteral(value) ? value.value : t.isJSXExpressionContainer(value) && t.isStringLiteral(value.expression) ? value.expression.value : ''
    const fitVal = ENUM_MAPS.fit[fit]
    if (fitVal !== undefined) ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${varName}, UI_PROP_IMAGE_FIT, ${fitVal});`)
  }
}

function componentBodyToJsx(body: t.BlockStatement | t.Expression): t.JSXElement | null {
  if (t.isBlockStatement(body)) {
    for (const stmt of body.body) {
      if (t.isReturnStatement(stmt) && stmt.argument) {
        if (t.isJSXElement(stmt.argument)) return stmt.argument
        if (t.isParenthesizedExpression(stmt.argument) && t.isJSXElement(stmt.argument.expression as any)) return stmt.argument.expression as any
      }
    }
  } else if (t.isJSXElement(body)) return body
  return null
}

function componentProps(attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[]): Map<string, t.Expression> {
  const propsMap = new Map<string, t.Expression>()
  for (const attr of attrs) {
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue
    const name = attr.name.name
    if (attr.value && t.isJSXExpressionContainer(attr.value) && t.isExpression(attr.value.expression)) propsMap.set(name, attr.value.expression)
    else if (t.isStringLiteral(attr.value)) propsMap.set(name, attr.value)
  }
  return propsMap
}

function collectComponentLocals(body: t.BlockStatement | t.Expression, exprCtx: ExprCtx): void {
  if (!t.isBlockStatement(body)) return
  for (const stmt of body.body) {
    if (t.isReturnStatement(stmt)) return
    if (!t.isVariableDeclaration(stmt)) continue
    for (const decl of stmt.declarations) {
      if (!t.isIdentifier(decl.id) || !decl.init || !t.isExpression(decl.init)) continue
      bindStaticLoopValue(exprCtx, decl.id.name, decl.init)
    }
  }
}

function bindComponentProp(targetCtx: ExprCtx, localName: string, propExpr: t.Expression, sourceCtx: ExprCtx): void {
  if (t.isIdentifier(propExpr) && sourceCtx.absentLocals?.has(propExpr.name)) {
    targetCtx.absentLocals?.add(localName)
    targetCtx.constVals.delete(localName)
    targetCtx.localExprs.delete(localName)
    targetCtx.localExprSources?.delete(localName)
    return
  }
  const numeric = resolveStaticNumber(propExpr, sourceCtx)
  if (numeric !== undefined) {
    targetCtx.constVals.set(localName, numeric)
    targetCtx.localExprs.delete(localName)
    targetCtx.localExprSources?.delete(localName)
    return
  }
  const stringValue = resolveStaticString(propExpr, sourceCtx)
  if (stringValue !== undefined) {
    targetCtx.constVals.set(localName, stringValue)
    targetCtx.localExprs.delete(localName)
    targetCtx.localExprSources?.delete(localName)
    return
  }
  const resolved = resolveStaticExpression(propExpr, sourceCtx)
  targetCtx.constVals.delete(localName)
  targetCtx.localExprs.set(localName, resolved ?? propExpr)
  const source = componentPropSource(propExpr, sourceCtx)
  if (source) targetCtx.localExprSources?.set(localName, source)
  else targetCtx.localExprSources?.delete(localName)
}

function componentPropSource(expr: t.Expression, ctx: ExprCtx): string | undefined {
  if (t.isIdentifier(expr)) return ctx.localExprSources?.get(expr.name) || ctx.srcCode
  if (t.isMemberExpression(expr)) {
    const object = expr.object as t.Expression
    if (t.isIdentifier(object)) return ctx.localExprSources?.get(object.name) || ctx.srcCode
  }
  return ctx.srcCode
}
