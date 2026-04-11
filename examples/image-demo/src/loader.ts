import { display, fetchBytes, images, WHITE } from './runtime'

export const TEST_URL = 'https://upload.wikimedia.org/wikipedia/commons/2/2c/Rotating_earth_%28large%29.gif'

export function showLoading() {
  display.clear()
  display.drawText('Loading image...', 10, 10, WHITE, 2)
  display.flush()
}

export async function loadRemoteImage() {
  const response = await fetchBytes(TEST_URL)
  if (!response.ok) {
    display.drawText(`HTTP ${response.status}`, 10, 50, display.color(255, 0, 0), 2)
    display.flush()
    return -1
  }

  const bytes = await response.arrayBuffer()
  const id = images.loadBytes(bytes)
  if (id < 0) {
    display.drawText('Decode failed', 10, 50, display.color(255, 0, 0), 2)
    display.flush()
  }
  return id
}
