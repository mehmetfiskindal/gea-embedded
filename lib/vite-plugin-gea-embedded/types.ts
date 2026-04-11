import type * as t from '@babel/types'

export interface GeaEmbeddedPluginOptions {
  cOutput: string
  display?: {
    flushChunkRows?: number
    flushQueueDepth?: number
  }
  mirror?: boolean
  wifi?: boolean
}

export interface EmbeddedDefaults {
  display?: {
    flushChunkRows?: number
    flushQueueDepth?: number
  }
  mirror?: boolean
  wifi?: boolean
}

export interface FontFaceEntry {
  family: string
  src: string
}

export interface FontTuple {
  family: string
  sizePx: number
}

export interface GlyphMetrics {
  codepoint: number
  atlasX: number
  atlasY: number
  width: number
  height: number
  advance: number
  bearingX: number
  bearingY: number
}

export interface BakedFont {
  id: number
  family: string
  sizePx: number
  lineHeight: number
  ascender: number
  descender: number
  glyphs: GlyphMetrics[]
  atlasWidth: number
  atlasHeight: number
  atlasData: Uint8Array
}

export interface CssClassRules {
  normal: Map<string, Record<string, string>>
  active: Map<string, Record<string, string>>
}

export interface StoreField {
  name: string
  cType: string
  cSize: number
  initLiteral: string
  isArray?: boolean
  arrayCapacity?: number
  subFields?: StoreField[]
  arrayInits?: Record<string, string>[]
}

export interface StoreClassDef {
  className: string
  fields: StoreField[]
  isBLEServer?: boolean
  methods: {
    name: string
    src: string
    isAsync: boolean
    params: t.Identifier[]
    bodyNode: t.BlockStatement
  }[]
}

export interface StoreInstance {
  jsVar: string
  className: string
  cStruct: string
}

export interface RafStoreCall {
  cCall: string
  arg: string
  methodName: string
  className: string
}

export interface FuncComponent {
  name: string
  params: string[]
  paramRenames: Map<string, string>
  body: t.BlockStatement | t.Expression
  srcCode: string
}

export interface Binding {
  id: number
  nodeId: number
  targetType: 'text' | 'style'
  styleProp?: string
  fieldDeps: string[]
  isSimple: boolean
  cLines?: string[]
  jsExpr?: string
}

export interface OnPressEntry {
  pressId: number
  jsBody: string
  methodCall?: { storeVar: string; cStruct: string; methodName: string; arg: string }
  hasCoords?: boolean
}

export interface InputElementBinding {
  id: number
  pressId: number
  storeVar: string
  storeName: string
  fieldName: string
  fieldSize: number
  placeholder: string
  type: 'text' | 'password'
  autoFocusExpr?: string
  focusMethodCall?: OnPressEntry['methodCall']
  inputMethodCall?: OnPressEntry['methodCall']
  blurMethodCall?: OnPressEntry['methodCall']
  keydownMethodCall?: OnPressEntry['methodCall']
}

export interface InputKeyNodeBinding {
  keyCode: number
  nodeId: number
}

export interface InputKeyPressBinding {
  pressId: number
  keyCode: number
}

export interface InputKeyLabelBinding {
  keyCode: number
  nodeId: number
}

export interface InputKeyboardPanelBinding {
  mode: number
  nodeId: number
}

export type ElementTouchEventType = 'onTouchStart' | 'onTouchEnd'

export interface ListBinding {
  bindId: number
  fieldName: string
  storeName: string
  arrayCapacity: number
  subFields: StoreField[]
  staticCssStyles: { key: string; rawValue: string }[]
  staticStyles: { key: string; value: t.Expression }[]
  dynamicStyles: { key: string; subField: string }[]
  nodeKind: 'view' | 'image'
  staticImageSrc?: string
}

export interface ComponentClassTemplate {
  templateBody: t.Statement[]
  templateJSX: t.JSXElement
}

export interface InitStoreCall {
  cCall: string
  srcText: string
}

export interface ImageRegistration {
  id: number
  jsName: string
  bytes: number[]
}

export interface CompilerDefinitions {
  stores: Map<string, StoreClassDef>
  storeInstances: StoreInstance[]
  funcComponents: Map<string, FuncComponent>
  mountTarget: string
  rafCallSrc: string
  rafStoreCalls: RafStoreCall[]
  rafStoreCall: string
  rafStoreCallArg: string
  rafMethodName: string
  rafClassName: string
  initStoreCalls: InitStoreCall[]
  moduleConstants: Map<string, number | string>
  hasGeaEmbeddedImport: boolean
  geaEmbeddedImports: Set<string>
  geaEmbeddedDefaultVars: Set<string>
  embeddedDefaults: EmbeddedDefaults
  accelerometerVars: Set<string>
  cssImports: string[]
  componentClasses: Map<string, ComponentClassTemplate>
  byteArrayLiterals: Map<string, number[]>
  imageRegistrations: ImageRegistration[]
}

export interface ExprCtx {
  storeMap: Map<string, string>
  constVals: Map<string, number | string>
  localExprs: Map<string, t.Expression>
  localExprSources?: Map<string, string>
  accelerometerVars?: Set<string>
  storeFieldsMap?: Map<string, StoreField[]>
  srcCode?: string
  absentLocals?: Set<string>
}

export interface TemplateEmission {
  initLines: string[]
  bindings: Binding[]
  onPressHandlers: OnPressEntry[]
  onTouchStartHandlers: OnPressEntry[]
  onTouchEndHandlers: OnPressEntry[]
  onTouchMoveHandlers: OnPressEntry[]
  listBindings: ListBinding[]
  inputBindings: InputElementBinding[]
  inputKeyPressIds: number[]
  inputKeyPresses: InputKeyPressBinding[]
  inputKeyNodes: InputKeyNodeBinding[]
  inputKeyLabels: InputKeyLabelBinding[]
  inputKeyboardPanels: InputKeyboardPanelBinding[]
  fontTuples: Map<string, FontTuple>
  baseCtx: ExprCtx
}

export type StoreMethodInfo = { returnType: string; cName: string }
