import { createBalls } from './src/balls'
import { drawInitialBalls, renderBallFrame } from './src/render'
import { requestFrame } from './src/runtime'

const balls = createBalls()
drawInitialBalls(balls)

requestFrame(function frame() {
  renderBallFrame(balls)
})
