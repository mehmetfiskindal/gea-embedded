import { Button } from 'gea-embedded'
import { store } from '../stores/ClickerStore'

export function MouseScreen() {
  return (
    <div class="screen">
      <div class="mouseButtonRow">
        <Button
          class="leftClickButton"
          onTouchStart={() => store.mouseLeftDown()}
          onTouchEnd={() => store.mouseLeftUp()}
        >
          LEFT
        </Button>
        <div class="scrollZone" onTouchStart={(x, y) => store.initTouch(x, y)} onTouchMove={(x, y) => store.scrollMove(x, y)} onTouchEnd={() => store.resetTouch()}>
          <span class="buttonLabel">SCROLL</span>
        </div>
        <Button
          class="rightClickButton"
          onTouchStart={() => store.mouseRightDown()}
          onTouchEnd={() => store.mouseRightUp()}
        >
          RIGHT
        </Button>
      </div>
      <div class="bottomRow">
        <Button class="navButton" onClick={() => store.switchScreen(0)}>
          BACK
        </Button>
        <Button class="biasButton" onClick={() => store.recaptureBias()}>
          BIAS
        </Button>
        <Button class="navButton" onClick={() => store.switchScreen(2)}>
          PAD
        </Button>
      </div>
    </div>
  )
}
