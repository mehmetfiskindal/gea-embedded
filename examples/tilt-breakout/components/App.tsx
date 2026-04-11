import { Component } from 'gea-embedded'
import { Ball } from './Ball'
import { BrickField } from './BrickField'
import { Hud, StatusLine } from './Hud'
import { Paddle } from '../dist/Paddle'

export class App extends Component {
  template() {
    return (
      <div class="breakout-app">
        <Hud />
        <StatusLine />
        <BrickField />
        <Paddle />
        <Ball />
      </div>
    )
  }
}
