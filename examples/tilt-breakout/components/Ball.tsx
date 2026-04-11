import { breakout } from '../stores/BreakoutStore'

export function Ball() {
  return (
    <div
      class="ball"
      style={{
        left: breakout.ballX - 8,
        top: breakout.ballY - 8
      }}
    />
  )
}
