import { BLEServer } from 'gea-embedded'
import { store } from './ClickerStore'

export class HIDService extends BLEServer {
  deviceName = 'Gea Clicker'
  appearance = 961
  // macAddress = 'C0:DE:5E:DA:73:8A'

  onConnected() {
    store.markConnected()
  }

  onDisconnected() {
    store.markAdvertising()
  }

  onBound() {
    store.markBound()
  }
}

export const hid = new HIDService()
