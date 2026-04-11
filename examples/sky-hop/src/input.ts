import { display, touch } from './runtime'

export type InputState = {
  left: boolean
  right: boolean
  jump: boolean
  restart: boolean
}

type RawInputState = {
  left: boolean
  right: boolean
  jump: boolean
  restart: boolean
}

export type ControlButtonId = 'left' | 'right' | 'jump' | 'restart'

export type ControlButton = {
  id: ControlButtonId
  x: number
  y: number
  w: number
  h: number
}

type KeyEventLike = {
  code?: string
  key?: string
  preventDefault?: () => void
}

type PointerTargetLike = {
  tagName?: string
  getBoundingClientRect?: () => { left: number; top: number; width: number; height: number }
}

type PointerEventLike = {
  clientX?: number
  clientY?: number
  target?: PointerTargetLike
  preventDefault?: () => void
}

type EventSourceLike = {
  addEventListener?: (type: string, handler: (event: never) => void) => void
}

const keyboard: RawInputState = {
  left: false,
  right: false,
  jump: false,
  restart: false
}

const pointer: RawInputState = {
  left: false,
  right: false,
  jump: false,
  restart: false
}

const deviceTouch: RawInputState = {
  left: false,
  right: false,
  jump: false,
  restart: false
}

let pointerLatch = 0
let deviceLatch = 0
let pointerDown = false

export function getControlButtons(width = display.width, height = display.height): ControlButton[] {
  const margin = 10
  const gap = 8
  const buttonH = 66
  const buttonY = height - buttonH - 12
  const moveW = 66
  const jumpW = 112

  return [
    { id: 'left', x: margin, y: buttonY, w: moveW, h: buttonH },
    { id: 'right', x: margin + moveW + gap, y: buttonY, w: moveW, h: buttonH },
    { id: 'jump', x: width - margin - jumpW, y: buttonY, w: jumpW, h: buttonH },
    { id: 'restart', x: width - margin - 34, y: 44, w: 34, h: 28 }
  ]
}

function hitControl(x: number, y: number) {
  const controls = getControlButtons()
  for (let i = 0; i < controls.length; i++) {
    const control = controls[i]
    if (x >= control.x && x < control.x + control.w && y >= control.y && y < control.y + control.h) {
      return control.id
    }
  }
  return undefined
}

function clearRaw(raw: RawInputState) {
  raw.left = false
  raw.right = false
  raw.jump = false
  raw.restart = false
}

function setTouchControl(raw: RawInputState, x: number, y: number, down: boolean, latch: number) {
  clearRaw(raw)
  if (!down) return 0

  const control = hitControl(x, y)
  if (control === 'left') {
    raw.left = true
    return -1
  }
  if (control === 'right') {
    raw.right = true
    return 1
  }
  if (control === 'jump') {
    raw.jump = true
    if (latch < 0) raw.left = true
    if (latch > 0) raw.right = true
    return latch
  }
  if (control === 'restart') raw.restart = true
  return latch
}

function isGameKey(event: KeyEventLike) {
  const code = event.code || event.key || ''
  return code === 'ArrowLeft' ||
    code === 'ArrowRight' ||
    code === 'ArrowUp' ||
    code === 'ArrowDown' ||
    code === 'KeyA' ||
    code === 'KeyD' ||
    code === 'KeyW' ||
    code === 'Space' ||
    code === 'Enter' ||
    code === 'KeyR' ||
    code === 'a' ||
    code === 'd' ||
    code === 'w' ||
    code === ' ' ||
    code === 'r'
}

function setKey(event: KeyEventLike, down: boolean) {
  const code = event.code || event.key || ''
  if (code === 'ArrowLeft' || code === 'KeyA' || code === 'a') keyboard.left = down
  if (code === 'ArrowRight' || code === 'KeyD' || code === 'd') keyboard.right = down
  if (code === 'ArrowUp' || code === 'KeyW' || code === 'Space' || code === 'w' || code === ' ') keyboard.jump = down
  if (code === 'KeyR' || code === 'Enter' || code === 'r') keyboard.restart = down
}

function updatePointer(event: PointerEventLike, down: boolean) {
  const target = event.target
  const tagName = (target?.tagName || '').toLowerCase()
  if (tagName !== 'canvas' || !target?.getBoundingClientRect || typeof event.clientX !== 'number' || typeof event.clientY !== 'number') return

  const rect = target.getBoundingClientRect()
  const x = Math.floor((event.clientX - rect.left) * (display.width / rect.width))
  const y = Math.floor((event.clientY - rect.top) * (display.height / rect.height))
  pointerLatch = setTouchControl(pointer, x, y, down, pointerLatch)
  event.preventDefault?.()
}

function pollDeviceTouch() {
  const sample = touch?.read?.()
  if (!sample?.touching) {
    clearRaw(deviceTouch)
    deviceLatch = 0
    return
  }
  deviceLatch = setTouchControl(deviceTouch, sample.x, sample.y, true, deviceLatch)
}

export function pollInput(input: InputState) {
  pollDeviceTouch()
  input.left = keyboard.left || pointer.left || deviceTouch.left
  input.right = keyboard.right || pointer.right || deviceTouch.right
  input.jump = keyboard.jump || pointer.jump || deviceTouch.jump
  input.restart = keyboard.restart || pointer.restart || deviceTouch.restart
}

export function bindInput(): InputState {
  const input: InputState = {
    left: false,
    right: false,
    jump: false,
    restart: false
  }
  const eventSource = globalThis as unknown as EventSourceLike

  eventSource.addEventListener?.('keydown', ((event: KeyEventLike) => {
    if (isGameKey(event)) event.preventDefault?.()
    setKey(event, true)
    pollInput(input)
  }) as (event: never) => void)

  eventSource.addEventListener?.('keyup', ((event: KeyEventLike) => {
    if (isGameKey(event)) event.preventDefault?.()
    setKey(event, false)
    pollInput(input)
  }) as (event: never) => void)

  eventSource.addEventListener?.('pointerdown', ((event: PointerEventLike) => { pointerDown = true; updatePointer(event, true); pollInput(input) }) as (event: never) => void)
  eventSource.addEventListener?.('pointermove', ((event: PointerEventLike) => { if (pointerDown) { updatePointer(event, true); pollInput(input) } }) as (event: never) => void)
  eventSource.addEventListener?.('pointerup', ((event: PointerEventLike) => { pointerDown = false; updatePointer(event, false); pointerLatch = 0; pollInput(input) }) as (event: never) => void)
  eventSource.addEventListener?.('pointercancel', ((event: PointerEventLike) => { pointerDown = false; updatePointer(event, false); pointerLatch = 0; pollInput(input) }) as (event: never) => void)

  return input
}
