import type { CompilerDefinitions, TemplateEmission } from '../types'
import { emitMethodsAndEntrypoints } from './app'
import { emitBindingRuntime } from './bindings'
import { emitMirrorRuntime } from './mirror'
import { emitRuntimeState, emitStoreDeclarations, emitStoreStateInit, prepareStoreRuntime } from './store-runtime'

export function generateCSource(defs: CompilerDefinitions, template: TemplateEmission): string {
  const cLines: string[] = []
  emitPreamble(cLines, defs, template)
  const runtime = prepareStoreRuntime(defs)
  emitStoreDeclarations(cLines, defs, runtime)
  emitStoreStateInit(cLines, defs)
  emitRuntimeState(cLines, runtime)
  const frameFusion = emitBindingRuntime(cLines, defs, template, runtime)
  emitMethodsAndEntrypoints(cLines, defs, template, runtime, frameFusion)
  emitMirrorRuntime(cLines, defs, runtime)
  return cLines.join('\n') + '\n'
}

function emitPreamble(cLines: string[], defs: CompilerDefinitions, template: TemplateEmission): void {
  const hasBLEServer = defs.storeInstances.some(si => defs.stores.get(si.className)?.isBLEServer)
  const usesBleApi =
    defs.geaEmbeddedImports.has('BLE') ||
    [...defs.geaEmbeddedImports].some(name => name.startsWith('gea_embedded_ble_'))
  const usesImuApi =
    [...defs.geaEmbeddedImports].some(name => name.startsWith('gea_embedded_imu_')) ||
    defs.geaEmbeddedImports.has('Accelerometer') ||
    defs.geaEmbeddedImports.has('accelerometer') ||
    defs.geaEmbeddedImports.has('readAccelerometer') ||
    defs.accelerometerVars.size > 0
  const usesWifiApi =
    defs.geaEmbeddedImports.has('WiFi') ||
    [...defs.geaEmbeddedImports].some(name => name.startsWith('gea_embedded_wifi_'))
  const usesAudioApi =
    defs.geaEmbeddedImports.has('Audio') ||
    defs.geaEmbeddedImports.has('audioContext') ||
    [...defs.geaEmbeddedImports].some(name => name.startsWith('gea_embedded_audio_'))
  const usesDisplayApi =
    defs.geaEmbeddedImports.has('Display') ||
    [...defs.geaEmbeddedImports].some(name => name.startsWith('gea_embedded_display_'))
  const usesAppsApi =
    defs.geaEmbeddedImports.has('Apps') ||
    [...defs.geaEmbeddedImports].some(name => name.startsWith('gea_embedded_apps_'))

  cLines.push('#define GEA_EMBEDDED_PURE_C 1')
  cLines.push('#include "ui/ui.h"')
  cLines.push('#include "ui/internal.h"')
  cLines.push('#include "image.h"')
  cLines.push('#include "gea_embedded_font_generated.h"')
  cLines.push('#include <stdlib.h>')
  cLines.push('#include <stdint.h>')
  cLines.push('#include <math.h>')
  cLines.push('#include <string.h>')
  cLines.push('#include <stdarg.h>')
  cLines.push('#if __has_include("esp_heap_caps.h")')
  cLines.push('#include "esp_heap_caps.h"')
  cLines.push('#endif')
  if (hasBLEServer || usesBleApi) cLines.push('#include "ble.h"')
  if (hasBLEServer) cLines.push('#include "touch.h"')
  if (hasBLEServer || usesImuApi) cLines.push('#include "imu.h"')
  if (usesWifiApi) cLines.push('#include "wifi.h"')
  if (usesAudioApi) cLines.push('#include "audio.h"')
  if (usesDisplayApi) cLines.push('#include "display.h"')
  if (usesAppsApi) cLines.push('#include "apps.h"')
  cLines.push('#include <stdio.h>', '')
  cLines.push('int gea_embedded_now_ms(void);', '')
  emitMathHelpers(cLines)
  emitStringHelpers(cLines)
  if (template.inputBindings.some(input => input.type === 'password')) {
    cLines.push('static int gea_embedded_input_password_reveal_index_for_binding(int input_id);', '')
  }

  const intConstants: [string, number][] = []
  const floatConstants: [string, number][] = []
  for (const [name, value] of defs.moduleConstants) {
    if (typeof value !== 'number') continue
    if (Number.isInteger(value)) intConstants.push([name, value])
    else floatConstants.push([name, value])
  }
  if (intConstants.length > 0) {
    const enumEntries = intConstants.map(([name, value]) => `${name} = ${value}`).join(', ')
    cLines.push(`enum { ${enumEntries} };`, '')
  }
  for (const [name, value] of floatConstants) {
    cLines.push(`#define ${name} (${value})`)
  }
  if (floatConstants.length > 0) cLines.push('')

  emitImageAssets(cLines, defs)
}

function emitImageAssets(cLines: string[], defs: CompilerDefinitions): void {
  if (defs.imageRegistrations.length === 0) return
  for (const reg of defs.imageRegistrations) {
    cLines.push(`static const uint8_t gea_embedded_image_bytes_${reg.id}[${reg.bytes.length}] = {`)
    for (let i = 0; i < reg.bytes.length; i += 16) {
      const slice = reg.bytes.slice(i, i + 16).join(', ')
      cLines.push(`    ${slice}${i + 16 < reg.bytes.length ? ',' : ''}`)
    }
    cLines.push('};')
  }
  cLines.push('')
  cLines.push('static void gea_embedded_register_image_assets(void) {')
  for (const reg of defs.imageRegistrations) {
    cLines.push(`    gea_embedded_image_decode(gea_embedded_image_bytes_${reg.id}, ${reg.bytes.length}, ${reg.id});`)
  }
  cLines.push('}', '')
}

function emitMathHelpers(cLines: string[]): void {
  cLines.push(
    'static double gea_embedded_math_random(void) {',
    '    static int seeded = 0;',
    '    if (!seeded) {',
    '        srand((unsigned)gea_embedded_now_ms());',
    '        seeded = 1;',
    '    }',
    '    return (double)rand() / ((double)RAND_MAX + 1.0);',
    '}',
    ''
  )
}

function emitStringHelpers(cLines: string[]): void {
  cLines.push(
    'static void gea_embedded_string_append(char *dst, size_t dst_size, const char *src) {',
    '    if (!dst || !src || dst_size == 0) return;',
    '    size_t len = strlen(dst);',
    '    if (len >= dst_size - 1) return;',
    '    size_t room = dst_size - len - 1;',
    '    size_t copy = strlen(src);',
    '    if (copy > room) copy = room;',
    '    memcpy(dst + len, src, copy);',
    "    dst[len + copy] = '\\0';",
    '}',
    '',
    'static void gea_embedded_string_append_n(char *dst, size_t dst_size, const char *src, int src_len) {',
    '    if (!dst || !src || dst_size == 0 || src_len <= 0) return;',
    '    size_t len = strlen(dst);',
    '    if (len >= dst_size - 1) return;',
    '    size_t room = dst_size - len - 1;',
    '    size_t copy = (size_t)src_len;',
    '    if (copy > room) copy = room;',
    '    memcpy(dst + len, src, copy);',
    "    dst[len + copy] = '\\0';",
    '}',
    '',
    'static void gea_embedded_string_append_char(char *dst, size_t dst_size, char ch) {',
    '    if (!dst || dst_size == 0) return;',
    '    size_t len = strlen(dst);',
    '    if (len >= dst_size - 1) return;',
    '    dst[len] = ch;',
    "    dst[len + 1] = '\\0';",
    '}',
    '',
    'static char gea_embedded_input_key_to_char(int key_code, int shift_active) {',
    "    if (key_code == 32) return ' ';",
    '    if (key_code >= 48 && key_code <= 57) return (char)key_code;',
    '    if (key_code >= 65 && key_code <= 90) return (char)key_code;',
    '    if (key_code >= 97 && key_code <= 122) return (char)(shift_active ? key_code - 32 : key_code);',
    '    if (key_code >= 33 && key_code <= 126) return (char)key_code;',
    "    return '\\0';",
    '}',
    '',
    'static void gea_embedded_input_apply_text(int node, const char *value, int password, int reveal_index) {',
    '    if (!value) value = "";',
    "    if (value[0] == '\\0') {",
    '        gea_embedded_ui_set_text(node, "");',
    '        gea_embedded_ui_set_style(node, UI_PROP_COLOR, 0xFFFF);',
    '        return;',
    '    }',
    '    if (!password) {',
    '        gea_embedded_ui_set_text(node, value);',
    '        gea_embedded_ui_set_style(node, UI_PROP_COLOR, 0xFFFF);',
    '        return;',
    '    }',
    '    char masked[64];',
    '    size_t len = strlen(value);',
    '    if (len >= sizeof(masked)) len = sizeof(masked) - 1;',
    "    memset(masked, '*', len);",
    '    if (reveal_index >= 0 && reveal_index < (int)len) masked[reveal_index] = value[reveal_index];',
    "    masked[len] = '\\0';",
    '    gea_embedded_ui_set_text(node, masked);',
    '    gea_embedded_ui_set_style(node, UI_PROP_COLOR, 0xFFFF);',
    '}',
    '',
    'static void gea_embedded_input_apply_placeholder(int node, const char *value, const char *placeholder) {',
    '    if (!value) value = "";',
    '    if (!placeholder) placeholder = "";',
    "    if (value[0] == '\\0') {",
    '        gea_embedded_ui_set_text(node, placeholder);',
    '        gea_embedded_ui_set_style(node, UI_PROP_COLOR, 0x73AE);',
    '        return;',
    '    }',
    '    gea_embedded_ui_set_text(node, "");',
    '}',
    ''
  )
}
