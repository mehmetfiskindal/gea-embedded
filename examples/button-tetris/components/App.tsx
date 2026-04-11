import { Component } from 'gea-embedded'
import { tetris } from '../stores/TetrisStore'
import { Controls } from './Controls'
import { GameOverOverlay } from './GameOverOverlay'
import { TetrisBoard } from './TetrisBoard'

export class App extends Component {
  template() {
    return (
      <div style={{ width: 410, height: 502, backgroundColor: '#020617' }}>
        <span class="tetris-title-label" style={{ position: 'absolute', left: 0, top: 20, width: 410, color: '#E2E8F0', textAlign: 'center' }}>Button Tetris</span>
        <TetrisBoard />
        <Controls />
        <span class="tetris-score-label" style={{ position: 'absolute', left: 0, top: 464, width: 410, color: '#E2E8F0', textAlign: 'center' }}>{'Score ' + tetris.score}</span>
        <GameOverOverlay />
      </div>
    )
  }
}
