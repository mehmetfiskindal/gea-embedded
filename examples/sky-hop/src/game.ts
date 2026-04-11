import type { GameAssets } from './assets'
import type { InputState } from './input'
import { getControlButtons } from './input'
import { display, images } from './runtime'

const TILE = 36
const PLAYER_W = 29
const PLAYER_H = 34
const GRAVITY = 0.00142
const MOVE_ACCEL = 0.00138
const GROUND_FRICTION = 0.76
const AIR_FRICTION = 0.945
const MAX_SPEED = 0.285
const JUMP_VELOCITY = -0.69
const COYOTE_MS = 120
const JUMP_BUFFER_MS = 160

const RAW_LEVEL = [
  '                                                            ',
  '                                                            ',
  '                       o       o          o                 ',
  '                 ####     ###        ###                    ',
  '                                                            ',
  '        o                         o         ###             ',
  '     #######         ###     ########             o         ',
  '                                      e       #######       ',
  '             ###             o                         G    ',
  '   o                   #######       ###      #######       ',
  ' ####        e                                           ####',
  '      B                      B                     B         ',
  '################   #############   ##########################',
  '################   #############   ##########################'
]

type Coin = {
  x: number
  y: number
  collected: boolean
}

type Enemy = {
  x: number
  y: number
  vx: number
  alive: boolean
}

type Goal = {
  x: number
  y: number
}

export type GameState = {
  level: string[]
  playerX: number
  playerY: number
  playerVx: number
  playerVy: number
  playerFacing: number
  onGround: boolean
  jumpWasDown: boolean
  coins: Coin[]
  enemies: Enemy[]
  goal: Goal
  score: number
  lives: number
  won: boolean
  cameraX: number
  walkFrame: number
  hurtCooldownMs: number
  coyoteMs: number
  jumpBufferMs: number
}

function normalizeLevel() {
  const width = RAW_LEVEL.reduce((max, row) => Math.max(max, row.length), 0)
  return RAW_LEVEL.map(row => row.padEnd(width, ' '))
}

function scanLevel(level: string[]) {
  const coins: Coin[] = []
  const enemies: Enemy[] = []
  let goal: Goal = { x: (level[0].length - 3) * TILE, y: 8 * TILE }

  for (let row = 0; row < level.length; row++) {
    let next = ''
    for (let col = 0; col < level[row].length; col++) {
      const tile = level[row][col]
      if (tile === 'o') {
        coins.push({ x: col * TILE + TILE / 2, y: row * TILE + TILE / 2, collected: false })
        next += ' '
      } else if (tile === 'e') {
        enemies.push({ x: col * TILE + 4, y: row * TILE + 5, vx: col % 2 === 0 ? 0.06 : -0.06, alive: true })
        next += ' '
      } else if (tile === 'G') {
        goal = { x: col * TILE + 10, y: row * TILE - 28 }
        next += ' '
      } else {
        next += tile
      }
    }
    level[row] = next
  }

  return { coins, enemies, goal }
}

export function createGame(): GameState {
  const level = normalizeLevel()
  const scanned = scanLevel(level)
  return {
    level,
    playerX: 74,
    playerY: 342,
    playerVx: 0,
    playerVy: 0,
    playerFacing: 1,
    onGround: false,
    jumpWasDown: false,
    coins: scanned.coins,
    enemies: scanned.enemies,
    goal: scanned.goal,
    score: 0,
    lives: 3,
    won: false,
    cameraX: 0,
    walkFrame: 0,
    hurtCooldownMs: 0,
    coyoteMs: 0,
    jumpBufferMs: 0
  }
}

function restartGame(game: GameState) {
  const next = createGame()
  game.level = next.level
  game.playerX = next.playerX
  game.playerY = next.playerY
  game.playerVx = next.playerVx
  game.playerVy = next.playerVy
  game.playerFacing = next.playerFacing
  game.onGround = next.onGround
  game.jumpWasDown = next.jumpWasDown
  game.coins = next.coins
  game.enemies = next.enemies
  game.goal = next.goal
  game.score = next.score
  game.lives = next.lives
  game.won = next.won
  game.cameraX = next.cameraX
  game.walkFrame = next.walkFrame
  game.hurtCooldownMs = next.hurtCooldownMs
  game.coyoteMs = next.coyoteMs
  game.jumpBufferMs = next.jumpBufferMs
}

function resetPlayer(game: GameState) {
  game.playerX = 74
  game.playerY = 342
  game.playerVx = 0
  game.playerVy = 0
  game.onGround = false
  game.coyoteMs = 0
  game.jumpBufferMs = 0
  game.hurtCooldownMs = 900
}

function loseLife(game: GameState) {
  game.lives -= 1
  if (game.lives <= 0) restartGame(game)
  else resetPlayer(game)
}

function tileAt(game: GameState, col: number, row: number) {
  if (row < 0) return ' '
  if (row >= game.level.length) return ' '
  if (col < 0 || col >= game.level[row].length) return '#'
  return game.level[row][col]
}

function isSolidTile(tile: string) {
  return tile === '#' || tile === 'B'
}

function isSolidAt(game: GameState, x: number, y: number) {
  return isSolidTile(tileAt(game, Math.floor(x / TILE), Math.floor(y / TILE)))
}

function rectHitsWorld(game: GameState, x: number, y: number, w: number, h: number) {
  return isSolidAt(game, x, y) ||
    isSolidAt(game, x + w - 1, y) ||
    isSolidAt(game, x, y + h - 1) ||
    isSolidAt(game, x + w - 1, y + h - 1)
}

function movePlayerX(game: GameState, amount: number) {
  game.playerX += amount
  if (!rectHitsWorld(game, game.playerX, game.playerY, PLAYER_W, PLAYER_H)) return

  if (amount > 0) {
    const col = Math.floor((game.playerX + PLAYER_W) / TILE)
    game.playerX = col * TILE - PLAYER_W - 0.01
  } else if (amount < 0) {
    const col = Math.floor(game.playerX / TILE)
    game.playerX = (col + 1) * TILE + 0.01
  }
  game.playerVx = 0
}

function movePlayerY(game: GameState, amount: number) {
  game.playerY += amount
  game.onGround = false
  if (!rectHitsWorld(game, game.playerX, game.playerY, PLAYER_W, PLAYER_H)) return

  if (amount > 0) {
    const row = Math.floor((game.playerY + PLAYER_H) / TILE)
    game.playerY = row * TILE - PLAYER_H - 0.01
    game.onGround = true
  } else if (amount < 0) {
    const row = Math.floor(game.playerY / TILE)
    game.playerY = (row + 1) * TILE + 0.01
  }
  game.playerVy = 0
}

function updateEnemies(game: GameState, deltaMs: number) {
  for (const enemy of game.enemies) {
    if (!enemy.alive) continue
    const nextX = enemy.x + enemy.vx * deltaMs
    const footY = enemy.y + 28
    const probeX = enemy.vx > 0 ? nextX + 28 : nextX
    const wallX = enemy.vx > 0 ? nextX + 30 : nextX - 2
    if (isSolidAt(game, wallX, enemy.y + 14) || !isSolidAt(game, probeX, footY + 4)) {
      enemy.vx = -enemy.vx
    } else {
      enemy.x = nextX
    }
  }
}

function intersects(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by
}

function collectCoins(game: GameState) {
  for (const coin of game.coins) {
    if (coin.collected) continue
    if (intersects(game.playerX, game.playerY, PLAYER_W, PLAYER_H, coin.x - 10, coin.y - 10, 20, 20)) {
      coin.collected = true
      game.score += 1
    }
  }
}

function touchEnemies(game: GameState) {
  for (const enemy of game.enemies) {
    if (!enemy.alive) continue
    if (!intersects(game.playerX, game.playerY, PLAYER_W, PLAYER_H, enemy.x + 3, enemy.y + 4, 26, 25)) continue

    if (game.playerVy > 0 && game.playerY + PLAYER_H < enemy.y + 24) {
      enemy.alive = false
      game.playerVy = JUMP_VELOCITY * 0.72
      game.score += 2
    } else if (game.hurtCooldownMs <= 0) {
      loseLife(game)
    }
  }
}

function updateCamera(game: GameState) {
  const worldW = game.level[0].length * TILE
  const target = game.playerX - display.width * 0.42
  game.cameraX = Math.max(0, Math.min(worldW - display.width, target))
}

function checkGoal(game: GameState) {
  if (intersects(game.playerX, game.playerY, PLAYER_W, PLAYER_H, game.goal.x - 10, game.goal.y, 28, 92)) {
    game.won = true
  }
}

export function tickGame(game: GameState, input: InputState, deltaMs: number) {
  if (input.restart) {
    restartGame(game)
    input.restart = false
    return
  }

  if (game.hurtCooldownMs > 0) game.hurtCooldownMs -= deltaMs
  if (game.won) {
    updateCamera(game)
    return
  }

  const direction = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  if (direction !== 0) {
    game.playerVx += direction * MOVE_ACCEL * deltaMs
    game.playerFacing = direction
  }

  const friction = game.onGround ? GROUND_FRICTION : AIR_FRICTION
  game.playerVx *= friction
  game.playerVx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, game.playerVx))

  if (game.onGround) game.coyoteMs = COYOTE_MS
  else game.coyoteMs = Math.max(0, game.coyoteMs - deltaMs)

  if (input.jump && !game.jumpWasDown) game.jumpBufferMs = JUMP_BUFFER_MS
  else if (game.jumpBufferMs > 0) game.jumpBufferMs = Math.max(0, game.jumpBufferMs - deltaMs)
  game.jumpWasDown = input.jump

  if (game.jumpBufferMs > 0 && game.coyoteMs > 0) {
    game.playerVy = JUMP_VELOCITY
    game.onGround = false
    game.coyoteMs = 0
    game.jumpBufferMs = 0
  }

  game.playerVy += GRAVITY * deltaMs
  if (game.playerVy > 0.72) game.playerVy = 0.72

  movePlayerX(game, game.playerVx * deltaMs)
  movePlayerY(game, game.playerVy * deltaMs)

  const voidY = game.level.length * TILE + 6
  if (game.playerY > voidY) loseLife(game)

  game.walkFrame += Math.abs(game.playerVx) * deltaMs
  updateEnemies(game, deltaMs)
  collectCoins(game)
  touchEnemies(game)
  checkGoal(game)
  updateCamera(game)
}

function screenX(game: GameState, worldX: number) {
  return Math.round(worldX - game.cameraX)
}

function drawBackground() {
  const sky = display.color(47, 150, 209)
  const farHill = display.color(98, 202, 128)
  const nearHill = display.color(65, 171, 108)
  const water = display.color(42, 153, 210)

  display.fillRect(0, 0, display.width, display.height, sky)
  display.fillTriangle(-58, 188, 128, 24, 336, 188, nearHill)
  display.fillTriangle(156, 188, 330, 46, display.width + 82, 188, farHill)
  display.fillRect(0, 182, display.width, display.height - 182, water)
}

function drawLevel(game: GameState, assets: GameAssets) {
  const firstCol = Math.max(0, Math.floor(game.cameraX / TILE) - 1)
  const lastCol = Math.min(game.level[0].length - 1, Math.ceil((game.cameraX + display.width) / TILE) + 1)

  for (let row = 0; row < game.level.length; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      const tile = tileAt(game, col, row)
      if (!isSolidTile(tile)) continue

      const x = screenX(game, col * TILE)
      const y = row * TILE
      if (tile === 'B') {
        images.draw(assets.crate, x, y)
      } else if (tileAt(game, col, row - 1) === ' ') {
        images.draw(assets.grassTop, x, y)
      } else {
        images.draw(assets.dirt, x, y)
      }
    }
  }
}

function drawCoins(game: GameState) {
  const gold = display.color(248, 196, 77)
  const rim = display.color(133, 92, 31)
  for (const coin of game.coins) {
    if (coin.collected) continue
    const x = screenX(game, coin.x)
    if (x < -16 || x > display.width + 16) continue
    const pulse = Math.floor(game.walkFrame / 28) % 2
    display.fillCircle(x, coin.y, pulse ? 8 : 7, gold)
    display.strokeCircle(x, coin.y, pulse ? 8 : 7, rim)
  }
}

function drawEnemies(game: GameState, assets: GameAssets) {
  for (const enemy of game.enemies) {
    if (!enemy.alive) continue
    const x = screenX(game, enemy.x)
    if (x < -40 || x > display.width + 40) continue
    images.draw(assets.drone, x, Math.round(enemy.y))
  }
}

function drawGoal(game: GameState) {
  const x = screenX(game, game.goal.x)
  const pole = display.color(245, 245, 245)
  const flag = display.color(248, 196, 77)
  const shadow = display.color(133, 92, 31)
  display.fillRect(x, game.goal.y, 5, 94, pole)
  display.fillTriangle(x + 5, game.goal.y + 6, x + 56, game.goal.y + 24, x + 5, game.goal.y + 44, flag)
  display.strokeRect(x + 5, game.goal.y + 11, 34, 23, shadow)
}

function drawPlayer(game: GameState, assets: GameAssets) {
  const blinking = game.hurtCooldownMs > 0 && Math.floor(game.hurtCooldownMs / 90) % 2 === 0
  if (blinking) return
  const id = Math.abs(game.playerVx) > 0.04 && Math.floor(game.walkFrame / 36) % 2 === 0 ? assets.heroWalk : assets.heroIdle
  images.draw(id, screenX(game, game.playerX - 4), Math.round(game.playerY - 2))
}

function drawHud(game: GameState) {
  const shade = display.color(22, 38, 57)
  const white = display.color(255, 255, 255)
  const gold = display.color(248, 196, 77)
  display.fillRect(0, 0, display.width, 36, shade)
  display.drawText('Sky Hop', 12, 9, white, 1)
  display.drawText('Coins ' + game.score + '/' + game.coins.length, 116, 9, gold, 1)
  display.drawText('Lives ' + game.lives, 272, 9, white, 1)
  if (game.won) {
    display.fillRect(47, 168, 316, 116, display.color(22, 38, 57))
    display.strokeRect(47, 168, 316, 116, gold)
    display.drawText('Course Clear', 88, 190, white, 2)
    display.drawText('Coins ' + game.score + '/' + game.coins.length, 132, 236, gold, 1)
  }
}

function drawArrowButton(x: number, y: number, w: number, h: number, direction: 'left' | 'right' | 'up', active: boolean) {
  const bg = active ? display.color(248, 196, 77) : display.color(22, 38, 57)
  const border = active ? display.color(255, 255, 255) : display.color(226, 247, 255)
  const icon = active ? display.color(22, 38, 57) : display.color(255, 255, 255)
  display.setAlpha?.(218)
  display.fillRect(x, y, w, h, bg)
  display.setAlpha?.(255)
  display.strokeRect(x, y, w, h, border)

  const cx = x + Math.floor(w / 2)
  const cy = y + Math.floor(h / 2)
  if (direction === 'left') {
    display.fillTriangle(cx - 17, cy, cx + 12, cy - 18, cx + 12, cy + 18, icon)
  } else if (direction === 'right') {
    display.fillTriangle(cx + 17, cy, cx - 12, cy - 18, cx - 12, cy + 18, icon)
  } else {
    display.fillTriangle(cx, cy - 20, cx - 22, cy + 14, cx + 22, cy + 14, icon)
  }
}

function drawControls(input: InputState) {
  const controls = getControlButtons()
  const restart = controls.find(control => control.id === 'restart')
  for (const control of controls) {
    if (control.id === 'left') drawArrowButton(control.x, control.y, control.w, control.h, 'left', input.left)
    if (control.id === 'right') drawArrowButton(control.x, control.y, control.w, control.h, 'right', input.right)
    if (control.id === 'jump') drawArrowButton(control.x, control.y, control.w, control.h, 'up', input.jump)
  }
  if (restart) {
    const bg = input.restart ? display.color(248, 196, 77) : display.color(22, 38, 57)
    const fg = input.restart ? display.color(22, 38, 57) : display.color(255, 255, 255)
    display.setAlpha?.(218)
    display.fillRect(restart.x, restart.y, restart.w, restart.h, bg)
    display.setAlpha?.(255)
    display.strokeRect(restart.x, restart.y, restart.w, restart.h, display.color(226, 247, 255))
    display.drawText('R', restart.x + 11, restart.y + 7, fg, 1)
  }
}

export function renderGame(game: GameState, assets: GameAssets, input: InputState) {
  drawBackground()
  drawCoins(game)
  drawGoal(game)
  drawLevel(game, assets)
  drawEnemies(game, assets)
  drawPlayer(game, assets)
  drawHud(game)
  drawControls(input)
  display.flush()
}
