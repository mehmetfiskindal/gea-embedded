import { execFileSync } from 'child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { describe, expect, it, beforeAll } from 'vitest'
import { geaEmbeddedPlugin } from '../../../lib/vite-plugin-gea-embedded'

const TTT_ROOT = join(__dirname, '..')
const BOUNCING_BALLS_JSX_ROOT = join(__dirname, '..', '..', 'bouncing-balls-jsx')
const TTT_SOURCE = readFileSync(join(TTT_ROOT, 'index.tsx'), 'utf8')
  .replace("import { Settings, mount } from 'gea-embedded'", "import { mount } from 'gea-embedded'")
  .replace('Settings.init()\n', '')
const BOUNCING_BALLS_JSX_SOURCE = readFileSync(join(BOUNCING_BALLS_JSX_ROOT, 'index.tsx'), 'utf8')
const BOUNCING_BALLS_JSX_WITH_SETTINGS_SOURCE = BOUNCING_BALLS_JSX_SOURCE
  .replace("import { defaults, mount } from 'gea-embedded'", "import { Settings, defaults, mount } from 'gea-embedded'")
  .replace('balls.init()\n', 'Settings.init()\nballs.init()\n')
  .replace('  balls.tick(timestampMs)\n', '  Settings.tick(timestampMs)\n  balls.tick(timestampMs)\n')
const FONT_SRC = resolve(__dirname, '..', '..', '..', 'assets', 'fonts', 'Oswald-Regular.ttf')
const INTER_FONT_SRC = resolve(__dirname, '..', '..', '..', 'assets', 'fonts', 'Inter-Regular.ttf')
const BEBAS_FONT_SRC = resolve(__dirname, '..', '..', '..', 'assets', 'fonts', 'BebasNeue-Regular.ttf')
const COSSETTE_FONT_SRC = resolve(__dirname, '..', '..', '..', 'assets', 'fonts', 'CossetteTexte-Regular.ttf')
const GEA_EMBEDDED_SRC = resolve(__dirname, '..', '..', '..', 'lib', 'gea-embedded')
const HTTPS_SCAN_SCRIPT = resolve(__dirname, '..', '..', '..', 'scripts', 'detect-app-https-support.mjs')
const RAF_TIMESTAMP_SOURCE = `
import { Store, Component, mount, View } from 'gea-embedded'

class BallStore extends Store {
  frameTime = 0

  tick(timestampMs) {
    this.frameTime = timestampMs
  }
}

const b = new BallStore()

class App extends Component {
  template() {
    return <View style={{ width: 10, height: 10 }} />
  }
}

mount(App)

requestAnimationFrame(function loop(timestampMs) {
  b.tick(timestampMs)
  requestAnimationFrame(loop)
})
`
const ARRAY_LENGTH_DIRTY_SOURCE = `
import { Store, Component, mount, View } from 'gea-embedded'

class StackStore extends Store {
  stack = [{ x: 0, y: 0, left: 0, top: 0, color: '#FFFFFF' }]

  clear() {
    this.stack.length = 4
    this.stack.length = 0
  }
}

const stackStore = new StackStore()

class App extends Component {
  template() {
    return (
      <View style={{ width: 10, height: 10 }}>
        {stackStore.stack.map(block => (
          <View style={{ position: 'absolute', left: block.left, top: block.top, width: 1, height: 1, backgroundColor: block.color }} />
        ))}
      </View>
    )
  }
}

mount(App)
`
const RETURN_DIRTY_SOURCE = `
import { Store, Component, Text, View, mount } from 'gea-embedded'

class CounterStore extends Store {
  count = 0

  bump(): number {
    this.count = this.count + 1
    return this.count
  }
}

const counter = new CounterStore()

class App extends Component {
  template() {
    return (
      <View style={{ width: 10, height: 10 }} onPress={() => counter.bump()}>
        <Text>{counter.count}</Text>
      </View>
    )
  }
}

mount(App)
`
const AUDIO_CONTEXT_SOURCE = `
import { Store, Component, mount, View, audioContext } from 'gea-embedded'

class SoundStore extends Store {
  blip() {
    const oscillator = audioContext.createOscillator()
    oscillator.type = 'square'
    oscillator.frequency.value = 440
    oscillator.frequency.setValueAtTime(660, audioContext.currentTime)
    oscillator.connect(audioContext.destination)
    const now = audioContext.currentTime
    oscillator.start(now)
    oscillator.stop(now + 0.08)
  }
}

const sound = new SoundStore()

class App extends Component {
  template() {
    return <View style={{ width: 10, height: 10 }} onPress={() => sound.blip()} />
  }
}

mount(App)
`
const FONT_FACE_WITHOUT_FONT_FAMILY_SOURCE = `
import { Component, Text, View, mount } from 'gea-embedded'
import './fonts.css'

class App extends Component {
  template() {
    return (
      <View style={{ width: 410, height: 502 }}>
        <Text style={{ fontSize: 18 }}>Plain default text</Text>
      </View>
    )
  }
}

mount(App)
`
const OVERFLOW_SCROLL_SOURCE = `
import { Component, Text, View, mount } from 'gea-embedded'

class App extends Component {
  template() {
    return (
      <View style={{ width: 410, height: 502 }}>
        <View style={{ width: 300, height: 120, overflow: 'scroll' }}>
          <Text>Scrollable content</Text>
        </View>
      </View>
    )
  }
}

mount(App)
`
const CSS_BOX_SHORTHAND_SOURCE = `
import { Component, View, mount } from 'gea-embedded'
import './styles.css'

class App extends Component {
  template() {
    return (
      <View class="box">
        <View class="inset" />
        <View style={{ padding: '2px 4px 6px 8px', margin: '3px 5px' }} />
        <View style={{ width: '10px', height: '11px', gap: '12px', borderRadius: '7px', fontSize: '18px' }} />
      </View>
    )
  }
}

mount(App)
`
const SEMANTIC_HTML_TAG_SOURCE = `
import { Component, mount } from 'gea-embedded'

class App extends Component {
  template() {
    return (
      <div style={{ width: 410, height: 502, color: '#F8FAFC', fontSize: 15 }}>
        <h1>Typography</h1>
        <p>Paragraph <span style={{ color: '#64D2FF' }}>span</span></p>
        <h3 style={{ fontSize: 21 }}>Subhead</h3>
      </div>
    )
  }
}

mount(App)
`
const TRANSFORM_SOURCE = `
import { Store, Component, View, mount } from 'gea-embedded'
import './styles.css'

class SpinStore extends Store {
  angle = 0

  tick(timestampMs: number) {
    this.angle = timestampMs
  }
}

const spin = new SpinStore()

class App extends Component {
  template() {
    return (
      <View style={{ width: 100, height: 100 }}>
        <View class="hand" style={{ transform: \`rotate(\${spin.angle / 10}deg)\` }} />
      </View>
    )
  }
}

mount(App)
`
const WIFI_SOURCE = `
import {
  Store,
  Component,
  Text,
  View,
  mount,
  WiFi
} from 'gea-embedded'

class WifiStore extends Store {
  connected = 0
  ssid = ''
  ip = ''

  refresh() {
    this.connected = WiFi.isConnected()
    this.ssid = WiFi.getSSID()
    this.ip = WiFi.getIP()
  }
}

const wifi = new WifiStore()

class App extends Component {
  template() {
    return (
      <View style={{ width: 410, height: 502 }}>
        <Text>{wifi.connected}</Text>
        <Text>{wifi.ssid}</Text>
        <Text>{wifi.ip}</Text>
      </View>
    )
  }
}

mount(App)
`
const RADIO_TOGGLE_SOURCE = `
import {
  Store,
  Component,
  Text,
  View,
  mount,
  BLE,
  WiFi
} from 'gea-embedded'

class RadioStore extends Store {
  wifiEnabled = 0
  bluetoothEnabled = 0

  refresh() {
    this.wifiEnabled = WiFi.isEnabled()
    this.bluetoothEnabled = BLE.isEnabled()
  }

  disable() {
    WiFi.setEnabled(0)
    BLE.setEnabled(0)
  }
}

const radios = new RadioStore()

class App extends Component {
  template() {
    return (
      <View style={{ width: 410, height: 502 }}>
        <Text>{radios.wifiEnabled}</Text>
        <Text>{radios.bluetoothEnabled}</Text>
        <View onClick={() => radios.disable()} />
      </View>
    )
  }
}

mount(App)
`
const LOGICAL_GROUPING_SOURCE = `
import { Store, Component, mount, View } from 'gea-embedded'

class CollisionStore extends Store {
  stack = [{ x: 0, y: 0 }]

  collides(x0: number, y0: number, x1: number, y1: number): number {
    for (let i = 0; i < this.stack.length; i++) {
      if ((this.stack[i].x == x0 && this.stack[i].y == y0) || (this.stack[i].x == x1 && this.stack[i].y == y1)) return 1
    }
    return 0
  }
}

const game = new CollisionStore()

class App extends Component {
  template() {
    return <View style={{ width: 10, height: 10 }} />
  }
}

mount(App)
`
const IF_ELSE_CHAIN_SOURCE = `
import { Store, Component, Text, View, mount } from 'gea-embedded'

class ChainStore extends Store {
  connected = 0
  bound = 0
  status = ''

  refresh() {
    if (this.connected) this.status = 'Connected'
    else if (this.bound) this.status = 'Bound'
    else this.status = 'Idle'
  }
}

const chain = new ChainStore()
chain.refresh()

class App extends Component {
  template() {
    return (
      <View style={{ width: 100, height: 100 }}>
        <Text>{chain.status}</Text>
      </View>
    )
  }
}

mount(App)
`
const INPUT_KEYBOARD_SOURCE = `
import { Store, Component, mount, View } from 'gea-embedded'

class FormStore extends Store {
  text = ''
  lastKey = 0
  focused = 0
  shouldAutoFocus = 0

  handleFocus() {
    this.focused = 1
  }

  handleBlur() {
    this.focused = 0
  }

  handleInput(value: string) {
    this.text = value
  }

  handleKeyDown(code: number) {
    this.lastKey = code
  }
}

const form = new FormStore()

class App extends Component {
  template() {
    return (
      <View style={{ width: 410, height: 502 }}>
        <input class="todo-edit" type="text" value={form.text} placeholder="Type here" autoFocus={form.shouldAutoFocus === 1} onInput={event => form.handleInput(event.currentTarget.value)} onFocus={form.handleFocus} onBlur={form.handleBlur} onKeyDown={event => form.handleKeyDown(event.keyCode)} />
      </View>
    )
  }
}

mount(App)
`
const PASSWORD_INPUT_SOURCE = `
import { Store, Component, mount, View } from 'gea-embedded'

class LoginStore extends Store {
  password = ''

  handleInput(value: string) {
    this.password = value
  }
}

const login = new LoginStore()

class App extends Component {
  template() {
    return (
      <View style={{ width: 410, height: 502 }}>
        <input type="password" value={login.password} placeholder="Password" onInput={event => login.handleInput(event.currentTarget.value)} />
      </View>
    )
  }
}

mount(App)
`
const PRESS_ID_SOURCE = `
import { Store, Component, mount, View, Button } from 'gea-embedded'

const ENTER_KEY = 13

class PressStore extends Store {
  last = 0
  focusCount = 0

  set(code: number) {
    this.last = code
  }

  focus() {
    this.focusCount = this.focusCount + 1
  }
}

const press = new PressStore()

class App extends Component {
  template() {
    const send = (code: number) => press.set(code)

    return (
      <View style={{ width: 100, height: 100 }}>
        <View pressId={0} onClick={id => press.set(id)} />
        <View onClick={() => press.focus()} />
        <View pressValue={ENTER_KEY} onPress={id => press.set(id)} />
        <Button pressId={65} onClick={send} />
        <View pressId={88} onClick={send} />
        <Button pressValue={90} onPress={send} />
      </View>
    )
  }
}

mount(App)
`
const TOUCH_AND_PRESS_SOURCE = `
import { Store, Component, mount, View } from 'gea-embedded'

class PressStore extends Store {
  left = 0
  restarted = 0

  leftDown() {
    this.left = 1
  }

  leftUp() {
    this.left = 0
  }

  restart() {
    this.restarted = this.restarted + 1
  }
}

const press = new PressStore()

class App extends Component {
  template() {
    return (
      <View style={{ width: 100, height: 100 }}>
        <View onTouchStart={() => press.leftDown()} onTouchEnd={() => press.leftUp()} />
        <View onPress={() => press.restart()} />
      </View>
    )
  }
}

mount(App)
`
const DATA_ATTRIBUTE_SOURCE = `
import { Store, Component, mount, View } from 'gea-embedded'

class PressStore extends Store {
  last = 0
  label = ''

  set(code: number) {
    this.last = code
  }

  setLabel(value: string) {
    this.label = value
  }
}

const press = new PressStore()

function DataKey({ code, onKey }: { code: number; onKey: (code: number) => void }) {
  return <View data-key={code} onClick={event => onKey(event.currentTarget.getAttribute('data-key'))} />
}

class App extends Component {
  template() {
    const send = (code: number) => press.set(code)

    return (
      <View style={{ width: 100, height: 100 }}>
        <View data-key={65} onClick={event => press.set(event.currentTarget.getAttribute('data-key'))} />
        <View data-key={88} onClick={event => press.set(event.target.dataset.key)} />
        <View data-label="wifi" onClick={event => press.setLabel(event.currentTarget.getAttribute('data-label'))} />
        <DataKey code={90} onKey={send} />
      </View>
    )
  }
}

mount(App)
`
const DYNAMIC_PRESS_ID_SOURCE = `
import { Store, Component, mount, View } from 'gea-embedded'

class PressStore extends Store {
  last = 7

  set(code: number) {
    this.last = code
  }
}

const press = new PressStore()

class App extends Component {
  template() {
    return <View pressId={press.last} onClick={id => press.set(id)} />
  }
}

mount(App)
`
const EDITABLE_STRING_SOURCE = `
import { Store, Component, mount, View } from 'gea-embedded'

class FormStore extends Store {
  text = ''

  append() {
    this.text = this.text + 'A'
  }

  backspace() {
    if (this.text.length > 0) this.text = this.text.substring(0, this.text.length - 1)
  }
}

const form = new FormStore()

class App extends Component {
  template() {
    return <View style={{ width: 410, height: 502 }} />
  }
}

mount(App)
`
const ACCELEROMETER_SOURCE = `
import { Store, Component, mount, View, Accelerometer } from 'gea-embedded'

class MotionStore extends Store {
  tilt = 0
  accelX = 0

  init() {
    Accelerometer.start()
  }

  tick() {
    this.tilt = Accelerometer.tiltX + Accelerometer.tiltY
    this.accelX = Accelerometer.x
  }
}

const motion = new MotionStore()
motion.init()

class App extends Component {
  template() {
    return <View style={{ width: 410, height: 502 }} />
  }
}

mount(App)
`
const JS_GLOBALS_SOURCE = `
import { Store, Component, Text, View, mount } from 'gea-embedded'

class ClockStore extends Store {
  elapsed = 0
  piScaled = 0
  trig = 0
  randomBucket = 0
  bounded = 0

  refresh() {
    const started = Date.now()
    this.elapsed = Date.now() - started
    this.piScaled = Math.round(Math.PI * 100)
    this.trig = Math.round(Math.sin(Math.PI / 2) * 10)
    this.randomBucket = Math.floor(Math.random() * 10)
    this.bounded = Math.max(Math.min(this.piScaled, 400), 300)
  }
}

const clock = new ClockStore()
clock.refresh()

class App extends Component {
  template() {
    return (
      <View style={{ width: 100, height: 100 }}>
        <Text>{clock.piScaled}</Text>
      </View>
    )
  }
}

mount(App)
`
const MATH_ABS_SOURCE = `
import { Store, Component, View, mount } from 'gea-embedded'

class AbsStore extends Store {
  last = 0
  value = 0

  move(x: number) {
    const dy = this.last - x
    this.value = Math.abs(dy)
    if (Math.abs(Math.random() - 0.5) > 0.1) this.last = x
  }
}

const absStore = new AbsStore()

class App extends Component {
  template() {
    return <View style={{ width: Math.abs(absStore.value), height: 10 }} />
  }
}

mount(App)
`
const DOUBLE_LOCAL_SOURCE = `
import { Store, Component, View, mount } from 'gea-embedded'

const GROUND_FRICTION = 0.76
const AIR_FRICTION = 0.945

class MotionStore extends Store {
  onGround = 0
  playerVx = 0.0

  tick() {
    const friction = this.onGround ? GROUND_FRICTION : AIR_FRICTION
    this.playerVx = this.playerVx * friction
  }
}

const motion = new MotionStore()

class App extends Component {
  template() {
    return <View style={{ width: 100, height: 100 }} />
  }
}

mount(App)
`
const FUSION_WITH_PRELUDE_SOURCE = `
import { Store, Component, mount, View } from 'gea-embedded'

class BallStore extends Store {
  balls = [{ x: 0, y: 0, dx: 0, dy: 0, color: '#FF0000' }]
  fpsText = 'FPS: --'
  windowStartMs = 0
  windowFrames = 0

  tick(timestampMs: number) {
    if (this.windowStartMs === 0) this.windowStartMs = timestampMs
    this.windowFrames++
    const elapsedMs = timestampMs - this.windowStartMs
    if (elapsedMs >= 500) {
      this.fpsText = 'FPS: ' + this.windowFrames
      this.windowStartMs = timestampMs
      this.windowFrames = 0
    }
    for (let i = 0; i < this.balls.length; i++) {
      this.balls[i].x = this.balls[i].x + this.balls[i].dx
      this.balls[i].y = this.balls[i].y + this.balls[i].dy
    }
  }
}

const balls = new BallStore()

class App extends Component {
  template() {
    return (
      <View style={{ width: 100, height: 100 }}>
        <View>{balls.fpsText}</View>
        {balls.balls.map(ball => (
          <View style={{ position: 'absolute', left: ball.x, top: ball.y, width: 4, height: 4, backgroundColor: ball.color }} />
        ))}
      </View>
    )
  }
}

mount(App)

requestAnimationFrame(function loop(timestampMs) {
  balls.tick(timestampMs)
  requestAnimationFrame(loop)
})
`

function copyFixtureSupportFiles(projectRoot: string, fixtureRoot?: string) {
  if (!fixtureRoot) return

  for (const entry of ['components', 'stores', 'src', 'constants.tsx', 'env.d.ts', 'styles.css']) {
    const sourcePath = join(fixtureRoot, entry)
    if (!existsSync(sourcePath)) continue
    const destPath = join(projectRoot, entry)
    mkdirSync(dirname(destPath), { recursive: true })
    cpSync(sourcePath, destPath, { recursive: true })
  }
}

function buildFixture(source: string, fixtureRoot?: string, extraFiles: Record<string, string> = {}) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'gea-embedded-plugin-'))
  const cOutput = 'generated/gea_embedded_app_generated.c'
  const plugin = geaEmbeddedPlugin({ cOutput })

  copyFixtureSupportFiles(projectRoot, fixtureRoot)
  mkdirSync(join(projectRoot, 'node_modules'), { recursive: true })
  cpSync(GEA_EMBEDDED_SRC, join(projectRoot, 'node_modules', 'gea-embedded'), { recursive: true })
  writeFileSync(join(projectRoot, 'index.tsx'), source)
  for (const [fileName, contents] of Object.entries(extraFiles)) {
    const filePath = join(projectRoot, fileName)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, contents)
  }

  const fontsDir = join(projectRoot, 'assets', 'fonts')
  mkdirSync(fontsDir, { recursive: true })
  copyFileSync(FONT_SRC, join(fontsDir, 'Oswald-Regular.ttf'))
  copyFileSync(INTER_FONT_SRC, join(fontsDir, 'Inter-Regular.ttf'))
  copyFileSync(BEBAS_FONT_SRC, join(fontsDir, 'BebasNeue-Regular.ttf'))
  copyFileSync(COSSETTE_FONT_SRC, join(fontsDir, 'CossetteTexte-Regular.ttf'))
  const sharedFontsDir = resolve(projectRoot, '..', '..', 'assets', 'fonts')
  mkdirSync(sharedFontsDir, { recursive: true })
  copyFileSync(INTER_FONT_SRC, join(sharedFontsDir, 'Inter-Regular.ttf'))
  writeFileSync(
    join(projectRoot, 'fonts.css'),
    `@font-face { font-family: 'Oswald'; src: url('./assets/fonts/Oswald-Regular.ttf'); }\n`
  )
  ;(plugin as any).configResolved({ root: projectRoot })

  const result = (plugin as any).transform(source, join(projectRoot, 'index.tsx'))
  if (!result || typeof result !== 'object' || !('code' in result)) {
    throw new Error('Expected plugin transform result')
  }

  const cPath = join(projectRoot, cOutput)
  const generatedC = readFileSync(cPath, 'utf8')

  return { js: result.code as string, c: generatedC, projectRoot }
}

function buildTicTacToeFixture() {
  return buildFixture(TTT_SOURCE, TTT_ROOT)
}

function countMatches(source: string, pattern: RegExp) {
  return source.match(pattern)?.length ?? 0
}

function runHttpsScan(projectRoot: string, appIds: string[]) {
  return execFileSync('node', [HTTPS_SCAN_SCRIPT, join(projectRoot, 'apps.json'), ...appIds], {
    encoding: 'utf8'
  }).trim()
}

function writeScanFixture(projectRoot: string, appId: string, source: string, extraFiles: Record<string, string> = {}) {
  const appRoot = join(projectRoot, appId)
  mkdirSync(appRoot, { recursive: true })
  writeFileSync(join(appRoot, 'index.tsx'), source)
  for (const [fileName, contents] of Object.entries(extraFiles)) {
    const filePath = join(appRoot, fileName)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, contents)
  }
  return {
    id: appId,
    root: appId,
    entry: 'index.tsx',
    runtime: 'app-render',
    targets: { esp32: { enabled: true } }
  }
}

describe('ESP32 HTTPS support detection', () => {
  it('does not enable HTTPS support for apps with only HTTP URLs', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'gea-embedded-https-scan-'))
    const app = writeScanFixture(
      projectRoot,
      'plain-http',
      "const url = 'http://example.test/image.gif'\nfetch(url)\n",
      {
        'package-lock.json': '{"resolved":"https://registry.npmjs.org/example.tgz"}',
        'test/app.test.ts': "it('documents a remote fixture', () => 'https://example.test/test-only.json')\n"
      }
    )
    writeFileSync(join(projectRoot, 'apps.json'), JSON.stringify({ apps: [app] }))

    expect(runHttpsScan(projectRoot, ['plain-http'])).toBe('0')
  })

  it('enables HTTPS support when any selected app contains an HTTPS URL', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'gea-embedded-https-scan-'))
    const httpApp = writeScanFixture(projectRoot, 'plain-http', "fetch('http://example.test/data.json')\n")
    const httpsApp = writeScanFixture(projectRoot, 'secure-http', "fetch('https://example.test/data.json')\n")
    writeFileSync(join(projectRoot, 'apps.json'), JSON.stringify({ apps: [httpApp, httpsApp] }))

    expect(runHttpsScan(projectRoot, ['plain-http', 'secure-http'])).toBe('1')
  })
})

/* ================================================================
 * COMPILER OUTPUT — C STRUCTURE
 * ================================================================ */

describe('Generated C structure', () => {
  let c: string

  beforeAll(() => {
    ;({ c } = buildTicTacToeFixture())
  })

  it('includes required headers', () => {
    expect(c).toContain('#define GEA_EMBEDDED_PURE_C 1')
    expect(c).toContain('#include "ui/ui.h"')
    expect(c).toContain('#include "gea_embedded_font_generated.h"')
    expect(c).toContain('#include <string.h>')
  })

  it('includes wifi headers and copies wifi string return values safely', () => {
    const { c, js } = buildFixture(WIFI_SOURCE)
    expect(c).toContain('#include "wifi.h"')
    expect(c).toContain('gea_embedded_wifi_is_connected()')
    expect(c).toContain('snprintf(wifi_store.ssid, sizeof(wifi_store.ssid), "%s", gea_embedded_wifi_get_ssid());')
    expect(c).toContain('snprintf(wifi_store.ip, sizeof(wifi_store.ip), "%s", gea_embedded_wifi_get_ip());')
    expect(js).toContain('const WiFi = {')
    expect(js).toContain('this.connected = WiFi.isConnected()')
  })

  it('emits native WiFi and Bluetooth enable toggles', () => {
    const { c } = buildFixture(RADIO_TOGGLE_SOURCE)
    expect(c).toContain('#include "wifi.h"')
    expect(c).toContain('#include "ble.h"')
    expect(c).toContain('gea_embedded_wifi_is_enabled()')
    expect(c).toContain('gea_embedded_wifi_set_enabled(0);')
    expect(c).toContain('gea_embedded_ble_is_enabled()')
    expect(c).toContain('gea_embedded_ble_set_enabled(0);')
  })

  it('keeps nested logical groups parenthesized for warning-clean C', () => {
    const { c } = buildFixture(LOGICAL_GROUPING_SOURCE)
    expect(c).toContain('if ((_s->x == x0 && _s->y == y0) || (_s->x == x1 && _s->y == y1))')
    expect(c).not.toContain('if (_s->x == x0 && _s->y == y0 || _s->x == x1 && _s->y == y1)')
  })

  it('preserves final else branches in if else-if chains', () => {
    const { c } = buildFixture(IF_ELSE_CHAIN_SOURCE)
    expect(c).toContain('else if ((chain_store.bound != 0))')
    expect(c).toContain('strcpy(chain_store.status, "Idle");')
  })

  it('maps overflow scroll to the native scroll overflow mode', () => {
    const { c } = buildFixture(OVERFLOW_SCROLL_SOURCE)
    expect(c).toContain('UI_PROP_OVERFLOW, 2')
  })

  it('expands CSS and JSX padding and margin box shorthands', () => {
    const { c } = buildFixture(CSS_BOX_SHORTHAND_SOURCE, undefined, {
      'styles.css': `
.box {
  padding: 16px 12px 8px 4px;
  margin: 1px 2px 3px 4px;
}

.inset {
  padding: 21px 34px;
  margin: 55px 89px;
}
`
    })

    expect(c).toContain('UI_PROP_PADDING_TOP, 16')
    expect(c).toContain('UI_PROP_PADDING_RIGHT, 12')
    expect(c).toContain('UI_PROP_PADDING_BOTTOM, 8')
    expect(c).toContain('UI_PROP_PADDING_LEFT, 4')
    expect(c).toContain('UI_PROP_MARGIN_TOP, 1')
    expect(c).toContain('UI_PROP_MARGIN_RIGHT, 2')
    expect(c).toContain('UI_PROP_MARGIN_BOTTOM, 3')
    expect(c).toContain('UI_PROP_MARGIN_LEFT, 4')
    expect(c).toContain('UI_PROP_PADDING_TOP, 21')
    expect(c).toContain('UI_PROP_PADDING_RIGHT, 34')
    expect(c).toContain('UI_PROP_PADDING_BOTTOM, 21')
    expect(c).toContain('UI_PROP_PADDING_LEFT, 34')
    expect(c).toContain('UI_PROP_MARGIN_TOP, 55')
    expect(c).toContain('UI_PROP_MARGIN_RIGHT, 89')
    expect(c).toContain('UI_PROP_MARGIN_BOTTOM, 55')
    expect(c).toContain('UI_PROP_MARGIN_LEFT, 89')
    expect(c).toContain('UI_PROP_PADDING_TOP, 2')
    expect(c).toContain('UI_PROP_PADDING_RIGHT, 4')
    expect(c).toContain('UI_PROP_PADDING_BOTTOM, 6')
    expect(c).toContain('UI_PROP_PADDING_LEFT, 8')
    expect(c).toContain('UI_PROP_MARGIN_TOP, 3')
    expect(c).toContain('UI_PROP_MARGIN_RIGHT, 5')
    expect(c).toContain('UI_PROP_MARGIN_BOTTOM, 3')
    expect(c).toContain('UI_PROP_MARGIN_LEFT, 5')
    expect(c).toContain('UI_PROP_WIDTH, 10')
    expect(c).toContain('UI_PROP_HEIGHT, 11')
    expect(c).toContain('UI_PROP_GAP, 12')
    expect(c).toContain('UI_PROP_BORDER_RADIUS_TL, 7')
    expect(c).toContain('UI_PROP_FONT_SIZE, 18')
  })

  it('compiles CSS transform rotation and transform origin styles', () => {
    const { c } = buildFixture(TRANSFORM_SOURCE, undefined, {
      'styles.css': `
.hand {
  position: absolute;
  left: 48px;
  top: 10px;
  width: 4px;
  height: 40px;
  background-color: #ffffff;
  transform-origin: 50% 100%;
  transform: rotate(30deg);
}
`
    })

    expect(c).toContain('UI_PROP_TRANSFORM_ORIGIN_X, 500')
    expect(c).toContain('UI_PROP_TRANSFORM_ORIGIN_Y, 1000')
    expect(c).toContain('UI_PROP_TRANSFORM_ROTATE, 300')
    expect(c).toContain('gea_embedded_ui_set_style(bind_nodes[0], UI_PROP_TRANSFORM_ROTATE, spin_store.angle);')
    expect(c).toContain('[FIELD_ANGLE] = { 0, -1 }')
  })

  it('compiles intrinsic input with an auto-mounted system keyboard', () => {
    const { c } = buildFixture(INPUT_KEYBOARD_SOURCE)
    expect(c).toContain('form_store_handleFocus()')
    expect(c).toContain('form_store_handleBlur()')
    expect(c).toContain('form_store_handleInput(form_store.text);')
    expect(c).toContain('form_store_handleKeyDown(key_code);')
    expect(c).toContain('gea_embedded_input_focus_press(press_id)')
    expect(c).toContain('gea_embedded_input_keyboard_press(press_id)')
    expect(c).toContain('static int gea_embedded_input_autofocus_seen[GEA_EMBEDDED_INPUT_COUNT];')
    expect(c).toContain('static int gea_embedded_input_focus_id(int input_id)')
    expect(c).toContain('static int gea_embedded_input_node_is_visible(int node_id)')
    expect(c).toContain(
      'if ((form_store.shouldAutoFocus == 1) && gea_embedded_input_node_is_visible(gea_embedded_input_root_nodes[0])) {'
    )
    expect(c).toContain('gea_embedded_input_autofocus_seen[0] = 1;')
    expect(c).toContain('return gea_embedded_input_focus_id(0);')
    expect(c).toContain('static int gea_embedded_input_should_blur_for_press(int press_id)')
    expect(c).toContain('static int gea_embedded_input_blur_for_touch_end(int x, int y)')
    expect(c).toContain('static int gea_embedded_input_consume_skipped_touch(int press_id)')
    expect(c).toContain('gea_embedded_input_blur_for_touch_end(x, y);')
    expect(c).toContain('static int gea_embedded_input_touch_start_press_id = -1;')
    expect(c).toContain('static int gea_embedded_input_skip_touch_press_id = -1;')
    expect(c).toContain('#define GEA_EMBEDDED_SYSTEM_KEYBOARD_PRESS_BASE 30000')
    expect(c).toContain(
      '#define GEA_EMBEDDED_KEYBOARD_KEY_SLOT_COUNT (GEA_EMBEDDED_KEYBOARD_ROW_COUNT * GEA_EMBEDDED_KEYBOARD_COL_COUNT)'
    )
    expect(c).toContain('static int gea_embedded_keyboard_root_node = -1;')
    expect(c).toContain('static int gea_embedded_input_resized_nodes[UI_MAX_NODES];')
    expect(c).toContain('static void gea_embedded_keyboard_apply_app_resize(int visible)')
    expect(c).toContain('#define GEA_EMBEDDED_KEYBOARD_HEIGHT 183')
    expect(c).toContain('#define GEA_EMBEDDED_KEYBOARD_PADDING_TOP 8')
    expect(c).toContain('#define GEA_EMBEDDED_KEYBOARD_PADDING_BOTTOM 8')
    expect(c).toContain('static int gea_embedded_keyboard_contains_point(int x, int y)')
    expect(c).toContain('if (gea_embedded_keyboard_contains_point(x, y)) return 0;')
    expect(c).toContain('int full_height = node->height == gea_embedded_viewport_h')
    expect(c).toContain('gea_embedded_ui_set_style(i, UI_PROP_HEIGHT, app_height);')
    expect(c).toContain('if (i == gea_embedded_root_node) gea_embedded_ui_set_style(i, UI_PROP_OVERFLOW, 1);')
    expect(c).toContain(
      'gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_PADDING_TOP, GEA_EMBEDDED_KEYBOARD_PADDING_TOP);'
    )
    expect(c).toContain(
      'gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_PADDING_BOTTOM, GEA_EMBEDDED_KEYBOARD_PADDING_BOTTOM);'
    )
    expect(c).toContain('gea_embedded_keyboard_apply_app_resize(1);')
    expect(c).toContain('gea_embedded_keyboard_apply_app_resize(0);')
    expect(c).toContain('gea_embedded_keyboard_create();')
    expect(c).toContain('if (gea_embedded_input_consume_skipped_touch(press_id)) return;')
    expect(c).toContain(`void gea_embedded_app_touch_start_element(int press_id, int x, int y) {
    gea_embedded_input_touch_start_press_id = -1;
    if (gea_embedded_input_focus_press(press_id)) {
        gea_embedded_input_touch_start_press_id = press_id;
        return;
    }`)
    expect(c).toContain(
      'gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_TOP, gea_embedded_keyboard_top());'
    )
    expect(c).toContain('gea_embedded_ui_set_style(gea_embedded_keyboard_root_node, UI_PROP_HAS_BG, 1);')
    expect(c).toContain('static const gea_embedded_keyboard_row_def_t gea_embedded_keyboard_alpha_rows')
    expect(c).toContain('{ "q", 113, GEA_EMBEDDED_KEYBOARD_KEY_KIND_LIGHT')
    expect(c).toContain('{ "1", 49, GEA_EMBEDDED_KEYBOARD_KEY_KIND_LIGHT')
    expect(c).toContain('{ "ABC", 1002, GEA_EMBEDDED_KEYBOARD_KEY_KIND_UTILITY')
    expect(c).toContain('{ 3, 6, 30, 30, {')
    expect(c).toContain('gea_embedded_keyboard_show();')
    expect(c).toContain('gea_embedded_keyboard_hide();')
    expect(c).toContain('gea_embedded_ui_set_on_press(key_node, GEA_EMBEDDED_SYSTEM_KEYBOARD_PRESS_BASE + slot);')
    expect(c).toContain('int system_key_code = gea_embedded_keyboard_key_code_for_press(press_id);')
    expect(c).toContain('if (system_key_code) return gea_embedded_input_key_press(system_key_code);')
    expect(c).toContain('UI_PROP_BLINK_INTERVAL')
    expect(c).toContain('gea_embedded_input_shift_active')
    expect(c).toContain('gea_embedded_input_caps_lock')
    expect(c).toContain(
      'gea_embedded_keyboard_sync_shift(gea_embedded_input_shift_active, gea_embedded_input_caps_lock)'
    )
    expect(c).toContain('GEA_EMBEDDED_KEYBOARD_MODE_SYMBOLS_KEY')
    expect(c).toContain('GEA_EMBEDDED_KEYBOARD_MODE_ALPHA_KEY')
    expect(c).toContain('GEA_EMBEDDED_KEYBOARD_MODE_MORE_SYMBOLS_KEY')
    expect(c).toContain('gea_embedded_keyboard_sync_mode(GEA_EMBEDDED_KEYBOARD_MODE_SYMBOLS)')
    expect(c).toContain('gea_embedded_keyboard_sync_mode(GEA_EMBEDDED_KEYBOARD_MODE_ALPHA)')
    expect(c).toContain('gea_embedded_keyboard_sync_mode(GEA_EMBEDDED_KEYBOARD_MODE_MORE_SYMBOLS)')
    expect(c).toContain('if (gea_embedded_input_caps_lock)')
    expect(c).toContain('gea_embedded_input_set_shift_state(0, 1)')
    expect(c).toContain('#define GEA_EMBEDDED_SHIFT_DOUBLE_TAP_MS 350')
    expect(c).toContain('static int gea_embedded_input_last_shift_tap_ms = -GEA_EMBEDDED_SHIFT_DOUBLE_TAP_MS;')
    expect(c).toContain(
      'int shift_elapsed_ms = gea_embedded_input_timestamp_ms - gea_embedded_input_last_shift_tap_ms;'
    )
    expect(c).toContain('if (shift_elapsed_ms >= 0 && shift_elapsed_ms < GEA_EMBEDDED_SHIFT_DOUBLE_TAP_MS) {')
    expect(c).toContain('gea_embedded_input_last_shift_tap_ms = gea_embedded_input_timestamp_ms;')
    expect(c).toContain('int uppercase = gea_embedded_keyboard_shift_active || gea_embedded_keyboard_caps_lock;')
    expect(c).toContain('gea_embedded_ui_set_text(label_node, label);')
    expect(c).toContain('UI_PROP_BG_COLOR, caps_lock ? 0x0C3F : (active ? 0xF79E : 0x6B8F)')
    expect(c).toContain('gea_embedded_input_restart_caret()')
    expect(c).toContain(
      'gea_embedded_input_key_to_char(key_code, gea_embedded_input_shift_active || gea_embedded_input_caps_lock)'
    )
    expect(c).toContain('gea_embedded_input_frame(timestampMs);')
    expect(c).toContain('gea_embedded_ui_frame(timestampMs);')
    expect(c).toContain('if (key_code == 13) {')
    expect(c).toContain('gea_embedded_input_blur_active();')
    expect(c).not.toContain('form_store_key(press_id);')
    expect(c).toContain('gea_embedded_input_apply_text')
    expect(c).toContain('gea_embedded_input_apply_placeholder')
    expect(c).toContain('gea_embedded_input_apply_text(bind_nodes[')
    expect(c).toContain('], form_store.text, 0, -1);')
    expect(c).toContain('gea_embedded_input_apply_placeholder(bind_nodes[')
    expect(c).toContain('], form_store.text, "Type here");')
    expect(c).toContain('gea_embedded_ui_set_text(node, "");')
    expect(c).toContain('UI_PROP_GAP, 0')
    expect(c).toContain('UI_PROP_FONT_SIZE, 15')
    expect(c).toContain(
      'UI_PROP_FONT_SIZE, kind == GEA_EMBEDDED_KEYBOARD_LABEL_KIND_SMALL ? 15 : (kind == GEA_EMBEDDED_KEYBOARD_LABEL_KIND_WIDE ? 17 : 19)'
    )
    expect(c).toContain('snprintf(form_store.text, sizeof(form_store.text), "%s", value);')
  })

  it('briefly reveals the newest password character before remasking it', () => {
    const { c } = buildFixture(PASSWORD_INPUT_SOURCE)

    expect(c).toContain('static int gea_embedded_input_password_reveal_index_for_binding(int input_id);')
    expect(c).toContain('#define GEA_EMBEDDED_PASSWORD_REVEAL_MS 500')
    expect(c).toContain('static int gea_embedded_input_password_reveal_active[GEA_EMBEDDED_INPUT_COUNT];')
    expect(c).toContain('masked[reveal_index] = value[reveal_index];')
    expect(c).toContain('gea_embedded_input_apply_text(bind_nodes[')
    expect(c).toContain('], login_store.password, 1, gea_embedded_input_password_reveal_index_for_binding(0));')
    expect(c).toContain('if (after_len > before_len) gea_embedded_input_start_password_reveal(0, (int)after_len);')
    expect(c).toContain('gea_embedded_input_clear_password_reveal(0);')
    expect(c).toContain('if (timestamp_ms < gea_embedded_input_password_reveal_until_ms[i]) continue;')
    expect(c).toContain('gea_embedded_input_apply_password_mask(i);')
    expect(c).toContain('gea_embedded_input_frame(timestampMs);')
  })

  it('uses explicit pressId and pressValue as native press ids', () => {
    const { c } = buildFixture(PRESS_ID_SOURCE)

    expect(countMatches(c, /gea_embedded_ui_set_on_press\(n\d+, 0\);/g)).toBe(1)
    expect(countMatches(c, /gea_embedded_ui_set_on_press\(n\d+, 1\);/g)).toBe(1)
    expect(countMatches(c, /gea_embedded_ui_set_on_press\(n\d+, 13\);/g)).toBe(1)
    expect(countMatches(c, /gea_embedded_ui_set_on_press\(n\d+, 65\);/g)).toBe(1)
    expect(countMatches(c, /gea_embedded_ui_set_on_press\(n\d+, 88\);/g)).toBe(1)
    expect(countMatches(c, /gea_embedded_ui_set_on_press\(n\d+, 90\);/g)).toBe(1)
  })

  it('skips explicit ids when assigning automatic press ids', () => {
    const { c } = buildFixture(PRESS_ID_SOURCE)

    expect(c).toContain('case 0:')
    expect(c).toContain('case 1:')
    expect(c).toContain('case 13:')
    expect(c).toContain('case 65:')
    expect(c).toContain('case 88:')
    expect(c).toContain('case 90:')
    expect(c).toContain('press_store_focus();')
    expect(c).not.toContain('case 0: press_store_focus();')
  })

  it('passes the runtime press_id through direct, forwarded, and aliased click handlers', () => {
    const { c } = buildFixture(PRESS_ID_SOURCE)

    expect(c).toContain('press_store_set(press_id);')
    expect(countMatches(c, /press_store_set\(press_id\);/g)).toBe(1)
    expect(c).not.toContain('press_store_set(0);')
    expect(c).not.toContain('press_store_set(13);')
    expect(c).not.toContain('press_store_set(65);')
    expect(c).not.toContain('press_store_set(88);')
    expect(c).not.toContain('press_store_set(90);')
  })

  it('does not route touch-only element releases through a single generic press handler', () => {
    const { c } = buildFixture(TOUCH_AND_PRESS_SOURCE)
    const pressStart = c.indexOf('void gea_embedded_app_touch(int press_id) {')
    const pressEnd = c.indexOf('\n}', pressStart)
    const pressHandler = c.slice(pressStart, pressEnd)

    expect(pressHandler).toContain('switch (press_id)')
    expect(pressHandler).toContain('case 1:')
    expect(pressHandler).toContain('press_store_restart();')
    expect(pressHandler).not.toContain('case 0:')
    expect(pressHandler).not.toMatch(/batch_begin\(\);\s*press_store_restart\(\);/)
    expect(c).toContain('case 0: press_store_leftDown(); break;')
    expect(c).toContain('case 0: press_store_leftUp(); break;')
  })

  it('resolves static data attributes through press event targets', () => {
    const { c, js } = buildFixture(DATA_ATTRIBUTE_SOURCE)

    expect(c).toContain('press_store_set(65);')
    expect(c).toContain('press_store_set(88);')
    expect(c).toContain('press_store_set(90);')
    expect(c).toContain('press_store_setLabel("wifi");')
    expect(js).toContain('press.set(65)')
    expect(js).toContain('press.set(88)')
    expect(js).toContain('press.set(90)')
    expect(js).toContain('press.setLabel("wifi")')
    expect(js).not.toContain('getAttribute')
    expect(js).not.toContain('dataset')
  })

  it('rejects non-static press ids before generating invalid embedded dispatch', () => {
    expect(() => buildFixture(DYNAMIC_PRESS_ID_SOURCE)).toThrow('pressId must be a statically resolvable number')
  })

  it('compiles editable string length and substring backspace safely', () => {
    const { c } = buildFixture(EDITABLE_STRING_SOURCE)
    expect(c).toContain('if ((int)strlen(form_store.text) > 0)')
    expect(c).toContain('char _tmp[sizeof(form_store.text)];')
    expect(c).toContain('snprintf(_tmp, sizeof(_tmp), "%.*s", _end - _start, _src + _start);')
  })

  it('compiles the Accelerometer singleton to native IMU reads', () => {
    const { c, js } = buildFixture(ACCELEROMETER_SOURCE)
    expect(c).toContain('#include "imu.h"')
    expect(c).toContain('gea_embedded_imu_init();')
    expect(c).toContain('motion_store.tilt = (gea_embedded_imu_get_tilt_x() + gea_embedded_imu_get_tilt_y());')
    expect(c).toContain('motion_store.accelX = gea_embedded_imu_get_acceleration_x();')
    expect(js).toContain('const Accelerometer = {')
    expect(js).toContain('this.tilt = Accelerometer.tiltX + Accelerometer.tiltY')
  })

  it('lowers common JS globals to native C expressions', () => {
    const { c } = buildFixture(JS_GLOBALS_SOURCE)

    expect(c).toContain('int gea_embedded_now_ms(void);')
    expect(c).toContain('static double gea_embedded_math_random(void)')
    expect(c).toContain('int started = gea_embedded_now_ms();')
    expect(c).toContain('clock_store.elapsed = (gea_embedded_now_ms() - started);')
    expect(c).toContain('clock_store.piScaled = ((int)floor(((3.14159265358979323846 * 100)) + 0.5));')
    expect(c).toContain('clock_store.trig = ((int)floor(((sin((3.14159265358979323846 / 2)) * 10)) + 0.5));')
    expect(c).toContain('clock_store.randomBucket = ((int)floor((gea_embedded_math_random() * 10)));')
    expect(c).toContain('clock_store.bounded = fmax(fmin(clock_store.piScaled, 400), 300);')
    expect(c).not.toContain('Date.now')
    expect(c).not.toContain('Math.')
  })

  it('selects integer and floating absolute value helpers', () => {
    const { c } = buildFixture(MATH_ABS_SOURCE)

    expect(c).toContain('absStore_store.value = abs(dy);')
    expect(c).toContain('gea_embedded_ui_set_style(n0, UI_PROP_WIDTH, abs(absStore_store.value));')
    expect(c).toContain('if (fabs((gea_embedded_math_random() - 0.5)) > 0.1)')
    expect(c).not.toContain('fabs(dy)')
  })

  it('keeps locals derived from floating constants as doubles', () => {
    const { c } = buildFixture(DOUBLE_LOCAL_SOURCE)

    expect(c).toContain('double friction = ((motion_store.onGround != 0) ? GROUND_FRICTION : AIR_FRICTION);')
    expect(c).not.toContain('int friction = ((motion_store.onGround != 0) ? GROUND_FRICTION : AIR_FRICTION);')
  })

  it('generates store field enum', () => {
    expect(c).toContain('FIELD_BOARD = 0')
    expect(c).toContain('FIELD_TURN = 1')
    expect(c).toContain('FIELD_WINNER = 2')
    expect(c).toContain('FIELD_COUNT = 3')
  })

  it('exports mirror schema metadata', () => {
    expect(c).toContain('#define MIRROR_SCHEMA_HASH')
    expect(c).toContain('int gea_embedded_app_mirror_get_field_count(void)')
    expect(c).toContain('unsigned int gea_embedded_app_mirror_get_schema_hash(void)')
    expect(c).toContain('mirror_write_u16(dst, &off, FIELD_COUNT);')
    expect(c).toContain('mirror_write_u32(dst, &off, MIRROR_SCHEMA_HASH);')
  })

  it('generates store struct with correct field types', () => {
    expect(c).toContain('char board[20];')
    expect(c).toContain('char turn;')
    expect(c).toContain('char winner[64];')
  })

  it('generates store struct with named instance', () => {
    expect(c).toContain('game_store_t game_store')
  })

  it('compiled methods mark dirty fields', () => {
    expect(c).toContain('mark_dirty_field(0)')
    expect(c).toContain('mark_dirty_field(1)')
    expect(c).toContain('mark_dirty_field(2)')
  })

  it('array length assignments mark list fields dirty', () => {
    const { c } = buildFixture(ARRAY_LENGTH_DIRTY_SOURCE)
    expect(c).toContain('stackStore_store.stack_len = 0;')
    expect(c).toContain('mark_dirty_field(0)')
    expect(c).toContain('static int stack_created_len = 0;')
    expect(c).toContain('UI_PROP_DISPLAY, is_visible ? 0 : 1')
    expect(c).not.toContain('gea_embedded_ui_remove_node(stack_node_ids[i])')
  })

  it('marks dirty fields before returning from compiled store methods', () => {
    const { c } = buildFixture(RETURN_DIRTY_SOURCE)
    expect(c).toContain('counter_store.count = (counter_store.count + 1);')
    expect(c).toContain('mark_dirty_field(0);')
    expect(c.indexOf('mark_dirty_field(0);')).toBeLessThan(c.indexOf('batch_end(); return counter_store.count;'))
  })

  it('compiles the embedded audioContext oscillator subset', () => {
    const { c, js } = buildFixture(AUDIO_CONTEXT_SOURCE)
    expect(c).toContain('#include "audio.h"')
    expect(c).toContain('int oscillator = gea_embedded_audio_context_create_oscillator();')
    expect(c).toContain('gea_embedded_audio_oscillator_set_type(oscillator, GEA_EMBEDDED_OSCILLATOR_SQUARE);')
    expect(c).toContain('gea_embedded_audio_oscillator_set_frequency(oscillator, 440);')
    expect(c).toContain(
      'gea_embedded_audio_oscillator_frequency_set_value_at_time(oscillator, 660, gea_embedded_audio_context_current_time());'
    )
    expect(c).toContain('double now = gea_embedded_audio_context_current_time();')
    expect(c).toContain('gea_embedded_audio_oscillator_start(oscillator, now);')
    expect(c).toContain('gea_embedded_audio_oscillator_stop(oscillator, (now + 0.08));')
    expect(js).toContain('const audioContext = {')
  })

  it('generates compiled methods for store', () => {
    expect(c).toContain('game_store_play')
    expect(c).toContain('game_store_checkWin')
  })

  it('returns null characters for empty char-returning store methods', () => {
    expect(c).toContain('static char game_store_checkWin(void)')
    expect(c).toContain("return '\\0';")
    expect(c).not.toContain('return "";')
  })

  it('generates batch management functions', () => {
    expect(c).toContain('batch_begin(void)')
    expect(c).toContain('batch_end(void)')
    expect(c).toContain('batch_depth++')
    expect(c).toContain('--batch_depth')
  })

  it('batch_end flushes dirty bindings and calls gea_embedded_ui_refresh', () => {
    expect(c).toContain('clear_dirty_fields();')
    expect(c).toContain(
      'gea_embedded_ui_refresh(gea_embedded_root_node, gea_embedded_viewport_w, gea_embedded_viewport_h)'
    )
  })

  it('generates gea_embedded_app_init entry point', () => {
    expect(c).toContain('void gea_embedded_app_init(int w, int h)')
  })

  it('generates gea_embedded_app_touch handler', () => {
    expect(c).toContain('void gea_embedded_app_touch(int press_id)')
  })

  it('gea_embedded_app_init creates nodes and mounts tree', () => {
    expect(c).toContain('gea_embedded_ui_clear()')
    expect(c).toContain('gea_embedded_ui_create_view()')
    expect(c).toContain('gea_embedded_ui_create_text()')
    expect(c).toContain('gea_embedded_ui_mount(n0, w, h)')
  })

  it('store fields have static initializers', () => {
    expect(c).toContain('.board = "         "')
    expect(c).toContain(".turn = 'X'")
    expect(c).toContain('.winner = ""')
  })

  it('gea_embedded_app_init evaluates all bindings once', () => {
    expect(c).toContain('for (int i = 0; i < BINDING_COUNT; i++) binding_fns[i]();')
  })

  it('does NOT call gea_embedded_ui_clear inside batch_end (retained tree)', () => {
    const batchEndMatch = c.match(/static void batch_end\(void\)\s*\{([\s\S]*?)\n\}/)
    expect(batchEndMatch).toBeTruthy()
    expect(batchEndMatch![1]).not.toContain('gea_embedded_ui_clear')
    expect(batchEndMatch![1]).not.toContain('gea_embedded_app_init')
  })
})

/* ================================================================
 * COMPILER OUTPUT — BINDINGS
 * ================================================================ */

describe('Reactive bindings', () => {
  let c: string

  beforeAll(() => {
    ;({ c } = buildTicTacToeFixture())
  })

  it('generates exactly 19 bindings (1 status + 9 text + 9 color)', () => {
    expect(c).toContain('#define BINDING_COUNT 19')
  })

  it('binding 0 updates status text', () => {
    expect(c).toContain('update_binding_0(void)')
    expect(c).toContain('gea_embedded_ui_set_text(bind_nodes[0]')
  })

  it('cell text bindings are simple C char access (board[N])', () => {
    for (let i = 0; i < 9; i++) {
      const textBindId = 2 + i * 2
      expect(c).toContain(`game_store.board[${i}], '\\0'`)
    }
  })

  it('cell color bindings are simple C ternary', () => {
    for (let i = 0; i < 9; i++) {
      const colorBindId = 1 + i * 2
      expect(c).toContain(`(game_store.board[${i}] == 'X')`)
    }
  })

  it('dependency table maps board to cell bindings', () => {
    expect(c).toContain('[FIELD_BOARD] = {')
    const boardDeps = c.match(/\[FIELD_BOARD\]\s*=\s*\{([^}]+)\}/)
    expect(boardDeps).toBeTruthy()
    const ids = boardDeps![1]
      .split(',')
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n))
    expect(ids.length).toBe(19)
    expect(ids[ids.length - 1]).toBe(-1)
  })

  it('dependency table maps turn and winner to status binding', () => {
    expect(c).toContain('[FIELD_TURN] = { 0, -1 }')
    expect(c).toContain('[FIELD_WINNER] = { 0, -1 }')
  })

  it('deduplicates bindings with processed bitmask', () => {
    expect(c).toContain('uint64_t processed[PROCESSED_BINDING_WORD_COUNT] = {0};')
    expect(c).toContain('if (processed[processed_word] & processed_bit) continue;')
    expect(c).toContain('processed[processed_word] |= processed_bit;')
  })
})

/* ================================================================
 * COMPILER OUTPUT — NODE TREE
 * ================================================================ */

describe('Node tree generation', () => {
  let c: string

  beforeAll(() => {
    ;({ c } = buildTicTacToeFixture())
  })

  it('unrolls [0,1,2].map loops (no C for-loops)', () => {
    expect(c).not.toMatch(/for\s*\(\s*int\s+(row|col)\s*=/)
  })

  it('creates 24 nodes (1 root + 1 status + 1 board + 3 rows + 9 cells + 9 texts)', () => {
    const nodeCreations = c.match(/gea_embedded_ui_create_(view|text|image)\(/g)
    expect(nodeCreations).toBeTruthy()
    expect(nodeCreations!.length).toBe(24)
  })

  it('sets onPress for each of the 9 cells with IDs 0-8', () => {
    for (let i = 0; i < 9; i++) {
      expect(c).toMatch(new RegExp(`gea_embedded_ui_set_on_press\\(n\\d+, ${i}\\)`))
    }
  })

  it('root node has correct styles', () => {
    expect(c).toContain('gea_embedded_ui_set_style(n0, UI_PROP_FLEX_DIRECTION, 0)')
    expect(c).toContain('gea_embedded_ui_set_style(n0, UI_PROP_ALIGN_ITEMS, 2)')
    expect(c).toContain('gea_embedded_ui_set_style(n0, UI_PROP_JUSTIFY_CONTENT, 1)')
    expect(c).toContain('gea_embedded_ui_set_style(n0, UI_PROP_WIDTH, 410)')
    expect(c).toContain('gea_embedded_ui_set_style(n0, UI_PROP_HEIGHT, 502)')
  })

  it('supports div, span, paragraph, and heading aliases', () => {
    const { c } = buildFixture(SEMANTIC_HTML_TAG_SOURCE)

    expect(countMatches(c, /gea_embedded_ui_create_view\(\)/g)).toBe(4)
    expect(countMatches(c, /gea_embedded_ui_create_text\(\)/g)).toBe(4)
    expect(c).toContain('gea_embedded_ui_set_style(n1, UI_PROP_FLEX_DIRECTION, 1)')
    expect(c).toContain('gea_embedded_ui_set_style(n1, UI_PROP_FLEX_WRAP, 1)')
    expect(c).toContain('gea_embedded_ui_set_style(n1, UI_PROP_ALIGN_SELF, 0)')
    expect(c).toContain('gea_embedded_ui_set_style(n1, UI_PROP_FONT_SIZE, 32)')
    expect(c).toContain('gea_embedded_ui_set_style(n3, UI_PROP_MARGIN_BOTTOM, 10)')
    expect(c).toContain('gea_embedded_ui_set_style(n5, UI_PROP_COLOR, 0x669F)')
    expect(c).toContain('gea_embedded_ui_set_style(n6, UI_PROP_FONT_SIZE, 22)')
    expect(c).toContain('gea_embedded_ui_set_style(n6, UI_PROP_FONT_SIZE, 21)')
    expect(c).toContain('gea_embedded_ui_set_style(n7, UI_PROP_FONT_SIZE, 21)')
  })
})

/* ================================================================
 * COMPILER OUTPUT — FONT PROPERTIES
 * ================================================================ */

describe('Font properties in generated C', () => {
  let c: string

  beforeAll(() => {
    ;({ c } = buildTicTacToeFixture())
  })

  it('sets font id for text nodes with fontFamily', () => {
    expect(c).toContain('UI_PROP_FONT_ID, 0')
    expect(c).toContain('UI_PROP_FONT_ID, 1')
  })

  it('sets pixel font size for text nodes', () => {
    expect(c).toContain('UI_PROP_FONT_SIZE, 24')
    expect(c).toContain('UI_PROP_FONT_SIZE, 48')
  })

  it('generates font asset files', () => {
    const { projectRoot } = buildTicTacToeFixture()

    expect(existsSync(join(projectRoot, 'generated', 'gea_embedded_font_generated.c'))).toBe(true)
    expect(existsSync(join(projectRoot, 'generated', 'gea_embedded_font_generated.h'))).toBe(true)

    const fontH = readFileSync(join(projectRoot, 'generated', 'gea_embedded_font_generated.h'), 'utf8')
    expect(fontH).toContain('GEA_EMBEDDED_FONT_COUNT 2')
    expect(fontH).toContain('gea_embedded_font_t')
    expect(fontH).toContain('gea_embedded_glyph_t')
  })

  it('does not apply the first loaded font face implicitly', () => {
    const { c, projectRoot } = buildFixture(FONT_FACE_WITHOUT_FONT_FAMILY_SOURCE)
    const fontH = readFileSync(join(projectRoot, 'generated', 'gea_embedded_font_generated.h'), 'utf8')

    expect(c).not.toContain('UI_PROP_FONT_ID')
    expect(fontH).toContain('GEA_EMBEDDED_FONT_COUNT 0')
  })
})

/* ================================================================
 * COMPILER OUTPUT — GENERATED JS
 * ================================================================ */

describe('Generated JS structure', () => {
  let js: string

  beforeAll(() => {
    ;({ js } = buildTicTacToeFixture())
  })

  it('GameStore constructor calls __gea_embedded_store_init_0', () => {
    expect(js).toContain('__gea_embedded_store_init_0.call(this)')
  })

  it('play method is wrapped in batch begin/end', () => {
    expect(js).toContain('__gea_embedded_batch_begin()')
    expect(js).toContain('__gea_embedded_batch_end()')
  })

  it('play method uses try/finally for batch safety', () => {
    expect(js).toMatch(/try\s*\{[\s\S]*?finally\s*\{[\s\S]*?__gea_embedded_batch_end/)
  })

  it('generates __binding_0 callback for status text', () => {
    expect(js).toContain('__binding_0')
    expect(js).toMatch(/game\.winner.*wins.*Turn.*game\.turn/)
  })

  it('generates __on_press dispatcher calling game.play(id)', () => {
    expect(js).toContain('__on_press')
    expect(js).toContain('game.play(id)')
  })

  it('generates grouped JS press dispatch for shared press-id handlers', () => {
    const { js } = buildFixture(PRESS_ID_SOURCE)

    expect(js).toContain('__on_press')
    expect(js).toContain('case 0:')
    expect(js).toContain('case 13:')
    expect(js).toContain('case 65:')
    expect(js).toContain('case 88:')
    expect(js).toContain('case 90:')
    expect(js).toContain('press.set(id)')
    expect(countMatches(js, /press\.set\(id\)/g)).toBe(1)
    expect(js).toContain('press.focus()')
  })

  it('does not ship generated component JS or JSX runtime JS in the source package', () => {
    const files = readdirSync(GEA_EMBEDDED_SRC).sort()

    expect(files).toEqual(['Button.tsx', 'Settings', 'css.d.ts', 'index.d.ts', 'package.json'])
  })

  it('ends with __gea_embedded_mount() call', () => {
    expect(js).toContain('__gea_embedded_mount()')
  })

  it('does NOT contain app.render (old API removed)', () => {
    expect(js).not.toContain('app.render')
  })

  it('does NOT contain gea_embedded_app_render (old API removed)', () => {
    expect(js).not.toContain('gea_embedded_app_render')
  })

  it('passes RAF timestamps through generated C frame hooks', () => {
    const { c } = buildFixture(RAF_TIMESTAMP_SOURCE)
    expect(c).toContain('static void b_store_tick(int timestampMs)')
    expect(c).toContain('void gea_embedded_app_frame(int timestampMs)')
    expect(c).toContain(`void gea_embedded_app_frame(int timestampMs) {
    batch_begin();
    b_store_tick(timestampMs);
    batch_end();
    gea_embedded_ui_frame(timestampMs);
}`)
  })

  it('compiles bouncing-balls JSX FPS logic without unsupported C expressions', () => {
    const { c } = buildFixture(BOUNCING_BALLS_JSX_SOURCE, BOUNCING_BALLS_JSX_ROOT)
    expect(c).not.toContain('Math.round')
    expect(c).not.toContain('/* unknown_expr */0')
    expect(c).toContain('snprintf')
    expect(c).toContain('gea_embedded_ui_set_style(n0, UI_PROP_WIDTH, 410);')
    expect(c).toContain('gea_embedded_ui_set_style(n, UI_PROP_WIDTH, 16);')
    expect(c).toContain('gea_embedded_ui_set_style(n, UI_PROP_BORDER_RADIUS_TL, 8);')
  })

  it('emits binary mirror records instead of JSON line snapshots', () => {
    const { c } = buildFixture(BOUNCING_BALLS_JSX_SOURCE, BOUNCING_BALLS_JSX_ROOT)
    expect(c).toContain('int gea_embedded_app_mirror_begin_snapshot(void)')
    expect(c).toContain('int gea_embedded_app_mirror_begin_diff(void)')
    expect(c).toContain('int gea_embedded_app_mirror_next_record(unsigned char *dst, int cap)')
    expect(c).toContain('#define MIRROR_REC_BEGIN 1')
    expect(c).not.toContain('\\"fields\\":[')
  })

  it('fuses RAF tick with prelude into app_frame and skips redundant list-binding work', () => {
    const { c } = buildFixture(FUSION_WITH_PRELUDE_SOURCE)
    const frameStart = c.indexOf('void gea_embedded_app_frame(int timestampMs) {')
    const frameEnd = c.indexOf('\n}', frameStart)
    const frame = c.slice(frameStart, frameEnd)
    expect(frame).toContain('batch_begin();')
    expect(frame).toContain('balls_store.windowFrames++;')
    expect(frame).toContain('if (elapsedMs >= 500)')
    expect(frame).toContain('int len = balls_store.balls_len;')
    expect(frame).toContain('balls_elem_t *_b = &balls_store.balls[i];')
    expect(frame).toContain('nd->pos_offsets[3] = _b->x;')
    expect(frame).toContain('nd->pos_offsets[0] = _b->y;')
    expect(frame).not.toContain('nd->bg_color = _b->color;')
    expect(frame).toContain('nd->dirty = 1;')
    expect(frame).toContain('dirty_fields_any = 1;')
    expect(frame).toContain('batch_end();')
    expect(frame).not.toContain('balls_store_tick(')
    expect(c).toContain('gea_embedded_ui_set_style(n, UI_PROP_BG_COLOR, balls_store.balls[i].color);')
    const ballsFieldIdx = c.match(/FIELD_(?:BALLS_STORE_)?BALLS\s*=\s*(\d+)/)?.[1]
    expect(ballsFieldIdx).toBeDefined()
    const fusedLoopBody = frame.slice(frame.indexOf('for (int i = 0; i < len; i++)'))
    expect(fusedLoopBody).not.toContain(`mark_dirty_field(${ballsFieldIdx})`)
    expect(frame).toContain(`mark_mirror_dirty_array_subfield(${ballsFieldIdx}, 0);`)
    expect(frame).toContain(`mark_mirror_dirty_array_subfield(${ballsFieldIdx}, 1);`)
    expect(frame).not.toContain(`mark_mirror_dirty_field(${ballsFieldIdx});`)
  })

  it('flushes generated settings swipe handlers through batch_end', () => {
    const { c } = buildFixture(BOUNCING_BALLS_JSX_WITH_SETTINGS_SOURCE, BOUNCING_BALLS_JSX_ROOT)
    expect(c).toContain('static int gea_embedded_app_timestamp_ms = 0;')
    expect(c).toContain('gea_embedded_app_timestamp_ms = timestampMs < 0 ? 0 : timestampMs;')
    expect(c).toContain('if (!((Settings_store.visible != 0)) && y > SETTINGS_SWIPE_EDGE_PX) {')
    expect(c).toContain('if ((Settings_store.visible != 0) && y < (SETTINGS_SCREEN_HEIGHT - SETTINGS_SWIPE_EDGE_PX)) {')
    expect(c).toContain('if ((dy >= SETTINGS_SWIPE_DISTANCE_PX && dx >= -96) && dx <= 96) {')
    expect(c).toContain('if ((dy <= -SETTINGS_SWIPE_DISTANCE_PX && dx >= -96) && dx <= 96) {')
    expect(c).toContain('Settings_store_close();')
    expect(c).toContain('Settings_store.wifiEnabled = gea_embedded_wifi_is_enabled();')
    expect(c).toContain('Settings_store.bluetoothEnabled = gea_embedded_ble_is_enabled();')
    expect(c).toContain('gea_embedded_wifi_set_enabled(0);')
    expect(c).toContain('gea_embedded_wifi_set_enabled(1);')
    expect(c).toContain('gea_embedded_ble_set_enabled(0);')
    expect(c).toContain('gea_embedded_ble_set_enabled(1);')
    expect(c).toContain(`void gea_embedded_app_touch_start(int x, int y) {
    batch_begin();
    Settings_store_handleSwipeStart(x, y);
    batch_end();
}`)
    expect(c).toContain(`void gea_embedded_app_touch_move(int x, int y) {
    batch_begin();
    Settings_store_handleSwipeMove(x, y);
    batch_end();
}`)
    expect(c).toContain(`void gea_embedded_app_touch_end(int x, int y) {
    gea_embedded_input_blur_for_touch_end(x, y);
    batch_begin();
    Settings_store_handleSwipeEnd(x, y);
    batch_end();
}`)
    expect(c).toContain(`void gea_embedded_app_settings_toggle(void) {
    batch_begin();
    Settings_store_toggle();
    batch_end();
}`)
  })
})

/* ================================================================
 * JS RUNTIME BEHAVIOR (with mocked C host functions)
 * ================================================================ */

describe('Reactive runtime behavior', () => {
  function createMockRuntime() {
    const state = {
      board: '         ',
      turn: 'X',
      winner: '',
      batchDepth: 0,
      dirtyFields: new Set<string>(),
      bindingCalls: [] as number[],
      mounted: false,
      refreshCount: 0
    }

    const storeObj: Record<string, any> = {}

    const globals: Record<string, any> = {
      __gea_embedded_store_init_0: function (this: any) {
        Object.defineProperty(this, 'board', {
          get() {
            return state.board
          },
          set(v: string) {
            state.board = v
            state.dirtyFields.add('board')
          },
          configurable: true
        })
        Object.defineProperty(this, 'turn', {
          get() {
            return state.turn
          },
          set(v: string) {
            state.turn = v
            state.dirtyFields.add('turn')
          },
          configurable: true
        })
        Object.defineProperty(this, 'winner', {
          get() {
            return state.winner
          },
          set(v: string) {
            state.winner = v
            state.dirtyFields.add('winner')
          },
          configurable: true
        })
      },
      __gea_embedded_batch_begin() {
        state.batchDepth++
      },
      __gea_embedded_batch_end() {
        if (--state.batchDepth > 0) return
        if (state.dirtyFields.size === 0) return
        state.refreshCount++
        state.dirtyFields.clear()
      },
      __gea_embedded_mount() {
        state.mounted = true
      }
    }

    return { state, globals }
  }

  function createPressRuntime() {
    const state = {
      last: 0,
      focusCount: 0,
      batchDepth: 0,
      dirtyFields: new Set<string>(),
      mounted: false,
      refreshCount: 0
    }

    const globals: Record<string, any> = {
      __gea_embedded_store_init_0: function (this: any) {
        Object.defineProperty(this, 'last', {
          get() {
            return state.last
          },
          set(v: number) {
            state.last = v
            state.dirtyFields.add('last')
          },
          configurable: true
        })
        Object.defineProperty(this, 'focusCount', {
          get() {
            return state.focusCount
          },
          set(v: number) {
            state.focusCount = v
            state.dirtyFields.add('focusCount')
          },
          configurable: true
        })
      },
      __gea_embedded_batch_begin() {
        state.batchDepth++
      },
      __gea_embedded_batch_end() {
        if (--state.batchDepth > 0) return
        if (state.dirtyFields.size === 0) return
        state.refreshCount++
        state.dirtyFields.clear()
      },
      __gea_embedded_mount() {
        state.mounted = true
      }
    }

    return { state, globals }
  }

  function runJS(js: string, globals: Record<string, any>, storeVar = 'game') {
    if (!/^[A-Za-z_$][\w$]*$/.test(storeVar)) throw new Error(`Invalid store variable: ${storeVar}`)
    const keys = Object.keys(globals)
    const wrappedBody = `${keys.map(k => `var ${k} = __globals.${k};`).join('\n')}
var globalThis = { __on_press: null, __binding_0: null };
${js.replace(/^\(function\(\) \{/, '').replace(/\}\)\(\);\s*$/, '')}
var __selectedStore = typeof ${storeVar} !== 'undefined' ? ${storeVar} : null;
return { globalThis, game: typeof game !== 'undefined' ? game : null, store: __selectedStore };`

    const fn = new Function('__globals', wrappedBody)
    return fn(globals)
  }

  it('constructs store with initial values', () => {
    const { js } = buildTicTacToeFixture()
    const { state, globals } = createMockRuntime()
    runJS(js, globals)

    expect(state.board).toBe('         ')
    expect(state.turn).toBe('X')
    expect(state.winner).toBe('')
  })

  it('mounts on initialization', () => {
    const { js } = buildTicTacToeFixture()
    const { state, globals } = createMockRuntime()
    runJS(js, globals)

    expect(state.mounted).toBe(true)
  })

  it('play(0) places X at position 0', () => {
    const { js } = buildTicTacToeFixture()
    const { state, globals } = createMockRuntime()
    const { globalThis: g, game } = runJS(js, globals)

    game.play(0)
    expect(state.board).toBe('X        ')
    expect(state.turn).toBe('O')
  })

  it('play triggers exactly one refresh (batched)', () => {
    const { js } = buildTicTacToeFixture()
    const { state, globals } = createMockRuntime()
    const { game } = runJS(js, globals)

    state.refreshCount = 0
    game.play(0)
    expect(state.refreshCount).toBe(1)
  })

  it('play on occupied cell is a no-op', () => {
    const { js } = buildTicTacToeFixture()
    const { state, globals } = createMockRuntime()
    const { game } = runJS(js, globals)

    game.play(0)
    const boardAfterFirst = state.board
    const turnAfterFirst = state.turn
    state.refreshCount = 0

    game.play(0)
    expect(state.board).toBe(boardAfterFirst)
    expect(state.turn).toBe(turnAfterFirst)
    expect(state.refreshCount).toBe(0)
  })

  it('alternates turns X -> O -> X', () => {
    const { js } = buildTicTacToeFixture()
    const { state, globals } = createMockRuntime()
    const { game } = runJS(js, globals)

    expect(state.turn).toBe('X')
    game.play(0)
    expect(state.turn).toBe('O')
    game.play(1)
    expect(state.turn).toBe('X')
  })

  it('detects winner (X wins top row)', () => {
    const { js } = buildTicTacToeFixture()
    const { state, globals } = createMockRuntime()
    const { game } = runJS(js, globals)

    game.play(0) // X
    game.play(3) // O
    game.play(1) // X
    game.play(4) // O
    game.play(2) // X wins

    expect(state.winner).toBe('X')
  })

  it('blocks play after winner is determined', () => {
    const { js } = buildTicTacToeFixture()
    const { state, globals } = createMockRuntime()
    const { game } = runJS(js, globals)

    game.play(0) // X
    game.play(3) // O
    game.play(1) // X
    game.play(4) // O
    game.play(2) // X wins

    const boardAfterWin = state.board
    game.play(5)
    expect(state.board).toBe(boardAfterWin)
  })

  it('__on_press dispatches to game.play', () => {
    const { js } = buildTicTacToeFixture()
    const { state, globals } = createMockRuntime()
    const { globalThis: g } = runJS(js, globals)

    g.__on_press(4)
    expect(state.board).toBe('    X    ')
    expect(state.turn).toBe('O')
  })

  it('__on_press forwards explicit press ids to shared handlers in JS', () => {
    const { js } = buildFixture(PRESS_ID_SOURCE)
    const { state, globals } = createPressRuntime()
    const { globalThis: g } = runJS(js, globals, 'press')

    g.__on_press(65)
    expect(state.last).toBe(65)

    g.__on_press(13)
    expect(state.last).toBe(13)

    g.__on_press(88)
    expect(state.last).toBe(88)

    g.__on_press(90)
    expect(state.last).toBe(90)

    g.__on_press(1)
    expect(state.focusCount).toBe(1)
  })

  it('__binding_0 returns correct status text', () => {
    const { js } = buildTicTacToeFixture()
    const { state, globals } = createMockRuntime()
    const { globalThis: g, game } = runJS(js, globals)

    expect(g.__binding_0()).toBe('Turn: X')

    game.play(0)
    expect(g.__binding_0()).toBe('Turn: O')

    game.play(3)
    game.play(1)
    game.play(4)
    game.play(2) // X wins
    expect(g.__binding_0()).toBe('X wins!')
  })

  it('nested batches do not flush prematurely', () => {
    const { js } = buildTicTacToeFixture()
    const { state, globals } = createMockRuntime()
    const { game } = runJS(js, globals)

    state.refreshCount = 0
    game.play(0)
    expect(state.refreshCount).toBe(1)
    expect(state.batchDepth).toBe(0)
  })

  it('full game: O wins diagonal', () => {
    const { js } = buildTicTacToeFixture()
    const { state, globals } = createMockRuntime()
    const { game } = runJS(js, globals)

    game.play(0) // X at 0
    game.play(2) // O at 2
    game.play(1) // X at 1
    game.play(4) // O at 4
    game.play(5) // X at 5
    game.play(6) // O at 6 -> O wins (2,4,6 diagonal)

    expect(state.winner).toBe('O')
    expect(state.board).toBe('XXO OXO  ')
  })

  it('dirty fields are cleared after batch flush', () => {
    const { js } = buildTicTacToeFixture()
    const { state, globals } = createMockRuntime()
    const { game } = runJS(js, globals)

    game.play(0)
    expect(state.dirtyFields.size).toBe(0)
  })
})
