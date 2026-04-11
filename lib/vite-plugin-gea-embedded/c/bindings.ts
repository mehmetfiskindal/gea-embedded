import type { CompilerDefinitions, ListBinding, TemplateEmission } from '../types'
import { emitRawListStyleLines, emitStaticListStyleLines } from '../template/lists'
import { PROP_MAP } from '../style'
import type { StoreRuntimeInfo } from './store-runtime'
import { collectWrittenSubFields } from '../store/method-writes'

export interface FrameFusionInfo {
  fieldName: string
  storeName: string
  perFrameStyles: { key: string; subField: string }[]
}

export const NODE_FIELD_MAP: Record<string, string> = {
  left: 'pos_offsets[3]',
  top: 'pos_offsets[0]',
  right: 'pos_offsets[1]',
  bottom: 'pos_offsets[2]',
  width: 'width',
  height: 'height',
  backgroundColor: 'bg_color',
  opacity: 'opacity',
  zIndex: 'z_index',
  transform: 'transform_rotate',
  rotate: 'transform_rotate'
}

export function emitBindingRuntime(
  cLines: string[],
  defs: CompilerDefinitions,
  template: TemplateEmission,
  runtime: StoreRuntimeInfo
): FrameFusionInfo | null {
  const { bindings, listBindings } = template
  if (bindings.length > 0) cLines.push(`static int bind_nodes[${bindings.length}];`, '')
  for (const lb of listBindings) emitListState(cLines, lb)
  if (listBindings.length > 0) emitListStateReset(cLines, listBindings)

  for (const b of bindings) cLines.push(`static void update_binding_${b.id}(void);`)
  cLines.push('static void batch_end(void);')
  if (bindings.length > 0) cLines.push('')

  for (const b of bindings) {
    if (listBindings.find(l => l.bindId === b.id)) continue
    if (b.cLines && b.cLines.length > 0) cLines.push(...b.cLines)
    cLines.push('')
  }

  const frameFusion = emitListBindingFunctions(cLines, defs, template)
  emitBindingTables(cLines, defs, bindings)
  emitBatchRuntime(cLines, bindings.length, runtime)
  return frameFusion
}

function emitListState(cLines: string[], lb: ListBinding): void {
  cLines.push(`#define ${lb.fieldName.toUpperCase()}_LIST_CAP ${lb.arrayCapacity}`)
  cLines.push(`static int ${lb.fieldName}_node_ids[${lb.arrayCapacity}];`)
  cLines.push(`static int ${lb.fieldName}_created_len = 0;`)
  cLines.push(`static int ${lb.fieldName}_prev_len = 0;`)
  cLines.push(`static int ${lb.fieldName}_parent_node = -1;`, '')
}

function emitListStateReset(cLines: string[], listBindings: ListBinding[]): void {
  cLines.push('static void gea_embedded_list_state_reset(void) {')
  for (const lb of listBindings) {
    cLines.push(`    ${lb.fieldName}_created_len = 0;`)
    cLines.push(`    ${lb.fieldName}_prev_len = 0;`)
    cLines.push(`    ${lb.fieldName}_parent_node = -1;`)
    cLines.push(`    for (int i = 0; i < ${lb.fieldName.toUpperCase()}_LIST_CAP; i++) ${lb.fieldName}_node_ids[i] = -1;`)
  }
  cLines.push('}', '')
}

function emitListBindingFunctions(
  cLines: string[],
  defs: CompilerDefinitions,
  template: TemplateEmission
): FrameFusionInfo | null {
  let frameFusion: FrameFusionInfo | null = null
  for (const lb of template.listBindings) {
    const { perFrameStyles, initOnlyStyles } = splitListDynamicStyles(defs, lb)
    if (perFrameStyles.length > 0 && defs.rafMethodName)
      frameFusion = { fieldName: lb.fieldName, storeName: lb.storeName, perFrameStyles }
    emitSingleListBinding(cLines, lb, perFrameStyles, initOnlyStyles, template)
  }
  return frameFusion
}

function splitListDynamicStyles(
  defs: CompilerDefinitions,
  lb: ListBinding
): { perFrameStyles: { key: string; subField: string }[]; initOnlyStyles: { key: string; subField: string }[] } {
  const si = defs.storeInstances.find(s => s.cStruct === lb.storeName)
  const storeDef = si ? defs.stores.get(si.className) : undefined
  if (!storeDef) return { perFrameStyles: lb.dynamicStyles, initOnlyStyles: [] }

  const writtenSubFields = new Set<string>()
  for (const method of storeDef.methods) {
    if (method.name === 'init') continue
    const writes = collectWrittenSubFields(method.bodyNode, storeDef.fields)
    for (const subField of writes.get(lb.fieldName) || []) writtenSubFields.add(subField)
  }

  const perFrameStyles: { key: string; subField: string }[] = []
  const initOnlyStyles: { key: string; subField: string }[] = []
  for (const style of lb.dynamicStyles) {
    if (writtenSubFields.has(style.subField)) perFrameStyles.push(style)
    else initOnlyStyles.push(style)
  }
  return { perFrameStyles, initOnlyStyles }
}

function emitSingleListBinding(
  cLines: string[],
  lb: ListBinding,
  perFrameStyles: { key: string; subField: string }[],
  initOnlyStyles: { key: string; subField: string }[],
  template: TemplateEmission
): void {
  cLines.push(`static void update_binding_${lb.bindId}(void) {`)
  cLines.push(`    int len = ${lb.storeName}.${lb.fieldName}_len;`, '')
  cLines.push(`    if (len > ${lb.fieldName.toUpperCase()}_LIST_CAP) len = ${lb.fieldName.toUpperCase()}_LIST_CAP;`, '')
  cLines.push(`    for (int i = ${lb.fieldName}_created_len; i < len; i++) {`)
  const createFn = lb.nodeKind === 'image' ? 'gea_embedded_ui_create_image' : 'gea_embedded_ui_create_view'
  cLines.push(`        int n = ${createFn}();`)
  cLines.push(`        ${lb.fieldName}_node_ids[i] = n;`)
  cLines.push('        if (n < 0) continue;')
  cLines.push(`        gea_embedded_ui_set_parent(n, ${lb.fieldName}_parent_node);`)
  if (lb.nodeKind === 'image' && lb.staticImageSrc !== undefined) {
    cLines.push(`        gea_embedded_ui_set_style(n, UI_PROP_IMAGE_ID, ${lb.staticImageSrc});`)
  }
  for (const ss of lb.staticCssStyles) emitRawListStyleLines(cLines, ss.key, ss.rawValue, '        ')
  for (const ss of lb.staticStyles) emitStaticListStyleLines(cLines, ss.key, ss.value, template.baseCtx, '        ')
  if (lb.dynamicStyles.some(ds => ds.key === 'backgroundColor'))
    cLines.push('        gea_embedded_ui_set_style(n, UI_PROP_HAS_BG, 1);')
  for (const ds of initOnlyStyles) {
    const cProp = PROP_MAP[ds.key]
    if (cProp)
      cLines.push(`        gea_embedded_ui_set_style(n, ${cProp}, ${lb.storeName}.${lb.fieldName}[i].${ds.subField});`)
  }
  cLines.push('    }')
  cLines.push(`    if (len > ${lb.fieldName}_created_len) ${lb.fieldName}_created_len = len;`, '')
  cLines.push(`    for (int i = 0; i < ${lb.fieldName}_created_len; i++) {`)
  cLines.push(`        if (${lb.fieldName}_node_ids[i] < 0) continue;`)
  cLines.push(`        int was_visible = i < ${lb.fieldName}_prev_len;`)
  cLines.push('        int is_visible = i < len;')
  cLines.push(
    '        if (was_visible != is_visible) gea_embedded_ui_set_style(' +
      `${lb.fieldName}_node_ids[i]` +
      ', UI_PROP_DISPLAY, is_visible ? 0 : 1);'
  )
  cLines.push('    }', '')
  emitPerFrameListUpdates(cLines, lb, perFrameStyles)
  cLines.push(`    ${lb.fieldName}_prev_len = len;`)
  cLines.push('}', '')
}

function emitPerFrameListUpdates(
  cLines: string[],
  lb: ListBinding,
  perFrameStyles: { key: string; subField: string }[]
): void {
  if (perFrameStyles.length === 0) return
  cLines.push('    for (int i = 0; i < len; i++) {')
  cLines.push(`        int node_id = ${lb.fieldName}_node_ids[i];`)
  cLines.push('        if (node_id < 0) continue;')
  cLines.push('        ui_node_t *nd = &gea_embedded_ui_nodes[node_id];')
  for (const ds of perFrameStyles) {
    const nf = NODE_FIELD_MAP[ds.key]
    if (nf) cLines.push(`        nd->${nf} = ${lb.storeName}.${lb.fieldName}[i].${ds.subField};`)
  }
  cLines.push('        nd->dirty = 1;')
  cLines.push('    }', '')
}

function emitBindingTables(cLines: string[], defs: CompilerDefinitions, bindings: TemplateEmission['bindings']): void {
  if (bindings.length === 0) return
  cLines.push('typedef void (*binding_fn_t)(void);')
  cLines.push('static binding_fn_t binding_fns[] = {')
  cLines.push('    ' + bindings.map(b => `update_binding_${b.id}`).join(', '))
  cLines.push('};')
  cLines.push(`#define BINDING_COUNT ${bindings.length}`, '')
  cLines.push('#define MAX_DEPS 32')
  cLines.push('static const int field_deps[FIELD_COUNT][MAX_DEPS] = {')
  for (const si of defs.storeInstances) {
    const prefix = defs.storeInstances.length > 1 ? `${si.cStruct.toUpperCase()}_` : ''
    for (const field of defs.stores.get(si.className)!.fields) {
      const fieldBindings = bindings.filter(b => b.fieldDeps.includes(field.name)).map(b => b.id)
      cLines.push(`    [FIELD_${prefix}${field.name.toUpperCase()}] = { ${[...fieldBindings, -1].join(', ')} },`)
    }
  }
  cLines.push('};', '')
}

function emitBatchRuntime(cLines: string[], bindingCount: number, runtime: StoreRuntimeInfo): void {
  cLines.push('static void batch_begin(void) { batch_depth++; }', '')
  cLines.push('static void batch_end(void) {')
  cLines.push('    if (--batch_depth > 0) return;')
  cLines.push('    if (!dirty_fields_any) return;')
  if (bindingCount > 0) {
    cLines.push(`#define PROCESSED_BINDING_WORD_COUNT ((BINDING_COUNT + 63) / 64)`)
    cLines.push('    uint64_t processed[PROCESSED_BINDING_WORD_COUNT] = {0};')
    cLines.push('    for (int f = 0; f < FIELD_COUNT; f++) {')
    cLines.push('        if (!is_dirty_field(f)) continue;')
    cLines.push('        for (int i = 0; i < MAX_DEPS; i++) {')
    cLines.push('            int bid = field_deps[f][i];')
    cLines.push('            if (bid < 0) break;')
    cLines.push('            uint64_t processed_bit = (1ull << (bid % 64));')
    cLines.push('            int processed_word = bid / 64;')
    cLines.push('            if (processed[processed_word] & processed_bit) continue;')
    cLines.push('            binding_fns[bid]();')
    cLines.push('            processed[processed_word] |= processed_bit;')
    cLines.push('        }')
    cLines.push('    }')
  }
  cLines.push('    clear_dirty_fields();')
  cLines.push('    gea_embedded_ui_refresh(gea_embedded_root_node, gea_embedded_viewport_w, gea_embedded_viewport_h);')
  cLines.push('}', '')
}
