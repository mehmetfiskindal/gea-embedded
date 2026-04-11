declare global {
  namespace JSX {
    interface Element {}
    interface ElementChildrenAttribute {
      children: {}
    }
    interface IntrinsicElements {
      div: import('gea-embedded').ViewProps
      span: import('gea-embedded').TextProps
      p: import('gea-embedded').ViewProps
      h1: import('gea-embedded').ViewProps
      h2: import('gea-embedded').ViewProps
      h3: import('gea-embedded').ViewProps
      h4: import('gea-embedded').ViewProps
      h5: import('gea-embedded').ViewProps
      h6: import('gea-embedded').ViewProps
      input: import('gea-embedded').InputElementProps
    }
  }
}

export type StyleLength = number | `${number}px`
export type StyleBox = StyleLength | string

export interface EmbeddedDefaults {
  display: {
    flushChunkRows?: number
    flushQueueDepth?: number
  }
  mirror?: boolean
  wifi?: boolean
}

export declare const defaults: EmbeddedDefaults

export interface Style {
  display?: 'flex' | 'none'
  flexDirection?: 'row' | 'column'
  flexWrap?: 'nowrap' | 'wrap'
  justifyContent?: 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around'
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch'
  alignSelf?: 'auto' | 'flex-start' | 'center' | 'flex-end' | 'stretch'
  gap?: StyleLength
  width?: StyleLength
  height?: StyleLength
  minWidth?: StyleLength
  minHeight?: StyleLength
  maxWidth?: StyleLength
  maxHeight?: StyleLength
  flex?: number
  padding?: StyleBox
  paddingTop?: StyleLength
  paddingRight?: StyleLength
  paddingBottom?: StyleLength
  paddingLeft?: StyleLength
  margin?: StyleBox
  marginTop?: StyleLength
  marginRight?: StyleLength
  marginBottom?: StyleLength
  marginLeft?: StyleLength
  position?: 'relative' | 'absolute'
  top?: StyleLength
  left?: StyleLength
  right?: StyleLength
  bottom?: StyleLength
  zIndex?: number
  backgroundColor?: string
  color?: string
  opacity?: number
  blinkInterval?: number
  borderWidth?: StyleLength
  borderColor?: string
  borderRadius?: StyleBox
  borderTopLeftRadius?: StyleLength
  borderTopRightRadius?: StyleLength
  borderBottomRightRadius?: StyleLength
  borderBottomLeftRadius?: StyleLength
  fontFamily?: string
  fontSize?: StyleLength
  textAlign?: 'left' | 'center' | 'right'
  overflow?: 'visible' | 'hidden' | 'scroll'
  transform?: string | number
  rotate?: string | number
  transformOrigin?: string
}

export interface DataAttributes {
  [name: `data-${string}`]: string | number | boolean | undefined
}

export interface PressEventTarget {
  dataset: Record<string, any>
  getAttribute(name: string): any
}

export interface PressEvent {
  pressId: number
  target: PressEventTarget
  currentTarget: PressEventTarget
}

export type PressEventArgument = number & PressEvent
export type PressHandler = (event: PressEventArgument) => void

export interface InputEventTarget {
  value: string
}

export interface InputEvent {
  target: InputEventTarget
  currentTarget: InputEventTarget
}

export interface KeyEvent {
  keyCode: number
  which: number
}

export interface ViewProps extends DataAttributes {
  class?: string
  style?: Style
  pressId?: number
  pressValue?: number
  onPress?: PressHandler
  onClick?: PressHandler
  onTouchStart?: (x: number, y: number) => void
  onTouchEnd?: (x: number, y: number) => void
  onTouchMove?: (x: number, y: number) => void
  children?: any
}

export interface TextProps {
  class?: string
  style?: Style
  children?: any
}

export type ImageSource = string | ArrayBuffer | Uint8Array | GeaEmbeddedImage

export interface ImageProps {
  src: ImageSource
  style?: Style
  fit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down'
  playing?: boolean
  loop?: number | 'infinite'
  onLoad?: () => void
  onError?: (error: string) => void
  onFrame?: (frame: number) => void
}

export interface GeaEmbeddedImage {
  readonly width: number
  readonly height: number
  readonly frameCount: number
  readonly isAnimated: boolean
  play(): void
  pause(): void
  seek(frame: number): void
  dispose(): void
}

export declare function loadImage(src: string | ArrayBuffer | Uint8Array): Promise<GeaEmbeddedImage>

export class Store {}

export class BLEServer extends Store {
  onConnected(): void
  onDisconnected(): void
  onBound(): void
  startAdvertising(): void
  stopAdvertising(): void
}

export class Component {
  template(...args: any[]): any
}

export interface BLEController {
  isEnabled(): number
  setEnabled(enabled: number): void
  isConnected(): number
  isBound(): number
  getBatteryLevel(): number
  getMAC(): string
  getMac(): string
  getDeviceName(): string
}

export declare const BLE: BLEController

export interface AudioController {
  getVolume(): number
  setVolume(volume: number): void
}

export declare const Audio: AudioController

export interface DisplayController {
  getBrightness(): number
  setBrightness(brightness: number): void
}

export declare const Display: DisplayController

export interface AppsController {
  launch(appId: string): number
}

export declare const Apps: AppsController

export declare function gea_embedded_ble_key_tap(hidCode: number): void
export declare function gea_embedded_ble_key_down(modifier: number, hidCode: number): void
export declare function gea_embedded_ble_key_up(): void
export declare function gea_embedded_ble_mouse_move(dx: number, dy: number, buttons: number, wheel: number): void
export declare function gea_embedded_ble_mouse_click(button: number): void

export type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle'

export interface AudioParam {
  value: number
  setValueAtTime(value: number, startTime: number): void
}

export interface AudioDestinationNode {}

export interface OscillatorNode {
  type: OscillatorType
  frequency: AudioParam
  connect(destination: AudioDestinationNode): AudioDestinationNode
  start(when?: number): void
  stop(when?: number): void
}

export interface AudioContext {
  readonly currentTime: number
  readonly destination: AudioDestinationNode
  createOscillator(): OscillatorNode
}

export declare const audioContext: AudioContext

export interface AccelerometerReading {
  x: number
  y: number
  z: number
  tiltX: number
  tiltY: number
  mouseButtons: number
  timestamp: number
}

export interface AccelerometerController {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly tiltX: number
  readonly tiltY: number
  readonly mouseButtons: number
  readonly activated: boolean
  readonly hasReading: boolean
  readonly timestamp: number
  read(): AccelerometerReading
  start(): void
  stop(): void
  calibrate(): void
  startMouse(): void
  stopMouse(): void
  setMouseButtons(buttons: number): void
  getMouseButtons(): number
}

export declare const Accelerometer: AccelerometerController

export interface WiFiController {
  isEnabled(): number
  setEnabled(enabled: number): void
  isConnected(): number
  getRSSI(): number
  getRssi(): number
  getSSID(): string
  getSsid(): string
  getIP(): string
  getIp(): string
  getMAC(): string
  getMac(): string
  configure(ssid: string, password: string): void
  startScan(): void
  isScanning(): number
  getScanCount(): number
  getScanSsidAt(index: number): string
  getScanRssiAt(index: number): number
  getScanSecuredAt(index: number): number
}

export declare const WiFi: WiFiController

export interface ButtonProps {
  class?: string
  style?: Style
  pressId?: number
  pressValue?: number
  onPress?: (pressId: number) => void
  onClick?: (pressId: number) => void
  onTouchStart?: (x: number, y: number) => void
  onTouchEnd?: (x: number, y: number) => void
  onTouchMove?: (x: number, y: number) => void
  children?: any
}

export interface InputElementProps {
  class?: string
  style?: Style
  type?: 'text' | 'password'
  value: string
  placeholder?: string
  autoFocus?: boolean | number
  onInput?: (event: InputEvent) => void
  onFocus?: () => void
  onBlur?: () => void
  onKeyDown?: (event: KeyEvent) => void
  input?: (value: string) => void
  focus?: () => void
  blur?: () => void
  keydown?: (keyCode: number) => void
}

export interface SettingsController {
  init(): void
  tick(timestampMs: number): void
  handleSwipeStart(x: number, y: number): void
  handleSwipeMove(x: number, y: number): void
  handleSwipeEnd(x: number, y: number): void
  open(): void
  close(): void
  toggle(): void
  absorbTouch(): void
  refresh(): void
  openWifi(): void
  showOverview(): void
  tapNetwork(index: number): void
  selectPassword(): void
  updatePassword(value: string): void
  keydown(keyCode: number): void
  connectToSelected(): void
  setVolume(value: number): void
  volumeDown(): void
  volumeUp(): void
  setBrightness(value: number): void
  brightnessDown(): void
  brightnessUp(): void
  toggleWifi(): void
  toggleBluetooth(): void
}

export declare function View(props: ViewProps): any
export declare function Text(props: TextProps): any
export declare function Image(props: ImageProps): any
export declare function Button(props: ButtonProps): any
export declare const Settings: SettingsController

export declare function mount(component: new () => Component): void
