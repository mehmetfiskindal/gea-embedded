import { Component } from 'gea-embedded'
import { DISPLAY_H, DISPLAY_W } from '../constants'
import { Background } from './Background'
import { Controls } from './Controls'
import { Hud } from './Hud'
import { WonOverlay } from './WonOverlay'
import { World } from './World'

export class App extends Component {
  template() {
    return (
      <div style={{ width: DISPLAY_W, height: DISPLAY_H, overflow: 'hidden' }}>
        <Background />
        <World />
        <Hud />
        <Controls />
        <WonOverlay />
      </div>
    )
  }
}
