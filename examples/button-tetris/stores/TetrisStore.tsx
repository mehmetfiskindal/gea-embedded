import { Store, audioContext } from 'gea-embedded'
import { BOARD_X, BOARD_Y, CELL, STACK_MAX } from '../constants'

export class TetrisStore extends Store {
  stack = [{ x: 0, y: 0, left: 0, top: 0, color: '#0EA5E9' }]
  px = 4
  py = 0
  rot = 0
  ax0 = 0
  ay0 = 0
  ax1 = 0
  ay1 = 0
  ax2 = 0
  ay2 = 0
  ax3 = 0
  ay3 = 0
  piece = 0
  nextPiece = 0
  color = '#0EA5E9'
  score = 0
  frame = 0
  gameOver = 0
  musicIndex = 0
  musicNextAt = 0
  musicEnabled = 1

  sound(frequency: number, durationMs: number) {
    const oscillator = audioContext.createOscillator()
    oscillator.type = 'square'
    oscillator.frequency.value = frequency
    oscillator.connect(audioContext.destination)
    const now = audioContext.currentTime
    oscillator.start(now)
    oscillator.stop(now + durationMs * 0.001)
  }

  musicSound(frequency: number, durationMs: number) {
    const oscillator = audioContext.createOscillator()
    oscillator.type = 'triangle'
    oscillator.frequency.value = frequency
    oscillator.connect(audioContext.destination)
    const now = audioContext.currentTime
    oscillator.start(now)
    oscillator.stop(now + durationMs * 0.001)
  }

  init() {
    this.stack.length = STACK_MAX
    this.stack.length = 0
    this.score = 0
    this.frame = 0
    this.rot = 0
    this.nextPiece = 0
    this.gameOver = 0
    this.musicIndex = 0
    this.musicNextAt = 0
    this.spawn()
  }

  restart() {
    this.init()
    this.sound(392, 70)
  }

  toggleMusic() {
    if (this.musicEnabled) {
      this.musicEnabled = 0
    } else {
      this.musicEnabled = 1
      this.musicIndex = 0
      this.musicNextAt = 0
      this.sound(523, 45)
    }
  }

  updateShape() {
    const shapes = [
      [-1, 0, 0, 0, 1, 0, 2, 0], [0, -1, 0, 0, 0, 1, 0, 2], [-1, 0, 0, 0, 1, 0, 2, 0], [0, -1, 0, 0, 0, 1, 0, 2],
      [0, 0, 1, 0, 0, 1, 1, 1], [0, 0, 1, 0, 0, 1, 1, 1], [0, 0, 1, 0, 0, 1, 1, 1], [0, 0, 1, 0, 0, 1, 1, 1],
      [0, 0, 1, 0, -1, 0, 0, 1], [0, 0, 0, -1, 0, 1, 1, 0], [0, 0, 1, 0, -1, 0, 0, -1], [0, 0, 0, -1, 0, 1, -1, 0],
      [0, 0, 1, 0, 0, 1, -1, 1], [0, 0, 0, -1, 1, 0, 1, 1], [0, 0, 1, 0, 0, 1, -1, 1], [0, 0, 0, -1, 1, 0, 1, 1],
      [0, 0, -1, 0, 0, 1, 1, 1], [0, 0, 0, 1, 1, 0, 1, -1], [0, 0, -1, 0, 0, 1, 1, 1], [0, 0, 0, 1, 1, 0, 1, -1],
      [0, 0, -1, 0, 1, 0, -1, 1], [0, 0, 0, -1, 0, 1, 1, 1], [0, 0, -1, 0, 1, 0, 1, -1], [0, 0, 0, -1, 0, 1, -1, -1],
      [0, 0, -1, 0, 1, 0, 1, 1], [0, 0, 0, -1, 0, 1, 1, -1], [0, 0, -1, 0, 1, 0, -1, -1], [0, 0, 0, -1, 0, 1, -1, 1]
    ]
    let shape = this.piece * 4 + this.rot
    if (shape < 0 || shape > 27) shape = 0
    this.ax0 = shapes[shape][0]; this.ay0 = shapes[shape][1]
    this.ax1 = shapes[shape][2]; this.ay1 = shapes[shape][3]
    this.ax2 = shapes[shape][4]; this.ay2 = shapes[shape][5]
    this.ax3 = shapes[shape][6]; this.ay3 = shapes[shape][7]
  }

  spawn() {
    this.px = 4
    this.py = 1
    this.rot = 0
    this.piece = this.nextPiece
    this.nextPiece = (this.nextPiece + 1) % 7
    const colors = ['#22D3EE', '#FACC15', '#A855F7', '#22C55E', '#EF4444', '#3B82F6', '#F97316']
    this.color = colors[this.piece]
    this.updateShape()
    if (!this.canMove(0, 0)) {
      this.gameOver = 1
      this.sound(110, 220)
    }
  }

  canMove(dx: number, dy: number): number {
    const x0 = this.px + this.ax0 + dx
    const y0 = this.py + this.ay0 + dy
    const x1 = this.px + this.ax1 + dx
    const y1 = this.py + this.ay1 + dy
    const x2 = this.px + this.ax2 + dx
    const y2 = this.py + this.ay2 + dy
    const x3 = this.px + this.ax3 + dx
    const y3 = this.py + this.ay3 + dy
    if (x0 < 0 || x0 > 9 || x1 < 0 || x1 > 9 || x2 < 0 || x2 > 9 || x3 < 0 || x3 > 9) return 0
    if (y0 < 0 || y1 < 0 || y2 < 0 || y3 < 0 || y0 > 17 || y1 > 17 || y2 > 17 || y3 > 17) return 0
    for (let i = 0; i < this.stack.length; i++) {
      if ((this.stack[i].x == x0 && this.stack[i].y == y0) || (this.stack[i].x == x1 && this.stack[i].y == y1) || (this.stack[i].x == x2 && this.stack[i].y == y2) || (this.stack[i].x == x3 && this.stack[i].y == y3)) return 0
    }
    return 1
  }

  lockOne(x: number, y: number) {
    if (this.stack.length >= STACK_MAX) {
      this.gameOver = 1
      this.sound(110, 220)
      return
    }
    this.stack.push({
      x,
      y,
      left: BOARD_X + x * CELL,
      top: BOARD_Y + y * CELL,
      color: this.color
    })
  }

  clearRows() {
    let cleared = 0
    for (let y = 17; y >= 0; y--) {
      let mask = 0
      for (let i = 0; i < this.stack.length; i++) {
        if (this.stack[i].y == y) {
          mask = mask | (1 << this.stack[i].x)
        }
      }

      if (mask == 1023) {
        let write = 0
        for (let read = 0; read < this.stack.length; read++) {
          if (this.stack[read].y != y) {
            this.stack[write].x = this.stack[read].x
            this.stack[write].y = this.stack[read].y
            this.stack[write].left = this.stack[read].left
            this.stack[write].top = this.stack[read].top
            this.stack[write].color = this.stack[read].color
            write = write + 1
          }
        }

        this.stack.length = write
        for (let i = 0; i < this.stack.length; i++) {
          if (this.stack[i].y < y) {
            this.stack[i].y = this.stack[i].y + 1
            this.stack[i].top = BOARD_Y + this.stack[i].y * CELL
          }
        }

        cleared = cleared + 1
        y = y + 1
      }
    }

    if (cleared > 0) {
      if (cleared == 1) this.score = this.score + 100
      else if (cleared == 2) this.score = this.score + 300
      else if (cleared == 3) this.score = this.score + 500
      else this.score = this.score + 800
      if (cleared == 1) this.sound(660, 80)
      else if (cleared == 2) this.sound(760, 90)
      else if (cleared == 3) this.sound(860, 100)
      else this.sound(980, 130)
    }
    return cleared
  }

  lockPiece() {
    if (this.gameOver) return
    if (this.stack.length > STACK_MAX - 4) {
      this.gameOver = 1
      this.sound(110, 220)
      return
    }
    this.lockOne(this.px + this.ax0, this.py + this.ay0)
    this.lockOne(this.px + this.ax1, this.py + this.ay1)
    this.lockOne(this.px + this.ax2, this.py + this.ay2)
    this.lockOne(this.px + this.ax3, this.py + this.ay3)
    if (this.gameOver) return
    this.score = this.score + 4
    const cleared = this.clearRows()
    if (cleared == 0) this.sound(210, 35)
    this.spawn()
  }

  move(dx: number) {
    if (this.gameOver) return
    if (this.canMove(dx, 0)) {
      this.px = this.px + dx
      this.sound(280, 24)
    }
  }

  rotate() {
    if (this.gameOver) return
    const old = this.rot
    this.rot = (this.rot + 1) % 4
    this.updateShape()
    if (!this.canMove(0, 0)) {
      this.rot = old
      this.updateShape()
    } else {
      this.sound(440, 34)
    }
  }

  stepDown() {
    if (this.gameOver) return
    if (this.canMove(0, 1)) this.py = this.py + 1
    else this.lockPiece()
  }

  drop() {
    if (this.gameOver) return
    for (let i = 0; i < 18; i++) {
      if (this.canMove(0, 1)) this.py = this.py + 1
    }
    this.frame = 0
    this.sound(180, 45)
    this.lockPiece()
  }

  playMusic(timestampMs: number) {
    if (!this.musicEnabled) return
    if (this.musicNextAt <= 0) this.musicNextAt = timestampMs
    if (timestampMs < this.musicNextAt) return

    const notes = [
      659, 494, 523, 587, 523, 494, 440, 440, 523, 659, 587, 523,
      494, 523, 587, 659, 523, 440, 440, 587, 698, 880, 784, 698,
      659, 523, 659, 587, 523, 494, 523, 587, 659, 523, 440, 440,
      659, 494, 523, 587, 523, 494, 440, 440, 523, 659, 587, 523,
      494, 523, 587, 659, 523, 440, 440, 587, 698, 880, 784, 698,
      659, 523, 659, 587, 523, 494, 523, 587, 659, 523, 440, 440,
      659, 523, 587, 494, 523, 440, 415, 659, 523, 587, 494, 523,
      659, 880, 880, 831, 659, 494, 523, 587, 523, 494, 440, 440,
      523, 659, 587, 523, 494, 523, 587, 659, 523, 440, 440, 587,
      698, 880, 784, 698, 659, 523, 659, 587, 523, 494, 523, 587,
      659, 523, 440, 440
    ]
    const beats = [
      2, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1,
      2, 1, 1, 2, 2, 2, 4, 3, 1, 2, 1, 1,
      3, 1, 2, 1, 1, 2, 1, 1, 2, 2, 2, 6,
      2, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1,
      2, 1, 1, 2, 2, 2, 4, 3, 1, 2, 1, 1,
      3, 1, 2, 1, 1, 2, 1, 1, 2, 2, 2, 6,
      4, 4, 4, 4, 4, 4, 8, 4, 4, 4, 4, 4,
      4, 4, 4, 8, 2, 1, 1, 2, 1, 1, 2, 1,
      1, 2, 1, 1, 2, 1, 1, 2, 2, 2, 4, 3,
      1, 2, 1, 1, 3, 1, 2, 1, 1, 2, 1, 1,
      2, 2, 2, 6
    ]
    const stepMs = 190
    if (this.musicIndex < 0 || this.musicIndex > 123) this.musicIndex = 0
    const note = notes[this.musicIndex]
    const beatCount = beats[this.musicIndex]
    const durationMs = stepMs * beatCount
    if (note > 0) this.musicSound(note, durationMs)

    this.musicNextAt = this.musicNextAt + stepMs * beatCount
    this.musicIndex = this.musicIndex + 1
    if (this.musicIndex > 123) {
      this.musicIndex = 0
      this.musicNextAt = this.musicNextAt + stepMs * 4
    }
  }

  tick(timestampMs: number) {
    if (this.gameOver) return
    this.playMusic(timestampMs)
    this.frame = this.frame + 1
    if (this.frame > 24) {
      this.frame = 0
      this.stepDown()
    }
  }
}

export const tetris = new TetrisStore()
export const game = tetris
