import { crateImage, dirtImage, grassTopImage } from '../assets'
import { TILE } from '../constants'
import { game } from '../stores/GameStore'

export function LevelTiles() {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: 2196, height: 504 }}>
      {game.dirtTiles.map(tile => (
        <Image src={dirtImage} style={{ position: 'absolute', left: tile.x, top: tile.y, width: TILE, height: TILE }} />
      ))}
      {game.grassTiles.map(tile => (
        <Image src={grassTopImage} style={{ position: 'absolute', left: tile.x, top: tile.y, width: TILE, height: TILE }} />
      ))}
      {game.crateTiles.map(tile => (
        <Image src={crateImage} style={{ position: 'absolute', left: tile.x, top: tile.y, width: TILE, height: TILE }} />
      ))}
    </div>
  )
}
