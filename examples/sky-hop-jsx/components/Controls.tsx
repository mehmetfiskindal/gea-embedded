import {
  COLOR_BUTTON,
  COLOR_BUTTON_ACTIVE,
  COLOR_BUTTON_BORDER,
  COLOR_BUTTON_TEXT,
  COLOR_BUTTON_TEXT_ACTIVE,
  DISPLAY_H,
  DISPLAY_W
} from '../constants'
import { game } from '../stores/GameStore'

const BUTTON_H = 66
const BUTTON_Y = DISPLAY_H - BUTTON_H - 12
const MOVE_W = 66
const JUMP_W = 112
const GAP = 8
const MARGIN = 10

export function Controls() {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: DISPLAY_W, height: DISPLAY_H }}>
      <div
        onTouchStart={() => game.buttonLeftDown()}
        onTouchEnd={() => game.buttonLeftUp()}
        style={{
          position: 'absolute',
          left: MARGIN,
          top: BUTTON_Y,
          width: MOVE_W,
          height: BUTTON_H,
          backgroundColor: game.pressLeft ? COLOR_BUTTON_ACTIVE : COLOR_BUTTON,
          borderWidth: 2,
          borderColor: COLOR_BUTTON_BORDER,
          opacity: 0.85,
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <span
          class="sky-hop-button-glyph"
          style={{ color: game.pressLeft ? COLOR_BUTTON_TEXT_ACTIVE : COLOR_BUTTON_TEXT }}
        >
          L
        </span>
      </div>

      <div
        onTouchStart={() => game.buttonRightDown()}
        onTouchEnd={() => game.buttonRightUp()}
        style={{
          position: 'absolute',
          left: MARGIN + MOVE_W + GAP,
          top: BUTTON_Y,
          width: MOVE_W,
          height: BUTTON_H,
          backgroundColor: game.pressRight ? COLOR_BUTTON_ACTIVE : COLOR_BUTTON,
          borderWidth: 2,
          borderColor: COLOR_BUTTON_BORDER,
          opacity: 0.85,
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <span
          class="sky-hop-button-glyph"
          style={{ color: game.pressRight ? COLOR_BUTTON_TEXT_ACTIVE : COLOR_BUTTON_TEXT }}
        >
          R
        </span>
      </div>

      <div
        onTouchStart={() => game.buttonJumpDown()}
        onTouchEnd={() => game.buttonJumpUp()}
        style={{
          position: 'absolute',
          left: DISPLAY_W - MARGIN - JUMP_W,
          top: BUTTON_Y,
          width: JUMP_W,
          height: BUTTON_H,
          backgroundColor: game.pressJump ? COLOR_BUTTON_ACTIVE : COLOR_BUTTON,
          borderWidth: 2,
          borderColor: COLOR_BUTTON_BORDER,
          opacity: 0.85,
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <span
          class="sky-hop-button-glyph"
          style={{ color: game.pressJump ? COLOR_BUTTON_TEXT_ACTIVE : COLOR_BUTTON_TEXT }}
        >
          JUMP
        </span>
      </div>

      <div
        onPress={() => game.buttonRestart()}
        style={{
          position: 'absolute',
          left: DISPLAY_W - MARGIN - 34,
          top: 44,
          width: 34,
          height: 28,
          backgroundColor: COLOR_BUTTON,
          borderWidth: 1,
          borderColor: COLOR_BUTTON_BORDER,
          opacity: 0.85,
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <span class="sky-hop-restart-glyph" style={{ color: COLOR_BUTTON_TEXT }}>
          R
        </span>
      </div>
    </div>
  )
}
