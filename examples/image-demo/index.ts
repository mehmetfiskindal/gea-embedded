import { loadRemoteImage, showLoading } from './src/loader'
import { animateImage, drawImageSummary } from './src/viewer'

async function main() {
  showLoading()
  const id = await loadRemoteImage()
  if (id < 0) return

  const bounds = drawImageSummary(id)
  if (bounds.animated) animateImage(id, bounds)
}

main()
