import { Store, Apps } from 'gea-embedded'

export class LauncherStore extends Store {
  page = 0

  init() {
    this.page = 0
  }

  select(id: number) {
    if (id == 1) Apps.launch('analog-clock')
    else if (id == 2) Apps.launch('bouncing-balls-jsx')
    else if (id == 3) Apps.launch('button-tetris')
    else if (id == 4) Apps.launch('hid-clicker')
    else if (id == 5) Apps.launch('tic-tac-toe')
    else if (id == 6) Apps.launch('tilt-breakout')
    else if (id == 7) Apps.launch('static-card')
    else if (id == 8) Apps.launch('typography')
    else if (id == 9) Apps.launch('sky-hop-jsx')
  }

  nextPage() {
    this.page = 1
  }

  prevPage() {
    this.page = 0
  }

  tick(timestampMs: number) {}
}

export const launcher = new LauncherStore()
