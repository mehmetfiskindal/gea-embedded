import type { CompilerDefinitions, StoreField } from '../types'
import type { StoreRuntimeInfo } from './store-runtime'

export function emitMirrorRuntime(cLines: string[], defs: CompilerDefinitions, runtime: StoreRuntimeInfo): void {
  const fields = collectMirrorFields(defs, runtime)
  const schemaHash = mirrorSchemaHash(fields)
  emitMirrorHelpers(cLines, schemaHash)
  emitMirrorWriter(cLines, fields)
  emitMirrorSetters(cLines, defs, runtime)
}

function emitMirrorHelpers(cLines: string[], schemaHash: number): void {
  cLines.push(
    '#define MIRROR_REC_BEGIN 1',
    '#define MIRROR_REC_INT 2',
    '#define MIRROR_REC_STRING 3',
    '#define MIRROR_REC_ARRAY_LEN 4',
    '#define MIRROR_REC_ARRAY_INT 5',
    '#define MIRROR_REC_END 6',
    '#define MIRROR_REC_ERROR 7',
    '#define MIRROR_REC_SCROLL 8',
    '',
    '#define MIRROR_MSG_SNAPSHOT 1',
    '#define MIRROR_MSG_DIFF 2',
    '',
    `#define MIRROR_SCHEMA_HASH ${schemaHash}u`,
    '',
    'static int mirror_stream_active = 0;',
    'static int mirror_stream_kind = 0;',
    'static int mirror_stream_begin_sent = 0;',
    'static int mirror_stream_field_cursor = 0;',
    'static int mirror_stream_array_field = -1;',
    'static int mirror_stream_array_index = 0;',
    'static int mirror_stream_array_subfield_cursor = 0;',
    'static int mirror_stream_scroll_cursor = 0;',
    'static int mirror_stream_dirty_only = 0;',
    'static uint64_t mirror_stream_dirty_fields[DIRTY_FIELD_WORD_COUNT];',
    'static uint32_t mirror_stream_dirty_array_subfields[FIELD_COUNT];',
    'static uint64_t mirror_stream_dirty_scroll_nodes[UI_SCROLL_DIRTY_WORD_COUNT];',
    '',
    'static void mirror_write_u16(unsigned char *dst, int *off, int value) {',
    '    dst[(*off)++] = (unsigned char)(value & 0xFF);',
    '    dst[(*off)++] = (unsigned char)((value >> 8) & 0xFF);',
    '}',
    '',
    'static void mirror_write_u32(unsigned char *dst, int *off, unsigned int value) {',
    '    dst[(*off)++] = (unsigned char)(value & 0xFF);',
    '    dst[(*off)++] = (unsigned char)((value >> 8) & 0xFF);',
    '    dst[(*off)++] = (unsigned char)((value >> 16) & 0xFF);',
    '    dst[(*off)++] = (unsigned char)((value >> 24) & 0xFF);',
    '}',
    '',
    'static int mirror_record_begin(unsigned char *dst, int cap, int message_kind, const char *app_id) {',
    '    if (!dst || cap < 9) return 0;',
    '    if (!app_id) app_id = "";',
    '    int app_len = (int)strlen(app_id);',
    '    if (app_len > 255) app_len = 255;',
    '    int needed = 3 + app_len + 6;',
    '    if (cap < needed) return 0;',
    '    int off = 0;',
    '    dst[off++] = MIRROR_REC_BEGIN;',
    '    dst[off++] = (unsigned char)message_kind;',
    '    dst[off++] = (unsigned char)app_len;',
    '    if (app_len > 0) memcpy(dst + off, app_id, (size_t)app_len);',
    '    off += app_len;',
    '    mirror_write_u16(dst, &off, FIELD_COUNT);',
    '    mirror_write_u32(dst, &off, MIRROR_SCHEMA_HASH);',
    '    return off;',
    '}',
    '',
    'static int mirror_record_end(unsigned char *dst, int cap) {',
    '    if (!dst || cap < 1) return 0;',
    '    dst[0] = MIRROR_REC_END;',
    '    return 1;',
    '}',
    '',
    'static int mirror_record_error(unsigned char *dst, int cap, const char *message) {',
    '    if (!dst || cap < 2) return 0;',
    '    if (!message) message = "store mirror is unavailable for this app";',
    '    int msg_len = (int)strlen(message);',
    '    if (msg_len > 255) msg_len = 255;',
    '    if (cap < 2 + msg_len) {',
    '        msg_len = cap - 2;',
    '        if (msg_len < 0) msg_len = 0;',
    '    }',
    '    int off = 0;',
    '    dst[off++] = MIRROR_REC_ERROR;',
    '    dst[off++] = (unsigned char)msg_len;',
    '    if (msg_len > 0) memcpy(dst + off, message, (size_t)msg_len);',
    '    off += msg_len;',
    '    return off;',
    '}',
    '',
    'static int mirror_record_int(unsigned char *dst, int cap, int field, int value) {',
    '    if (!dst || cap < 7) return 0;',
    '    int off = 0;',
    '    dst[off++] = MIRROR_REC_INT;',
    '    mirror_write_u16(dst, &off, field);',
    '    mirror_write_u32(dst, &off, (unsigned int)value);',
    '    return off;',
    '}',
    '',
    'static int mirror_record_string(unsigned char *dst, int cap, int field, const char *value) {',
    '    if (!dst || cap < 5) return 0;',
    '    if (!value) value = "";',
    '    int len = (int)strlen(value);',
    '    int max_len = cap - 5;',
    '    if (max_len < 0) max_len = 0;',
    '    if (len > max_len) len = max_len;',
    '    if (len > 65535) len = 65535;',
    '    int off = 0;',
    '    dst[off++] = MIRROR_REC_STRING;',
    '    mirror_write_u16(dst, &off, field);',
    '    mirror_write_u16(dst, &off, len);',
    '    if (len > 0) memcpy(dst + off, value, (size_t)len);',
    '    off += len;',
    '    return off;',
    '}',
    '',
    'static int mirror_record_array_len(unsigned char *dst, int cap, int field, int len) {',
    '    if (!dst || cap < 5) return 0;',
    '    if (len < 0) len = 0;',
    '    if (len > 65535) len = 65535;',
    '    int off = 0;',
    '    dst[off++] = MIRROR_REC_ARRAY_LEN;',
    '    mirror_write_u16(dst, &off, field);',
    '    mirror_write_u16(dst, &off, len);',
    '    return off;',
    '}',
    '',
    'static int mirror_record_array_int(unsigned char *dst, int cap, int field, int index, int subfield, int value) {',
    '    if (!dst || cap < 10) return 0;',
    '    if (index < 0) index = 0;',
    '    if (index > 65535) index = 65535;',
    '    int off = 0;',
    '    dst[off++] = MIRROR_REC_ARRAY_INT;',
    '    mirror_write_u16(dst, &off, field);',
    '    mirror_write_u16(dst, &off, index);',
    '    dst[off++] = (unsigned char)(subfield & 0xFF);',
    '    mirror_write_u32(dst, &off, (unsigned int)value);',
    '    return off;',
    '}',
    '',
    'static int mirror_record_scroll(unsigned char *dst, int cap, int node, int scroll_y) {',
    '    if (!dst || cap < 7) return 0;',
    '    if (node < 0) node = 0;',
    '    if (node > 65535) node = 65535;',
    '    int off = 0;',
    '    dst[off++] = MIRROR_REC_SCROLL;',
    '    mirror_write_u16(dst, &off, node);',
    '    mirror_write_u32(dst, &off, (unsigned int)scroll_y);',
    '    return off;',
    '}',
    '',
    'static int is_mirror_dirty_field(int field) {',
    '    if (field < 0 || field >= FIELD_COUNT) return 0;',
    '    return (mirror_dirty_fields[field / 64] & (1ull << (field % 64))) != 0;',
    '}',
    '',
    'static void clear_mirror_dirty_fields(void) {',
    '    for (int i = 0; i < DIRTY_FIELD_WORD_COUNT; i++) mirror_dirty_fields[i] = 0;',
    '    for (int i = 0; i < FIELD_COUNT; i++) mirror_dirty_array_subfields[i] = 0;',
    '    mirror_dirty_fields_any = 0;',
    '}',
    '',
    'static int mirror_stream_field_is_selected(int field) {',
    '    if (!mirror_stream_dirty_only) return 1;',
    '    if (field < 0 || field >= FIELD_COUNT) return 0;',
    '    return (mirror_stream_dirty_fields[field / 64] & (1ull << (field % 64))) != 0;',
    '}',
    '',
    'static int mirror_stream_array_subfield_is_selected(int field, int subfield) {',
    '    if (!mirror_stream_dirty_only) return 1;',
    '    if (field < 0 || field >= FIELD_COUNT) return 0;',
    '    uint32_t mask = mirror_stream_dirty_array_subfields[field];',
    '    if (mask == 0 || mask == 0xFFFFFFFFu) return 1;',
    '    if (subfield < 0 || subfield >= 32) return 1;',
    '    return (mask & (1u << subfield)) != 0;',
    '}',
    '',
    'static int mirror_stream_scroll_node_is_selected(int node) {',
    '    if (!mirror_stream_dirty_only) return 1;',
    '    if (node < 0 || node >= UI_MAX_NODES) return 0;',
    '    return (mirror_stream_dirty_scroll_nodes[node / 64] & (1ull << (node % 64))) != 0;',
    '}',
    '',
    'static int mirror_stream_begin(int dirty_only, int kind) {',
    '    mirror_stream_active = 1;',
    '    mirror_stream_kind = kind;',
    '    mirror_stream_begin_sent = 0;',
    '    mirror_stream_field_cursor = 0;',
    '    mirror_stream_array_field = -1;',
    '    mirror_stream_array_index = 0;',
    '    mirror_stream_array_subfield_cursor = 0;',
    '    mirror_stream_scroll_cursor = 0;',
    '    mirror_stream_dirty_only = dirty_only ? 1 : 0;',
    '    if (dirty_only) {',
    '        if (!mirror_dirty_fields_any && !gea_embedded_ui_mirror_scroll_dirty_any()) {',
    '            mirror_stream_active = 0;',
    '            mirror_stream_dirty_only = 0;',
    '            return 0;',
    '        }',
    '        for (int i = 0; i < DIRTY_FIELD_WORD_COUNT; i++) mirror_stream_dirty_fields[i] = mirror_dirty_fields[i];',
    '        for (int i = 0; i < FIELD_COUNT; i++) mirror_stream_dirty_array_subfields[i] = mirror_dirty_array_subfields[i];',
    '        gea_embedded_ui_mirror_copy_scroll_dirty(mirror_stream_dirty_scroll_nodes, UI_SCROLL_DIRTY_WORD_COUNT);',
    '        clear_mirror_dirty_fields();',
    '        gea_embedded_ui_mirror_clear_scroll_dirty();',
    '    } else {',
    '        for (int i = 0; i < DIRTY_FIELD_WORD_COUNT; i++) mirror_stream_dirty_fields[i] = 0;',
    '        for (int i = 0; i < FIELD_COUNT; i++) mirror_stream_dirty_array_subfields[i] = 0;',
    '        for (int i = 0; i < UI_SCROLL_DIRTY_WORD_COUNT; i++) mirror_stream_dirty_scroll_nodes[i] = 0;',
    '        clear_mirror_dirty_fields();',
    '        gea_embedded_ui_mirror_clear_scroll_dirty();',
    '    }',
    '    return 1;',
    '}',
    ''
  )
}

type MirrorFieldMeta = {
  ordinal: number
  fieldIdx: number
  storeName: string
  field: StoreField
}

function collectMirrorFields(defs: CompilerDefinitions, runtime: StoreRuntimeInfo): MirrorFieldMeta[] {
  const fields: MirrorFieldMeta[] = []
  let ordinal = 0
  for (const si of defs.storeInstances) {
    const storeDef = defs.stores.get(si.className)!
    const offset = runtime.storeFieldOffsets.get(si.cStruct) ?? 0
    for (let i = 0; i < storeDef.fields.length; i++) {
      fields.push({
        ordinal,
        fieldIdx: offset + i,
        storeName: si.cStruct,
        field: storeDef.fields[i]
      })
      ordinal++
    }
  }
  return fields
}

function emitMirrorWriter(cLines: string[], fields: MirrorFieldMeta[]): void {
  cLines.push('extern const char *gea_embedded_apps_get_current_id(void);', '')
  cLines.push('int gea_embedded_app_mirror_get_field_count(void) {')
  cLines.push('    return FIELD_COUNT;')
  cLines.push('}', '')
  cLines.push('unsigned int gea_embedded_app_mirror_get_schema_hash(void) {')
  cLines.push('    return MIRROR_SCHEMA_HASH;')
  cLines.push('}', '')
  cLines.push('int gea_embedded_app_mirror_begin_snapshot(void) {')
  cLines.push('    return mirror_stream_begin(0, MIRROR_MSG_SNAPSHOT);')
  cLines.push('}', '')
  cLines.push('int gea_embedded_app_mirror_begin_diff(void) {')
  cLines.push('    return mirror_stream_begin(1, MIRROR_MSG_DIFF);')
  cLines.push('}', '')
  cLines.push('int gea_embedded_app_mirror_next_record(unsigned char *dst, int cap) {')
  cLines.push('    if (!mirror_stream_active || !dst || cap <= 0) return 0;')
  cLines.push('    if (!mirror_stream_begin_sent) {')
  cLines.push('        mirror_stream_begin_sent = 1;')
  cLines.push('        const char *app_id = gea_embedded_apps_get_current_id();')
  cLines.push('        return mirror_record_begin(dst, cap, mirror_stream_kind, app_id ? app_id : "");')
  cLines.push('    }')
  cLines.push('')
  cLines.push('    if (mirror_stream_array_field >= 0) {')
  cLines.push('        switch (mirror_stream_array_field) {')
  for (const meta of fields) {
    if (!meta.field.isArray || !meta.field.subFields) continue
    const numericSubfields = meta.field.subFields
      .map((subField, subIndex) => ({ subField, subIndex }))
      .filter(({ subField }) => !isStringField(subField))
    cLines.push(`            case ${meta.ordinal}:`)
    if (numericSubfields.length === 0) {
      cLines.push('                mirror_stream_array_field = -1;')
      cLines.push('                break;')
      continue
    }
    cLines.push(`                while (mirror_stream_array_index < ${meta.storeName}.${meta.field.name}_len) {`)
    cLines.push('                    switch (mirror_stream_array_subfield_cursor) {')
    for (let s = 0; s < numericSubfields.length; s++) {
      const { subField, subIndex } = numericSubfields[s]
      cLines.push(`                        case ${s}:`)
      cLines.push(`                            mirror_stream_array_subfield_cursor = ${s + 1};`)
      cLines.push(
        `                            if (!mirror_stream_array_subfield_is_selected(${meta.fieldIdx}, ${subIndex})) break;`
      )
      cLines.push(
        `                            return mirror_record_array_int(dst, cap, ${meta.fieldIdx}, mirror_stream_array_index, ${subIndex}, (int)${meta.storeName}.${meta.field.name}[mirror_stream_array_index].${subField.name});`
      )
    }
    cLines.push('                        default:')
    cLines.push('                            mirror_stream_array_subfield_cursor = 0;')
    cLines.push('                            mirror_stream_array_index++;')
    cLines.push('                            break;')
    cLines.push('                    }')
    cLines.push('                }')
    cLines.push('                mirror_stream_array_field = -1;')
    cLines.push('                break;')
  }
  cLines.push('            default:')
  cLines.push('                mirror_stream_array_field = -1;')
  cLines.push('                break;')
  cLines.push('        }')
  cLines.push('    }')
  cLines.push('')
  cLines.push('    while (mirror_stream_field_cursor < FIELD_COUNT) {')
  cLines.push('        switch (mirror_stream_field_cursor) {')
  for (const meta of fields) {
    cLines.push(`            case ${meta.ordinal}:`)
    cLines.push('                mirror_stream_field_cursor++;')
    cLines.push(`                if (!mirror_stream_field_is_selected(${meta.fieldIdx})) break;`)
    if (meta.field.isArray && meta.field.subFields) {
      cLines.push(`                mirror_stream_array_field = ${meta.ordinal};`)
      cLines.push('                mirror_stream_array_index = 0;')
      cLines.push('                mirror_stream_array_subfield_cursor = 0;')
      cLines.push(
        `                return mirror_record_array_len(dst, cap, ${meta.fieldIdx}, (int)${meta.storeName}.${meta.field.name}_len);`
      )
    } else if (isStringField(meta.field)) {
      cLines.push(
        `                return mirror_record_string(dst, cap, ${meta.fieldIdx}, ${meta.storeName}.${meta.field.name});`
      )
    } else {
      cLines.push(
        `                return mirror_record_int(dst, cap, ${meta.fieldIdx}, (int)${meta.storeName}.${meta.field.name});`
      )
    }
  }
  cLines.push('            default:')
  cLines.push('                mirror_stream_field_cursor = FIELD_COUNT;')
  cLines.push('                break;')
  cLines.push('        }')
  cLines.push('    }')
  cLines.push('')
  cLines.push('    while (mirror_stream_scroll_cursor < gea_embedded_ui_node_count) {')
  cLines.push('        int scroll_node = mirror_stream_scroll_cursor++;')
  cLines.push('        if (!gea_embedded_ui_mirror_node_is_scrollable(scroll_node)) continue;')
  cLines.push('        if (!mirror_stream_scroll_node_is_selected(scroll_node)) continue;')
  cLines.push(
    '        return mirror_record_scroll(dst, cap, scroll_node, gea_embedded_ui_mirror_get_scroll_y(scroll_node));'
  )
  cLines.push('    }')
  cLines.push('')
  cLines.push('    mirror_stream_active = 0;')
  cLines.push('    mirror_stream_dirty_only = 0;')
  cLines.push('    mirror_stream_array_field = -1;')
  cLines.push('    mirror_stream_scroll_cursor = 0;')
  cLines.push('    return mirror_record_end(dst, cap);')
  cLines.push('}', '')

  cLines.push('void gea_embedded_app_mirror_clear_dirty(void) {')
  cLines.push('    clear_mirror_dirty_fields();')
  cLines.push('    gea_embedded_ui_mirror_clear_scroll_dirty();')
  cLines.push('    mirror_stream_active = 0;')
  cLines.push('    mirror_stream_dirty_only = 0;')
  cLines.push('    mirror_stream_array_field = -1;')
  cLines.push('    mirror_stream_scroll_cursor = 0;')
  cLines.push('}', '')
}

function emitMirrorSetters(cLines: string[], defs: CompilerDefinitions, runtime: StoreRuntimeInfo): void {
  cLines.push('void gea_embedded_app_mirror_set_int(int field, int value) {')
  cLines.push('    switch (field) {')
  for (const si of defs.storeInstances) {
    const storeDef = defs.stores.get(si.className)!
    const offset = runtime.storeFieldOffsets.get(si.cStruct) ?? 0
    for (let i = 0; i < storeDef.fields.length; i++) {
      const field = storeDef.fields[i]
      if (field.isArray || isStringField(field)) continue
      const fieldIdx = offset + i
      cLines.push(
        `        case ${fieldIdx}: ${si.cStruct}.${field.name} = (${field.cType})value; mark_dirty_field(${fieldIdx}); break;`
      )
    }
  }
  cLines.push('        default: break;')
  cLines.push('    }')
  cLines.push('}', '')

  cLines.push('void gea_embedded_app_mirror_set_string(int field, const char *value) {')
  cLines.push('    if (!value) value = "";')
  cLines.push('    switch (field) {')
  for (const si of defs.storeInstances) {
    const storeDef = defs.stores.get(si.className)!
    const offset = runtime.storeFieldOffsets.get(si.cStruct) ?? 0
    for (let i = 0; i < storeDef.fields.length; i++) {
      const field = storeDef.fields[i]
      if (!isStringField(field)) continue
      const fieldIdx = offset + i
      cLines.push(
        `        case ${fieldIdx}: snprintf(${si.cStruct}.${field.name}, sizeof(${si.cStruct}.${field.name}), "%s", value); mark_dirty_field(${fieldIdx}); break;`
      )
    }
  }
  cLines.push('        default: break;')
  cLines.push('    }')
  cLines.push('}', '')

  cLines.push('void gea_embedded_app_mirror_set_array_len(int field, int len) {')
  cLines.push('    switch (field) {')
  for (const si of defs.storeInstances) {
    const storeDef = defs.stores.get(si.className)!
    const offset = runtime.storeFieldOffsets.get(si.cStruct) ?? 0
    for (let i = 0; i < storeDef.fields.length; i++) {
      const field = storeDef.fields[i]
      if (!field.isArray) continue
      const fieldIdx = offset + i
      const cap = field.arrayCapacity ?? 0
      cLines.push(
        `        case ${fieldIdx}: if (len < 0) len = 0; if (len > ${cap}) len = ${cap}; ${si.cStruct}.${field.name}_len = len; mark_dirty_field(${fieldIdx}); break;`
      )
    }
  }
  cLines.push('        default: break;')
  cLines.push('    }')
  cLines.push('}', '')

  cLines.push('void gea_embedded_app_mirror_set_array_int(int field, int index, int subfield, int value) {')
  cLines.push('    switch (field) {')
  for (const si of defs.storeInstances) {
    const storeDef = defs.stores.get(si.className)!
    const offset = runtime.storeFieldOffsets.get(si.cStruct) ?? 0
    for (let i = 0; i < storeDef.fields.length; i++) {
      const field = storeDef.fields[i]
      if (!field.isArray || !field.subFields) continue
      const fieldIdx = offset + i
      cLines.push(`        case ${fieldIdx}:`)
      cLines.push(`            if (index < 0 || index >= ${field.arrayCapacity ?? 0}) break;`)
      cLines.push('            switch (subfield) {')
      for (let s = 0; s < field.subFields.length; s++) {
        const subField = field.subFields[s]
        if (isStringField(subField)) continue
        cLines.push(
          `                case ${s}: ${si.cStruct}.${field.name}[index].${subField.name} = (${subField.cType})value; mark_dirty_field(${fieldIdx}); break;`
        )
      }
      cLines.push('                default: break;')
      cLines.push('            }')
      cLines.push('            break;')
    }
  }
  cLines.push('        default: break;')
  cLines.push('    }')
  cLines.push('}', '')

  cLines.push('void gea_embedded_app_mirror_commit(void) {')
  cLines.push('    batch_begin();')
  cLines.push('    batch_end();')
  cLines.push('    if (gea_embedded_ui_mirror_scroll_dirty_any()) {')
  cLines.push('        gea_embedded_ui_refresh(gea_embedded_root_node, gea_embedded_viewport_w, gea_embedded_viewport_h);')
  cLines.push('        gea_embedded_ui_mirror_clear_scroll_dirty();')
  cLines.push('    }')
  cLines.push('    clear_mirror_dirty_fields();')
  cLines.push('}', '')
}

function isStringField(field: StoreField): boolean {
  return field.cType === 'char' && field.cSize > 1
}

function mirrorSchemaHash(fields: MirrorFieldMeta[]): number {
  const schema = fields
    .map(meta => {
      const field = meta.field
      const subfields = field.subFields
        ?.map(sub => `${sub.name}:${sub.cType}:${sub.cSize}:${sub.isArray ? 1 : 0}:${sub.arrayCapacity ?? 0}`)
        .join(',')
      return [
        meta.fieldIdx,
        meta.storeName,
        field.name,
        field.cType,
        field.cSize,
        field.isArray ? 1 : 0,
        field.arrayCapacity ?? 0,
        subfields ?? ''
      ].join(':')
    })
    .join('|')
  let hash = 2166136261
  for (let i = 0; i < schema.length; i++) {
    hash ^= schema.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash >>> 0
}
