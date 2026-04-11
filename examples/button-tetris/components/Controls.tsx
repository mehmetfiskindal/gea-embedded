import { tetris } from '../stores/TetrisStore'
import { ControlButton } from './ControlButton'

export function Controls() {
  return (
    <div style={{ position: 'absolute', left: 22, top: 56, flexDirection: 'column', gap: 8 }}>
      <ControlButton label="Left" onPress={() => tetris.move(-1)} />
      <ControlButton label="Rot" onPress={() => tetris.rotate()} />
      <ControlButton label="Right" onPress={() => tetris.move(1)} />
      <ControlButton label="Drop" onPress={() => tetris.drop()} />
      {tetris.musicEnabled ? (
        <ControlButton label="Music On" onPress={() => tetris.toggleMusic()} />
      ) : (
        <ControlButton label="Music Off" onPress={() => tetris.toggleMusic()} />
      )}
    </div>
  )
}
