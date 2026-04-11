import { loadImage } from 'gea-embedded'
import {
  crateBytes,
  dirtBytes,
  droneBytes,
  goalFlagBytes,
  grassTopBytes,
  heroIdleBytes,
  heroWalkBytes,
  hillBackgroundBytes
} from './src/assetBytes'

export const grassTopImage = loadImage(grassTopBytes)
export const dirtImage = loadImage(dirtBytes)
export const crateImage = loadImage(crateBytes)
export const heroIdleImage = loadImage(heroIdleBytes)
export const heroWalkImage = loadImage(heroWalkBytes)
export const droneImage = loadImage(droneBytes)
export const hillBackgroundImage = loadImage(hillBackgroundBytes)
export const goalFlagImage = loadImage(goalFlagBytes)
