import { BOARD_X, BOARD_Y, CELL } from '../constants'
import { tetris } from '../stores/TetrisStore'

export function TetrisBoard() {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: 410, height: 502, overflow: 'visible' }}>
      <div style={{ position: 'absolute', left: BOARD_X, top: BOARD_Y, width: 200, height: 360, backgroundColor: '#0F172A', borderWidth: 2, borderColor: '#334155' }} />
      {tetris.stack.map(block => (
        <div style={{ position: 'absolute', left: block.left, top: block.top, width: CELL - 2, height: CELL - 2, backgroundColor: block.color }} />
      ))}
      {tetris.gameOver === 0 && <div style={{ position: 'absolute', left: BOARD_X + (tetris.px + tetris.ax0) * CELL, top: BOARD_Y + (tetris.py + tetris.ay0) * CELL, width: CELL - 2, height: CELL - 2, backgroundColor: tetris.color }} />}
      {tetris.gameOver === 0 && <div style={{ position: 'absolute', left: BOARD_X + (tetris.px + tetris.ax1) * CELL, top: BOARD_Y + (tetris.py + tetris.ay1) * CELL, width: CELL - 2, height: CELL - 2, backgroundColor: tetris.color }} />}
      {tetris.gameOver === 0 && <div style={{ position: 'absolute', left: BOARD_X + (tetris.px + tetris.ax2) * CELL, top: BOARD_Y + (tetris.py + tetris.ay2) * CELL, width: CELL - 2, height: CELL - 2, backgroundColor: tetris.color }} />}
      {tetris.gameOver === 0 && <div style={{ position: 'absolute', left: BOARD_X + (tetris.px + tetris.ax3) * CELL, top: BOARD_Y + (tetris.py + tetris.ay3) * CELL, width: CELL - 2, height: CELL - 2, backgroundColor: tetris.color }} />}
    </div>
  )
}
