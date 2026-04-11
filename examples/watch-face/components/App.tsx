import { Component } from 'gea-embedded'
import { H, W } from '../constants'
import { watch } from '../stores/WatchStore'
import { WatchFace } from './WatchFace'
import { WifiSettings } from './WifiSettings'

export class App extends Component {
  template() {
    return (
      <div style={{ width: W, height: H, backgroundColor: '#000000', overflow: 'hidden', fontFamily: 'Inter', fontSize: 15 }}>
        {watch.screen === 0 ? <WatchFace /> : <WifiSettings />}
      </div>
    )
  }
}
