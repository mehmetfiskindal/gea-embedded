import { display } from './runtime'

export const W = display.width
export const H = display.height
export const R = 8
export const BALL_COUNT = 50

export interface Ball {
  x: number
  y: number
  dx: number
  dy: number
  color: number
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomVelocity() {
  const speed = randomInt(2, 6)
  return Math.random() < 0.5 ? -speed : speed
}

export function createBalls(): Ball[] {
  return Array.from({ length: BALL_COUNT }, () => ({
    x: randomInt(R, W - R - 1),
    y: randomInt(R, H - R - 1),
    dx: randomVelocity(),
    dy: randomVelocity(),
    color: display.color(randomInt(0, 255), randomInt(0, 255), randomInt(0, 255))
  }))
}

export function stepBall(ball: Ball) {
  ball.x += ball.dx
  ball.y += ball.dy
  if (ball.x - R < 0 || ball.x + R >= W) {
    ball.dx = -ball.dx
    ball.x += ball.dx
  }
  if (ball.y - R < 0 || ball.y + R >= H) {
    ball.dy = -ball.dy
    ball.y += ball.dy
  }
}
