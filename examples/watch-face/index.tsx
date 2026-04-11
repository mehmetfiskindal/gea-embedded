import { mount } from 'gea-embedded'
import './styles.css'
import { App } from './components/App'
import { watch } from './stores/WatchStore'

watch.init()
mount(App)

requestAnimationFrame(function loop(timestampMs) {
  watch.tick(timestampMs)
  requestAnimationFrame(loop)
})
