import { breakout } from '../stores/BreakoutStore'

export function Hud() {
  return (
    <span class="hud">
      {'Score ' + breakout.score + '   Lives ' + breakout.lives}
    </span>
  )
}

export function StatusLine() {
  return <span class="status-line">{breakout.status}</span>
}
