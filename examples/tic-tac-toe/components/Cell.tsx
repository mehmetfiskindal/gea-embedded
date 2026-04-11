import { game } from '../stores/GameStore'

export function Cell({ index }: { index: number }) {
  return (
    <div
      style={{
        width: 120,
        height: 120,
        backgroundColor: '#1A1A3E',
        borderRadius: 8,
        borderWidth: 2,
        borderColor: '#333366',
        justifyContent: 'center',
        alignItems: 'center'
      }}
      onPress={() => game.play(index)}
    >
      <span
        style={{
          fontFamily: 'Oswald',
          fontSize: 48,
          color: game.board[index] === 'X' ? '#E94560' : '#0F3460'
        }}
      >
        {game.board[index]}
      </span>
    </div>
  )
}
