import { Audio, BLE, Display, Store, WiFi } from 'gea-embedded'

const SETTINGS_SCREEN_HEIGHT = 502
const SETTINGS_SWIPE_EDGE_PX = 20
const SETTINGS_SWIPE_DISTANCE_PX = 100
const SETTINGS_STATE_REFRESH_MS = 500

class SettingsStore extends Store {
  visible = 0
  screen = 0
  selectedInput = 0
  swipeActive = 0
  swipeStartX = 0
  swipeStartY = 0
  wifiEnabled = 0
  wifiConnected = 0
  bluetoothEnabled = 0
  bluetoothConnected = 0
  bluetoothBound = 0
  deviceName = ''
  bluetoothDisplayName = ''
  volume = 0
  volumeText = ''
  wifiStatus = ''
  bluetoothStatus = ''
  batteryText = ''
  currentNetwork = ''
  ipAddress = ''
  wifiMac = ''
  bluetoothMac = ''
  wifiRssiText = ''
  brightness = 0
  brightnessText = ''
  wifiToggleLabel = ''
  bluetoothToggleLabel = ''
  currentTimestampMs = 0.0
  wifiHoldActive = 0
  wifiHoldTriggered = 0
  wifiHoldOpened = 0
  wifiHoldStartMs = 0.0
  wifiHoldStartX = 0
  wifiHoldStartY = 0
  wifiToggleBlockedUntilMs = 0.0
  networkTapBlockedUntilMs = 0.0
  selectedSsid = ''
  selectedRssiText = ''
  inputPassword = ''
  status = ''

  networkCount = 0
  network0Ssid = ''
  network0Rssi = 0
  network0Secured = 0
  network0RssiText = ''
  network1Ssid = ''
  network1Rssi = 0
  network1Secured = 0
  network1RssiText = ''
  network2Ssid = ''
  network2Rssi = 0
  network2Secured = 0
  network2RssiText = ''
  network3Ssid = ''
  network3Rssi = 0
  network3Secured = 0
  network3RssiText = ''
  network4Ssid = ''
  network4Rssi = 0
  network4Secured = 0
  network4RssiText = ''
  network5Ssid = ''
  network5Rssi = 0
  network5Secured = 0
  network5RssiText = ''
  network6Ssid = ''
  network6Rssi = 0
  network6Secured = 0
  network6RssiText = ''
  network7Ssid = ''
  network7Rssi = 0
  network7Secured = 0
  network7RssiText = ''

  lastScanMs = 0.0
  lastRefreshMs = 0.0

  init() {
    this.visible = 0
    this.screen = 0
    this.swipeActive = 0
    this.swipeStartX = 0
    this.swipeStartY = 0
    this.currentTimestampMs = 0
    this.clearWifiHold()
    this.wifiHoldOpened = 0
    this.wifiToggleBlockedUntilMs = 0
    this.networkTapBlockedUntilMs = 0
    this.lastRefreshMs = 0
    this.status = 'Swipe down from the top edge to open settings'
    this.refresh()
  }

  tick(timestampMs: number) {
    this.currentTimestampMs = timestampMs
    if (!this.visible) return
    if (timestampMs - this.lastRefreshMs >= SETTINGS_STATE_REFRESH_MS) {
      this.lastRefreshMs = timestampMs
      this.refresh()
    }
    if (this.screen == 0 && this.wifiHoldActive && !this.wifiHoldTriggered) {
      if (this.wifiHoldStartMs == 0) this.wifiHoldStartMs = timestampMs
      if (timestampMs - this.wifiHoldStartMs >= 650) {
        this.wifiHoldTriggered = 1
        this.wifiHoldOpened = 1
        this.wifiHoldActive = 0
        this.openWifi()
        return
      }
    }
    if (this.screen != 1) return
    if (this.lastScanMs == 0 || timestampMs - this.lastScanMs > 2000) {
      this.lastScanMs = timestampMs
      WiFi.startScan()
    }
    this.refreshNetworks()
  }

  handleSwipeStart(x: number, y: number) {
    if (!this.visible && y > SETTINGS_SWIPE_EDGE_PX) {
      this.swipeActive = 0
      return
    }
    if (this.visible && y < SETTINGS_SCREEN_HEIGHT - SETTINGS_SWIPE_EDGE_PX) {
      this.swipeActive = 0
      return
    }
    this.swipeActive = 1
    this.swipeStartX = x
    this.swipeStartY = y
  }

  handleSwipeMove(x: number, y: number) {
    if (!this.swipeActive) return
    this.finishSwipe(x, y)
  }

  handleSwipeEnd(x: number, y: number) {
    if (!this.swipeActive) return
    this.finishSwipe(x, y)
    this.swipeActive = 0
  }

  finishSwipe(x: number, y: number) {
    const dx = x - this.swipeStartX
    const dy = y - this.swipeStartY
    if (this.visible) {
      if (dy <= -SETTINGS_SWIPE_DISTANCE_PX && dx >= -96 && dx <= 96) {
        this.close()
        return
      }
      if (dy > 24 || dx < -144 || dx > 144) this.swipeActive = 0
      return
    }
    if (dy >= SETTINGS_SWIPE_DISTANCE_PX && dx >= -96 && dx <= 96) {
      this.open()
      return
    }
    if (dy < -24 || dx < -144 || dx > 144) this.swipeActive = 0
  }

  open() {
    this.visible = 1
    this.screen = 0
    this.swipeActive = 0
    this.clearWifiHold()
    this.wifiHoldOpened = 0
    this.wifiToggleBlockedUntilMs = 0
    this.networkTapBlockedUntilMs = 0
    this.status = 'Swipe up to close'
    this.refresh()
    this.lastRefreshMs = this.currentTimestampMs
  }

  close() {
    this.visible = 0
    this.screen = 0
    this.swipeActive = 0
    this.clearWifiHold()
    this.wifiHoldOpened = 0
    this.wifiToggleBlockedUntilMs = 0
    this.networkTapBlockedUntilMs = 0
    this.status = 'Swipe down from the top edge to open settings'
  }

  toggle() {
    if (this.visible) this.close()
    else this.open()
  }

  absorbTouch() {}

  refresh() {
    this.deviceName = BLE.getDeviceName()
    this.bluetoothDisplayName = BLE.getDeviceName()
    this.volume = Audio.getVolume()
    this.volumeText = this.volume + '%'
    this.brightness = Display.getBrightness()
    this.brightnessText = this.brightness + '%'
    this.wifiMac = WiFi.getMAC()
    this.bluetoothMac = BLE.getMAC()
    this.wifiEnabled = WiFi.isEnabled()
    this.bluetoothEnabled = BLE.isEnabled()
    this.wifiToggleLabel = 'Wi-Fi'
    this.bluetoothToggleLabel = 'Bluetooth'
    this.wifiConnected = this.wifiEnabled ? WiFi.isConnected() : 0
    this.bluetoothConnected = this.bluetoothEnabled ? BLE.isConnected() : 0
    this.bluetoothBound = this.bluetoothEnabled ? BLE.isBound() : 0
    this.batteryText = BLE.getBatteryLevel() + '%'

    if (!this.wifiEnabled) {
      this.wifiStatus = 'Disabled'
      this.currentNetwork = 'Wi-Fi disabled'
      this.ipAddress = '0.0.0.0'
      this.wifiRssiText = 'RSSI unavailable'
    } else if (this.wifiConnected) {
      this.wifiStatus = 'Connected'
      this.currentNetwork = WiFi.getSSID()
      this.ipAddress = WiFi.getIP()
      this.wifiRssiText = 'RSSI ' + WiFi.getRSSI() + 'dBm'
    } else {
      this.wifiStatus = 'Offline'
      this.currentNetwork = 'Not connected'
      this.ipAddress = '0.0.0.0'
      this.wifiRssiText = 'RSSI unavailable'
    }

    if (!this.bluetoothEnabled) this.bluetoothStatus = 'Disabled'
    else if (this.bluetoothConnected) this.bluetoothStatus = 'Connected'
    else if (this.bluetoothBound) this.bluetoothStatus = 'Bound'
    else this.bluetoothStatus = 'Idle'
  }

  refreshNetworks() {
    const count = WiFi.getScanCount()
    this.networkCount = count

    if (count > 0) {
      this.network0Ssid = WiFi.getScanSsidAt(0)
      this.network0Rssi = WiFi.getScanRssiAt(0)
      this.network0Secured = WiFi.getScanSecuredAt(0)
      this.network0RssiText = this.network0Rssi + ' dBm'
    } else {
      this.network0Ssid = ''
      this.network0Rssi = 0
      this.network0Secured = 0
      this.network0RssiText = ''
    }
    if (count > 1) {
      this.network1Ssid = WiFi.getScanSsidAt(1)
      this.network1Rssi = WiFi.getScanRssiAt(1)
      this.network1Secured = WiFi.getScanSecuredAt(1)
      this.network1RssiText = this.network1Rssi + ' dBm'
    } else {
      this.network1Ssid = ''
      this.network1Rssi = 0
      this.network1Secured = 0
      this.network1RssiText = ''
    }
    if (count > 2) {
      this.network2Ssid = WiFi.getScanSsidAt(2)
      this.network2Rssi = WiFi.getScanRssiAt(2)
      this.network2Secured = WiFi.getScanSecuredAt(2)
      this.network2RssiText = this.network2Rssi + ' dBm'
    } else {
      this.network2Ssid = ''
      this.network2Rssi = 0
      this.network2Secured = 0
      this.network2RssiText = ''
    }
    if (count > 3) {
      this.network3Ssid = WiFi.getScanSsidAt(3)
      this.network3Rssi = WiFi.getScanRssiAt(3)
      this.network3Secured = WiFi.getScanSecuredAt(3)
      this.network3RssiText = this.network3Rssi + ' dBm'
    } else {
      this.network3Ssid = ''
      this.network3Rssi = 0
      this.network3Secured = 0
      this.network3RssiText = ''
    }
    if (count > 4) {
      this.network4Ssid = WiFi.getScanSsidAt(4)
      this.network4Rssi = WiFi.getScanRssiAt(4)
      this.network4Secured = WiFi.getScanSecuredAt(4)
      this.network4RssiText = this.network4Rssi + ' dBm'
    } else {
      this.network4Ssid = ''
      this.network4Rssi = 0
      this.network4Secured = 0
      this.network4RssiText = ''
    }
    if (count > 5) {
      this.network5Ssid = WiFi.getScanSsidAt(5)
      this.network5Rssi = WiFi.getScanRssiAt(5)
      this.network5Secured = WiFi.getScanSecuredAt(5)
      this.network5RssiText = this.network5Rssi + ' dBm'
    } else {
      this.network5Ssid = ''
      this.network5Rssi = 0
      this.network5Secured = 0
      this.network5RssiText = ''
    }
    if (count > 6) {
      this.network6Ssid = WiFi.getScanSsidAt(6)
      this.network6Rssi = WiFi.getScanRssiAt(6)
      this.network6Secured = WiFi.getScanSecuredAt(6)
      this.network6RssiText = this.network6Rssi + ' dBm'
    } else {
      this.network6Ssid = ''
      this.network6Rssi = 0
      this.network6Secured = 0
      this.network6RssiText = ''
    }
    if (count > 7) {
      this.network7Ssid = WiFi.getScanSsidAt(7)
      this.network7Rssi = WiFi.getScanRssiAt(7)
      this.network7Secured = WiFi.getScanSecuredAt(7)
      this.network7RssiText = this.network7Rssi + ' dBm'
    } else {
      this.network7Ssid = ''
      this.network7Rssi = 0
      this.network7Secured = 0
      this.network7RssiText = ''
    }
  }

  setVolume(value: number) {
    if (value < 0) value = 0
    if (value > 100) value = 100
    Audio.setVolume(value)
    this.volume = Audio.getVolume()
    this.volumeText = this.volume + '%'
    this.status = 'Volume ' + this.volumeText
  }

  volumeDown() {
    this.setVolume(this.volume - 10)
  }

  volumeUp() {
    this.setVolume(this.volume + 10)
  }

  setBrightness(value: number) {
    if (value < 10) value = 10
    if (value > 100) value = 100
    Display.setBrightness(value)
    this.brightness = Display.getBrightness()
    this.brightnessText = this.brightness + '%'
    this.status = 'Brightness ' + this.brightnessText
  }

  brightnessDown() {
    this.setBrightness(this.brightness - 10)
  }

  brightnessUp() {
    this.setBrightness(this.brightness + 10)
  }

  toggleWifi() {
    if (this.wifiToggleBlockedUntilMs > 0 && this.currentTimestampMs <= this.wifiToggleBlockedUntilMs) {
      this.wifiToggleBlockedUntilMs = 0
      return
    }
    this.wifiToggleBlockedUntilMs = 0
    if (this.wifiEnabled) {
      WiFi.setEnabled(0)
      this.status = 'Wi-Fi disabled'
    } else {
      WiFi.setEnabled(1)
      this.status = 'Wi-Fi enabled'
    }
    this.refresh()
    this.lastRefreshMs = this.currentTimestampMs
  }

  toggleBluetooth() {
    if (this.bluetoothEnabled) {
      BLE.setEnabled(0)
      this.status = 'Bluetooth disabled'
    } else {
      BLE.setEnabled(1)
      this.status = 'Bluetooth enabled'
    }
    this.refresh()
    this.lastRefreshMs = this.currentTimestampMs
  }

  clearWifiHold() {
    this.wifiHoldActive = 0
    this.wifiHoldTriggered = 0
    this.wifiHoldStartMs = 0
    this.wifiHoldStartX = 0
    this.wifiHoldStartY = 0
  }

  startWifiHold(x: number, y: number) {
    if (!this.visible || this.screen != 0) return
    this.wifiHoldActive = 1
    this.wifiHoldTriggered = 0
    this.wifiHoldOpened = 0
    this.wifiHoldStartMs = this.currentTimestampMs
    this.wifiHoldStartX = x
    this.wifiHoldStartY = y
  }

  moveWifiHold(x: number, y: number) {
    if (!this.wifiHoldActive || this.wifiHoldTriggered) return
    const dx = x - this.wifiHoldStartX
    const dy = y - this.wifiHoldStartY
    if (dx > 12 || dx < -12 || dy > 12 || dy < -12) this.clearWifiHold()
  }

  endWifiHold() {
    if (this.wifiHoldOpened) {
      this.wifiToggleBlockedUntilMs = this.currentTimestampMs + 350
      this.networkTapBlockedUntilMs = this.currentTimestampMs + 350
      this.wifiHoldOpened = 0
    }
    this.clearWifiHold()
  }

  openWifi() {
    this.clearWifiHold()
    this.refresh()
    this.screen = 1
    this.selectedInput = 0
    this.selectedSsid = ''
    this.inputPassword = ''
    this.lastScanMs = 0
    if (!this.wifiEnabled) {
      this.status = 'Enable Wi-Fi to scan'
      this.clearNetworks()
      return
    }
    this.status = 'Scanning networks'
    WiFi.startScan()
    this.refreshNetworks()
  }

  clearNetworks() {
    this.networkCount = 0
    this.network0Ssid = ''
    this.network0Rssi = 0
    this.network0Secured = 0
    this.network0RssiText = ''
    this.network1Ssid = ''
    this.network1Rssi = 0
    this.network1Secured = 0
    this.network1RssiText = ''
    this.network2Ssid = ''
    this.network2Rssi = 0
    this.network2Secured = 0
    this.network2RssiText = ''
    this.network3Ssid = ''
    this.network3Rssi = 0
    this.network3Secured = 0
    this.network3RssiText = ''
    this.network4Ssid = ''
    this.network4Rssi = 0
    this.network4Secured = 0
    this.network4RssiText = ''
    this.network5Ssid = ''
    this.network5Rssi = 0
    this.network5Secured = 0
    this.network5RssiText = ''
    this.network6Ssid = ''
    this.network6Rssi = 0
    this.network6Secured = 0
    this.network6RssiText = ''
    this.network7Ssid = ''
    this.network7Rssi = 0
    this.network7Secured = 0
    this.network7RssiText = ''
  }

  showOverview() {
    this.screen = 0
    this.selectedSsid = ''
    this.inputPassword = ''
    this.clearWifiHold()
    this.wifiHoldOpened = 0
    this.networkTapBlockedUntilMs = 0
    this.status = 'Device settings'
    this.refresh()
  }

  tapNetwork(index: number) {
    if (this.networkTapBlockedUntilMs > 0 && this.currentTimestampMs <= this.networkTapBlockedUntilMs) return
    this.networkTapBlockedUntilMs = 0
    if (index == 0 && this.network0Ssid) this.attemptConnect(this.network0Ssid, this.network0Secured, this.network0Rssi)
    else if (index == 1 && this.network1Ssid)
      this.attemptConnect(this.network1Ssid, this.network1Secured, this.network1Rssi)
    else if (index == 2 && this.network2Ssid)
      this.attemptConnect(this.network2Ssid, this.network2Secured, this.network2Rssi)
    else if (index == 3 && this.network3Ssid)
      this.attemptConnect(this.network3Ssid, this.network3Secured, this.network3Rssi)
    else if (index == 4 && this.network4Ssid)
      this.attemptConnect(this.network4Ssid, this.network4Secured, this.network4Rssi)
    else if (index == 5 && this.network5Ssid)
      this.attemptConnect(this.network5Ssid, this.network5Secured, this.network5Rssi)
    else if (index == 6 && this.network6Ssid)
      this.attemptConnect(this.network6Ssid, this.network6Secured, this.network6Rssi)
    else if (index == 7 && this.network7Ssid)
      this.attemptConnect(this.network7Ssid, this.network7Secured, this.network7Rssi)
  }

  attemptConnect(ssid: string, secured: number, rssi: number) {
    if (!secured) {
      this.status = 'Connecting to ' + ssid
      WiFi.configure(ssid, '')
      this.screen = 0
      this.refresh()
      return
    }

    this.selectedSsid = ssid
    this.selectedRssiText = rssi + ' dBm'
    this.inputPassword = ''
    this.selectedInput = 1
    this.screen = 2
    this.status = 'Enter password for ' + ssid
  }

  selectPassword() {
    this.selectedInput = 1
    this.status = 'Editing password'
  }

  updatePassword(value: string) {
    this.inputPassword = value
    this.selectedInput = 1
    this.status = 'Editing password'
  }

  keydown(code: number) {
    if (code == 13) this.connectToSelected()
  }

  connectToSelected() {
    if (!this.selectedSsid) {
      this.status = 'No network selected'
      return
    }
    WiFi.configure(this.selectedSsid, this.inputPassword)
    this.status = 'Connecting to ' + this.selectedSsid
    this.screen = 0
    this.refresh()
  }
}

export const Settings = new SettingsStore()
