import type { CompilerDefinitions, TemplateEmission } from './types'

export function generateThinJs(defs: CompilerDefinitions, template: TemplateEmission): string {
  const jsLines: string[] = []
  emitImageAssetConstants(jsLines, defs)
  emitNativeSingletons(jsLines, defs)
  emitStoreClasses(jsLines, defs)
  emitJsBindings(jsLines, template)
  emitOnPressDispatcher(jsLines, template)
  jsLines.push('__gea_embedded_mount()', '')
  if (defs.rafCallSrc) jsLines.push(defs.rafCallSrc, '')
  return jsLines.join('\n')
}

function emitImageAssetConstants(jsLines: string[], defs: CompilerDefinitions): void {
  if (defs.imageRegistrations.length === 0) return
  for (const reg of defs.imageRegistrations) {
    jsLines.push(`const ${reg.jsName} = ${reg.id}`)
  }
  jsLines.push('')
}

function emitNativeSingletons(jsLines: string[], defs: CompilerDefinitions): void {
  if (defs.geaEmbeddedImports.has('Accelerometer')) {
    jsLines.push('const Accelerometer = {')
    jsLines.push('  get x() { return gea_embedded_imu_get_acceleration_x() },')
    jsLines.push('  get y() { return gea_embedded_imu_get_acceleration_y() },')
    jsLines.push('  get z() { return gea_embedded_imu_get_acceleration_z() },')
    jsLines.push('  get tiltX() { return gea_embedded_imu_get_tilt_x() },')
    jsLines.push('  get tiltY() { return gea_embedded_imu_get_tilt_y() },')
    jsLines.push('  get mouseButtons() { return gea_embedded_imu_get_mouse_buttons() },')
    jsLines.push('  get activated() { return true },')
    jsLines.push('  get hasReading() { return true },')
    jsLines.push('  get timestamp() { return 0 },')
    jsLines.push(
      '  read: () => ({ x: gea_embedded_imu_get_acceleration_x(), y: gea_embedded_imu_get_acceleration_y(), z: gea_embedded_imu_get_acceleration_z(), tiltX: gea_embedded_imu_get_tilt_x(), tiltY: gea_embedded_imu_get_tilt_y(), mouseButtons: gea_embedded_imu_get_mouse_buttons(), timestamp: 0 }),'
    )
    jsLines.push('  start: () => gea_embedded_imu_init(),')
    jsLines.push('  stop: () => gea_embedded_imu_close(),')
    jsLines.push('  calibrate: () => gea_embedded_imu_calibrate_bias(),')
    jsLines.push('  startMouse: () => gea_embedded_imu_start_mouse(),')
    jsLines.push('  stopMouse: () => gea_embedded_imu_stop_mouse(),')
    jsLines.push('  setMouseButtons: buttons => gea_embedded_imu_set_mouse_buttons(buttons),')
    jsLines.push('  getMouseButtons: () => gea_embedded_imu_get_mouse_buttons()')
    jsLines.push('}', '')
  }

  if (defs.geaEmbeddedImports.has('BLE')) {
    jsLines.push('const BLE = {')
    jsLines.push('  isEnabled: () => gea_embedded_ble_is_enabled(),')
    jsLines.push('  setEnabled: enabled => gea_embedded_ble_set_enabled(enabled),')
    jsLines.push('  isConnected: () => gea_embedded_ble_is_connected(),')
    jsLines.push('  isBound: () => gea_embedded_ble_is_bound(),')
    jsLines.push('  getBatteryLevel: () => gea_embedded_ble_get_battery_level(),')
    jsLines.push('  getMAC: () => gea_embedded_ble_get_mac(),')
    jsLines.push('  getMac: () => gea_embedded_ble_get_mac(),')
    jsLines.push('  getDeviceName: () => gea_embedded_ble_get_device_name()')
    jsLines.push('}', '')
  }

  if (defs.geaEmbeddedImports.has('Audio')) {
    jsLines.push('const Audio = {')
    jsLines.push('  getVolume: () => gea_embedded_audio_get_volume(),')
    jsLines.push('  setVolume: volume => gea_embedded_audio_set_volume(volume)')
    jsLines.push('}', '')
  }

  if (defs.geaEmbeddedImports.has('Display')) {
    jsLines.push('const Display = {')
    jsLines.push('  getBrightness: () => gea_embedded_display_get_brightness(),')
    jsLines.push('  setBrightness: brightness => gea_embedded_display_set_brightness(brightness)')
    jsLines.push('}', '')
  }

  if (defs.geaEmbeddedImports.has('Apps')) {
    jsLines.push('const Apps = {')
    jsLines.push('  launch: appId => gea_embedded_apps_launch(appId)')
    jsLines.push('}', '')
  }

  if (defs.geaEmbeddedImports.has('WiFi')) {
    jsLines.push('const WiFi = {')
    jsLines.push('  isEnabled: () => gea_embedded_wifi_is_enabled(),')
    jsLines.push('  setEnabled: enabled => gea_embedded_wifi_set_enabled(enabled),')
    jsLines.push('  isConnected: () => gea_embedded_wifi_is_connected(),')
    jsLines.push('  getRSSI: () => gea_embedded_wifi_get_rssi(),')
    jsLines.push('  getRssi: () => gea_embedded_wifi_get_rssi(),')
    jsLines.push('  getSSID: () => gea_embedded_wifi_get_ssid(),')
    jsLines.push('  getSsid: () => gea_embedded_wifi_get_ssid(),')
    jsLines.push('  getIP: () => gea_embedded_wifi_get_ip(),')
    jsLines.push('  getIp: () => gea_embedded_wifi_get_ip(),')
    jsLines.push('  getMAC: () => gea_embedded_wifi_get_mac(),')
    jsLines.push('  getMac: () => gea_embedded_wifi_get_mac(),')
    jsLines.push('  configure: (ssid, password) => gea_embedded_wifi_configure(ssid, password),')
    jsLines.push('  startScan: () => gea_embedded_wifi_start_scan(),')
    jsLines.push('  isScanning: () => gea_embedded_wifi_is_scanning(),')
    jsLines.push('  getScanCount: () => gea_embedded_wifi_get_scan_count(),')
    jsLines.push('  getScanSsidAt: index => gea_embedded_wifi_get_scan_ssid_at(index),')
    jsLines.push('  getScanRssiAt: index => gea_embedded_wifi_get_scan_rssi_at(index),')
    jsLines.push('  getScanSecuredAt: index => gea_embedded_wifi_get_scan_secured_at(index)')
    jsLines.push('}', '')
  }

  if (defs.geaEmbeddedImports.has('audioContext')) {
    jsLines.push('const audioContext = {')
    jsLines.push('  get currentTime() { return gea_embedded_audio_context_current_time() },')
    jsLines.push('  get destination() { return gea_embedded_audio_context_destination() },')
    jsLines.push('  createOscillator() {')
    jsLines.push('    const id = gea_embedded_audio_context_create_oscillator()')
    jsLines.push('    return {')
    jsLines.push('      get type() { return "sine" },')
    jsLines.push(
      '      set type(value) { gea_embedded_audio_oscillator_set_type(id, value === "square" ? 1 : value === "sawtooth" ? 2 : value === "triangle" ? 3 : 0) },'
    )
    jsLines.push('      frequency: {')
    jsLines.push('        get value() { return gea_embedded_audio_oscillator_get_frequency(id) },')
    jsLines.push('        set value(value) { gea_embedded_audio_oscillator_set_frequency(id, value) },')
    jsLines.push(
      '        setValueAtTime(value, startTime) { gea_embedded_audio_oscillator_frequency_set_value_at_time(id, value, startTime) }'
    )
    jsLines.push('      },')
    jsLines.push(
      '      connect(destination) { gea_embedded_audio_oscillator_connect(id, destination); return destination },'
    )
    jsLines.push('      start(when = audioContext.currentTime) { gea_embedded_audio_oscillator_start(id, when) },')
    jsLines.push('      stop(when = audioContext.currentTime) { gea_embedded_audio_oscillator_stop(id, when) }')
    jsLines.push('    }')
    jsLines.push('  }')
    jsLines.push('}', '')
  }
}

function emitStoreClasses(jsLines: string[], defs: CompilerDefinitions): void {
  for (let siIdx = 0; siIdx < defs.storeInstances.length; siIdx++) {
    const si = defs.storeInstances[siIdx]
    const storeDef = defs.stores.get(si.className)!
    jsLines.push(`class ${si.className} {`)
    jsLines.push('  constructor() {')
    jsLines.push(`    __gea_embedded_store_init_${siIdx}.call(this)`)
    jsLines.push('  }')
    for (const method of storeDef.methods) emitStoreMethod(jsLines, method.src)
    jsLines.push('}', '')
    jsLines.push(`const ${si.jsVar} = new ${si.className}()`, '')
  }
}

function emitStoreMethod(jsLines: string[], methodSrc: string): void {
  const methodMatch = methodSrc.match(/^(\s*(?:async\s+)?)([\w]+)\s*\(([^)]*)\)\s*(?::\s*\w+\s*)?\{([\s\S]*)\}\s*$/)
  if (!methodMatch) return
  const [, prefix, mName, rawParams, body] = methodMatch
  const params = rawParams.replace(/:\s*\w+(\[\])?/g, '')
  jsLines.push(`  ${prefix.trim()}${prefix.trim() ? ' ' : ''}${mName}(${params}) {`)
  jsLines.push('    __gea_embedded_batch_begin()')
  jsLines.push('    try {')
  jsLines.push(`      ${body.trim()}`)
  jsLines.push('    } finally {')
  jsLines.push('      __gea_embedded_batch_end()')
  jsLines.push('    }')
  jsLines.push('  }')
}

function emitJsBindings(jsLines: string[], template: TemplateEmission): void {
  for (const b of template.bindings) {
    if (!b.jsExpr) continue
    jsLines.push(`globalThis.__binding_${b.id} = function() {`)
    jsLines.push(`  return ${b.jsExpr}`)
    jsLines.push('}', '')
  }
}

function emitOnPressDispatcher(jsLines: string[], template: TemplateEmission): void {
  const handlers = template.onPressHandlers
  if (handlers.length === 0) return
  const allSamePattern =
    handlers.length > 1 &&
    handlers.every(h => h.jsBody.replace(/\d+/g, 'N') === handlers[0].jsBody.replace(/\d+/g, 'N'))
  if (allSamePattern) {
    jsLines.push('globalThis.__on_press = function(id) {')
    jsLines.push(`  ${handlers[0].jsBody.replace(/\b\d+\b/, 'id')}`)
    jsLines.push('}')
  } else {
    jsLines.push('globalThis.__on_press = function(id) {')
    jsLines.push('  switch(id) {')
    for (const group of groupedJsHandlers(handlers)) {
      for (const pressId of group.pressIds) jsLines.push(`    case ${pressId}:`)
      jsLines.push(`      ${group.jsBody}`)
      jsLines.push('      break')
    }
    jsLines.push('  }')
    jsLines.push('}')
  }
  jsLines.push('')
}

function groupedJsHandlers(handlers: TemplateEmission['onPressHandlers']): { jsBody: string; pressIds: number[] }[] {
  const groups = new Map<string, { jsBody: string; pressIds: number[] }>()
  for (const h of handlers) {
    if (!groups.has(h.jsBody)) groups.set(h.jsBody, { jsBody: h.jsBody, pressIds: [] })
    groups.get(h.jsBody)!.pressIds.push(h.pressId)
  }
  return [...groups.values()].map(group => ({ ...group, pressIds: [...new Set(group.pressIds)] }))
}
