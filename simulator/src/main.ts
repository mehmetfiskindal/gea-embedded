import './style.css'

import {
  dispatchAppFrame,
  dispatchAppPress,
  dispatchAppTouchStartElement,
  dispatchAppTouchEndElement,
  dispatchAppTouchMoveElement,
  dispatchTouchDown,
  dispatchTouchEnd,
  dispatchTouchMove,
  dispatchTouchStart,
  dispatchTouchUp,
  hitTestApp,
  initializeAppRuntime,
  setAppTilt,
  setAppWifi,
  setAppWifiScan
} from './app-runtime'
import { loadAppScript, loadModule } from './app-loader'
import { DEFAULT_ZOOM } from './defaults'
import { framebufferView, rgb565ToRgba } from './framebuffer'
import { WEB_APP_IDS, getAppRuntime } from './manifest'
import { initScreenRuntime, type ScreenRuntime } from './screen-runtime'
import { createDeviceMirrorRuntime, type DeviceMirrorRuntime } from './mirror-runtime'

const nativeRAF = window.requestAnimationFrame.bind(window)
const nativeCAF = window.cancelAnimationFrame.bind(window)

type WifiState = {
  connected: boolean
  ssid: string
  ip: string
  rssi: number
}

type WifiScanEntry = {
  ssid: string
  rssi: number
  secured: number
}

type TiltState = {
  x: number
  y: number
}

type SimulatedOscillator = {
  oscillator: OscillatorNode
  connected: boolean
  started: boolean
  stopped: boolean
}

let simulatorAudioContext: AudioContext | undefined
let simulatorAudioGain: GainNode | undefined
let simulatorAudioVolume = 100
let simulatorDisplayBrightness = 100
const simulatorOscillators: SimulatedOscillator[] = []

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
}

function embeddedAudioContext() {
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext
  if (!AudioContextCtor) return undefined
  simulatorAudioContext ||= new AudioContextCtor()
  return simulatorAudioContext
}

function embeddedAudioGain() {
  const ctx = embeddedAudioContext()
  if (!ctx) return undefined
  if (!simulatorAudioGain) {
    simulatorAudioGain = ctx.createGain()
    simulatorAudioGain.gain.value = simulatorAudioVolume / 100
    simulatorAudioGain.connect(ctx.destination)
  }
  return simulatorAudioGain
}

function setEmbeddedAudioVolume(volume: number) {
  simulatorAudioVolume = clampPercent(volume)
  const ctx = simulatorAudioContext
  if (ctx && simulatorAudioGain) simulatorAudioGain.gain.setValueAtTime(simulatorAudioVolume / 100, ctx.currentTime)
}

function setEmbeddedDisplayBrightness(brightness: number) {
  simulatorDisplayBrightness = clampPercent(brightness)
  ;(globalThis as { __gea_embedded_display_brightness?: number }).__gea_embedded_display_brightness =
    simulatorDisplayBrightness
  applyCanvasBrightness()
}

function createEmbeddedOscillator() {
  try {
    const ctx = embeddedAudioContext()
    if (!ctx) return -1
    const id = simulatorOscillators.length
    simulatorOscillators.push({
      oscillator: ctx.createOscillator(),
      connected: false,
      started: false,
      stopped: false
    })
    return id
  } catch {
    return -1
  }
}

const root = document.querySelector<HTMLDivElement>('#app')

if (!root) {
  throw new Error('Missing root element')
}

root.innerHTML = `
  <main class="page">
    <section class="controls">
      <h1>Gea Embedded WASM Simulator</h1>
      <label>
        App
        <select id="app-select">
          ${WEB_APP_IDS.map(appId => `<option value="${appId}">${appId}</option>`).join('')}
        </select>
      </label>
      <label>
        Width
        <input id="width-input" type="number" min="1" step="1" value="410" />
      </label>
      <label>
        Height
        <input id="height-input" type="number" min="1" step="1" value="502" />
      </label>
      <label>
        Zoom
        <input id="zoom-input" type="number" min="1" step="1" value="${DEFAULT_ZOOM}" />
      </label>
      <label>
        Transport
        <select id="transport-select">
          <option value="direct">Direct framebuffer</option>
          <option value="device-mirror">Device mirror</option>
        </select>
      </label>
      <p class="mode-copy">Device mirror receives store diffs from ESP32 hardware and renders them locally.</p>
      <fieldset class="sim-fieldset">
        <legend>Device Mirror</legend>
        <label>
          Board IP
          <input id="mirror-host-input" type="text" value="192.168.4.22" />
        </label>
        <label>
          Port
          <input id="mirror-port-input" type="number" min="1" max="65535" step="1" value="8081" />
        </label>
      </fieldset>
      <fieldset class="sim-fieldset">
        <legend>Wi-Fi</legend>
        <label class="inline-control">
          <input id="wifi-connected-input" type="checkbox" checked />
          Connected
        </label>
        <label>
          SSID
          <input id="wifi-ssid-input" type="text" maxlength="32" value="Gea Lab" />
        </label>
        <label>
          IP
          <input id="wifi-ip-input" type="text" maxlength="15" value="192.168.4.22" />
        </label>
        <label>
          RSSI
          <input id="wifi-rssi-input" type="number" step="1" value="-48" />
        </label>
        <label>
          Available networks
          <textarea id="wifi-scan-input" rows="6" spellcheck="false" placeholder="One per line: SSID:rssi:secured (e.g. Home Wi-Fi:-45:1)">Gea Lab:-48:1
Cafe Free:-62:0
Living Room:-71:1
Studio Mesh:-58:1
Guest Network:-78:0
Neighbor 5G:-82:1
Pixel Hotspot:-67:1
Coffee 2.4:-74:0</textarea>
        </label>
      </fieldset>
      <button id="render-button" type="button">Render</button>
      <p id="status-line" class="status">Idle</p>
    </section>
    <section class="viewer">
      <div class="canvas-shell">
        <canvas id="preview-canvas" width="410" height="502"></canvas>
      </div>
    </section>
  </main>
`

const appSelect = document.querySelector<HTMLSelectElement>('#app-select')!
const widthInput = document.querySelector<HTMLInputElement>('#width-input')!
const heightInput = document.querySelector<HTMLInputElement>('#height-input')!
const zoomInput = document.querySelector<HTMLInputElement>('#zoom-input')!
const transportSelect = document.querySelector<HTMLSelectElement>('#transport-select')!
const mirrorHostInput = document.querySelector<HTMLInputElement>('#mirror-host-input')!
const mirrorPortInput = document.querySelector<HTMLInputElement>('#mirror-port-input')!
const wifiConnectedInput = document.querySelector<HTMLInputElement>('#wifi-connected-input')!
const wifiSsidInput = document.querySelector<HTMLInputElement>('#wifi-ssid-input')!
const wifiIpInput = document.querySelector<HTMLInputElement>('#wifi-ip-input')!
const wifiRssiInput = document.querySelector<HTMLInputElement>('#wifi-rssi-input')!
const wifiScanInput = document.querySelector<HTMLTextAreaElement>('#wifi-scan-input')!
const renderButton = document.querySelector<HTMLButtonElement>('#render-button')!
const statusLine = document.querySelector<HTMLParagraphElement>('#status-line')!
const canvas = document.querySelector<HTMLCanvasElement>('#preview-canvas')!
const context = canvas.getContext('2d')

if (!context) {
  throw new Error('Missing 2D canvas context')
}

const ctx = context
ctx.imageSmoothingEnabled = false

function currentDisplayBrightness() {
  const published = Number(
    (globalThis as { __gea_embedded_display_brightness?: number }).__gea_embedded_display_brightness
  )
  return Number.isFinite(published) ? clampPercent(published) : simulatorDisplayBrightness
}

function applyCanvasBrightness() {
  const brightness = currentDisplayBrightness()
  canvas.style.filter = brightness >= 100 ? '' : `brightness(${brightness}%)`
}

let activeScreenRuntime: ScreenRuntime | null = null
let activeDeviceMirrorRuntime: DeviceMirrorRuntime | null = null
let activeAppRuntime: {
  appId: string
  module: Awaited<ReturnType<typeof loadModule>>
  width: number
  height: number
  zoom: number
} | null = null
let appRafHandle = 0
const tiltKeys = new Set<string>()
let deviceTiltX = 0
let deviceTiltY = 0
let simulatedMouseButtons = 0

function clampTilt(v: number) {
  if (!Number.isFinite(v)) return 0
  return Math.max(-100, Math.min(100, Math.round(v)))
}

function currentKeyboardTilt() {
  let x = 0
  let y = 0
  if (tiltKeys.has('ArrowLeft') || tiltKeys.has('KeyA')) x += 80
  if (tiltKeys.has('ArrowRight') || tiltKeys.has('KeyD')) x -= 80
  if (tiltKeys.has('ArrowUp') || tiltKeys.has('KeyW')) y -= 80
  if (tiltKeys.has('ArrowDown') || tiltKeys.has('KeyS')) y += 80
  return { x, y }
}

function syncTiltToActiveApp() {
  if (!activeAppRuntime) return
  const keyTilt = currentKeyboardTilt()
  const x = keyTilt.x || deviceTiltX
  const y = keyTilt.y || deviceTiltY
  const tilt = { x: clampTilt(x), y: clampTilt(y) }
  setAppTilt(activeAppRuntime.module, tilt.x, tilt.y)
}

function currentTiltState(): TiltState {
  const keyTilt = currentKeyboardTilt()
  return { x: clampTilt(keyTilt.x || deviceTiltX), y: clampTilt(keyTilt.y || deviceTiltY) }
}

function tiltToG(tilt: number) {
  return Math.max(-1, Math.min(1, tilt / 70))
}

function currentAccelerationState() {
  const tilt = currentTiltState()
  const xg = -tiltToG(tilt.y)
  const yg = tiltToG(tilt.x)
  const zg = Math.sqrt(Math.max(0, 1 - xg * xg - yg * yg))
  const g = 9.80665
  return { x: xg * g, y: yg * g, z: zg * g }
}

function currentWifiState(): WifiState {
  const rssi = Number(wifiRssiInput.value)
  return {
    connected: wifiConnectedInput.checked,
    ssid: wifiSsidInput.value.slice(0, 32),
    ip: wifiIpInput.value.slice(0, 15),
    rssi: Number.isFinite(rssi) ? Math.round(rssi) : 0
  }
}

function syncWifiToActiveApp() {
  if (!activeAppRuntime) return
  const wifi = currentWifiState()
  setAppWifi(activeAppRuntime.module, wifi.connected, wifi.ssid, wifi.ip, wifi.rssi)
}

const simulatedWifiMac = '02:00:00:00:00:01'
const simulatedBleMac = '02:00:00:00:00:02'
const simulatedBleDeviceName = 'Gea Embedded BLE'
const simulatedBleBatteryLevel = 82

function getWifiConnected() {
  return currentWifiState().connected ? 1 : 0
}

function getWifiRssi() {
  return currentWifiState().connected ? currentWifiState().rssi : 0
}

function getWifiSsid() {
  return currentWifiState().connected ? currentWifiState().ssid : ''
}

function getWifiIp() {
  return currentWifiState().connected ? currentWifiState().ip : '0.0.0.0'
}

function configureWifi(ssid: string, _password: string) {
  wifiSsidInput.value = String(ssid).slice(0, 32)
  wifiConnectedInput.checked = wifiSsidInput.value.length > 0
  wifiIpInput.value = wifiConnectedInput.checked ? '192.168.4.22' : '0.0.0.0'
  wifiRssiInput.value = wifiConnectedInput.checked ? '-45' : '0'
  syncWifiToActiveApp()
}

function parseScanEntries(text: string): WifiScanEntry[] {
  const out: WifiScanEntry[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const parts = line.split(':')
    const ssid = parts[0]?.trim().slice(0, 32) ?? ''
    if (!ssid) continue
    const rssiPart = parts[1]?.trim()
    const securedPart = parts[2]?.trim()
    let rssi = rssiPart ? Number(rssiPart) : -55
    if (!Number.isFinite(rssi)) rssi = -55
    rssi = Math.max(-100, Math.min(0, Math.round(rssi)))
    const secured = securedPart === '0' || securedPart === 'open' ? 0 : 1
    out.push({ ssid, rssi, secured })
  }
  return out
}

function currentScanEntries(): WifiScanEntry[] {
  const entries = parseScanEntries(wifiScanInput.value)
  return entries.map(e => ({
    ssid: e.ssid,
    rssi: Math.max(-100, Math.min(0, e.rssi + Math.round((Math.random() - 0.5) * 4))),
    secured: e.secured
  }))
}

let lastScanSnapshot: WifiScanEntry[] = []

function refreshScanSnapshot() {
  lastScanSnapshot = currentScanEntries()
}

function syncWifiScanToActiveApp() {
  if (!activeAppRuntime) return
  setAppWifiScan(activeAppRuntime.module, lastScanSnapshot)
}

refreshScanSnapshot()

function readAccelerometer() {
  const acceleration = currentAccelerationState()
  const tilt = currentTiltState()
  return {
    x: acceleration.x,
    y: acceleration.y,
    z: acceleration.z,
    tiltX: tilt.x,
    tiltY: tilt.y,
    mouseButtons: simulatedMouseButtons,
    timestamp: performance.now()
  }
}

Object.defineProperties(globalThis, {
  Accelerometer: {
    value: {
      get x() {
        return currentAccelerationState().x
      },
      get y() {
        return currentAccelerationState().y
      },
      get z() {
        return currentAccelerationState().z
      },
      get tiltX() {
        return currentTiltState().x
      },
      get tiltY() {
        return currentTiltState().y
      },
      get mouseButtons() {
        return simulatedMouseButtons
      },
      get activated() {
        return true
      },
      get hasReading() {
        return true
      },
      get timestamp() {
        return performance.now()
      },
      read: readAccelerometer,
      start: () => undefined,
      stop: () => undefined,
      calibrate: () => undefined,
      startMouse: () => undefined,
      stopMouse: () => undefined,
      setMouseButtons: (buttons: number) => {
        simulatedMouseButtons = buttons
      },
      getMouseButtons: () => simulatedMouseButtons
    },
    configurable: true
  },
  readAccelerometer: {
    value: readAccelerometer,
    configurable: true
  },
  BLE: {
    value: {
      isConnected: () => 0,
      isBound: () => 0,
      getBatteryLevel: () => simulatedBleBatteryLevel,
      getMAC: () => simulatedBleMac,
      getMac: () => simulatedBleMac,
      getDeviceName: () => simulatedBleDeviceName
    },
    configurable: true
  },
  WiFi: {
    value: {
      isConnected: getWifiConnected,
      getRSSI: getWifiRssi,
      getRssi: getWifiRssi,
      getSSID: getWifiSsid,
      getSsid: getWifiSsid,
      getIP: getWifiIp,
      getIp: getWifiIp,
      getMAC: () => simulatedWifiMac,
      getMac: () => simulatedWifiMac,
      configure: configureWifi,
      startScan: () => {
        refreshScanSnapshot()
        syncWifiScanToActiveApp()
      },
      isScanning: () => 0,
      getScanCount: () => lastScanSnapshot.length,
      getScanSsidAt: (index: number) => lastScanSnapshot[index]?.ssid ?? '',
      getScanRssiAt: (index: number) => lastScanSnapshot[index]?.rssi ?? 0,
      getScanSecuredAt: (index: number) => lastScanSnapshot[index]?.secured ?? 0
    },
    configurable: true
  },
  Display: {
    value: {
      getBrightness: () => simulatorDisplayBrightness,
      setBrightness: setEmbeddedDisplayBrightness
    },
    configurable: true
  },
  gea_embedded_imu_init: {
    value: () => undefined,
    configurable: true
  },
  gea_embedded_imu_close: {
    value: () => undefined,
    configurable: true
  },
  gea_embedded_imu_calibrate_bias: {
    value: () => undefined,
    configurable: true
  },
  gea_embedded_imu_start_mouse: {
    value: () => undefined,
    configurable: true
  },
  gea_embedded_imu_stop_mouse: {
    value: () => undefined,
    configurable: true
  },
  gea_embedded_imu_get_tilt_x: {
    value: () => currentTiltState().x,
    configurable: true
  },
  gea_embedded_imu_get_tilt_y: {
    value: () => currentTiltState().y,
    configurable: true
  },
  gea_embedded_imu_get_acceleration_x: {
    value: () => currentAccelerationState().x,
    configurable: true
  },
  gea_embedded_imu_get_acceleration_y: {
    value: () => currentAccelerationState().y,
    configurable: true
  },
  gea_embedded_imu_get_acceleration_z: {
    value: () => currentAccelerationState().z,
    configurable: true
  },
  gea_embedded_imu_set_mouse_buttons: {
    value: (buttons: number) => {
      simulatedMouseButtons = buttons
    },
    configurable: true
  },
  gea_embedded_imu_get_mouse_buttons: {
    value: () => simulatedMouseButtons,
    configurable: true
  },
  gea_embedded_wifi_is_connected: {
    value: getWifiConnected,
    configurable: true
  },
  gea_embedded_wifi_get_rssi: {
    value: getWifiRssi,
    configurable: true
  },
  gea_embedded_wifi_get_ssid: {
    value: getWifiSsid,
    configurable: true
  },
  gea_embedded_wifi_get_ip: {
    value: getWifiIp,
    configurable: true
  },
  gea_embedded_wifi_get_mac: {
    value: () => simulatedWifiMac,
    configurable: true
  },
  gea_embedded_wifi_configure: {
    value: configureWifi,
    configurable: true
  },
  gea_embedded_wifi_start_scan: {
    value: () => {
      refreshScanSnapshot()
      syncWifiScanToActiveApp()
    },
    configurable: true
  },
  gea_embedded_wifi_is_scanning: {
    value: () => 0,
    configurable: true
  },
  gea_embedded_wifi_get_scan_count: {
    value: () => lastScanSnapshot.length,
    configurable: true
  },
  gea_embedded_wifi_get_scan_ssid_at: {
    value: (index: number) => lastScanSnapshot[index]?.ssid ?? '',
    configurable: true
  },
  gea_embedded_wifi_get_scan_rssi_at: {
    value: (index: number) => lastScanSnapshot[index]?.rssi ?? 0,
    configurable: true
  },
  gea_embedded_wifi_get_scan_secured_at: {
    value: (index: number) => lastScanSnapshot[index]?.secured ?? 0,
    configurable: true
  },
  gea_embedded_ble_is_connected: {
    value: () => 0,
    configurable: true
  },
  gea_embedded_ble_is_bound: {
    value: () => 0,
    configurable: true
  },
  gea_embedded_ble_get_battery_level: {
    value: () => simulatedBleBatteryLevel,
    configurable: true
  },
  gea_embedded_ble_get_mac: {
    value: () => simulatedBleMac,
    configurable: true
  },
  gea_embedded_ble_get_device_name: {
    value: () => simulatedBleDeviceName,
    configurable: true
  },
  gea_embedded_audio_context_current_time: {
    value: () => embeddedAudioContext()?.currentTime ?? 0,
    configurable: true
  },
  gea_embedded_audio_context_destination: {
    value: () => 0,
    configurable: true
  },
  gea_embedded_audio_context_create_oscillator: {
    value: createEmbeddedOscillator,
    configurable: true
  },
  gea_embedded_audio_get_volume: {
    value: () => simulatorAudioVolume,
    configurable: true
  },
  gea_embedded_audio_set_volume: {
    value: setEmbeddedAudioVolume,
    configurable: true
  },
  gea_embedded_display_get_brightness: {
    value: () => simulatorDisplayBrightness,
    configurable: true
  },
  gea_embedded_display_set_brightness: {
    value: setEmbeddedDisplayBrightness,
    configurable: true
  },
  gea_embedded_audio_oscillator_set_type: {
    value: (id: number, type: number) => {
      const entry = simulatorOscillators[id]
      if (!entry) return
      entry.oscillator.type = type === 1 ? 'square' : type === 2 ? 'sawtooth' : type === 3 ? 'triangle' : 'sine'
    },
    configurable: true
  },
  gea_embedded_audio_oscillator_get_frequency: {
    value: (id: number) => simulatorOscillators[id]?.oscillator.frequency.value ?? 0,
    configurable: true
  },
  gea_embedded_audio_oscillator_set_frequency: {
    value: (id: number, frequencyHz: number) => {
      const entry = simulatorOscillators[id]
      if (entry) entry.oscillator.frequency.value = frequencyHz
    },
    configurable: true
  },
  gea_embedded_audio_oscillator_frequency_set_value_at_time: {
    value: (id: number, frequencyHz: number, startTime: number) => {
      simulatorOscillators[id]?.oscillator.frequency.setValueAtTime(frequencyHz, startTime)
    },
    configurable: true
  },
  gea_embedded_audio_oscillator_connect: {
    value: (id: number) => {
      const gain = embeddedAudioGain()
      const entry = simulatorOscillators[id]
      if (!gain || !entry || entry.connected) return
      entry.oscillator.connect(gain)
      entry.connected = true
    },
    configurable: true
  },
  gea_embedded_audio_oscillator_start: {
    value: (id: number, when: number) => {
      const ctx = embeddedAudioContext()
      const entry = simulatorOscillators[id]
      if (!ctx || !entry || entry.started) return
      if (ctx.state === 'suspended') void ctx.resume()
      entry.oscillator.start(when)
      entry.started = true
    },
    configurable: true
  },
  gea_embedded_audio_oscillator_stop: {
    value: (id: number, when: number) => {
      const entry = simulatorOscillators[id]
      if (!entry || entry.stopped) return
      entry.oscillator.stop(when)
      entry.stopped = true
    },
    configurable: true
  }
})

function teardownPreviousRuntime() {
  if (activeScreenRuntime) {
    activeScreenRuntime.teardown()
    activeScreenRuntime = null
  }

  if (activeDeviceMirrorRuntime) {
    activeDeviceMirrorRuntime.teardown()
    activeDeviceMirrorRuntime = null
  }

  if (appRafHandle) {
    nativeCAF(appRafHandle)
    appRafHandle = 0
  }
  activeAppRuntime = null
}

function updateCanvasPresentation(width: number, height: number, zoom: number) {
  canvas.width = width
  canvas.height = height
  canvas.style.width = `${width * zoom}px`
  canvas.style.height = `${height * zoom}px`
}

function presentFramebuffer(module: Awaited<ReturnType<typeof loadModule>>, width: number, height: number) {
  const framebufferPtr = module.ccall('get_framebuffer_ptr', 'number', [], [])
  const framebufferWidth = module.ccall('get_framebuffer_width', 'number', [], [])
  const framebufferHeight = module.ccall('get_framebuffer_height', 'number', [], [])
  const strideBytes = module.ccall('get_framebuffer_stride_bytes', 'number', [], [])

  if (framebufferWidth !== width || framebufferHeight !== height || strideBytes !== width * 2) {
    throw new Error('Unexpected framebuffer geometry returned from WASM module')
  }

  const pixels = framebufferView(module.HEAPU8, framebufferPtr, framebufferWidth, framebufferHeight)
  const rgba = rgb565ToRgba(new Uint16Array(pixels))
  const imageData = new ImageData(new Uint8ClampedArray(rgba), framebufferWidth, framebufferHeight)
  ctx.putImageData(imageData, 0, 0)
  applyCanvasBrightness()
}

async function runAppRender(appId: string, width: number, height: number, zoom: number) {
  const module = await loadModule(appId)
  initializeAppRuntime(module, width, height)
  presentFramebuffer(module, width, height)

  activeAppRuntime = { appId, module, width, height, zoom }
  syncWifiToActiveApp()
  refreshScanSnapshot()
  syncWifiScanToActiveApp()

  function frameLoop(timestampMs: number) {
    if (!activeAppRuntime) return
    syncTiltToActiveApp()
    activeAppRuntime.module.ccall('app_frame', null, ['number'], [timestampMs])
    presentFramebuffer(activeAppRuntime.module, activeAppRuntime.width, activeAppRuntime.height)
    appRafHandle = nativeRAF(frameLoop)
  }
  appRafHandle = nativeRAF(frameLoop)

  statusLine.textContent = `Running ${appId} at ${width}x${height} with ${zoom}x zoom.`
}

async function runDeviceMirrorAppRender(appId: string, width: number, height: number, zoom: number) {
  const host = mirrorHostInput.value.trim()
  const port = Math.round(Number(mirrorPortInput.value || 8081))
  if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) {
    statusLine.textContent = 'Device mirror needs a board IP and valid port.'
    return
  }

  let activeAppId = appId
  statusLine.textContent = `Starting device mirror for ${activeAppId} from ${host}:${port}...`
  activeDeviceMirrorRuntime = await createDeviceMirrorRuntime({
    appId,
    width,
    height,
    ctx,
    host,
    port,
    onStatus(status) {
      statusLine.textContent = `Device mirror ${activeAppId}: ${status.message}`
    },
    onStats(stats) {
      if (stats.type === 'error') return
      statusLine.textContent = `Device mirror ${activeAppId}: ${stats.type}, ${stats.fieldCount} field${stats.fieldCount === 1 ? '' : 's'}, ${stats.itemCount} item${stats.itemCount === 1 ? '' : 's'}.`
    },
    onAppIdChange(nextAppId) {
      activeAppId = nextAppId
      if (WEB_APP_IDS.includes(nextAppId)) appSelect.value = nextAppId
      statusLine.textContent = `Device mirror tracking ${nextAppId} on ${host}:${port}.`
    }
  })
  statusLine.textContent = `Device mirror ${activeAppId} waiting for ${host}:${port}...`
}

async function runScreenApp(appId: string, width: number, height: number, zoom: number) {
  activeScreenRuntime = await initScreenRuntime(width, height, ctx)

  await loadAppScript(appId, `${Date.now()}`)

  activeScreenRuntime.presentFramebuffer()

  statusLine.textContent = `Running ${appId} at ${width}x${height} with ${zoom}x zoom.`
}

async function renderSelectedApp() {
  const appId = appSelect.value
  const width = Number(widthInput.value)
  const height = Number(heightInput.value)
  const zoom = Math.max(1, Number(zoomInput.value))

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    statusLine.textContent = 'Viewport must be positive.'
    return
  }

  teardownPreviousRuntime()

  statusLine.textContent = `Loading ${appId}...`
  updateCanvasPresentation(width, height, zoom)

  const runtime = getAppRuntime(appId)
  const transport = transportSelect.value

  if (runtime === 'screen') {
    await runScreenApp(appId, width, height, zoom)
    if (transport !== 'direct') {
      statusLine.textContent = `Running ${appId} directly. Device mirror is available for app-render apps.`
    }
  } else if (transport === 'device-mirror') {
    await runDeviceMirrorAppRender(appId, width, height, zoom)
  } else {
    await runAppRender(appId, width, height, zoom)
  }
}

renderButton.addEventListener('click', () => {
  void renderSelectedApp()
})

window.addEventListener('gea-embedded-launch-app', event => {
  const appId = (event as CustomEvent<{ appId?: string }>).detail?.appId
  if (!appId || !WEB_APP_IDS.includes(appId)) {
    statusLine.textContent = appId ? `Unknown app "${appId}".` : 'Launch request did not include an app id.'
    return
  }

  statusLine.textContent = `Loading ${appId}...`
  window.setTimeout(() => {
    appSelect.value = appId
    void renderSelectedApp()
  }, 0)
})

function getActiveAppViewport() {
  if (activeAppRuntime) return { width: activeAppRuntime.width, height: activeAppRuntime.height }
  return null
}

let pointerLastX = 0
let pointerLastY = 0
let pointerStartX = 0
let pointerStartY = 0
let pointerIsDown = false
let pointerActivePressId = -1
let pointerDragged = false

canvas.addEventListener('pointerdown', event => {
  const viewport = getActiveAppViewport()
  if (!viewport) return
  syncTiltToActiveApp()
  pointerIsDown = true
  const rect = canvas.getBoundingClientRect()
  pointerLastX = Math.floor((event.clientX - rect.left) * (viewport.width / rect.width))
  pointerLastY = Math.floor((event.clientY - rect.top) * (viewport.height / rect.height))
  pointerStartX = pointerLastX
  pointerStartY = pointerLastY
  pointerDragged = false
  if (!activeAppRuntime) return
  dispatchTouchDown(activeAppRuntime.module, pointerLastX, pointerLastY)
  dispatchTouchStart(activeAppRuntime.module, pointerLastX, pointerLastY)
  const pressId = hitTestApp(activeAppRuntime.module, pointerLastX, pointerLastY)
  if (pressId >= 0) {
    pointerActivePressId = pressId
    dispatchAppTouchStartElement(activeAppRuntime.module, pressId, pointerLastX, pointerLastY)
  }
  presentFramebuffer(activeAppRuntime.module, activeAppRuntime.width, activeAppRuntime.height)
})

canvas.addEventListener('pointermove', event => {
  const viewport = getActiveAppViewport()
  if (!viewport || !pointerIsDown) return
  syncTiltToActiveApp()
  const rect = canvas.getBoundingClientRect()
  const x = Math.floor((event.clientX - rect.left) * (viewport.width / rect.width))
  const y = Math.floor((event.clientY - rect.top) * (viewport.height / rect.height))
  if (x !== pointerLastX || y !== pointerLastY) {
    if (!pointerDragged && (Math.abs(x - pointerStartX) > 10 || Math.abs(y - pointerStartY) > 10)) pointerDragged = true
    pointerLastX = x
    pointerLastY = y
    if (!activeAppRuntime) return
    dispatchTouchMove(activeAppRuntime.module, x, y)
    if (pointerActivePressId >= 0) {
      dispatchAppTouchMoveElement(activeAppRuntime.module, pointerActivePressId, x, y)
    }
    presentFramebuffer(activeAppRuntime.module, activeAppRuntime.width, activeAppRuntime.height)
  }
})

canvas.addEventListener('pointerup', () => {
  if (!activeAppRuntime) return
  syncTiltToActiveApp()
  pointerIsDown = false
  dispatchTouchUp(activeAppRuntime.module)
  dispatchAppFrame(activeAppRuntime.module)
  dispatchTouchEnd(activeAppRuntime.module, pointerLastX, pointerLastY)
  if (pointerActivePressId >= 0) {
    dispatchAppTouchEndElement(activeAppRuntime.module, pointerActivePressId, pointerLastX, pointerLastY)
  }
  if (!pointerDragged) {
    const pressId = hitTestApp(activeAppRuntime.module, pointerLastX, pointerLastY)
    if (pressId >= 0) {
      dispatchAppPress(activeAppRuntime.module, pressId)
    }
  }
  pointerActivePressId = -1
  pointerDragged = false
  presentFramebuffer(activeAppRuntime.module, activeAppRuntime.width, activeAppRuntime.height)
})

appSelect.addEventListener('change', () => {
  void renderSelectedApp()
})

transportSelect.addEventListener('change', () => {
  void renderSelectedApp()
})

for (const input of [wifiConnectedInput, wifiSsidInput, wifiIpInput, wifiRssiInput]) {
  input.addEventListener('input', syncWifiToActiveApp)
  input.addEventListener('change', syncWifiToActiveApp)
}

function applyScanSidebar() {
  refreshScanSnapshot()
  syncWifiScanToActiveApp()
}
wifiScanInput.addEventListener('input', applyScanSidebar)
wifiScanInput.addEventListener('change', applyScanSidebar)

window.addEventListener('keydown', event => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS'].includes(event.code)) {
    tiltKeys.add(event.code)
    syncTiltToActiveApp()
  }
})

window.addEventListener('keyup', event => {
  if (tiltKeys.delete(event.code)) {
    syncTiltToActiveApp()
  }
})

window.addEventListener('deviceorientation', event => {
  if (typeof event.gamma === 'number') deviceTiltX = clampTilt(event.gamma * 3)
  if (typeof event.beta === 'number') deviceTiltY = clampTilt((event.beta - 35) * 2)
  syncTiltToActiveApp()
})

void renderSelectedApp()
