import { mount } from 'gea-embedded'
import './styles.css'
import { App } from './components/App'
import { tetris } from './stores/TetrisStore'

tetris.init()
mount(App)

requestAnimationFrame(function loop(timestampMs) {
  tetris.tick(timestampMs)
  requestAnimationFrame(loop)
})
