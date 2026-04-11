import { tetris } from '../stores/TetrisStore'

export function GameOverOverlay() {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: 410, height: 502, overflow: 'visible' }}>
      {tetris.gameOver === 1 && (
        <div
          style={{
            position: 'absolute',
            left: 50,
            top: 140,
            width: 310,
            height: 212,
            backgroundColor: '#111827',
            borderWidth: 2,
            borderColor: '#F97316',
            borderRadius: 8,
            alignItems: 'center',
            paddingTop: 24
          }}
        >
          <span class="tetris-overlay-title" style={{ color: '#F8FAFC' }}>You lost the game</span>
          <span class="tetris-overlay-score" style={{ margin: '12px 0 0 0', color: '#CBD5E1' }}>{'Score ' + tetris.score}</span>
          <div
            onPress={() => tetris.restart()}
            style={{
              margin: '22px 0 0 0',
              width: 150,
              height: 80,
              backgroundColor: '#F97316',
              borderRadius: 8,
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <span class="tetris-restart-label" style={{ color: '#111827' }}>Restart</span>
          </div>
        </div>
      )}
    </div>
  )
}
