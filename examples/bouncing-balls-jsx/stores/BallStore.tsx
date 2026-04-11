import { Store } from 'gea-embedded'
import { BALL_COUNT } from '../constants'

export class BallStore extends Store {
  balls = [{ x: 0, y: 0, dx: 0, dy: 0, color: '#000000' }]
  fpsText = 'FPS: --'
  fpsWindowStartMs = 0
  fpsWindowFrames = 0

  init() {
    const colors = [
      '#FF0000',
      '#00FF00',
      '#0000FF',
      '#FFFF00',
      '#00FFFF',
      '#FF00FF',
      '#FF6600',
      '#FFFFFF',
      '#8800FF',
      '#FFD700'
    ]
    this.balls.length = BALL_COUNT
    for (let i = 0; i < BALL_COUNT; i++) {
      const seed = i * 97 + 23
      const speedX = ((i * 37 + 11) % 7) + 1
      const speedY = ((i * 53 + 17) % 7) + 1
      this.balls[i].x = ((i * 79 + 17) % 390) + 10
      this.balls[i].y = ((i * 97 + 31) % 480) + 10
      this.balls[i].dx = speedX * (seed % 2 === 0 ? 1 : -1)
      this.balls[i].dy = speedY * (seed % 3 === 0 ? 1 : -1)
      this.balls[i].color = colors[i % 10]
    }
  }

  tick(timestampMs: number) {
    if (this.fpsWindowStartMs === 0) {
      this.fpsWindowStartMs = timestampMs
    }
    this.fpsWindowFrames++

    const elapsedMs = timestampMs - this.fpsWindowStartMs
    if (elapsedMs >= 500) {
      const fps = Math.round((this.fpsWindowFrames * 1000) / elapsedMs)
      this.fpsText = `FPS: ${fps}`
      this.fpsWindowStartMs = timestampMs
      this.fpsWindowFrames = 0
    }

    for (let i = 0; i < this.balls.length; i++) {
      if (this.balls[i].x + this.balls[i].dx < 8 || this.balls[i].x + this.balls[i].dx > 402)
        this.balls[i].dx = -this.balls[i].dx
      if (this.balls[i].y + this.balls[i].dy < 8 || this.balls[i].y + this.balls[i].dy > 494)
        this.balls[i].dy = -this.balls[i].dy
      this.balls[i].x += this.balls[i].dx
      this.balls[i].y += this.balls[i].dy
    }
  }
}

export const balls = new BallStore()
