import { Component } from 'gea-embedded'
import { store } from '../stores/ClickerStore'
import { StatusBar } from './StatusBar'
import { PresentationScreen } from './PresentationScreen'
import { MouseScreen } from './MouseScreen'
import { TrackpadScreen } from './TrackpadScreen'

export class App extends Component {
  template() {
    return (
      <div class="app">
        <StatusBar />
        {store.screen === 0 && <PresentationScreen />}
        {store.screen === 1 && <MouseScreen />}
        {store.screen === 2 && <TrackpadScreen />}
      </div>
    )
  }
}
