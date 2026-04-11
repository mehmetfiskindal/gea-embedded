import { Button } from 'gea-embedded'
import { store } from '../stores/ClickerStore'

export function TrackpadScreen() {
  return (
    <div class="screen">
      <div
        class="trackpadArea"
        onTouchStart={(x, y) => store.initTouch(x, y)}
        onTouchMove={(x, y) => store.trackpadMove(x, y)}
        onTouchEnd={() => store.resetTouch()}
        onClick={() => store.leftClick()}
      >
        <span class="buttonLabel">TRACKPAD</span>
      </div>
      <Button class="trackpadRightClick" onClick={() => store.rightClick()}>
        RIGHT CLICK
      </Button>
      <div class="bottomRow">
        <Button class="navButton" onClick={() => store.switchScreen(1)}>
          MOUSE
        </Button>
        <Button class="navButton" onClick={() => store.switchScreen(0)}>
          BACK
        </Button>
      </div>
    </div>
  )
}
