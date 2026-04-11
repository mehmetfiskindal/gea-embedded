import { Component, Settings, mount } from 'gea-embedded'

Settings.init()
Settings.open()

class App extends Component {
  template() {
    return (
      <p
        style={{
          width: 410,
          height: 502,
          backgroundColor: '#000000',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '36px'
        }}
      >
      </p>
    )
  }
}

mount(App)

requestAnimationFrame(function loop(timestampMs) {
  Settings.tick(timestampMs)
  requestAnimationFrame(loop)
})
