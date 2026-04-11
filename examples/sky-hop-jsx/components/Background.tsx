import { hillBackgroundImage } from '../assets'
import { COLOR_WATER, DISPLAY_H, DISPLAY_W, HILL_BG_H, HORIZON_Y } from '../constants'

export function Background() {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: DISPLAY_W, height: DISPLAY_H }}>
      <Image src={hillBackgroundImage} style={{ position: 'absolute', left: 0, top: 0, width: DISPLAY_W, height: HILL_BG_H }} />
      <div style={{ position: 'absolute', left: 0, top: HORIZON_Y, width: DISPLAY_W, height: DISPLAY_H - HORIZON_Y, backgroundColor: COLOR_WATER }} />
    </div>
  )
}
