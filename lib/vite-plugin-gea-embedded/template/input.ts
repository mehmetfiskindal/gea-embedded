import * as t from '@babel/types'
import type { ExprCtx, InputElementBinding, StoreField } from '../types'
import { hexToRgb565, PROP_MAP } from '../style'
import { collectStoreDeps, jsxTruthyExprToC } from '../expressions/jsx'
import { resolveStaticNumber, resolveStaticString } from '../expressions/static'
import { emitCssClassStyles, emitStyleObject } from './styles'
import { ensurePressId, resolveHandler } from './handlers'
import { I, INHERITABLE_PROPS, type TemplateEmitContext } from './context'

type NodeKind = 'view' | 'text'
const DEFAULT_INPUT_FONT_SIZE = 15

export function emitInputElement(
  ctx: TemplateEmitContext,
  attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[],
  parentVar: string | null,
  level: number,
  exprCtx: ExprCtx
): void {
  const value = resolveInputValue(ctx, attrs, exprCtx)
  const placeholder = stringAttr(attrs, 'placeholder', exprCtx) ?? ''
  const inputType = (stringAttr(attrs, 'type', exprCtx) === 'password') ? 'password' : 'text'

  const root = createNode(ctx, 'view', parentVar, level)
  emitInputDefaults(ctx, root.varName, level)
  emitInputClassAndStyle(ctx, attrs, root.varName, root.id, level, exprCtx)

  const text = createNode(ctx, 'text', root.varName, level)
  if (!inheritInputTextStyles(ctx, text.varName, text.id, level)) {
    ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${text.varName}, UI_PROP_FONT_SIZE, ${DEFAULT_INPUT_FONT_SIZE});`)
    ctx.nodeExplicitProps.get(text.id)?.set('fontSize', String(DEFAULT_INPUT_FONT_SIZE))
  }

  const caret = createNode(ctx, 'view', root.varName, level)
  emitCaretDefaults(ctx, caret.varName, level)

  const placeholderText = createNode(ctx, 'text', root.varName, level)
  if (!inheritInputTextStyles(ctx, placeholderText.varName, placeholderText.id, level)) {
    ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${placeholderText.varName}, UI_PROP_FONT_SIZE, ${DEFAULT_INPUT_FONT_SIZE});`)
    ctx.nodeExplicitProps.get(placeholderText.id)?.set('fontSize', String(DEFAULT_INPUT_FONT_SIZE))
  }

  const pressId = ensurePressId(ctx, root.varName, level)
  const inputId = ctx.inputBindings.length
  ctx.initLines.push(`${I(level)}gea_embedded_input_root_nodes[${inputId}] = ${root.varName};`)
  ctx.initLines.push(`${I(level)}gea_embedded_input_text_nodes[${inputId}] = ${text.varName};`)
  ctx.initLines.push(`${I(level)}gea_embedded_input_caret_nodes[${inputId}] = ${caret.varName};`)

  const valueBindId = ctx.nextBindingId++
  const isPassword = inputType === 'password' ? 1 : 0
  ctx.bindings.push({
    id: valueBindId,
    nodeId: text.id,
    targetType: 'text',
    fieldDeps: [...collectStoreDeps(value.expr, ctx.storeVars, exprCtx.localExprs)],
    isSimple: true,
    cLines: [
      `static void update_binding_${valueBindId}(void) {`,
      `    gea_embedded_input_apply_text(bind_nodes[${valueBindId}], ${value.storeName}.${value.field.name}, ${isPassword}, ${isPassword ? `gea_embedded_input_password_reveal_index_for_binding(${inputId})` : '-1'});`,
      `}`
    ]
  })
  ctx.initLines.push(`${I(level)}bind_nodes[${valueBindId}] = ${text.varName};`)

  const placeholderBindId = ctx.nextBindingId++
  ctx.bindings.push({
    id: placeholderBindId,
    nodeId: placeholderText.id,
    targetType: 'text',
    fieldDeps: [...collectStoreDeps(value.expr, ctx.storeVars, exprCtx.localExprs)],
    isSimple: true,
    cLines: [
      `static void update_binding_${placeholderBindId}(void) {`,
      `    gea_embedded_input_apply_placeholder(bind_nodes[${placeholderBindId}], ${value.storeName}.${value.field.name}, ${JSON.stringify(placeholder)});`,
      `}`
    ]
  })
  ctx.initLines.push(`${I(level)}bind_nodes[${placeholderBindId}] = ${placeholderText.varName};`)

  const inputBinding: InputElementBinding = {
    id: inputId,
    pressId,
    storeVar: value.storeVar,
    storeName: value.storeName,
    fieldName: value.field.name,
    fieldSize: value.field.cSize,
    placeholder,
    type: inputType,
    autoFocusExpr: booleanAttrExpression(attrs, 'autoFocus', exprCtx),
    focusMethodCall: eventMethod(ctx, attrs, ['onFocus', 'focus'], exprCtx, ''),
    inputMethodCall: eventMethod(ctx, attrs, ['onInput', 'input'], exprCtx, `${value.storeName}.${value.field.name}`, 'value'),
    blurMethodCall: eventMethod(ctx, attrs, ['onBlur', 'blur'], exprCtx, ''),
    keydownMethodCall: eventMethod(ctx, attrs, ['onKeyDown', 'keydown'], exprCtx, 'key_code', 'keyCode')
  }
  ctx.inputBindings.push(inputBinding)
}

export function emitInputKeyAttribute(
  ctx: TemplateEmitContext,
  attrValue: t.JSXAttribute['value'],
  nodeVar: string,
  level: number,
  exprCtx: ExprCtx
): boolean {
  if (!attrValue || !t.isJSXExpressionContainer(attrValue) || !t.isExpression(attrValue.expression)) return false
  const keyCode = resolveStaticNumber(attrValue.expression, exprCtx)
  if (keyCode === undefined) throw new Error('inputKey must be a statically resolvable number')
  const pressId = ensurePressId(ctx, nodeVar, level, keyCode)
  ctx.inputKeyPressIds.add(pressId)
  ctx.inputKeyPresses.push({ pressId, keyCode })
  ctx.inputKeyNodes.push({ keyCode, nodeId: nodeIdFromVar(nodeVar) })
  return true
}

export function emitInputKeyLabelAttribute(
  ctx: TemplateEmitContext,
  attrValue: t.JSXAttribute['value'],
  nodeVar: string,
  exprCtx: ExprCtx
): boolean {
  if (!attrValue || !t.isJSXExpressionContainer(attrValue) || !t.isExpression(attrValue.expression)) return false
  const keyCode = resolveStaticNumber(attrValue.expression, exprCtx)
  if (keyCode === undefined) throw new Error('inputKeyLabel must be a statically resolvable number')
  ctx.inputKeyLabels.push({ keyCode, nodeId: nodeIdFromVar(nodeVar) })
  return true
}

export function emitInputKeyboardPanelAttribute(
  ctx: TemplateEmitContext,
  attrValue: t.JSXAttribute['value'],
  nodeVar: string,
  exprCtx: ExprCtx
): boolean {
  if (!attrValue) return false
  const expr = t.isJSXExpressionContainer(attrValue) ? attrValue.expression : attrValue
  if (!t.isExpression(expr)) return false
  const rawMode = resolveStaticString(expr, exprCtx)
  const mode = rawMode === 'symbols' ? 1 : rawMode === 'more-symbols' ? 2 : rawMode === 'alpha' ? 0 : undefined
  if (mode === undefined) throw new Error('inputKeyboardPanel must be "alpha", "symbols", or "more-symbols"')
  ctx.inputKeyboardPanels.push({ mode, nodeId: nodeIdFromVar(nodeVar) })
  return true
}

function nodeIdFromVar(nodeVar: string): number {
  const nodeId = Number(nodeVar.replace(/^n/, ''))
  return Number.isFinite(nodeId) ? nodeId : -1
}

function createNode(ctx: TemplateEmitContext, kind: NodeKind, parentVar: string | null, level: number): { varName: string; id: number } {
  const id = ctx.nodeCounter++
  const varName = `n${id}`
  const create = kind === 'text' ? 'gea_embedded_ui_create_text' : 'gea_embedded_ui_create_view'
  ctx.initLines.push(`${I(level)}int ${varName} = ${create}();`)
  ctx.nodeExplicitProps.set(id, new Map())
  ctx.nodeTypeMap.set(id, kind === 'text' ? 1 : 0)
  if (parentVar) {
    ctx.initLines.push(`${I(level)}gea_embedded_ui_set_parent(${varName}, ${parentVar});`)
    const parentId = parseInt(parentVar.slice(1))
    if (!isNaN(parentId)) ctx.nodeParentMap.set(id, parentId)
  }
  return { varName, id }
}

function inheritInputTextStyles(ctx: TemplateEmitContext, varName: string, varId: number, level: number): boolean {
  const myProps = ctx.nodeExplicitProps.get(varId)
  let hasFontSize = false
  if (!myProps) return hasFontSize

  for (const prop of INHERITABLE_PROPS) {
    let ancestor = ctx.nodeParentMap.get(varId)
    while (ancestor !== undefined) {
      const cVal = ctx.nodeExplicitProps.get(ancestor)?.get(prop)
      if (cVal !== undefined) {
        ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${varName}, ${PROP_MAP[prop]}, ${cVal});`)
        myProps.set(prop, cVal)
        if (prop === 'fontSize') hasFontSize = true
        break
      }
      ancestor = ctx.nodeParentMap.get(ancestor)
    }
  }

  return hasFontSize
}

function emitInputDefaults(ctx: TemplateEmitContext, nodeVar: string, level: number): void {
  const defaults: [string, number][] = [
    ['UI_PROP_WIDTH', 360],
    ['UI_PROP_HEIGHT', 52],
    ['UI_PROP_BORDER_WIDTH', 2],
    ['UI_PROP_BORDER_COLOR', hexToRgb565('#3A3A44')],
    ['UI_PROP_BG_COLOR', hexToRgb565('#111116')],
    ['UI_PROP_HAS_BG', 1],
    ['UI_PROP_FLEX_DIRECTION', 1],
    ['UI_PROP_ALIGN_ITEMS', 2],
    ['UI_PROP_JUSTIFY_CONTENT', 0],
    ['UI_PROP_GAP', 0],
    ['UI_PROP_PADDING_LEFT', 18],
    ['UI_PROP_PADDING_RIGHT', 18]
  ]
  for (const [prop, value] of defaults) ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, ${prop}, ${value});`)
  for (const prop of ['UI_PROP_BORDER_RADIUS_TL', 'UI_PROP_BORDER_RADIUS_TR', 'UI_PROP_BORDER_RADIUS_BR', 'UI_PROP_BORDER_RADIUS_BL']) {
    ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, ${prop}, 18);`)
  }
}

function emitCaretDefaults(ctx: TemplateEmitContext, nodeVar: string, level: number): void {
  const defaults: [string, number][] = [
    ['UI_PROP_WIDTH', 0],
    ['UI_PROP_HEIGHT', 24],
    ['UI_PROP_BG_COLOR', hexToRgb565('#64D2FF')],
    ['UI_PROP_HAS_BG', 1],
    ['UI_PROP_BLINK_INTERVAL', 0]
  ]
  for (const [prop, value] of defaults) ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, ${prop}, ${value});`)
  for (const prop of ['UI_PROP_BORDER_RADIUS_TL', 'UI_PROP_BORDER_RADIUS_TR', 'UI_PROP_BORDER_RADIUS_BR', 'UI_PROP_BORDER_RADIUS_BL']) {
    ctx.initLines.push(`${I(level)}gea_embedded_ui_set_style(${nodeVar}, ${prop}, 1);`)
  }
}

function emitInputClassAndStyle(
  ctx: TemplateEmitContext,
  attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[],
  nodeVar: string,
  nodeId: number,
  level: number,
  exprCtx: ExprCtx
): void {
  const cls = stringAttr(attrs, 'class', exprCtx)
  if (cls) {
    emitCssClassStyles(ctx, cls, nodeVar, level, 'init')
    emitCssClassStyles(ctx, cls, nodeVar, level, 'active')
  }

  const styleAttr = jsxAttr(attrs, 'style')
  if (styleAttr?.value && t.isJSXExpressionContainer(styleAttr.value) && t.isObjectExpression(styleAttr.value.expression)) {
    emitStyleObject(ctx, styleAttr.value.expression, nodeVar, nodeId, level, exprCtx)
  }
}

function resolveInputValue(ctx: TemplateEmitContext, attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[], exprCtx: ExprCtx): {
  expr: t.Expression
  storeVar: string
  storeName: string
  field: StoreField
} {
  const attr = jsxAttr(attrs, 'value')
  if (!attr?.value || !t.isJSXExpressionContainer(attr.value) || !t.isExpression(attr.value.expression)) {
    throw new Error('input value must be a store string field')
  }

  let expr = attr.value.expression
  if (t.isIdentifier(expr) && exprCtx.localExprs.has(expr.name)) expr = exprCtx.localExprs.get(expr.name)!
  if (!t.isMemberExpression(expr) || expr.computed || !t.isIdentifier(expr.object) || !t.isIdentifier(expr.property)) {
    throw new Error('input value must be a simple store string field')
  }

  const storeVar = expr.object.name
  const storeName = exprCtx.storeMap.get(storeVar)
  const fieldName = (expr.property as t.Identifier).name
  const field = exprCtx.storeFieldsMap?.get(storeVar)?.find(f => f.name === fieldName)
  if (!storeName || !field || field.cType !== 'char' || field.cSize <= 1) {
    throw new Error('input value must be a store string field')
  }
  return { expr, storeVar, storeName, field }
}

function eventMethod(
  ctx: TemplateEmitContext,
  attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[],
  names: string[],
  exprCtx: ExprCtx,
  eventArgCName: string,
  eventArgJsName = 'event'
): InputElementBinding['inputMethodCall'] | undefined {
  const attr = jsxAttrByNames(attrs, names)
  if (!attr?.value || !t.isJSXExpressionContainer(attr.value) || !t.isExpression(attr.value.expression)) return undefined
  if (t.isIdentifier(attr.value.expression) && exprCtx.absentLocals?.has(attr.value.expression.name)) return undefined
  return resolveHandler(ctx, attr.value.expression, exprCtx, eventArgCName, eventArgJsName).methodCall
}

function jsxAttr(attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[], name: string): t.JSXAttribute | undefined {
  return attrs.find((attr): attr is t.JSXAttribute => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name, { name }))
}

function jsxAttrByNames(attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[], names: string[]): t.JSXAttribute | undefined {
  for (const name of names) {
    const attr = jsxAttr(attrs, name)
    if (attr) return attr
  }
  return undefined
}

function stringAttr(attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[], name: string, exprCtx: ExprCtx): string | undefined {
  const attr = jsxAttr(attrs, name)
  if (!attr?.value) return undefined
  if (t.isStringLiteral(attr.value)) return attr.value.value
  if (t.isJSXExpressionContainer(attr.value) && t.isIdentifier(attr.value.expression) && exprCtx.absentLocals?.has(attr.value.expression.name)) return undefined
  if (t.isJSXExpressionContainer(attr.value) && t.isExpression(attr.value.expression)) return resolveStaticString(attr.value.expression, exprCtx)
  return undefined
}

function booleanAttrExpression(
  attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[],
  name: string,
  exprCtx: ExprCtx
): string | undefined {
  const attr = jsxAttr(attrs, name)
  if (!attr) return undefined
  if (!attr.value) return '1'
  if (t.isStringLiteral(attr.value)) {
    const value = attr.value.value.trim().toLowerCase()
    return value === 'false' || value === '0' || value === '' ? undefined : '1'
  }
  if (!t.isJSXExpressionContainer(attr.value) || !t.isExpression(attr.value.expression)) return undefined
  const expr = attr.value.expression
  if (t.isIdentifier(expr) && exprCtx.absentLocals?.has(expr.name)) return undefined
  if (t.isBooleanLiteral(expr)) return expr.value ? '1' : undefined
  const numeric = resolveStaticNumber(expr, exprCtx)
  if (numeric !== undefined) return numeric ? '1' : undefined
  return jsxTruthyExprToC(expr, exprCtx)
}
