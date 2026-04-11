import * as t from '@babel/types'
import type { CompilerDefinitions, TemplateEmission } from '../types'
import { stmtToC } from '../store/method-statements'
import { inferReturnType, methodParamCDecl, methodParamLocalType } from '../store/methods'
import type { MethodCtx } from '../store/method-context'
import { NODE_FIELD_MAP, type FrameFusionInfo } from './bindings'
import type { StoreRuntimeInfo } from './store-runtime'
import { hexToRgb565 } from '../style'

export function emitMethodsAndEntrypoints(
  cLines: string[],
  defs: CompilerDefinitions,
  template: TemplateEmission,
  runtime: StoreRuntimeInfo,
  frameFusion: FrameFusionInfo | null
): void {
  emitMethodForwardDeclarations(cLines, defs)
  for (const block of runtime.compiledMethodBlocks) cLines.push(...block, '')
  if (settingsStore(defs)) cLines.push('static int gea_embedded_app_timestamp_ms = 0;', '')
  emitInputRuntime(cLines, defs, template, runtime)
  emitAppInit(cLines, defs, template)
  emitAppFrame(cLines, defs, template, runtime, frameFusion)
  emitTouchEntrypoints(cLines, defs, template)
  emitBleEntrypoints(cLines, defs)
  emitRawTouchStubs(cLines, defs, template)
  emitSettingsToggleEntrypoint(cLines, defs)
}

function emitMethodForwardDeclarations(cLines: string[], defs: CompilerDefinitions): void {
  for (const si of defs.storeInstances) {
    const storeDef = defs.stores.get(si.className)!
    for (const m of storeDef.methods) {
      const paramList = m.params.length > 0 ? m.params.map(methodParamCDecl).join(', ') : 'void'
      cLines.push(`static ${inferReturnType(m.bodyNode, storeDef.fields)} ${si.cStruct}_${m.name}(${paramList});`)
    }
    cLines.push('')
  }
}

function emitAppInit(cLines: string[], defs: CompilerDefinitions, template: TemplateEmission): void {
  cLines.push('void gea_embedded_app_init(int w, int h) {')
  cLines.push('    gea_embedded_viewport_w = w;')
  cLines.push('    gea_embedded_viewport_h = h;')
  cLines.push('    gea_embedded_ui_clear();', '')
  if (template.listBindings.length > 0) cLines.push('    gea_embedded_list_state_reset();', '')
  if (template.inputBindings.length > 0) cLines.push('    gea_embedded_input_state_reset();', '')
  cLines.push('    gea_embedded_store_state_init();', '')
  if (defs.imageRegistrations.length > 0) cLines.push('    gea_embedded_register_image_assets();', '')
  cLines.push(...template.initLines)
  cLines.push('', '    gea_embedded_root_node = n0;', '')

  if (defs.initStoreCalls.length > 0) {
    cLines.push('    batch_depth++;')
    for (const ic of defs.initStoreCalls) cLines.push(`    ${ic.cCall}();`)
    cLines.push('    clear_dirty_fields();', '    batch_depth = 0;', '')
  }
  emitBleInit(cLines, defs)
  if (template.bindings.length > 0) cLines.push('    for (int i = 0; i < BINDING_COUNT; i++) binding_fns[i]();', '')
  if (template.inputBindings.length > 0) cLines.push('    gea_embedded_keyboard_create();', '')
  cLines.push('    gea_embedded_ui_mount(n0, w, h);')
  cLines.push('}', '')
}

function emitInputRuntime(
  cLines: string[],
  defs: CompilerDefinitions,
  template: TemplateEmission,
  runtime: StoreRuntimeInfo
): void {
  const hasPasswordInputs = template.inputBindings.some(input => input.type === 'password')
  const hasAutoFocusInputs = template.inputBindings.some(input => input.autoFocusExpr)
  cLines.push('#define GEA_EMBEDDED_KEYBOARD_MODE_ALPHA 0')
  cLines.push('#define GEA_EMBEDDED_KEYBOARD_MODE_SYMBOLS 1')
  cLines.push('#define GEA_EMBEDDED_KEYBOARD_MODE_MORE_SYMBOLS 2')
  cLines.push('#define GEA_EMBEDDED_KEYBOARD_MODE_SYMBOLS_KEY 1001')
  cLines.push('#define GEA_EMBEDDED_KEYBOARD_MODE_ALPHA_KEY 1002')
  cLines.push('#define GEA_EMBEDDED_KEYBOARD_MODE_MORE_SYMBOLS_KEY 1003', '')
  if (template.inputBindings.length === 0) return
  cLines.push('extern int gea_embedded_ui_node_count;')
  cLines.push('static int gea_embedded_input_resized_nodes[UI_MAX_NODES];')
  cLines.push('static int gea_embedded_input_resized_heights[UI_MAX_NODES];')
  cLines.push('static int gea_embedded_input_resized_overflows[UI_MAX_NODES];')
  cLines.push('static int gea_embedded_input_resized_node_count = 0;')
  cLines.push('static int gea_embedded_input_root_resized = 0;', '')
  emitKeyboardVisualRuntime(cLines, true)

  cLines.push(`#define GEA_EMBEDDED_INPUT_COUNT ${template.inputBindings.length}`)
  cLines.push('static int gea_embedded_active_input_id = -1;')
  cLines.push('static int gea_embedded_input_touch_start_press_id = -1;')
  cLines.push('static int gea_embedded_input_skip_touch_press_id = -1;')
  cLines.push('static int gea_embedded_input_shift_active = 0;')
  cLines.push('static int gea_embedded_input_caps_lock = 0;')
  cLines.push('#define GEA_EMBEDDED_SHIFT_DOUBLE_TAP_MS 350')
  cLines.push('static int gea_embedded_input_timestamp_ms = 0;')
  cLines.push('static int gea_embedded_input_last_shift_tap_ms = -GEA_EMBEDDED_SHIFT_DOUBLE_TAP_MS;')
  cLines.push('static int gea_embedded_input_root_nodes[GEA_EMBEDDED_INPUT_COUNT];')
  cLines.push('static int gea_embedded_input_text_nodes[GEA_EMBEDDED_INPUT_COUNT];')
  cLines.push('static int gea_embedded_input_caret_nodes[GEA_EMBEDDED_INPUT_COUNT];', '')
  if (hasAutoFocusInputs) {
    cLines.push('static int gea_embedded_input_autofocus_seen[GEA_EMBEDDED_INPUT_COUNT];', '')
    cLines.push('static int gea_embedded_input_focus_id(int input_id);')
    cLines.push('static int gea_embedded_input_node_is_visible(int node_id);', '')
  }

  if (hasPasswordInputs) emitPasswordRevealRuntime(cLines, template)
  emitInputStateResetRuntime(cLines, hasAutoFocusInputs, hasPasswordInputs)
  emitInputFrameRuntime(cLines, template, hasPasswordInputs)

  cLines.push('static void gea_embedded_input_restart_caret(void) {')
  cLines.push(
    '    if (gea_embedded_active_input_id < 0 || gea_embedded_active_input_id >= GEA_EMBEDDED_INPUT_COUNT) return;'
  )
  cLines.push('    int caret = gea_embedded_input_caret_nodes[gea_embedded_active_input_id];')
  cLines.push('    gea_embedded_ui_set_style(caret, UI_PROP_WIDTH, 2);')
  cLines.push('    gea_embedded_ui_set_style(caret, UI_PROP_BLINK_INTERVAL, 500);')
  cLines.push('}', '')

  cLines.push('static void gea_embedded_input_set_focus_visual(int input_id, int focused) {')
  cLines.push('    if (input_id < 0 || input_id >= GEA_EMBEDDED_INPUT_COUNT) return;')
  cLines.push('    int root = gea_embedded_input_root_nodes[input_id];')
  cLines.push('    int caret = gea_embedded_input_caret_nodes[input_id];')
  cLines.push('    gea_embedded_ui_set_style(root, UI_PROP_BORDER_COLOR, focused ? 0x669F : 0x39C8);')
  cLines.push('    gea_embedded_ui_set_style(caret, UI_PROP_WIDTH, focused ? 2 : 0);')
  cLines.push('    gea_embedded_ui_set_style(caret, UI_PROP_BLINK_INTERVAL, focused ? 500 : 0);')
  cLines.push('}', '')

  cLines.push('static void gea_embedded_input_set_shift_state(int active, int caps_lock);', '')
  cLines.push('static int gea_embedded_input_is_keyboard_press(int press_id);', '')

  cLines.push('static void gea_embedded_input_blur_active(void) {')
  cLines.push('    if (gea_embedded_active_input_id < 0) return;')
  cLines.push('    int input_id = gea_embedded_active_input_id;')
  cLines.push('    gea_embedded_active_input_id = -1;')
  if (hasPasswordInputs) {
    cLines.push('    gea_embedded_input_clear_password_reveal(input_id);')
    cLines.push('    gea_embedded_input_apply_password_mask(input_id);')
  }
  cLines.push('    gea_embedded_input_set_shift_state(0, 0);')
  cLines.push('    gea_embedded_keyboard_sync_mode(GEA_EMBEDDED_KEYBOARD_MODE_ALPHA);')
  cLines.push('    gea_embedded_keyboard_hide();')
  cLines.push('    gea_embedded_input_set_focus_visual(input_id, 0);')
  emitInputSwitch(cLines, template, 'input_id', 'blurMethodCall', '')
  cLines.push('}', '')

  cLines.push('static int gea_embedded_input_should_blur_for_press(int press_id) {')
  cLines.push('    if (gea_embedded_active_input_id < 0) return 0;')
  cLines.push('    if (press_id < 0) return 1;')
  cLines.push('    if (gea_embedded_input_is_keyboard_press(press_id)) return 0;')
  cLines.push('    switch (press_id) {')
  for (const input of template.inputBindings) cLines.push(`        case ${input.pressId}: return 0;`)
  cLines.push('        default: return 1;')
  cLines.push('    }')
  cLines.push('}', '')

  cLines.push('static int gea_embedded_input_blur_for_touch_end(int x, int y) {')
  cLines.push('    if (gea_embedded_keyboard_contains_point(x, y)) return 0;')
  cLines.push('    int press_id = gea_embedded_ui_hit_test(x, y);')
  cLines.push('    if (gea_embedded_input_touch_start_press_id >= 0) {')
  cLines.push('        gea_embedded_input_touch_start_press_id = -1;')
  cLines.push(
    '        if (gea_embedded_input_is_keyboard_press(press_id)) gea_embedded_input_skip_touch_press_id = press_id;'
  )
  cLines.push('        return 0;')
  cLines.push('    }')
  cLines.push('    if (!gea_embedded_input_should_blur_for_press(press_id)) return 0;')
  cLines.push('    batch_begin();')
  cLines.push('    gea_embedded_input_blur_active();')
  cLines.push('    batch_end();')
  cLines.push('    gea_embedded_ui_refresh(gea_embedded_root_node, gea_embedded_viewport_w, gea_embedded_viewport_h);')
  cLines.push('    return 1;')
  cLines.push('}', '')

  cLines.push('static int gea_embedded_input_consume_skipped_touch(int press_id) {')
  cLines.push('    if (gea_embedded_input_skip_touch_press_id < 0) return 0;')
  cLines.push('    int skip_press_id = gea_embedded_input_skip_touch_press_id;')
  cLines.push('    gea_embedded_input_skip_touch_press_id = -1;')
  cLines.push('    return press_id == skip_press_id;')
  cLines.push('}', '')

  cLines.push('static void gea_embedded_input_set_shift_state(int active, int caps_lock) {')
  cLines.push('    gea_embedded_input_shift_active = active ? 1 : 0;')
  cLines.push('    gea_embedded_input_caps_lock = caps_lock ? 1 : 0;')
  cLines.push('    gea_embedded_keyboard_sync_shift(gea_embedded_input_shift_active, gea_embedded_input_caps_lock);')
  cLines.push('}', '')

  if (hasAutoFocusInputs) {
    cLines.push('static int gea_embedded_input_node_is_visible(int node_id) {')
    cLines.push('    if (node_id < 0 || node_id >= gea_embedded_ui_node_count) return 0;')
    cLines.push('    while (node_id >= 0 && node_id < gea_embedded_ui_node_count) {')
    cLines.push('        ui_node_t *node = &gea_embedded_ui_nodes[node_id];')
    cLines.push('        if (node->display == 1) return 0;')
    cLines.push('        node_id = node->parent;')
    cLines.push('    }')
    cLines.push('    return 1;')
    cLines.push('}', '')
  }

  cLines.push('static int gea_embedded_input_focus_id(int input_id) {')
  cLines.push('    if (input_id < 0 || input_id >= GEA_EMBEDDED_INPUT_COUNT) return 0;')
  cLines.push('    if (gea_embedded_active_input_id == input_id) return 1;')
  cLines.push('    batch_begin();')
  cLines.push('    gea_embedded_input_blur_active();')
  cLines.push('    gea_embedded_active_input_id = input_id;')
  cLines.push('    gea_embedded_input_set_shift_state(0, 0);')
  cLines.push('    gea_embedded_keyboard_sync_mode(GEA_EMBEDDED_KEYBOARD_MODE_ALPHA);')
  cLines.push('    gea_embedded_keyboard_show();')
  cLines.push('    gea_embedded_input_set_focus_visual(input_id, 1);')
  emitInputSwitch(cLines, template, 'input_id', 'focusMethodCall', '    ')
  cLines.push('    batch_end();')
  cLines.push('    gea_embedded_ui_refresh(gea_embedded_root_node, gea_embedded_viewport_w, gea_embedded_viewport_h);')
  cLines.push('    return 1;')
  cLines.push('}', '')

  cLines.push('static int gea_embedded_input_focus_press(int press_id) {')
  cLines.push('    switch (press_id) {')
  for (const input of template.inputBindings) {
    cLines.push(`        case ${input.pressId}: return gea_embedded_input_focus_id(${input.id});`)
  }
  cLines.push('        default: return 0;')
  cLines.push('    }')
  cLines.push('}', '')

  cLines.push('static int gea_embedded_input_key_press(int key_code) {')
  cLines.push('    if (gea_embedded_active_input_id < 0) return 0;')
  cLines.push('    batch_begin();')
  cLines.push('    if (key_code == GEA_EMBEDDED_KEYBOARD_MODE_SYMBOLS_KEY) {')
  cLines.push('        gea_embedded_input_set_shift_state(0, 0);')
  cLines.push('        gea_embedded_keyboard_sync_mode(GEA_EMBEDDED_KEYBOARD_MODE_SYMBOLS);')
  cLines.push('        batch_end();')
  cLines.push(
    '        gea_embedded_ui_refresh(gea_embedded_root_node, gea_embedded_viewport_w, gea_embedded_viewport_h);'
  )
  cLines.push('        return 1;')
  cLines.push('    }')
  cLines.push('    if (key_code == GEA_EMBEDDED_KEYBOARD_MODE_MORE_SYMBOLS_KEY) {')
  cLines.push('        gea_embedded_input_set_shift_state(0, 0);')
  cLines.push('        gea_embedded_keyboard_sync_mode(GEA_EMBEDDED_KEYBOARD_MODE_MORE_SYMBOLS);')
  cLines.push('        batch_end();')
  cLines.push(
    '        gea_embedded_ui_refresh(gea_embedded_root_node, gea_embedded_viewport_w, gea_embedded_viewport_h);'
  )
  cLines.push('        return 1;')
  cLines.push('    }')
  cLines.push('    if (key_code == GEA_EMBEDDED_KEYBOARD_MODE_ALPHA_KEY) {')
  cLines.push('        gea_embedded_input_set_shift_state(0, 0);')
  cLines.push('        gea_embedded_keyboard_sync_mode(GEA_EMBEDDED_KEYBOARD_MODE_ALPHA);')
  cLines.push('        batch_end();')
  cLines.push(
    '        gea_embedded_ui_refresh(gea_embedded_root_node, gea_embedded_viewport_w, gea_embedded_viewport_h);'
  )
  cLines.push('        return 1;')
  cLines.push('    }')
  cLines.push('    if (key_code == 16) {')
  emitInputSwitch(cLines, template, 'gea_embedded_active_input_id', 'keydownMethodCall', '        ')
  cLines.push('        if (gea_embedded_input_caps_lock) {')
  cLines.push('            gea_embedded_input_set_shift_state(0, 0);')
  cLines.push('        } else if (gea_embedded_input_shift_active) {')
  cLines.push(
    '            int shift_elapsed_ms = gea_embedded_input_timestamp_ms - gea_embedded_input_last_shift_tap_ms;'
  )
  cLines.push('            if (shift_elapsed_ms >= 0 && shift_elapsed_ms < GEA_EMBEDDED_SHIFT_DOUBLE_TAP_MS) {')
  cLines.push('                gea_embedded_input_set_shift_state(0, 1);')
  cLines.push('            } else {')
  cLines.push('                gea_embedded_input_set_shift_state(0, 0);')
  cLines.push('            }')
  cLines.push('            gea_embedded_input_last_shift_tap_ms = -GEA_EMBEDDED_SHIFT_DOUBLE_TAP_MS;')
  cLines.push('        } else {')
  cLines.push('            gea_embedded_input_last_shift_tap_ms = gea_embedded_input_timestamp_ms;')
  cLines.push('            gea_embedded_input_set_shift_state(1, 0);')
  cLines.push('        }')
  cLines.push('        gea_embedded_input_restart_caret();')
  cLines.push('        batch_end();')
  cLines.push(
    '        gea_embedded_ui_refresh(gea_embedded_root_node, gea_embedded_viewport_w, gea_embedded_viewport_h);'
  )
  cLines.push('        return 1;')
  cLines.push('    }')
  cLines.push('    switch (gea_embedded_active_input_id) {')
  for (const input of template.inputBindings) {
    const field = `${input.storeName}.${input.fieldName}`
    const fieldIdx = inputFieldIndex(defs, runtime, input.storeName, input.fieldName)
    cLines.push(`        case ${input.id}: {`)
    emitMethodCall(cLines, input.keydownMethodCall, '            ')
    cLines.push('            if (key_code == 13) {')
    cLines.push('                gea_embedded_input_blur_active();')
    cLines.push('                break;')
    cLines.push('            }')
    cLines.push('            if (key_code == 8) {')
    cLines.push(`                size_t len = strlen(${field});`)
    cLines.push('                if (len > 0) {')
    cLines.push(`                    ${field}[len - 1] = '\\0';`)
    if (input.type === 'password')
      cLines.push(`                    gea_embedded_input_clear_password_reveal(${input.id});`)
    cLines.push(`                    mark_dirty_field(${fieldIdx});`)
    emitMethodCall(cLines, input.inputMethodCall, '                    ')
    cLines.push('                }')
    cLines.push('                if (!gea_embedded_input_caps_lock) gea_embedded_input_set_shift_state(0, 0);')
    cLines.push('                gea_embedded_input_restart_caret();')
    cLines.push('                break;')
    cLines.push('            }')
    cLines.push(
      '            char ch = gea_embedded_input_key_to_char(key_code, gea_embedded_input_shift_active || gea_embedded_input_caps_lock);'
    )
    cLines.push("            if (ch != '\\0') {")
    if (input.type === 'password') {
      cLines.push(`                size_t before_len = strlen(${field});`)
      cLines.push(`                gea_embedded_string_append_char(${field}, sizeof(${field}), ch);`)
      cLines.push(`                size_t after_len = strlen(${field});`)
      cLines.push(
        `                if (after_len > before_len) gea_embedded_input_start_password_reveal(${input.id}, (int)after_len);`
      )
    } else {
      cLines.push(`                gea_embedded_string_append_char(${field}, sizeof(${field}), ch);`)
    }
    cLines.push(`                mark_dirty_field(${fieldIdx});`)
    emitMethodCall(cLines, input.inputMethodCall, '                ')
    cLines.push('                if (!gea_embedded_input_caps_lock) gea_embedded_input_set_shift_state(0, 0);')
    cLines.push('                gea_embedded_input_restart_caret();')
    cLines.push('            }')
    cLines.push('            break;')
    cLines.push('        }')
  }
  cLines.push('    }')
  cLines.push('    batch_end();')
  cLines.push('    gea_embedded_ui_refresh(gea_embedded_root_node, gea_embedded_viewport_w, gea_embedded_viewport_h);')
  cLines.push('    return 1;')
  cLines.push('}', '')

  cLines.push('static int gea_embedded_input_is_keyboard_press(int press_id) {')
  if (template.inputKeyPresses.length === 0) {
    cLines.push('    if (gea_embedded_keyboard_is_system_press(press_id)) return 1;')
    cLines.push('    return 0;')
  } else {
    cLines.push('    if (gea_embedded_keyboard_is_system_press(press_id)) return 1;')
    cLines.push('    switch (press_id) {')
    for (const key of template.inputKeyPresses) cLines.push(`        case ${key.pressId}: return 1;`)
    cLines.push('        default: return 0;')
    cLines.push('    }')
  }
  cLines.push('}', '')

  cLines.push('static int gea_embedded_input_keyboard_press(int press_id) {')
  if (template.inputKeyPresses.length === 0) {
    cLines.push('    int system_key_code = gea_embedded_keyboard_key_code_for_press(press_id);')
    cLines.push('    if (system_key_code) return gea_embedded_input_key_press(system_key_code);')
    cLines.push('    return 0;')
  } else {
    cLines.push('    int system_key_code = gea_embedded_keyboard_key_code_for_press(press_id);')
    cLines.push('    if (system_key_code) return gea_embedded_input_key_press(system_key_code);')
    cLines.push('    switch (press_id) {')
    for (const key of template.inputKeyPresses)
      cLines.push(`        case ${key.pressId}: return gea_embedded_input_key_press(${key.keyCode});`)
    cLines.push('        default: return 0;')
    cLines.push('    }')
  }
  cLines.push('}', '')
}

function emitPasswordRevealRuntime(cLines: string[], template: TemplateEmission): void {
  const passwordInputs = template.inputBindings.filter(input => input.type === 'password')
  cLines.push('#define GEA_EMBEDDED_PASSWORD_REVEAL_MS 500')
  cLines.push('static int gea_embedded_input_password_reveal_active[GEA_EMBEDDED_INPUT_COUNT];')
  cLines.push('static int gea_embedded_input_password_reveal_index[GEA_EMBEDDED_INPUT_COUNT];')
  cLines.push('static int gea_embedded_input_password_reveal_until_ms[GEA_EMBEDDED_INPUT_COUNT];', '')

  cLines.push('static int gea_embedded_input_password_reveal_index_for_binding(int input_id) {')
  cLines.push('    if (input_id < 0 || input_id >= GEA_EMBEDDED_INPUT_COUNT) return -1;')
  cLines.push('    if (!gea_embedded_input_password_reveal_active[input_id]) return -1;')
  cLines.push(
    '    if (gea_embedded_input_timestamp_ms >= gea_embedded_input_password_reveal_until_ms[input_id]) return -1;'
  )
  cLines.push('    return gea_embedded_input_password_reveal_index[input_id];')
  cLines.push('}', '')

  cLines.push('static void gea_embedded_input_clear_password_reveal(int input_id) {')
  cLines.push('    if (input_id < 0 || input_id >= GEA_EMBEDDED_INPUT_COUNT) return;')
  cLines.push('    gea_embedded_input_password_reveal_active[input_id] = 0;')
  cLines.push('    gea_embedded_input_password_reveal_index[input_id] = -1;')
  cLines.push('    gea_embedded_input_password_reveal_until_ms[input_id] = 0;')
  cLines.push('}', '')

  cLines.push('static void gea_embedded_input_start_password_reveal(int input_id, int len) {')
  cLines.push('    if (input_id < 0 || input_id >= GEA_EMBEDDED_INPUT_COUNT) return;')
  cLines.push('    if (len <= 0) {')
  cLines.push('        gea_embedded_input_clear_password_reveal(input_id);')
  cLines.push('        return;')
  cLines.push('    }')
  cLines.push('    gea_embedded_input_password_reveal_active[input_id] = 1;')
  cLines.push('    gea_embedded_input_password_reveal_index[input_id] = len - 1;')
  cLines.push(
    '    gea_embedded_input_password_reveal_until_ms[input_id] = gea_embedded_input_timestamp_ms + GEA_EMBEDDED_PASSWORD_REVEAL_MS;'
  )
  cLines.push('}', '')

  cLines.push('static void gea_embedded_input_apply_password_mask(int input_id) {')
  cLines.push('    switch (input_id) {')
  for (const input of passwordInputs) {
    cLines.push(
      `        case ${input.id}: gea_embedded_input_apply_text(gea_embedded_input_text_nodes[${input.id}], ${input.storeName}.${input.fieldName}, 1, -1); break;`
    )
  }
  cLines.push('        default: break;')
  cLines.push('    }')
  cLines.push('}', '')
}

function emitInputStateResetRuntime(cLines: string[], hasAutoFocusInputs: boolean, hasPasswordInputs: boolean): void {
  cLines.push('static void gea_embedded_input_state_reset(void) {')
  cLines.push('    gea_embedded_input_resized_node_count = 0;')
  cLines.push('    gea_embedded_input_root_resized = 0;')
  cLines.push('    gea_embedded_active_input_id = -1;')
  cLines.push('    gea_embedded_input_touch_start_press_id = -1;')
  cLines.push('    gea_embedded_input_skip_touch_press_id = -1;')
  cLines.push('    gea_embedded_input_shift_active = 0;')
  cLines.push('    gea_embedded_input_caps_lock = 0;')
  cLines.push('    gea_embedded_input_timestamp_ms = 0;')
  cLines.push('    gea_embedded_input_last_shift_tap_ms = -GEA_EMBEDDED_SHIFT_DOUBLE_TAP_MS;')
  cLines.push('    for (int i = 0; i < GEA_EMBEDDED_INPUT_COUNT; i++) {')
  cLines.push('        gea_embedded_input_root_nodes[i] = -1;')
  cLines.push('        gea_embedded_input_text_nodes[i] = -1;')
  cLines.push('        gea_embedded_input_caret_nodes[i] = -1;')
  if (hasAutoFocusInputs) cLines.push('        gea_embedded_input_autofocus_seen[i] = 0;')
  if (hasPasswordInputs) {
    cLines.push('        gea_embedded_input_password_reveal_active[i] = 0;')
    cLines.push('        gea_embedded_input_password_reveal_index[i] = -1;')
    cLines.push('        gea_embedded_input_password_reveal_until_ms[i] = 0;')
  }
  cLines.push('    }')
  cLines.push('    gea_embedded_keyboard_root_node = -1;')
  cLines.push('    gea_embedded_keyboard_visible = 0;')
  cLines.push('    gea_embedded_keyboard_mode = GEA_EMBEDDED_KEYBOARD_MODE_ALPHA;')
  cLines.push('    gea_embedded_keyboard_shift_active = 0;')
  cLines.push('    gea_embedded_keyboard_caps_lock = 0;')
  cLines.push('    for (int i = 0; i < GEA_EMBEDDED_KEYBOARD_ROW_COUNT; i++) gea_embedded_keyboard_row_nodes[i] = -1;')
  cLines.push('    for (int i = 0; i < GEA_EMBEDDED_KEYBOARD_KEY_SLOT_COUNT; i++) {')
  cLines.push('        gea_embedded_keyboard_key_nodes[i] = -1;')
  cLines.push('        gea_embedded_keyboard_label_nodes[i] = -1;')
  cLines.push('        gea_embedded_keyboard_key_codes[i] = 0;')
  cLines.push('    }')
  cLines.push('}', '')
}

function emitInputFrameRuntime(cLines: string[], template: TemplateEmission, hasPasswordInputs: boolean): void {
  const autoFocusInputs = template.inputBindings.filter(input => input.autoFocusExpr)
  cLines.push('static void gea_embedded_input_frame(int timestamp_ms) {')
  cLines.push('    if (timestamp_ms < 0) timestamp_ms = 0;')
  cLines.push('    gea_embedded_input_timestamp_ms = timestamp_ms;')
  if (hasPasswordInputs) {
    cLines.push('    int changed = 0;')
    cLines.push('    for (int i = 0; i < GEA_EMBEDDED_INPUT_COUNT; i++) {')
    cLines.push('        if (!gea_embedded_input_password_reveal_active[i]) continue;')
    cLines.push('        if (timestamp_ms < gea_embedded_input_password_reveal_until_ms[i]) continue;')
    cLines.push('        gea_embedded_input_clear_password_reveal(i);')
    cLines.push('        gea_embedded_input_apply_password_mask(i);')
    cLines.push('        changed = 1;')
    cLines.push('    }')
    cLines.push(
      '    if (changed) gea_embedded_ui_refresh(gea_embedded_root_node, gea_embedded_viewport_w, gea_embedded_viewport_h);'
    )
  }
  for (const input of autoFocusInputs) {
    cLines.push(
      `    if ((${input.autoFocusExpr}) && gea_embedded_input_node_is_visible(gea_embedded_input_root_nodes[${input.id}])) {`
    )
    cLines.push(`        if (!gea_embedded_input_autofocus_seen[${input.id}]) {`)
    cLines.push(`            gea_embedded_input_autofocus_seen[${input.id}] = 1;`)
    cLines.push(`            gea_embedded_input_focus_id(${input.id});`)
    cLines.push('        }')
    cLines.push('    } else {')
    cLines.push(`        gea_embedded_input_autofocus_seen[${input.id}] = 0;`)
    cLines.push('    }')
  }
  cLines.push('}', '')
}

type KeyboardKeyKind = 'light' | 'utility' | 'primary'
type KeyboardLabelKind = 'normal' | 'wide' | 'small'
type KeyboardKeyDef = {
  label: string
  code: number
  kind: KeyboardKeyKind
  labelKind: KeyboardLabelKind
  width: number
  flex: number
}
type KeyboardRowDef = { count?: number; gap: number; paddingLeft: number; paddingRight: number; keys: KeyboardKeyDef[] }

const KEYBOARD_LIGHT = 'light'
const KEYBOARD_UTILITY = 'utility'
const KEYBOARD_PRIMARY = 'primary'
const KEYBOARD_LABEL_NORMAL = 'normal'
const KEYBOARD_LABEL_WIDE = 'wide'
const KEYBOARD_LABEL_SMALL = 'small'

function key(
  label: string,
  code: number,
  kind: KeyboardKeyKind,
  labelKind: KeyboardLabelKind,
  width: number,
  flex: number
): KeyboardKeyDef {
  return { label, code, kind, labelKind, width, flex }
}

const SYSTEM_KEYBOARD_ROWS: Record<'alpha' | 'symbols' | 'moreSymbols', KeyboardRowDef[]> = {
  alpha: [
    {
      gap: 5,
      paddingLeft: 0,
      paddingRight: 0,
      keys: 'qwertyuiop'.split('').map(ch => key(ch, ch.charCodeAt(0), KEYBOARD_LIGHT, KEYBOARD_LABEL_NORMAL, 0, 1))
    },
    {
      gap: 5,
      paddingLeft: 18,
      paddingRight: 18,
      keys: 'asdfghjkl'.split('').map(ch => key(ch, ch.charCodeAt(0), KEYBOARD_LIGHT, KEYBOARD_LABEL_NORMAL, 0, 1))
    },
    {
      gap: 5,
      paddingLeft: 0,
      paddingRight: 0,
      keys: [
        key('shift', 16, KEYBOARD_UTILITY, KEYBOARD_LABEL_SMALL, 58, 0),
        ...'zxcvbnm'.split('').map(ch => key(ch, ch.charCodeAt(0), KEYBOARD_LIGHT, KEYBOARD_LABEL_NORMAL, 0, 1)),
        key('delete', 8, KEYBOARD_UTILITY, KEYBOARD_LABEL_SMALL, 58, 0)
      ]
    },
    {
      gap: 6,
      paddingLeft: 30,
      paddingRight: 30,
      keys: [
        key('123', 1001, KEYBOARD_UTILITY, KEYBOARD_LABEL_SMALL, 58, 0),
        key('space', 32, KEYBOARD_LIGHT, KEYBOARD_LABEL_WIDE, 0, 1),
        key('return', 13, KEYBOARD_PRIMARY, KEYBOARD_LABEL_SMALL, 86, 0)
      ]
    }
  ],
  symbols: [
    {
      gap: 5,
      paddingLeft: 0,
      paddingRight: 0,
      keys: '1234567890'.split('').map(ch => key(ch, ch.charCodeAt(0), KEYBOARD_LIGHT, KEYBOARD_LABEL_NORMAL, 0, 1))
    },
    {
      gap: 5,
      paddingLeft: 0,
      paddingRight: 0,
      keys: ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'].map(ch =>
        key(ch, ch.charCodeAt(0), KEYBOARD_LIGHT, KEYBOARD_LABEL_NORMAL, 0, 1)
      )
    },
    {
      gap: 5,
      paddingLeft: 0,
      paddingRight: 0,
      keys: [
        key('#+=', 1003, KEYBOARD_UTILITY, KEYBOARD_LABEL_SMALL, 58, 0),
        ...['.', ',', '?', '!', "'"].map(ch => key(ch, ch.charCodeAt(0), KEYBOARD_LIGHT, KEYBOARD_LABEL_NORMAL, 0, 1)),
        key('delete', 8, KEYBOARD_UTILITY, KEYBOARD_LABEL_SMALL, 58, 0)
      ]
    },
    {
      gap: 6,
      paddingLeft: 30,
      paddingRight: 30,
      keys: [
        key('ABC', 1002, KEYBOARD_UTILITY, KEYBOARD_LABEL_SMALL, 58, 0),
        key('space', 32, KEYBOARD_LIGHT, KEYBOARD_LABEL_WIDE, 0, 1),
        key('return', 13, KEYBOARD_PRIMARY, KEYBOARD_LABEL_SMALL, 86, 0)
      ]
    }
  ],
  moreSymbols: [
    {
      gap: 5,
      paddingLeft: 0,
      paddingRight: 0,
      keys: ['[', ']', '{', '}', '#', '%', '^', '*', '+', '='].map(ch =>
        key(ch, ch.charCodeAt(0), KEYBOARD_LIGHT, KEYBOARD_LABEL_NORMAL, 0, 1)
      )
    },
    {
      gap: 5,
      paddingLeft: 0,
      paddingRight: 0,
      keys: ['_', '\\', '|', '~', '<', '>', '`'].map(ch =>
        key(ch, ch.charCodeAt(0), KEYBOARD_LIGHT, KEYBOARD_LABEL_NORMAL, 0, 1)
      )
    },
    {
      gap: 5,
      paddingLeft: 0,
      paddingRight: 0,
      keys: [
        key('123', 1001, KEYBOARD_UTILITY, KEYBOARD_LABEL_SMALL, 58, 0),
        ...['.', ',', '?', '!', "'"].map(ch => key(ch, ch.charCodeAt(0), KEYBOARD_LIGHT, KEYBOARD_LABEL_NORMAL, 0, 1)),
        key('delete', 8, KEYBOARD_UTILITY, KEYBOARD_LABEL_SMALL, 58, 0)
      ]
    },
    {
      gap: 6,
      paddingLeft: 30,
      paddingRight: 30,
      keys: [
        key('ABC', 1002, KEYBOARD_UTILITY, KEYBOARD_LABEL_SMALL, 58, 0),
        key('space', 32, KEYBOARD_LIGHT, KEYBOARD_LABEL_WIDE, 0, 1),
        key('return', 13, KEYBOARD_PRIMARY, KEYBOARD_LABEL_SMALL, 86, 0)
      ]
    }
  ]
}

function emitSystemKeyboardVisualRuntime(cLines: string[]): void {
  cLines.push('#define GEA_EMBEDDED_SYSTEM_KEYBOARD_PRESS_BASE 30000')
  cLines.push('#define GEA_EMBEDDED_KEYBOARD_ROW_COUNT 4')
  cLines.push('#define GEA_EMBEDDED_KEYBOARD_COL_COUNT 10')
  cLines.push(
    '#define GEA_EMBEDDED_KEYBOARD_KEY_SLOT_COUNT (GEA_EMBEDDED_KEYBOARD_ROW_COUNT * GEA_EMBEDDED_KEYBOARD_COL_COUNT)'
  )
  cLines.push('#define GEA_EMBEDDED_KEYBOARD_WIDTH 386')
  cLines.push('#define GEA_EMBEDDED_KEYBOARD_HEIGHT 183')
  cLines.push('#define GEA_EMBEDDED_KEYBOARD_PADDING_TOP 8')
  cLines.push('#define GEA_EMBEDDED_KEYBOARD_PADDING_BOTTOM 8')
  cLines.push('#define GEA_EMBEDDED_KEYBOARD_KEY_KIND_LIGHT 0')
  cLines.push('#define GEA_EMBEDDED_KEYBOARD_KEY_KIND_UTILITY 1')
  cLines.push('#define GEA_EMBEDDED_KEYBOARD_KEY_KIND_PRIMARY 2')
  cLines.push('#define GEA_EMBEDDED_KEYBOARD_LABEL_KIND_NORMAL 0')
  cLines.push('#define GEA_EMBEDDED_KEYBOARD_LABEL_KIND_WIDE 1')
  cLines.push('#define GEA_EMBEDDED_KEYBOARD_LABEL_KIND_SMALL 2', '')

  cLines.push('typedef struct {')
  cLines.push('    const char *label;')
  cLines.push('    int code;')
  cLines.push('    int key_kind;')
  cLines.push('    int label_kind;')
  cLines.push('    int width;')
  cLines.push('    int flex;')
  cLines.push('} gea_embedded_keyboard_key_def_t;', '')

  cLines.push('typedef struct {')
  cLines.push('    int count;')
  cLines.push('    int gap;')
  cLines.push('    int padding_left;')
  cLines.push('    int padding_right;')
  cLines.push('    gea_embedded_keyboard_key_def_t keys[GEA_EMBEDDED_KEYBOARD_COL_COUNT];')
  cLines.push('} gea_embedded_keyboard_row_def_t;', '')

  emitKeyboardRowArray(cLines, 'gea_embedded_keyboard_alpha_rows', SYSTEM_KEYBOARD_ROWS.alpha)
  emitKeyboardRowArray(cLines, 'gea_embedded_keyboard_symbol_rows', SYSTEM_KEYBOARD_ROWS.symbols)
  emitKeyboardRowArray(cLines, 'gea_embedded_keyboard_more_symbol_rows', SYSTEM_KEYBOARD_ROWS.moreSymbols)

  cLines.push('static int gea_embedded_keyboard_root_node = -1;')
  cLines.push('static int gea_embedded_keyboard_visible = 0;')
  cLines.push('static int gea_embedded_keyboard_mode = GEA_EMBEDDED_KEYBOARD_MODE_ALPHA;')
  cLines.push('static int gea_embedded_keyboard_shift_active = 0;')
  cLines.push('static int gea_embedded_keyboard_caps_lock = 0;')
  cLines.push('static int gea_embedded_keyboard_row_nodes[GEA_EMBEDDED_KEYBOARD_ROW_COUNT];')
  cLines.push('static int gea_embedded_keyboard_key_nodes[GEA_EMBEDDED_KEYBOARD_KEY_SLOT_COUNT];')
  cLines.push('static int gea_embedded_keyboard_label_nodes[GEA_EMBEDDED_KEYBOARD_KEY_SLOT_COUNT];')
  cLines.push('static int gea_embedded_keyboard_key_codes[GEA_EMBEDDED_KEYBOARD_KEY_SLOT_COUNT];', '')

  cLines.push('static const gea_embedded_keyboard_row_def_t *gea_embedded_keyboard_rows_for_mode(int mode) {')
  cLines.push('    if (mode == GEA_EMBEDDED_KEYBOARD_MODE_SYMBOLS) return gea_embedded_keyboard_symbol_rows;')
  cLines.push('    if (mode == GEA_EMBEDDED_KEYBOARD_MODE_MORE_SYMBOLS) return gea_embedded_keyboard_more_symbol_rows;')
  cLines.push('    return gea_embedded_keyboard_alpha_rows;')
  cLines.push('}', '')

  cLines.push('static void gea_embedded_keyboard_apply_key_style(int node, int kind) {')
  cLines.push('    gea_embedded_ui_set_style(node, UI_PROP_HEIGHT, 38);')
  cLines.push('    gea_embedded_ui_set_style(node, UI_PROP_ALIGN_ITEMS, 2);')
  cLines.push('    gea_embedded_ui_set_style(node, UI_PROP_JUSTIFY_CONTENT, 1);')
  cLines.push('    gea_embedded_ui_set_style(node, UI_PROP_HAS_BG, 1);')
  cLines.push('    gea_embedded_ui_set_style(node, UI_PROP_BORDER_RADIUS_TL, 9);')
  cLines.push('    gea_embedded_ui_set_style(node, UI_PROP_BORDER_RADIUS_TR, 9);')
  cLines.push('    gea_embedded_ui_set_style(node, UI_PROP_BORDER_RADIUS_BR, 9);')
  cLines.push('    gea_embedded_ui_set_style(node, UI_PROP_BORDER_RADIUS_BL, 9);')
  cLines.push(
    `    if (kind == GEA_EMBEDDED_KEYBOARD_KEY_KIND_PRIMARY) gea_embedded_ui_set_style(node, UI_PROP_BG_COLOR, ${rgb('#0a84ff')});`
  )
  cLines.push(
    `    else if (kind == GEA_EMBEDDED_KEYBOARD_KEY_KIND_UTILITY) gea_embedded_ui_set_style(node, UI_PROP_BG_COLOR, ${rgb('#6f737d')});`
  )
  cLines.push(`    else gea_embedded_ui_set_style(node, UI_PROP_BG_COLOR, ${rgb('#f2f2f7')});`)
  cLines.push('}', '')

  cLines.push('static void gea_embedded_keyboard_apply_label_style(int node, int kind) {')
  cLines.push(
    '    gea_embedded_ui_set_style(node, UI_PROP_FONT_SIZE, kind == GEA_EMBEDDED_KEYBOARD_LABEL_KIND_SMALL ? 15 : (kind == GEA_EMBEDDED_KEYBOARD_LABEL_KIND_WIDE ? 17 : 19));'
  )
  cLines.push(
    `    gea_embedded_ui_set_style(node, UI_PROP_COLOR, kind == GEA_EMBEDDED_KEYBOARD_LABEL_KIND_SMALL ? ${rgb('#ffffff')} : ${rgb('#111116')});`
  )
  cLines.push('}', '')

  emitSystemKeyboardBehavior(cLines)
}

function emitKeyboardVisualRuntime(cLines: string[], enabled: boolean): void {
  if (enabled) {
    emitSystemKeyboardVisualRuntime(cLines)
    return
  }

  cLines.push('static void gea_embedded_keyboard_show(void) {}')
  cLines.push('static void gea_embedded_keyboard_hide(void) {}')
  cLines.push('static void gea_embedded_keyboard_sync_mode(int mode) { (void)mode; }')
  cLines.push(
    'static void gea_embedded_keyboard_sync_shift(int active, int caps_lock) { (void)active; (void)caps_lock; }'
  )
  cLines.push('static int gea_embedded_keyboard_is_system_press(int press_id) { (void)press_id; return 0; }')
  cLines.push('static int gea_embedded_keyboard_key_code_for_press(int press_id) { (void)press_id; return 0; }', '')
}

function emitSystemKeyboardBehavior(cLines: string[]): void {
  cLines.push('static void gea_embedded_keyboard_sync_shift(int active, int caps_lock);', '')

  cLines.push('static int gea_embedded_keyboard_top(void) {')
  cLines.push('    int top = gea_embedded_viewport_h - GEA_EMBEDDED_KEYBOARD_HEIGHT;')
  cLines.push('    return top > 0 ? top : 0;')
  cLines.push('}', '')

  cLines.push('static int gea_embedded_keyboard_contains_point(int x, int y) {')
  cLines.push('    if (!gea_embedded_keyboard_visible || gea_embedded_keyboard_root_node < 0) return 0;')
  cLines.push('    ui_node_t *keyboard = &gea_embedded_ui_nodes[gea_embedded_keyboard_root_node];')
  cLines.push('    return x >= keyboard->layout_x && x < keyboard->layout_x + keyboard->layout_w &&')
  cLines.push('           y >= keyboard->layout_y && y < keyboard->layout_y + keyboard->layout_h;')
  cLines.push('}', '')

  cLines.push('static void gea_embedded_keyboard_apply_app_resize(int visible) {')
  cLines.push('    if (gea_embedded_root_node < 0 || gea_embedded_root_node >= UI_MAX_NODES) return;')
  cLines.push('    if (visible) {')
  cLines.push('        if (gea_embedded_input_root_resized) return;')
  cLines.push('        gea_embedded_input_resized_node_count = 0;')
  cLines.push('        gea_embedded_input_root_resized = 1;')
  cLines.push('        int app_height = gea_embedded_viewport_h - GEA_EMBEDDED_KEYBOARD_HEIGHT;')
  cLines.push('        if (app_height < 0) app_height = 0;')
  cLines.push(
    '        for (int i = 0; i < gea_embedded_ui_node_count && gea_embedded_input_resized_node_count < UI_MAX_NODES; i++) {'
  )
  cLines.push('            if (i == gea_embedded_keyboard_root_node) continue;')
  cLines.push('            ui_node_t *node = &gea_embedded_ui_nodes[i];')
  cLines.push(
    '            int full_height = node->height == gea_embedded_viewport_h || (i == gea_embedded_root_node && node->height == UI_UNSET);'
  )
  cLines.push('            if (!full_height) continue;')
  cLines.push('            int slot = gea_embedded_input_resized_node_count++;')
  cLines.push('            gea_embedded_input_resized_nodes[slot] = i;')
  cLines.push('            gea_embedded_input_resized_heights[slot] = node->height;')
  cLines.push('            gea_embedded_input_resized_overflows[slot] = node->overflow;')
  cLines.push('            gea_embedded_ui_set_style(i, UI_PROP_HEIGHT, app_height);')
  cLines.push('            if (i == gea_embedded_root_node) gea_embedded_ui_set_style(i, UI_PROP_OVERFLOW, 1);')
  cLines.push('        }')
  cLines.push('    } else if (gea_embedded_input_root_resized) {')
  cLines.push('        for (int i = gea_embedded_input_resized_node_count - 1; i >= 0; i--) {')
  cLines.push('            int node_id = gea_embedded_input_resized_nodes[i];')
  cLines.push('            if (node_id < 0 || node_id >= gea_embedded_ui_node_count) continue;')
  cLines.push('            gea_embedded_ui_set_style(node_id, UI_PROP_HEIGHT, gea_embedded_input_resized_heights[i]);')
  cLines.push(
    '            gea_embedded_ui_set_style(node_id, UI_PROP_OVERFLOW, gea_embedded_input_resized_overflows[i]);'
  )
  cLines.push('        }')
  cLines.push('        gea_embedded_input_resized_node_count = 0;')
  cLines.push('        gea_embedded_input_root_resized = 0;')
  cLines.push('    }')
  cLines.push('}', '')

  cLines.push('static void gea_embedded_keyboard_apply_mode(void) {')
  cLines.push('    if (gea_embedded_keyboard_root_node < 0) return;')
  cLines.push(
    '    const gea_embedded_keyboard_row_def_t *rows = gea_embedded_keyboard_rows_for_mode(gea_embedded_keyboard_mode);'
  )
  cLines.push('    for (int row = 0; row < GEA_EMBEDDED_KEYBOARD_ROW_COUNT; row++) {')
  cLines.push('        int row_node = gea_embedded_keyboard_row_nodes[row];')
  cLines.push('        gea_embedded_ui_set_style(row_node, UI_PROP_GAP, rows[row].gap);')
  cLines.push('        gea_embedded_ui_set_style(row_node, UI_PROP_PADDING_LEFT, rows[row].padding_left);')
  cLines.push('        gea_embedded_ui_set_style(row_node, UI_PROP_PADDING_RIGHT, rows[row].padding_right);')
  cLines.push('        for (int col = 0; col < GEA_EMBEDDED_KEYBOARD_COL_COUNT; col++) {')
  cLines.push('            int slot = row * GEA_EMBEDDED_KEYBOARD_COL_COUNT + col;')
  cLines.push('            int key_node = gea_embedded_keyboard_key_nodes[slot];')
  cLines.push('            int label_node = gea_embedded_keyboard_label_nodes[slot];')
  cLines.push('            if (col >= rows[row].count) {')
  cLines.push('                gea_embedded_keyboard_key_codes[slot] = 0;')
  cLines.push('                gea_embedded_ui_set_style(key_node, UI_PROP_DISPLAY, 1);')
  cLines.push('                continue;')
  cLines.push('            }')
  cLines.push('            const gea_embedded_keyboard_key_def_t *def = &rows[row].keys[col];')
  cLines.push('            gea_embedded_keyboard_key_codes[slot] = def->code;')
  cLines.push('            gea_embedded_ui_set_style(key_node, UI_PROP_DISPLAY, 0);')
  cLines.push('            gea_embedded_ui_set_style(key_node, UI_PROP_WIDTH, def->width);')
  cLines.push('            gea_embedded_ui_set_style(key_node, UI_PROP_FLEX, def->flex);')
  cLines.push('            gea_embedded_keyboard_apply_key_style(key_node, def->key_kind);')
  cLines.push('            gea_embedded_keyboard_apply_label_style(label_node, def->label_kind);')
  cLines.push('            gea_embedded_ui_set_text(label_node, def->label);')
  cLines.push('        }')
  cLines.push('    }')
  cLines.push(
    '    gea_embedded_keyboard_sync_shift(gea_embedded_keyboard_shift_active, gea_embedded_keyboard_caps_lock);'
  )
  cLines.push('}', '')

  cLines.push('static void gea_embedded_keyboard_create(void) {')
  cLines.push('    if (gea_embedded_keyboard_root_node >= 0 || gea_embedded_root_node < 0) return;')
  cLines.push('    gea_embedded_keyboard_root_node = gea_embedded_ui_create_view();')
  cLines.push('    gea_embedded_ui_set_parent(gea_embedded_keyboard_root_node, gea_embedded_root_node);')
  cLines.push('    gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_DISPLAY, 1);')
  cLines.push('    gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_POSITION, 1);')
  cLines.push('    gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_LEFT, 0);')
  cLines.push(
    '    gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_TOP, gea_embedded_keyboard_top());'
  )
  cLines.push('    gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_Z_INDEX, 32000);')
  cLines.push('    gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_WIDTH, gea_embedded_viewport_w);')
  cLines.push(
    '    gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_HEIGHT, GEA_EMBEDDED_KEYBOARD_HEIGHT);'
  )
  cLines.push(`    gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_BG_COLOR, ${rgb('#d1d3da')});`)
  cLines.push('    gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_HAS_BG, 1);')
  cLines.push(
    '    gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_PADDING_TOP, GEA_EMBEDDED_KEYBOARD_PADDING_TOP);'
  )
  cLines.push(
    '    gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_PADDING_BOTTOM, GEA_EMBEDDED_KEYBOARD_PADDING_BOTTOM);'
  )
  cLines.push('    gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_FLEX_DIRECTION, 0);')
  cLines.push('    gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_JUSTIFY_CONTENT, 2);')
  cLines.push('    gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_ALIGN_ITEMS, 2);')
  cLines.push('    gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_GAP, 5);')
  cLines.push('    for (int row = 0; row < GEA_EMBEDDED_KEYBOARD_ROW_COUNT; row++) {')
  cLines.push('        int row_node = gea_embedded_ui_create_view();')
  cLines.push('        gea_embedded_keyboard_row_nodes[row] = row_node;')
  cLines.push('        gea_embedded_ui_set_parent(row_node, gea_embedded_keyboard_root_node);')
  cLines.push('        gea_embedded_ui_set_style(row_node, UI_PROP_WIDTH, GEA_EMBEDDED_KEYBOARD_WIDTH);')
  cLines.push('        gea_embedded_ui_set_style(row_node, UI_PROP_HEIGHT, 38);')
  cLines.push('        gea_embedded_ui_set_style(row_node, UI_PROP_FLEX_DIRECTION, 1);')
  cLines.push('        for (int col = 0; col < GEA_EMBEDDED_KEYBOARD_COL_COUNT; col++) {')
  cLines.push('            int slot = row * GEA_EMBEDDED_KEYBOARD_COL_COUNT + col;')
  cLines.push('            int key_node = gea_embedded_ui_create_view();')
  cLines.push('            int label_node = gea_embedded_ui_create_text();')
  cLines.push('            gea_embedded_keyboard_key_nodes[slot] = key_node;')
  cLines.push('            gea_embedded_keyboard_label_nodes[slot] = label_node;')
  cLines.push('            gea_embedded_ui_set_parent(key_node, row_node);')
  cLines.push('            gea_embedded_ui_set_parent(label_node, key_node);')
  cLines.push('            gea_embedded_ui_set_on_press(key_node, GEA_EMBEDDED_SYSTEM_KEYBOARD_PRESS_BASE + slot);')
  cLines.push('        }')
  cLines.push('    }')
  cLines.push('    gea_embedded_keyboard_apply_mode();')
  cLines.push('}', '')

  cLines.push('static void gea_embedded_keyboard_show(void) {')
  cLines.push('    gea_embedded_keyboard_create();')
  cLines.push('    if (gea_embedded_keyboard_root_node < 0) return;')
  cLines.push('    gea_embedded_keyboard_visible = 1;')
  cLines.push('    gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_WIDTH, gea_embedded_viewport_w);')
  cLines.push(
    '    gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_TOP, gea_embedded_keyboard_top());'
  )
  cLines.push('    gea_embedded_keyboard_apply_app_resize(1);')
  cLines.push('    gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_DISPLAY, 0);')
  cLines.push('    gea_embedded_keyboard_apply_mode();')
  cLines.push('}', '')

  cLines.push('static void gea_embedded_keyboard_hide(void) {')
  cLines.push('    gea_embedded_keyboard_visible = 0;')
  cLines.push(
    '    if (gea_embedded_keyboard_root_node >= 0) gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_DISPLAY, 1);'
  )
  cLines.push('    gea_embedded_keyboard_apply_app_resize(0);')
  cLines.push('}', '')

  cLines.push('static void gea_embedded_keyboard_sync_mode(int mode) {')
  cLines.push('    gea_embedded_keyboard_mode = mode;')
  cLines.push('    gea_embedded_keyboard_apply_mode();')
  cLines.push('}', '')

  cLines.push('static void gea_embedded_keyboard_sync_shift(int active, int caps_lock) {')
  cLines.push('    gea_embedded_keyboard_shift_active = active ? 1 : 0;')
  cLines.push('    gea_embedded_keyboard_caps_lock = caps_lock ? 1 : 0;')
  cLines.push('    int uppercase = gea_embedded_keyboard_shift_active || gea_embedded_keyboard_caps_lock;')
  cLines.push('    if (gea_embedded_keyboard_root_node < 0) return;')
  cLines.push('    for (int i = 0; i < GEA_EMBEDDED_KEYBOARD_KEY_SLOT_COUNT; i++) {')
  cLines.push('        int key_code = gea_embedded_keyboard_key_codes[i];')
  cLines.push('        int label_node = gea_embedded_keyboard_label_nodes[i];')
  cLines.push('        int key_node = gea_embedded_keyboard_key_nodes[i];')
  cLines.push('        if (key_code >= 97 && key_code <= 122) {')
  cLines.push("            char label[2] = { (char)(uppercase ? key_code - 32 : key_code), '\\0' };")
  cLines.push('            gea_embedded_ui_set_text(label_node, label);')
  cLines.push('        } else if (key_code == 16) {')
  cLines.push(
    '            gea_embedded_ui_set_style(label_node, UI_PROP_COLOR, caps_lock ? 0xFFFF : (active ? 0x1082 : 0xFFFF));'
  )
  cLines.push(
    '            gea_embedded_ui_set_style(key_node, UI_PROP_BG_COLOR, caps_lock ? 0x0C3F : (active ? 0xF79E : 0x6B8F));'
  )
  cLines.push('        }')
  cLines.push('    }')
  cLines.push('}', '')

  cLines.push('static int gea_embedded_keyboard_is_system_press(int press_id) {')
  cLines.push(
    '    return press_id >= GEA_EMBEDDED_SYSTEM_KEYBOARD_PRESS_BASE && press_id < GEA_EMBEDDED_SYSTEM_KEYBOARD_PRESS_BASE + GEA_EMBEDDED_KEYBOARD_KEY_SLOT_COUNT;'
  )
  cLines.push('}', '')

  cLines.push('static int gea_embedded_keyboard_key_code_for_press(int press_id) {')
  cLines.push('    if (!gea_embedded_keyboard_visible || !gea_embedded_keyboard_is_system_press(press_id)) return 0;')
  cLines.push('    int slot = press_id - GEA_EMBEDDED_SYSTEM_KEYBOARD_PRESS_BASE;')
  cLines.push('    return gea_embedded_keyboard_key_codes[slot];')
  cLines.push('}', '')
}

function emitKeyboardRowArray(cLines: string[], name: string, rows: KeyboardRowDef[]): void {
  cLines.push(`static const gea_embedded_keyboard_row_def_t ${name}[GEA_EMBEDDED_KEYBOARD_ROW_COUNT] = {`)
  for (const row of rows) {
    cLines.push(`    { ${row.count ?? row.keys.length}, ${row.gap}, ${row.paddingLeft}, ${row.paddingRight}, {`)
    for (const keyDef of row.keys) {
      cLines.push(
        `        { ${JSON.stringify(keyDef.label)}, ${keyDef.code}, ${cKeyKind(keyDef.kind)}, ${cLabelKind(keyDef.labelKind)}, ${keyDef.width}, ${keyDef.flex} },`
      )
    }
    cLines.push('    } },')
  }
  cLines.push('};', '')
}

function cKeyKind(kind: KeyboardKeyKind): string {
  if (kind === KEYBOARD_PRIMARY) return 'GEA_EMBEDDED_KEYBOARD_KEY_KIND_PRIMARY'
  if (kind === KEYBOARD_UTILITY) return 'GEA_EMBEDDED_KEYBOARD_KEY_KIND_UTILITY'
  return 'GEA_EMBEDDED_KEYBOARD_KEY_KIND_LIGHT'
}

function cLabelKind(kind: KeyboardLabelKind): string {
  if (kind === KEYBOARD_LABEL_SMALL) return 'GEA_EMBEDDED_KEYBOARD_LABEL_KIND_SMALL'
  if (kind === KEYBOARD_LABEL_WIDE) return 'GEA_EMBEDDED_KEYBOARD_LABEL_KIND_WIDE'
  return 'GEA_EMBEDDED_KEYBOARD_LABEL_KIND_NORMAL'
}

function rgb(hex: string): string {
  return `0x${hexToRgb565(hex).toString(16).toUpperCase().padStart(4, '0')}`
}

function emitInputSwitch(
  cLines: string[],
  template: TemplateEmission,
  switchExpr: string,
  methodKey: 'focusMethodCall' | 'inputMethodCall' | 'blurMethodCall' | 'keydownMethodCall',
  indent: string
): void {
  cLines.push(`${indent}switch (${switchExpr}) {`)
  for (const input of template.inputBindings) {
    const methodCall = input[methodKey]
    if (!methodCall) continue
    cLines.push(`${indent}    case ${input.id}:`)
    emitMethodCall(cLines, methodCall, `${indent}        `)
    cLines.push(`${indent}        break;`)
  }
  cLines.push(`${indent}}`)
}

function emitMethodCall(
  cLines: string[],
  methodCall: { cStruct: string; methodName: string; arg: string } | undefined,
  indent: string
): void {
  if (!methodCall) return
  cLines.push(`${indent}${methodCall.cStruct}_${methodCall.methodName}(${methodCall.arg});`)
}

function inputFieldIndex(
  defs: CompilerDefinitions,
  runtime: StoreRuntimeInfo,
  storeName: string,
  fieldName: string
): number {
  const si = defs.storeInstances.find(s => s.cStruct === storeName)
  const storeDef = si ? defs.stores.get(si.className) : undefined
  const field = storeDef?.fields.find(f => f.name === fieldName)
  if (!si || !storeDef || !field) return 0
  return (runtime.storeFieldOffsets.get(storeName) ?? 0) + storeDef.fields.indexOf(field)
}

function emitBleInit(cLines: string[], defs: CompilerDefinitions): void {
  if (!defs.storeInstances.some(si => defs.stores.get(si.className)?.isBLEServer)) return
  const bleSI = defs.storeInstances.find(si => defs.stores.get(si.className)?.isBLEServer)
  if (!bleSI) return
  const bleDef = defs.stores.get(bleSI.className)!
  const nameField = bleDef.fields.find(f => f.name === 'deviceName')
  const appField = bleDef.fields.find(f => f.name === 'appearance')
  const macField = bleDef.fields.find(f => f.name === 'macAddress')
  const nameArg = nameField ? `${bleSI.cStruct}.deviceName` : '"Gea Embedded BLE"'
  const appArg = appField ? `${bleSI.cStruct}.appearance` : '0x03C1'
  const macArg = macField ? `${bleSI.cStruct}.macAddress` : 'NULL'
  cLines.push(`    gea_embedded_ble_init(${nameArg}, ${appArg}, ${macArg});`, '')
}

function emitAppFrame(
  cLines: string[],
  defs: CompilerDefinitions,
  template: TemplateEmission,
  runtime: StoreRuntimeInfo,
  frameFusion: FrameFusionInfo | null
): void {
  const hasInputs = template.inputBindings.length > 0
  const hasSettings = !!settingsStore(defs)
  if (frameFusion && emitFusedFrame(cLines, defs, template, runtime, frameFusion)) return
  cLines.push('void gea_embedded_app_frame(int timestampMs) {')
  if (hasSettings) cLines.push('    gea_embedded_app_timestamp_ms = timestampMs < 0 ? 0 : timestampMs;')
  const rafCalls = defs.rafStoreCalls.length > 0
    ? defs.rafStoreCalls
    : defs.rafStoreCall
      ? [{ cCall: defs.rafStoreCall, arg: defs.rafStoreCallArg, methodName: defs.rafMethodName, className: defs.rafClassName }]
      : []
  if (rafCalls.length > 0) {
    cLines.push('    batch_begin();')
    for (const call of rafCalls) cLines.push(`    ${call.cCall}${call.arg ? `(${call.arg})` : '()'};`)
    cLines.push('    batch_end();')
  }
  if (hasInputs) cLines.push('    gea_embedded_input_frame(timestampMs);')
  cLines.push('    gea_embedded_ui_frame(timestampMs);')
  cLines.push('}', '')
}

function emitFusedFrame(
  cLines: string[],
  defs: CompilerDefinitions,
  template: TemplateEmission,
  runtime: StoreRuntimeInfo,
  frameFusion: FrameFusionInfo
): boolean {
  if (!defs.rafMethodName || !defs.rafClassName) return false
  const rafStoreDef = defs.stores.get(defs.rafClassName)
  const rafSI = defs.storeInstances.find(s => s.className === defs.rafClassName)
  const rafMethod = rafStoreDef?.methods.find(m => m.name === defs.rafMethodName)
  if (!rafStoreDef || !rafSI || !rafMethod || rafMethod.bodyNode.body.length === 0) return false
  const fusedCall = `${rafSI.cStruct}_${defs.rafMethodName}`
  const rafCalls = defs.rafStoreCalls.length > 0
    ? defs.rafStoreCalls
    : defs.rafStoreCall
      ? [{ cCall: defs.rafStoreCall, arg: defs.rafStoreCallArg, methodName: defs.rafMethodName, className: defs.rafClassName }]
      : []
  const fusedCallIndex = rafCalls.findIndex(call => call.cCall === fusedCall)
  const lastStmt = rafMethod.bodyNode.body[rafMethod.bodyNode.body.length - 1]
  if (!t.isForStatement(lastStmt) || !isFusionLoop(lastStmt, frameFusion.fieldName)) return false
  const forNode = lastStmt
  const prelude = rafMethod.bodyNode.body.slice(0, -1)
  const hasPrelude = prelude.length > 0

  const loopVar = (forNode.init.declarations[0].id as t.Identifier).name
  const methodInfoMap = runtime.perStoreMethodInfo.get(rafSI.jsVar) || new Map()
  const elemType = `${frameFusion.fieldName}_elem_t`
  const ptrName = `_${frameFusion.fieldName.charAt(0)}`
  const fusedField = rafStoreDef.fields.find(f => f.name === frameFusion.fieldName)
  const fusedFieldIdx =
    fusedField ? (runtime.storeFieldOffsets.get(rafSI.cStruct) ?? 0) + rafStoreDef.fields.indexOf(fusedField) : -1
  const methodCtx: MethodCtx = {
    storeName: rafSI.cStruct,
    storeFields: rafStoreDef.fields,
    allMethods: methodInfoMap,
    localTypes: new Map(rafMethod.params.map(p => [p.name, methodParamLocalType(p)] as const)),
    bitmaskOne: runtime.bitmaskOne,
    fieldOffset: runtime.storeFieldOffsets.get(rafSI.cStruct) ?? 0,
    arrayAliases: new Map(),
    audioOscillatorVars: new Set(),
    crossStoreMethods: runtime.crossStoreMethods,
    accelerometerVars: defs.accelerometerVars,
    moduleConstants: defs.moduleConstants
  }

  cLines.push('void gea_embedded_app_frame(int timestampMs) {')
  if (settingsStore(defs)) cLines.push('    gea_embedded_app_timestamp_ms = timestampMs < 0 ? 0 : timestampMs;')

  emitRafCalls(cLines, rafCalls.slice(0, fusedCallIndex < 0 ? 0 : fusedCallIndex))

  if (hasPrelude) {
    cLines.push('    batch_begin();')
    for (const stmt of prelude) cLines.push(...stmtToC(stmt, methodCtx, '    ', true).lines)
  }

  methodCtx.localTypes.set(loopVar, 'int')
  methodCtx.arrayAliases.set(frameFusion.fieldName, { iterVar: loopVar, ptrName, elemType })
  if (hasPrelude) methodCtx.suppressDirtyMarks = new Set([frameFusion.fieldName])

  cLines.push(`    int len = ${frameFusion.storeName}.${frameFusion.fieldName}_len;`)
  cLines.push(`    for (int ${loopVar} = 0; ${loopVar} < len; ${loopVar}++) {`)
  cLines.push(`        ${elemType} *${ptrName} = &${frameFusion.storeName}.${frameFusion.fieldName}[${loopVar}];`)
  for (const s of forNode.body.body) cLines.push(...stmtToC(s, methodCtx, '        ', hasPrelude).lines)
  cLines.push(`        ui_node_t *nd = &gea_embedded_ui_nodes[${frameFusion.fieldName}_node_ids[${loopVar}]];`)
  for (const ds of frameFusion.perFrameStyles) {
    const nf = NODE_FIELD_MAP[ds.key]
    if (nf) cLines.push(`        nd->${nf} = ${ptrName}->${ds.subField};`)
  }
  cLines.push('        nd->dirty = 1;', '    }')
  if (fusedFieldIdx >= 0 && fusedField?.subFields) {
    const emittedSubfields = new Set<number>()
    for (const ds of frameFusion.perFrameStyles) {
      const subIndex = fusedField.subFields.findIndex(subField => subField.name === ds.subField)
      if (subIndex < 0 || emittedSubfields.has(subIndex)) continue
      emittedSubfields.add(subIndex)
      cLines.push(`    mark_mirror_dirty_array_subfield(${fusedFieldIdx}, ${subIndex});`)
    }
    if (emittedSubfields.size === 0) cLines.push(`    mark_mirror_dirty_field(${fusedFieldIdx});`)
  }

  if (hasPrelude) {
    cLines.push('    dirty_fields_any = 1;')
    cLines.push('    batch_end();')
  } else {
    cLines.push(
      '    gea_embedded_ui_refresh(gea_embedded_root_node, gea_embedded_viewport_w, gea_embedded_viewport_h);'
    )
  }

  emitRafCalls(cLines, fusedCallIndex < 0 ? [] : rafCalls.slice(fusedCallIndex + 1))

  if (template.inputBindings.length > 0) cLines.push('    gea_embedded_input_frame(timestampMs);')
  cLines.push('    gea_embedded_ui_frame(timestampMs);')
  cLines.push('}', '')
  return true
}

function emitRafCalls(cLines: string[], calls: CompilerDefinitions['rafStoreCalls']): void {
  if (calls.length === 0) return
  cLines.push('    batch_begin();')
  for (const call of calls) cLines.push(`    ${call.cCall}${call.arg ? `(${call.arg})` : '()'};`)
  cLines.push('    batch_end();')
}

function emitTouchEntrypoints(cLines: string[], defs: CompilerDefinitions, template: TemplateEmission): void {
  cLines.push('void gea_embedded_app_touch(int press_id) {')
  if (template.inputBindings.length > 0)
    cLines.push('    if (gea_embedded_input_consume_skipped_touch(press_id)) return;')
  if (template.inputBindings.length > 0) cLines.push('    if (gea_embedded_input_focus_press(press_id)) return;')
  if (template.inputBindings.length > 0) {
    cLines.push('    if (gea_embedded_active_input_id >= 0 && gea_embedded_input_keyboard_press(press_id)) return;')
    cLines.push('    if (!gea_embedded_input_is_keyboard_press(press_id)) {')
    cLines.push('        batch_begin();')
    cLines.push('        gea_embedded_input_blur_active();')
    cLines.push('        batch_end();')
    cLines.push(
      '        gea_embedded_ui_refresh(gea_embedded_root_node, gea_embedded_viewport_w, gea_embedded_viewport_h);'
    )
    cLines.push('    }')
  }
  if (template.onPressHandlers.length > 0) {
    const shared = sharedPressMethodCall(template)
    cLines.push('    batch_begin();')
    if (shared) {
      cLines.push(`    ${shared.cStruct}_${shared.methodName}(${shared.arg});`)
      cLines.push('    batch_end();')
      cLines.push('    return;')
    } else {
      emitGroupedPressSwitch(cLines, template.onPressHandlers)
      cLines.push('    batch_end();')
    }
  }
  if (template.inputBindings.length > 0) cLines.push('    if (gea_embedded_input_keyboard_press(press_id)) return;')
  if (template.onPressHandlers.length === 0 && template.inputBindings.length === 0) cLines.push('    (void)press_id;')
  cLines.push('}', '')

  emitElementTouchEntrypoint(
    cLines,
    'gea_embedded_app_touch_start_element',
    template.onTouchStartHandlers,
    template.inputBindings.length > 0
  )
  emitElementTouchEntrypoint(cLines, 'gea_embedded_app_touch_end_element', template.onTouchEndHandlers, false)
  emitTouchMoveEntrypoint(cLines, template)
  void defs
}

function sharedPressMethodCall(
  template: TemplateEmission
): { cStruct: string; methodName: string; arg: string } | null {
  const handlers = template.onPressHandlers
  const first = handlers[0]?.methodCall
  if (!first) return null
  if (!allPressableIdsCoveredByOnPress(template)) return null
  const sameMethod = handlers.every(
    h => h.methodCall && h.methodCall.cStruct === first.cStruct && h.methodCall.methodName === first.methodName
  )
  if (!sameMethod) return null
  if (handlers.every(h => h.methodCall!.arg === ''))
    return { cStruct: first.cStruct, methodName: first.methodName, arg: '' }
  const canPassPressId = handlers.every(
    h => h.methodCall!.arg === 'press_id' || h.methodCall!.arg === String(h.pressId)
  )
  return canPassPressId ? { cStruct: first.cStruct, methodName: first.methodName, arg: 'press_id' } : null
}

function allPressableIdsCoveredByOnPress(template: TemplateEmission): boolean {
  const onPressIds = new Set(template.onPressHandlers.map(h => h.pressId))
  const pressableIds = new Set<number>()
  for (const h of template.onPressHandlers) pressableIds.add(h.pressId)
  for (const h of template.onTouchStartHandlers) pressableIds.add(h.pressId)
  for (const h of template.onTouchEndHandlers) pressableIds.add(h.pressId)
  for (const h of template.onTouchMoveHandlers) pressableIds.add(h.pressId)
  for (const pressId of pressableIds) {
    if (!onPressIds.has(pressId)) return false
  }
  return true
}

function emitGroupedPressSwitch(cLines: string[], handlers: TemplateEmission['onPressHandlers']): void {
  const groups = new Map<string, { call: string; pressIds: number[] }>()
  for (const h of handlers) {
    if (!h.methodCall) continue
    const call = `${h.methodCall.cStruct}_${h.methodCall.methodName}(${h.methodCall.arg});`
    if (!groups.has(call)) groups.set(call, { call, pressIds: [] })
    groups.get(call)!.pressIds.push(h.pressId)
  }

  cLines.push('    switch (press_id) {')
  for (const group of groups.values()) {
    for (const pressId of new Set(group.pressIds)) cLines.push(`        case ${pressId}:`)
    cLines.push(`            ${group.call}`)
    cLines.push('            break;')
  }
  cLines.push('    }')
}

function emitElementTouchEntrypoint(
  cLines: string[],
  name: string,
  handlers: TemplateEmission['onTouchStartHandlers'],
  focusInputsOnStart: boolean
): void {
  cLines.push(`void ${name}(int press_id, int x, int y) {`)
  if (focusInputsOnStart) {
    cLines.push('    gea_embedded_input_touch_start_press_id = -1;')
    cLines.push('    if (gea_embedded_input_focus_press(press_id)) {')
    cLines.push('        gea_embedded_input_touch_start_press_id = press_id;')
    cLines.push('        return;')
    cLines.push('    }')
  }
  if (handlers.length > 0) {
    cLines.push('    batch_begin();')
    cLines.push('    switch (press_id) {')
    for (const h of handlers) {
      if (!h.methodCall) continue
      cLines.push(
        h.hasCoords
          ? `        case ${h.pressId}: ${h.methodCall.cStruct}_${h.methodCall.methodName}(x, y); break;`
          : `        case ${h.pressId}: ${h.methodCall.cStruct}_${h.methodCall.methodName}(${h.methodCall.arg}); break;`
      )
    }
    cLines.push('    }')
    cLines.push('    batch_end();')
  } else cLines.push('    (void)press_id; (void)x; (void)y;')
  cLines.push('}', '')
}

function emitTouchMoveEntrypoint(cLines: string[], template: TemplateEmission): void {
  cLines.push('void gea_embedded_app_touch_move_element(int press_id, int x, int y) {')
  if (template.onTouchMoveHandlers.length > 0) {
    cLines.push('    batch_begin();')
    cLines.push('    switch (press_id) {')
    for (const h of template.onTouchMoveHandlers)
      if (h.methodCall)
        cLines.push(`        case ${h.pressId}: ${h.methodCall.cStruct}_${h.methodCall.methodName}(x, y); break;`)
    cLines.push('    }')
    cLines.push('    batch_end();')
  } else cLines.push('    (void)press_id; (void)x; (void)y;')
  cLines.push('}', '')
}

function emitBleEntrypoints(cLines: string[], defs: CompilerDefinitions): void {
  const bleSI = defs.storeInstances.find(si => defs.stores.get(si.className)?.isBLEServer)
  if (!bleSI) return
  const bleDef = defs.stores.get(bleSI.className)!
  for (const cb of [
    { event: 'connected', method: 'onConnected' },
    { event: 'disconnected', method: 'onDisconnected' },
    { event: 'bound', method: 'onBound' }
  ]) {
    cLines.push(`void gea_embedded_app_ble_${cb.event}(void) {`)
    if (bleDef.methods.some(m => m.name === cb.method)) {
      cLines.push('    batch_begin();')
      cLines.push(`    ${bleSI.cStruct}_${cb.method}();`)
      cLines.push('    batch_end();')
    }
    cLines.push('}', '')
  }
}

function emitRawTouchStubs(cLines: string[], defs: CompilerDefinitions, template: TemplateEmission): void {
  const settings = settingsStore(defs)
  const settingsMethods: Record<string, string> = {
    start: 'handleSwipeStart',
    move: 'handleSwipeMove',
    end: 'handleSwipeEnd'
  }
  for (const event of ['start', 'move', 'end']) {
    cLines.push(`void gea_embedded_app_touch_${event}(int x, int y) {`)
    if (event === 'end' && template.inputBindings.length > 0)
      cLines.push('    gea_embedded_input_blur_for_touch_end(x, y);')
    const settingsMethod = settingsMethods[event]
    if (settings && settingsMethod && storeHasMethod(defs, settings.className, settingsMethod)) {
      cLines.push('    batch_begin();')
      cLines.push(`    ${settings.cStruct}_${settingsMethod}(x, y);`)
      cLines.push('    batch_end();')
    } else {
      cLines.push('    (void)x; (void)y;')
    }
    cLines.push('}', '')
  }
}

function emitSettingsToggleEntrypoint(cLines: string[], defs: CompilerDefinitions): void {
  const settings = settingsStore(defs)
  cLines.push('void gea_embedded_app_settings_toggle(void) {')
  if (settings && storeHasMethod(defs, settings.className, 'toggle')) {
    cLines.push('    batch_begin();')
    cLines.push(`    ${settings.cStruct}_toggle();`)
    cLines.push('    batch_end();')
  }
  cLines.push('}', '')
}

function settingsStore(defs: CompilerDefinitions) {
  const settings = defs.storeInstances.find(si => si.jsVar === 'Settings' && si.className === 'SettingsStore')
  if (!settings) return null
  return defs.initStoreCalls.some(call => call.cCall === `${settings.cStruct}_init`) ? settings : null
}

function storeHasMethod(defs: CompilerDefinitions, className: string, methodName: string): boolean {
  return !!defs.stores.get(className)?.methods.some(m => m.name === methodName)
}

function isFusionLoop(
  forNode: t.ForStatement,
  fieldName: string
): forNode is t.ForStatement & { init: t.VariableDeclaration; body: t.BlockStatement } {
  return !!(
    forNode.init &&
    t.isVariableDeclaration(forNode.init) &&
    forNode.test &&
    t.isBinaryExpression(forNode.test, { operator: '<' }) &&
    t.isMemberExpression(forNode.test.right) &&
    !forNode.test.right.computed &&
    t.isIdentifier(forNode.test.right.property, { name: 'length' }) &&
    t.isMemberExpression(forNode.test.right.object) &&
    !forNode.test.right.object.computed &&
    t.isThisExpression(forNode.test.right.object.object) &&
    t.isIdentifier(forNode.test.right.object.property, { name: fieldName }) &&
    t.isBlockStatement(forNode.body)
  )
}
