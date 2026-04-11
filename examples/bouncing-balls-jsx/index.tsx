import { defaults, mount } from 'gea-embedded'
import './styles.css'
import { App } from './components/App'
import { balls } from './stores/BallStore'

defaults.display.flushChunkRows = 32
defaults.display.flushQueueDepth = 2

balls.init()
mount(App)

requestAnimationFrame(function loop(timestampMs) {
  balls.tick(timestampMs)
  requestAnimationFrame(loop)
})
