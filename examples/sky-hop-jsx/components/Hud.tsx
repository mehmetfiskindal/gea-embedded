import { COLOR_HUD_BG, COLOR_HUD_GOLD, COLOR_HUD_TEXT, DISPLAY_W, HUD_H } from '../constants'
import { game } from '../stores/GameStore'

const COIN_TOTAL = 8

export function Hud() {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: DISPLAY_W,
        height: HUD_H,
        backgroundColor: COLOR_HUD_BG,
        flexDirection: 'row',
        alignItems: 'center',
        padding: '0 96px 0 96px'
      }}
    >
      <span class="sky-hop-title" style={{ color: COLOR_HUD_TEXT, width: 110 }}>
        Sky Hop
      </span>
      <span class="sky-hop-hud-score" style={{ color: COLOR_HUD_GOLD, width: 150 }}>
        {'Coins ' + game.score + '/' + COIN_TOTAL}
      </span>
      <span class="sky-hop-hud-text" style={{ color: COLOR_HUD_TEXT, flex: 1, textAlign: 'right' }}>
        {'Lives ' + game.lives}
      </span>
    </div>
  )
}
