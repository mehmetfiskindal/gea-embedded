type WasmModule = {
  ccall: (ident: string, returnType: string | null, argTypes: string[], args: unknown[]) => number
  [name: string]: unknown
}

export const APP_RUNTIME_WASM_EXPORTS = [
  'app_init',
  'app_frame',
  'app_touch',
  'app_touch_start_element',
  'app_touch_end_element',
  'app_touch_move_element',
  'app_hit_test',
  'app_touch_down',
  'app_touch_up',
  'app_touch_start',
  'app_touch_move',
  'app_touch_end',
  'app_mirror_set_int',
  'app_mirror_set_string',
  'app_mirror_set_array_len',
  'app_mirror_set_array_int',
  'app_mirror_set_scroll',
  'app_mirror_commit',
  'app_mirror_get_field_count',
  'app_mirror_get_schema_hash',
  'gea_embedded_imu_web_set_tilt',
  'gea_embedded_wifi_web_set_state',
  'gea_embedded_wifi_web_set_scan_count',
  'gea_embedded_wifi_web_set_scan_entry'
] as const

export function initializeAppRuntime(module: WasmModule, width: number, height: number) {
  const exitCode = module.ccall('app_init', 'number', ['number', 'number'], [width, height])

  if (exitCode !== 0) {
    throw new Error(`WASM app initialization failed with code ${exitCode}`)
  }
}

export function dispatchAppPress(module: WasmModule, pressId: number) {
  module.ccall('app_touch', null, ['number'], [pressId])
  module.ccall('app_frame', null, ['number'], [performance.now()])
}

export function dispatchAppFrame(module: WasmModule) {
  module.ccall('app_frame', null, ['number'], [performance.now()])
}

export function dispatchAppTouchStartElement(module: WasmModule, pressId: number, x: number, y: number) {
  module.ccall('app_touch_start_element', null, ['number', 'number', 'number'], [pressId, x, y])
  module.ccall('app_frame', null, ['number'], [performance.now()])
}

export function dispatchAppTouchEndElement(module: WasmModule, pressId: number, x: number, y: number) {
  module.ccall('app_touch_end_element', null, ['number', 'number', 'number'], [pressId, x, y])
  module.ccall('app_frame', null, ['number'], [performance.now()])
}

export function dispatchAppTouchMoveElement(module: WasmModule, pressId: number, x: number, y: number) {
  module.ccall('app_touch_move_element', null, ['number', 'number', 'number'], [pressId, x, y])
  module.ccall('app_frame', null, ['number'], [performance.now()])
}

export function hitTestApp(module: WasmModule, x: number, y: number) {
  return module.ccall('app_hit_test', 'number', ['number', 'number'], [x, y])
}

export function dispatchTouchDown(module: WasmModule, x: number, y: number) {
  module.ccall('app_touch_down', null, ['number', 'number'], [x, y])
}

export function dispatchTouchUp(module: WasmModule) {
  module.ccall('app_touch_up', 'number', [], [])
}

export function dispatchTouchStart(module: WasmModule, x: number, y: number) {
  module.ccall('app_touch_start', null, ['number', 'number'], [x, y])
}

export function dispatchTouchMove(module: WasmModule, x: number, y: number) {
  module.ccall('app_touch_move', null, ['number', 'number'], [x, y])
}

export function dispatchTouchEnd(module: WasmModule, x: number, y: number) {
  module.ccall('app_touch_end', null, ['number', 'number'], [x, y])
}

function hasWasmExport(module: WasmModule, ident: string) {
  return typeof module[`_${ident}`] === 'function'
}

export function setAppTilt(module: WasmModule, x: number, y: number) {
  if (!hasWasmExport(module, 'gea_embedded_imu_web_set_tilt')) return
  module.ccall('gea_embedded_imu_web_set_tilt', null, ['number', 'number'], [x, y])
}

export function setAppWifi(module: WasmModule, connected: boolean, ssid: string, ip: string, rssi: number) {
  if (!hasWasmExport(module, 'gea_embedded_wifi_web_set_state')) return
  module.ccall(
    'gea_embedded_wifi_web_set_state',
    null,
    ['number', 'string', 'string', 'number'],
    [connected ? 1 : 0, ssid, ip, rssi]
  )
}

export function setAppWifiScan(
  module: WasmModule,
  entries: { ssid: string; rssi: number; secured: number }[]
) {
  if (
    !hasWasmExport(module, 'gea_embedded_wifi_web_set_scan_count') ||
    !hasWasmExport(module, 'gea_embedded_wifi_web_set_scan_entry')
  ) {
    return
  }
  module.ccall('gea_embedded_wifi_web_set_scan_count', null, ['number'], [entries.length])
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    module.ccall(
      'gea_embedded_wifi_web_set_scan_entry',
      null,
      ['number', 'string', 'number', 'number'],
      [i, entry.ssid, entry.rssi, entry.secured]
    )
  }
}

export function setMirrorInt(module: WasmModule, field: number, value: number) {
  module.ccall('app_mirror_set_int', null, ['number', 'number'], [field, value])
}

export function setMirrorString(module: WasmModule, field: number, value: string) {
  module.ccall('app_mirror_set_string', null, ['number', 'string'], [field, value])
}

export function setMirrorArrayLen(module: WasmModule, field: number, len: number) {
  module.ccall('app_mirror_set_array_len', null, ['number', 'number'], [field, len])
}

export function setMirrorArrayInt(module: WasmModule, field: number, index: number, subfield: number, value: number) {
  module.ccall('app_mirror_set_array_int', null, ['number', 'number', 'number', 'number'], [field, index, subfield, value])
}

export function setMirrorScroll(module: WasmModule, node: number, scrollY: number) {
  module.ccall('app_mirror_set_scroll', null, ['number', 'number'], [node, scrollY])
}

export function commitMirrorFrame(module: WasmModule) {
  module.ccall('app_mirror_commit', null, [], [])
}

export function getMirrorSchema(module: WasmModule) {
  return {
    fieldCount: hasWasmExport(module, 'app_mirror_get_field_count')
      ? module.ccall('app_mirror_get_field_count', 'number', [], [])
      : null,
    schemaHash: hasWasmExport(module, 'app_mirror_get_schema_hash')
      ? module.ccall('app_mirror_get_schema_hash', 'number', [], []) >>> 0
      : null
  }
}
