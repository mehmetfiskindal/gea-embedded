import { mount } from 'gea-embedded'
import './styles.css'
import { App } from './components/App'
import { breakout } from './stores/BreakoutStore'

breakout.init()
mount(App)

requestAnimationFrame(function loop(timestampMs) {
  breakout.tick(timestampMs)
  requestAnimationFrame(loop)
})
