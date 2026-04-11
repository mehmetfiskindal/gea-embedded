import { Ball, R, stepBall } from './balls'
import { display } from './runtime'

const BLACK = display.color(0, 0, 0)

export function drawInitialBalls(balls: Ball[]) {
  display.clear()
  for (let i = 0; i < balls.length; i++) {
    display.fillCircle(balls[i].x, balls[i].y, R, balls[i].color)
  }
}

export function renderBallFrame(balls: Ball[]) {
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i]
    display.fillCircle(b.x, b.y, R, BLACK)
  }

  for (let i = 0; i < balls.length; i++) {
    const b = balls[i]
    stepBall(b)
    display.fillCircle(b.x, b.y, R, b.color)
  }
}
