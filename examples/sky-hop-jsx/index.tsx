import { mount } from 'gea-embedded'
import './styles.css'
import './assets'
import { App } from './components/App'
import { game } from './stores/GameStore'

game.init()
mount(App)

requestAnimationFrame(function loop(timestampMs) {
  game.tick(timestampMs)
  requestAnimationFrame(loop)
})
