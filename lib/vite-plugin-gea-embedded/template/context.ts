import * as t from '@babel/types'
import type {
  Binding,
  CompilerDefinitions,
  CssClassRules,
  ElementTouchEventType,
  ExprCtx,
  FontTuple,
  InputElementBinding,
  InputKeyLabelBinding,
  InputKeyNodeBinding,
  InputKeyboardPanelBinding,
  InputKeyPressBinding,
  ListBinding,
  OnPressEntry,
  StoreField,
  StoreInstance,
  TemplateEmission
} from '../types'

export interface TemplateEmitContext extends CompilerDefinitions {
  code: string
  cssClassRules: CssClassRules
  fontFaces: Map<string, string>
  fontTuples: Map<string, FontTuple>
  initLines: string[]
  bindings: Binding[]
  onPressHandlers: OnPressEntry[]
  onTouchStartHandlers: OnPressEntry[]
  onTouchEndHandlers: OnPressEntry[]
  onTouchMoveHandlers: OnPressEntry[]
  listBindings: ListBinding[]
  inputBindings: InputElementBinding[]
  inputKeyPressIds: Set<number>
  inputKeyPresses: InputKeyPressBinding[]
  inputKeyNodes: InputKeyNodeBinding[]
  inputKeyLabels: InputKeyLabelBinding[]
  inputKeyboardPanels: InputKeyboardPanelBinding[]
  nodePressIds: Map<string, number>
  nodeExplicitProps: Map<number, Map<string, string>>
  nodeParentMap: Map<number, number>
  nodeTypeMap: Map<number, number>
  storeVars: Set<string>
  storeMapForExpr: Map<string, string>
  storeFieldsMap: Map<string, StoreField[]>
  baseCtx: ExprCtx
  slotChildren: t.JSXElement['children'] | null
  slotChildrenCtx: ExprCtx | null
  nodeCounter: number
  nextPressId: number
  nextBindingId: number
  emitNode: (node: t.JSXElement | t.JSXFragment, parentVar: string | null, level: number, ctx: ExprCtx) => void
  emitChild: (
    child: t.JSXElement['children'][number],
    parentVar: string | null,
    level: number,
    ctx: ExprCtx,
    parentNodeId?: number
  ) => void
}

export const INHERITABLE_PROPS = new Set(['color', 'textAlign', 'fontFamily', 'fontSize'])

export function I(level: number): string {
  return '    '.repeat(level)
}

export function createTemplateEmitContext(
  code: string,
  defs: CompilerDefinitions,
  cssClassRules: CssClassRules,
  fontFaces: Map<string, string>
): TemplateEmitContext {
  const storeVars = new Set(defs.storeInstances.map(si => si.jsVar))
  const storeMapForExpr = new Map(defs.storeInstances.map(si => [si.jsVar, si.cStruct]))
  const storeFieldsMap = new Map(defs.storeInstances.map(si => [si.jsVar, defs.stores.get(si.className)!.fields]))

  const comp = defs.componentClasses.get(defs.mountTarget)!
  const templateLocals = new Map<string, t.Expression>()
  const templateLocalSources = new Map<string, string>()
  for (const stmt of comp.templateBody) {
    if (!t.isVariableDeclaration(stmt)) continue
    for (const decl of stmt.declarations) {
      if (t.isIdentifier(decl.id) && decl.init && t.isExpression(decl.init)) {
        templateLocals.set(decl.id.name, decl.init)
        templateLocalSources.set(decl.id.name, code)
      }
    }
  }

  const baseCtx: ExprCtx = {
    storeMap: storeMapForExpr,
    constVals: new Map(defs.moduleConstants),
    localExprs: templateLocals,
    localExprSources: templateLocalSources,
    accelerometerVars: defs.accelerometerVars,
    storeFieldsMap,
    srcCode: code,
    absentLocals: new Set()
  }

  return {
    ...defs,
    code,
    cssClassRules,
    fontFaces,
    fontTuples: new Map(),
    initLines: [],
    bindings: [],
    onPressHandlers: [],
    onTouchStartHandlers: [],
    onTouchEndHandlers: [],
    onTouchMoveHandlers: [],
    listBindings: [],
    inputBindings: [],
    inputKeyPressIds: new Set(),
    inputKeyPresses: [],
    inputKeyNodes: [],
    inputKeyLabels: [],
    inputKeyboardPanels: [],
    nodePressIds: new Map(),
    nodeExplicitProps: new Map(),
    nodeParentMap: new Map(),
    nodeTypeMap: new Map(),
    storeVars,
    storeMapForExpr,
    storeFieldsMap,
    baseCtx,
    slotChildren: null,
    slotChildrenCtx: null,
    nodeCounter: 0,
    nextPressId: 0,
    nextBindingId: 0,
    emitNode: () => {},
    emitChild: () => {}
  }
}

export function toTemplateEmission(ctx: TemplateEmitContext): TemplateEmission {
  return {
    initLines: ctx.initLines,
    bindings: ctx.bindings,
    onPressHandlers: ctx.onPressHandlers,
    onTouchStartHandlers: ctx.onTouchStartHandlers,
    onTouchEndHandlers: ctx.onTouchEndHandlers,
    onTouchMoveHandlers: ctx.onTouchMoveHandlers,
    listBindings: ctx.listBindings,
    inputBindings: ctx.inputBindings,
    inputKeyPressIds: [...ctx.inputKeyPressIds],
    inputKeyPresses: ctx.inputKeyPresses,
    inputKeyNodes: ctx.inputKeyNodes,
    inputKeyLabels: ctx.inputKeyLabels,
    inputKeyboardPanels: ctx.inputKeyboardPanels,
    fontTuples: ctx.fontTuples,
    baseCtx: ctx.baseCtx
  }
}

export type TemplateHandlerEvent = ElementTouchEventType
export type TemplateStoreInstance = StoreInstance
