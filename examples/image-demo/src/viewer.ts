import { DARK, display, H, images, requestFrame, W, WHITE } from './runtime'

export function drawImageSummary(id: number) {
  const iw = images.width(id)
  const ih = images.height(id)
  const frames = images.frameCount(id)
  const dx = Math.floor((W - iw) / 2)
  const dy = Math.floor((H - ih) / 2)

  display.clear()
  display.drawText(`${iw}x${ih} ${frames}f`, 10, 10, WHITE, 1)
  images.draw(id, dx, dy)
  display.flush()

  return { dx, dy, iw, ih, animated: images.isAnimated(id) }
}

export function animateImage(id: number, bounds: { dx: number; dy: number; iw: number; ih: number }) {
  let lastTime = 0
  requestFrame(function loop(timestampMs) {
    const delta = lastTime === 0 ? 0 : timestampMs - lastTime
    lastTime = timestampMs

    if (images.advance(id, delta)) {
      display.fillRect(bounds.dx, bounds.dy, bounds.iw, bounds.ih, DARK)
      images.draw(id, bounds.dx, bounds.dy)
    }

    requestFrame(loop)
  })
}
