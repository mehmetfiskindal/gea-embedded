import { Component } from 'gea-embedded'
import { Card } from './Card'

export class App extends Component {
  template() {
    return (
      <div
        style={{
          width: 410,
          height: 502,
          backgroundColor: '#111827',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '24px'
        }}
      >
        <Card />
      </div>
    )
  }
}
