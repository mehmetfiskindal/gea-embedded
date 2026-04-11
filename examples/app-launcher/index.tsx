import { defaults, Settings, mount } from 'gea-embedded'
import './styles.css'
import { App } from './components/App'
import { launcher } from './stores/LauncherStore'

defaults.display.flushChunkRows = 32
defaults.display.flushQueueDepth = 1

Settings.init()
launcher.init()
mount(App)

requestAnimationFrame(function loop(timestampMs) {
  Settings.tick(timestampMs)
  launcher.tick(timestampMs)
  requestAnimationFrame(loop)
})
