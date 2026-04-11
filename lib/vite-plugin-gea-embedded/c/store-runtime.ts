import * as t from '@babel/types'
import type { CompilerDefinitions, StoreField, StoreMethodInfo } from '../types'
import { compileMethod, inferReturnType } from '../store/methods'
import { getPushedField, getWrittenField } from '../store/method-writes'

export interface StoreRuntimeInfo {
  totalFields: number
  bitmaskType: string
  bitmaskOne: string
  storeFieldOffsets: Map<string, number>
  perStoreMethodInfo: Map<string, Map<string, StoreMethodInfo>>
  crossStoreMethods: Map<string, Map<string, StoreMethodInfo>>
  compiledMethodBlocks: string[][]
}

export function prepareStoreRuntime(defs: CompilerDefinitions): StoreRuntimeInfo {
  const totalFields = defs.storeInstances.reduce((sum, si) => sum + defs.stores.get(si.className)!.fields.length, 0)
  const bitmaskType = totalFields > 32 ? 'uint64_t' : 'uint32_t'
  const bitmaskOne = totalFields > 32 ? '1ull' : '1u'
  const storeFieldOffsets = computeFieldOffsets(defs)
  const perStoreMethodInfo = buildMethodInfo(defs)
  const crossStoreMethods = perStoreMethodInfo
  const compiledMethodBlocks = precompileMethods(
    defs,
    perStoreMethodInfo,
    crossStoreMethods,
    storeFieldOffsets,
    bitmaskOne
  )
  return {
    totalFields,
    bitmaskType,
    bitmaskOne,
    storeFieldOffsets,
    perStoreMethodInfo,
    crossStoreMethods,
    compiledMethodBlocks
  }
}

export function emitStoreDeclarations(cLines: string[], defs: CompilerDefinitions, runtime: StoreRuntimeInfo): void {
  emitArrayElementTypedefs(cLines, defs)
  const globalFieldEnumEntries: string[] = []
  let globalFieldIdx = 0

  cLines.push(
    'static void *gea_embedded_store_alloc(size_t size) {',
    '#if __has_include("esp_heap_caps.h")',
    '    void *ptr = heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);',
    '    if (ptr) return ptr;',
    '#endif',
    '    return malloc(size);',
    '}',
    ''
  )

  for (const si of defs.storeInstances) {
    const storeDef = defs.stores.get(si.className)!
    globalFieldIdx = runtime.storeFieldOffsets.get(si.cStruct) ?? 0
    cLines.push('typedef struct {')
    for (const f of storeDef.fields) {
      if (f.isArray && f.subFields) {
        cLines.push(`    ${f.name}_elem_t ${f.name}[${f.arrayCapacity}];`)
        cLines.push(`    int ${f.name}_len;`)
      } else if (f.cSize > 1) cLines.push(`    ${f.cType} ${f.name}[${f.cSize}];`)
      else cLines.push(`    ${f.cType} ${f.name};`)
      const prefix = defs.storeInstances.length > 1 ? `${si.cStruct.toUpperCase()}_` : ''
      globalFieldEnumEntries.push(`FIELD_${prefix}${f.name.toUpperCase()} = ${globalFieldIdx++}`)
    }
    cLines.push(`} ${si.cStruct}_t;`, '')
    emitStoreInitializer(cLines, si.cStruct, storeDef.fields)
  }

  globalFieldEnumEntries.push(`FIELD_COUNT = ${globalFieldIdx}`)
  cLines.push(`enum { ${globalFieldEnumEntries.join(', ')} };`, '')
}

export function emitRuntimeState(cLines: string[], runtime: StoreRuntimeInfo): void {
  cLines.push('static int batch_depth = 0;')
  cLines.push('#define DIRTY_FIELD_WORD_COUNT ((FIELD_COUNT + 63) / 64)')
  cLines.push('static uint64_t dirty_fields[DIRTY_FIELD_WORD_COUNT];')
  cLines.push('static int dirty_fields_any = 0;')
  cLines.push('static uint64_t mirror_dirty_fields[DIRTY_FIELD_WORD_COUNT];')
  cLines.push('static int mirror_dirty_fields_any = 0;')
  cLines.push('static uint32_t mirror_dirty_array_subfields[FIELD_COUNT];')
  cLines.push('static void mark_mirror_dirty_field(int field) {')
  cLines.push('    if (field < 0 || field >= FIELD_COUNT) return;')
  cLines.push('    mirror_dirty_fields[field / 64] |= (1ull << (field % 64));')
  cLines.push('    mirror_dirty_array_subfields[field] = 0xFFFFFFFFu;')
  cLines.push('    mirror_dirty_fields_any = 1;')
  cLines.push('}')
  cLines.push('static void mark_mirror_dirty_array_subfield(int field, int subfield) {')
  cLines.push('    if (field < 0 || field >= FIELD_COUNT) return;')
  cLines.push('    mirror_dirty_fields[field / 64] |= (1ull << (field % 64));')
  cLines.push('    if (subfield < 0 || subfield >= 32) mirror_dirty_array_subfields[field] = 0xFFFFFFFFu;')
  cLines.push('    else mirror_dirty_array_subfields[field] |= (1u << subfield);')
  cLines.push('    mirror_dirty_fields_any = 1;')
  cLines.push('}')
  cLines.push('static void mark_dirty_field(int field) {')
  cLines.push('    if (field < 0 || field >= FIELD_COUNT) return;')
  cLines.push('    dirty_fields[field / 64] |= (1ull << (field % 64));')
  cLines.push('    dirty_fields_any = 1;')
  cLines.push('    mark_mirror_dirty_field(field);')
  cLines.push('}')
  cLines.push('static int is_dirty_field(int field) {')
  cLines.push('    if (field < 0 || field >= FIELD_COUNT) return 0;')
  cLines.push('    return (dirty_fields[field / 64] & (1ull << (field % 64))) != 0;')
  cLines.push('}')
  cLines.push('static void clear_dirty_fields(void) {')
  cLines.push('    for (int i = 0; i < DIRTY_FIELD_WORD_COUNT; i++) dirty_fields[i] = 0;')
  cLines.push('    dirty_fields_any = 0;')
  cLines.push('}')
  cLines.push('static int gea_embedded_root_node = -1;')
  cLines.push('static int gea_embedded_viewport_w = 0, gea_embedded_viewport_h = 0;')
  cLines.push('')
}

function computeFieldOffsets(defs: CompilerDefinitions): Map<string, number> {
  const offsets = new Map<string, number>()
  let offset = 0
  for (const si of defs.storeInstances) {
    offsets.set(si.cStruct, offset)
    offset += defs.stores.get(si.className)!.fields.length
  }
  return offsets
}

function buildMethodInfo(defs: CompilerDefinitions): Map<string, Map<string, StoreMethodInfo>> {
  const perStoreMethodInfo = new Map<string, Map<string, StoreMethodInfo>>()
  for (const si of defs.storeInstances) {
    const storeDef = defs.stores.get(si.className)!
    const methodInfoMap = new Map<string, StoreMethodInfo>()
    for (const m of storeDef.methods)
      methodInfoMap.set(m.name, {
        returnType: inferReturnType(m.bodyNode, storeDef.fields),
        cName: `${si.cStruct}_${m.name}`
      })
    if (storeDef.isBLEServer) {
      methodInfoMap.set('startAdvertising', { returnType: 'void', cName: 'gea_embedded_ble_start_advertising' })
      methodInfoMap.set('stopAdvertising', { returnType: 'void', cName: 'gea_embedded_ble_stop_advertising' })
    }
    perStoreMethodInfo.set(si.jsVar, methodInfoMap)
  }
  return perStoreMethodInfo
}

function precompileMethods(
  defs: CompilerDefinitions,
  perStoreMethodInfo: Map<string, Map<string, StoreMethodInfo>>,
  crossStoreMethods: Map<string, Map<string, StoreMethodInfo>>,
  storeFieldOffsets: Map<string, number>,
  bitmaskOne: string
): string[][] {
  const compiledMethodBlocks: string[][] = []
  for (const si of defs.storeInstances) {
    const storeDef = defs.stores.get(si.className)!
    const methodInfoMap = perStoreMethodInfo.get(si.jsVar)!
    for (const m of storeDef.methods) {
      compiledMethodBlocks.push(
        compileMethod(
          m.name,
          m.params,
          m.bodyNode,
          methodInfoMap.get(m.name)!.returnType,
          si.cStruct,
          storeDef.fields,
          methodInfoMap,
          bitmaskOne,
          methodWritesFields(m.bodyNode, storeDef.fields),
          crossStoreMethods,
          defs.accelerometerVars,
          storeFieldOffsets.get(si.cStruct) ?? 0,
          defs.moduleConstants
        )
      )
    }
  }
  return compiledMethodBlocks
}

function methodWritesFields(body: t.BlockStatement, fields: Parameters<typeof getWrittenField>[1]): boolean {
  let writes = false
  function scan(n: t.Node) {
    if (t.isAssignmentExpression(n) && getWrittenField(n.left as t.Expression, fields)) writes = true
    if (t.isCallExpression(n) && getPushedField(n, fields)) writes = true
    for (const key of Object.keys(n)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue
      const child = (n as any)[key]
      if (!child || typeof child !== 'object') continue
      if (Array.isArray(child)) {
        for (const item of child) if (item && typeof item.type === 'string') scan(item)
      } else if (typeof (child as any).type === 'string') {
        scan(child as unknown as t.Node)
      }
    }
  }
  scan(body)
  return writes
}

function emitArrayElementTypedefs(cLines: string[], defs: CompilerDefinitions): void {
  for (const si of defs.storeInstances) {
    for (const f of defs.stores.get(si.className)!.fields) {
      if (!f.isArray || !f.subFields) continue
      cLines.push('typedef struct {')
      for (const sf of f.subFields) cLines.push(`    ${sf.cType} ${sf.name};`)
      cLines.push(`} ${f.name}_elem_t;`, '')
    }
  }
}

function emitStoreInitializer(cLines: string[], cStruct: string, fields: StoreField[]): void {
  const inits: string[] = []
  for (const f of fields as any[]) {
    if (f.isArray && f.subFields && f.arrayInits) {
      inits.push(
        `.${f.name} = { ${f.arrayInits.map((vals: Record<string, string>) => `{${f.subFields.map((sf: any) => vals[sf.name] || '0').join(', ')}}`).join(', ')} }`
      )
      inits.push(`.${f.name}_len = ${f.arrayInits.length}`)
    } else inits.push(`.${f.name} = ${f.initLiteral}`)
  }
  cLines.push(`static const ${cStruct}_t ${cStruct}_initial = {`)
  cLines.push('    ' + inits.join(',\n    '))
  cLines.push('};', '')
  cLines.push(`static ${cStruct}_t *${cStruct}_ptr = NULL;`)
  cLines.push(`#define ${cStruct} (*${cStruct}_ptr)`, '')
}

export function emitStoreStateInit(cLines: string[], defs: CompilerDefinitions): void {
  cLines.push('static void gea_embedded_store_state_init(void) {')
  for (const si of defs.storeInstances) {
    cLines.push(`    if (!${si.cStruct}_ptr) {`)
    cLines.push(`        ${si.cStruct}_ptr = (${si.cStruct}_t *)gea_embedded_store_alloc(sizeof(${si.cStruct}_t));`)
    cLines.push(`        if (!${si.cStruct}_ptr) abort();`)
    cLines.push('    }')
    cLines.push(`    memcpy(${si.cStruct}_ptr, &${si.cStruct}_initial, sizeof(${si.cStruct}_t));`)
  }
  cLines.push('}', '')
}
