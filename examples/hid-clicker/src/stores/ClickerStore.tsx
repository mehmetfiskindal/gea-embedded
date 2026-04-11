import { Accelerometer, Store, gea_embedded_ble_key_tap, gea_embedded_ble_mouse_move, gea_embedded_ble_mouse_click } from 'gea-embedded'

export class ClickerStore extends Store {
  status = 'idle'
  screen = 0
  lastX = -1
  lastY = -1
  residualX = 0
  residualY = 0

  markConnected() {
    this.status = 'connected'
  }

  markAdvertising() {
    this.status = 'advertising'
  }

  markBound() {
    this.status = 'bound'
  }

  switchScreen(id: number) {
    if (this.screen === 1) {
      Accelerometer.stopMouse()
    }
    this.screen = id
    if (id === 1) {
      Accelerometer.setMouseButtons(0)
      Accelerometer.startMouse()
    }
  }

  nextSlide() {
    gea_embedded_ble_key_tap(0x4e)
  }

  prevSlide() {
    gea_embedded_ble_key_tap(0x4b)
  }

  mouseLeftDown() {
    const btns = Accelerometer.getMouseButtons() | 1
    Accelerometer.setMouseButtons(btns)
    gea_embedded_ble_mouse_move(0, 0, btns, 0)
  }

  mouseLeftUp() {
    const btns = Accelerometer.getMouseButtons() & ~1
    Accelerometer.setMouseButtons(btns)
    gea_embedded_ble_mouse_move(0, 0, btns, 0)
  }

  mouseRightDown() {
    const btns = Accelerometer.getMouseButtons() | 2
    Accelerometer.setMouseButtons(btns)
    gea_embedded_ble_mouse_move(0, 0, btns, 0)
  }

  mouseRightUp() {
    const btns = Accelerometer.getMouseButtons() & ~2
    Accelerometer.setMouseButtons(btns)
    gea_embedded_ble_mouse_move(0, 0, btns, 0)
  }

  recaptureBias() {
    Accelerometer.startMouse()
  }

  leftClick() {
    gea_embedded_ble_mouse_click(1)
  }

  rightClick() {
    gea_embedded_ble_mouse_click(2)
  }

  initTouch(x: number, y: number) {
    this.lastX = x
    this.lastY = y
    this.residualX = 0
    this.residualY = 0
  }

  resetTouch() {
    this.lastX = -1
    this.lastY = -1
    this.residualX = 0
    this.residualY = 0
  }

  scrollMove(x: number, y: number) {
    if (this.lastY < 0) return
    const dy = this.lastY - y
    this.lastY = y
    if (Math.abs(dy) > 1) {
      gea_embedded_ble_mouse_move(0, 0, 0, dy > 0 ? 1 : -1)
    }
  }

  trackpadMove(x: number, y: number) {
    if (this.lastX < 0) return
    const dx = (x - this.lastX) * 1.5
    const dy = (y - this.lastY) * 1.5
    this.lastX = x
    this.lastY = y
    this.residualX += dx
    this.residualY += dy
    const idx = this.residualX | 0
    const idy = this.residualY | 0
    this.residualX -= idx
    this.residualY -= idy
    if (idx !== 0 || idy !== 0) {
      gea_embedded_ble_mouse_move(idx, idy, 0, 0)
    }
  }
}

export const store = new ClickerStore()
