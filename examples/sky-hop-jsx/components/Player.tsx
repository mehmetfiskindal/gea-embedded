import { heroIdleImage, heroWalkImage } from '../assets'
import { PLAYER_SPRITE } from '../constants'
import { game } from '../stores/GameStore'

export function Player() {
  return (
    <Image
      src={Math.abs(game.playerVx) > 0.04 && game.walkCycle === 0 ? heroWalkImage : heroIdleImage}
      style={{
        position: 'absolute',
        left: game.playerX - 4,
        top: game.playerY - 2,
        width: PLAYER_SPRITE,
        height: PLAYER_SPRITE,
        display: game.blink
      }}
    />
  )
}
