import { images } from './runtime'
import { crate36Png, dirt36Png, drone32Png, grassTop36Png, heroIdle38Png, heroWalk38Png } from './assetBytes'

export type GameAssets = {
  grassTop: number
  dirt: number
  crate: number
  heroIdle: number
  heroWalk: number
  drone: number
}

function loadImage(bytes: Uint8Array) {
  const id = images.loadBytes(bytes.buffer as ArrayBuffer)
  return id >= 0 ? id : -1
}

export function loadAssets(): GameAssets | null {
  const grassTop = loadImage(grassTop36Png)
  const dirt = loadImage(dirt36Png)
  const crate = loadImage(crate36Png)
  const heroIdle = loadImage(heroIdle38Png)
  const heroWalk = loadImage(heroWalk38Png)
  const drone = loadImage(drone32Png)

  if (grassTop < 0 || dirt < 0 || crate < 0 || heroIdle < 0 || heroWalk < 0 || drone < 0) return null

  return {
    grassTop,
    dirt,
    crate,
    heroIdle,
    heroWalk,
    drone
  }
}
