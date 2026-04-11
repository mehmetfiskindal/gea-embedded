import { Settings, defaults, mount } from 'gea-embedded'
import './styles.css'
import './stores/HIDService'
import { App } from './components/App'

defaults.display.flushChunkRows = 8
defaults.display.flushQueueDepth = 1
// defaults.mirror = false
// defaults.wifi = false

Settings.init()
mount(App)

requestAnimationFrame(function loop(timestampMs) {
  Settings.tick(timestampMs)
  requestAnimationFrame(loop)
})
