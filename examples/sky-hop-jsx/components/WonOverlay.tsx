import { COLOR_HUD_GOLD, COLOR_HUD_TEXT, COLOR_OVERLAY_BG, COLOR_OVERLAY_BORDER } from '../constants'
import { game } from '../stores/GameStore'

export function WonOverlay() {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: 410, height: 502, alignItems: 'center', justifyContent: 'center' }}>
      {game.won === 1 && (
        <div style={{ width: 316, height: 116, backgroundColor: COLOR_OVERLAY_BG, borderWidth: 2, borderColor: COLOR_OVERLAY_BORDER, alignItems: 'center', justifyContent: 'center' }}>
          <span class="sky-hop-overlay-title" style={{ color: COLOR_HUD_TEXT, marginBottom: 14 }}>Course Clear</span>
          <span class="sky-hop-overlay-score" style={{ color: COLOR_HUD_GOLD }}>{'Coins ' + game.score + '/8'}</span>
        </div>
      )}
    </div>
  )
}
