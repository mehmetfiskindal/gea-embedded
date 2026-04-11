import { Store } from 'gea-embedded'

export class GameStore extends Store {
  board = '         '
  turn = 'X'
  winner = ''

  play(index: number) {
    if (this.board[index] !== ' ' || this.winner) return
    this.board = this.board.substring(0, index) + this.turn + this.board.substring(index + 1)
    this.winner = this.checkWin()
    this.turn = this.turn === 'X' ? 'O' : 'X'
  }

  checkWin(): string {
    const w = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8],
      [0, 4, 8],
      [2, 4, 6]
    ]
    for (const [a, b, c] of w) {
      if (this.board[a] !== ' ' && this.board[a] === this.board[b] && this.board[b] === this.board[c])
        return this.board[a]
    }
    return ''
  }
}

export const game = new GameStore()
