import { Accelerometer, Store, audioContext } from 'gea-embedded'
import { BRICK_COUNT, H, MISS_PAUSE_MS, PADDLE_W, W, WIN_PAUSE_MS } from '../constants'

export class BreakoutStore extends Store {
  bricks = [{ x: 0, y: 0, alive: 1, opacity: 255, color: '#EF4444' }]
  ballX = 205
  ballY = 355
  ballDx = 3
  ballDy = -4
  paddleX = 159
  score = 0
  lives = 3
  remainingBricks = 0
  roundWon = 0
  serveAtMs = 0
  status = 'Tilt to move. Arrow keys simulate tilt.'

  sound(frequency: number, durationMs: number) {
    const oscillator = audioContext.createOscillator()
    oscillator.type = 'square'
    oscillator.frequency.value = frequency
    oscillator.connect(audioContext.destination)
    const now = audioContext.currentTime
    oscillator.start(now)
    oscillator.stop(now + durationMs * 0.001)
  }

  init() {
    Accelerometer.start()
    this.ballX = 205
    this.ballY = 355
    this.ballDx = 3
    this.ballDy = -4
    this.paddleX = 159
    this.score = 0
    this.lives = 3
    this.remainingBricks = BRICK_COUNT
    this.roundWon = 0
    this.serveAtMs = 0
    this.status = 'Tilt to move. Arrow keys simulate tilt.'
    this.bricks.length = BRICK_COUNT
    for (let i = 0; i < this.bricks.length; i++) {
      this.bricks[i].x = 20 + (i % 6) * 62
      this.bricks[i].y = 78 + ((i / 6) | 0) * 28
      this.bricks[i].alive = 1
      this.bricks[i].opacity = 255
      if (i < 6) this.bricks[i].color = '#F97316'
      else if (i < 12) this.bricks[i].color = '#EAB308'
      else if (i < 18) this.bricks[i].color = '#22C55E'
      else this.bricks[i].color = '#38BDF8'
    }
  }

  resetBall() {
    this.ballX = 205
    this.ballY = 355
    this.ballDx = -this.ballDx
    this.ballDy = -4
  }

  tick(timestampMs: number) {
    if (this.serveAtMs > 0) {
      if (timestampMs < this.serveAtMs) return
      this.serveAtMs = 0
      if (this.roundWon || this.lives <= 0) {
        this.init()
      } else {
        this.resetBall()
      }
    }

    const tilt = -Accelerometer.tiltX
    this.paddleX = this.paddleX + tilt / 10
    if (this.paddleX < 14) this.paddleX = 14
    if (this.paddleX > W - PADDLE_W - 14) this.paddleX = W - PADDLE_W - 14

    this.ballX = this.ballX + this.ballDx
    this.ballY = this.ballY + this.ballDy

    if (this.ballX < 10 || this.ballX > W - 10) {
      this.ballDx = -this.ballDx
      this.sound(300, 22)
    }
    if (this.ballY < 54) {
      this.ballDy = -this.ballDy
      this.sound(340, 22)
    }

    if (this.ballY > 414 && this.ballY < 436 && this.ballX > this.paddleX && this.ballX < this.paddleX + PADDLE_W) {
      this.ballDy = -4
      this.ballDx = (this.ballX - (this.paddleX + PADDLE_W / 2)) / 12
      this.sound(520, 38)
    }

    for (let i = 0; i < this.bricks.length; i++) {
      if (
        this.bricks[i].alive &&
        this.ballX > this.bricks[i].x &&
        this.ballX < this.bricks[i].x + 54 &&
        this.ballY > this.bricks[i].y &&
        this.ballY < this.bricks[i].y + 18
      ) {
        this.bricks[i].alive = 0
        this.bricks[i].opacity = 0
        this.ballDy = -this.ballDy
        this.score = this.score + 10
        this.remainingBricks = this.remainingBricks - 1
        this.sound(720, 48)
      }
    }

    if (this.remainingBricks <= 0) {
      this.roundWon = 1
      this.status = 'You win. New round coming.'
      this.serveAtMs = timestampMs + WIN_PAUSE_MS
      this.sound(880, 140)
    }

    if (this.ballY > H) {
      this.lives = this.lives - 1
      if (this.lives <= 0) {
        this.status = 'Game over. Resetting.'
        this.sound(120, 180)
      } else {
        this.status = 'Ball lost. Lives ' + this.lives
        this.sound(180, 110)
      }
      this.serveAtMs = timestampMs + MISS_PAUSE_MS
    }
  }
}

export const breakout = new BreakoutStore()
export const game = breakout
