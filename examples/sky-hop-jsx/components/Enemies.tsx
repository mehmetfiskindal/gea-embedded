import { droneImage } from '../assets'
import { DRONE_SPRITE } from '../constants'
import { game } from '../stores/GameStore'

export function Enemies() {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: 2196, height: 504 }}>
      {game.enemies.map(enemy => (
        <Image
          src={droneImage}
          style={{
            position: 'absolute',
            left: enemy.x,
            top: enemy.y,
            width: DRONE_SPRITE,
            height: DRONE_SPRITE,
            display: enemy.dead
          }}
        />
      ))}
    </div>
  )
}
