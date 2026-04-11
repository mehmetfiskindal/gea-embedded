import { loadAssets } from './src/assets'
import { createGame, renderGame, tickGame } from './src/game'
import { bindInput, pollInput } from './src/input'
import { display, requestFrame } from './src/runtime'

function showLoading() {
  display.clear()
  display.fillRect(0, 0, display.width, display.height, display.color(47, 150, 209))
  display.drawText('Loading Sky Hop...', 20, 224, display.color(255, 255, 255), 2)
  display.flush()
}

function showLoadError() {
  display.clear()
  display.fillRect(0, 0, display.width, display.height, display.color(31, 41, 55))
  display.drawText('Asset load failed', 24, 214, display.color(255, 255, 255), 2)
  display.drawText('Rebuild the web app.', 24, 252, display.color(248, 196, 77), 1)
  display.flush()
}

function main() {
  showLoading()
  const assets = loadAssets()
  if (!assets) {
    showLoadError()
    return
  }

  const input = bindInput()
  const game = createGame()
  let lastTimestampMs = 0

  requestFrame(function frame(timestampMs) {
    if (lastTimestampMs === 0) lastTimestampMs = timestampMs
    const deltaMs = Math.min(42, timestampMs - lastTimestampMs)
    lastTimestampMs = timestampMs

    pollInput(input)
    tickGame(game, input, deltaMs)
    renderGame(game, assets, input)
    requestFrame(frame)
  })
}

main()
