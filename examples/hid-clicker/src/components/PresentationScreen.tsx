import { Button } from 'gea-embedded'
import { store } from '../stores/ClickerStore'

export function PresentationScreen() {
  return (
    <div class="screen">
      <Button class="prevButton" onClick={() => store.prevSlide()}>PREV</Button>
      <Button class="nextButton" onClick={() => store.nextSlide()}>NEXT</Button>
      <Button class="mouseToggleButton" onClick={() => store.switchScreen(1)}>MOUSE MODE</Button>
    </div>
  )
}
