export const NATIVE_SINGLETON_METHODS: Record<string, Record<string, string>> = {
  BLE: {
    isEnabled: 'gea_embedded_ble_is_enabled',
    setEnabled: 'gea_embedded_ble_set_enabled',
    isConnected: 'gea_embedded_ble_is_connected',
    isBound: 'gea_embedded_ble_is_bound',
    getBatteryLevel: 'gea_embedded_ble_get_battery_level',
    getMAC: 'gea_embedded_ble_get_mac',
    getMac: 'gea_embedded_ble_get_mac',
    getDeviceName: 'gea_embedded_ble_get_device_name'
  },
  Audio: {
    getVolume: 'gea_embedded_audio_get_volume',
    setVolume: 'gea_embedded_audio_set_volume'
  },
  Display: {
    getBrightness: 'gea_embedded_display_get_brightness',
    setBrightness: 'gea_embedded_display_set_brightness'
  },
  Apps: {
    launch: 'gea_embedded_apps_launch'
  },
  WiFi: {
    isEnabled: 'gea_embedded_wifi_is_enabled',
    setEnabled: 'gea_embedded_wifi_set_enabled',
    isConnected: 'gea_embedded_wifi_is_connected',
    getRSSI: 'gea_embedded_wifi_get_rssi',
    getRssi: 'gea_embedded_wifi_get_rssi',
    getSSID: 'gea_embedded_wifi_get_ssid',
    getSsid: 'gea_embedded_wifi_get_ssid',
    getIP: 'gea_embedded_wifi_get_ip',
    getIp: 'gea_embedded_wifi_get_ip',
    getMAC: 'gea_embedded_wifi_get_mac',
    getMac: 'gea_embedded_wifi_get_mac',
    configure: 'gea_embedded_wifi_configure',
    startScan: 'gea_embedded_wifi_start_scan',
    isScanning: 'gea_embedded_wifi_is_scanning',
    getScanCount: 'gea_embedded_wifi_get_scan_count',
    getScanSsidAt: 'gea_embedded_wifi_get_scan_ssid_at',
    getScanRssiAt: 'gea_embedded_wifi_get_scan_rssi_at',
    getScanSecuredAt: 'gea_embedded_wifi_get_scan_secured_at'
  }
}

export const NATIVE_STRING_RETURN_FUNCS = new Set([
  'gea_embedded_wifi_get_ssid',
  'gea_embedded_wifi_get_ip',
  'gea_embedded_wifi_get_mac',
  'gea_embedded_wifi_get_scan_ssid_at',
  'gea_embedded_ble_get_mac',
  'gea_embedded_ble_get_device_name'
])

export function nativeSingletonMethodCName(objectName: string, methodName: string): string | undefined {
  return NATIVE_SINGLETON_METHODS[objectName]?.[methodName]
}
