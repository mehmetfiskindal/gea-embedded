import { Component } from 'gea-embedded'
import { Board } from './Board'
import { StatusText } from './StatusText'

export class App extends Component {
  template() {
    return (
      <div
        style={{
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: 410,
          height: 502,
          backgroundColor: '#0A0A1A'
        }}
      >
        <StatusText />
        <Board />
      </div>
    )
  }
}
