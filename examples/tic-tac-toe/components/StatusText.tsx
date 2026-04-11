import { game } from '../stores/GameStore'

export function StatusText() {
  return (
    <span style={{ fontFamily: 'Oswald', fontSize: 24, color: '#FFFFFF', margin: '0 0 16px 0' }}>
      {game.winner ? game.winner + ' wins!' : 'Turn: ' + game.turn}
    </span>
  )
}
