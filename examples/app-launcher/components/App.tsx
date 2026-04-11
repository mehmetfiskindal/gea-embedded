import { Component } from 'gea-embedded'
import { launcher } from '../stores/LauncherStore'

function LauncherButton({ id, title, detail, accent }: { id: number; title: string; detail: string; accent: string }) {
  return (
    <div
      onPress={() => launcher.select(id)}
      style={{
        width: 116,
        height: 96,
        borderRadius: 10,
        borderWidth: 2,
        borderColor: accent,
        backgroundColor: '#111827',
        padding: '10px 8px 0 8px'
      }}
    >
      <span class="launcher-card-title" style={{ color: '#F8FAFC' }}>{title}</span>
      <span class="launcher-card-description" style={{ margin: '8px 0 0 0', color: '#94A3B8' }}>{detail}</span>
    </div>
  )
}

function LauncherList() {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 132,
        width: 410,
        height: 330,
        overflow: 'visible',
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        padding: '0 20px 0 20px'
      }}
    >
      <LauncherButton id={1} title="Analog" detail="clock face" accent="#D4AF37" />
      <LauncherButton id={2} title="Balls JSX" detail="animation test" accent="#22D3EE" />
      <LauncherButton id={3} title="Tetris" detail="button game" accent="#A78BFA" />
      <LauncherButton id={4} title="HID Clicker" detail="BLE remote" accent="#60A5FA" />
      <LauncherButton id={5} title="Tic Tac Toe" detail="tap board" accent="#FB7185" />
      <LauncherButton id={6} title="Breakout" detail="tilt paddle" accent="#34D399" />
      <LauncherButton id={7} title="Card" detail="static layout" accent="#F472B6" />
      <LauncherButton id={8} title="Typography" detail="font sample" accent="#C084FC" />
      <LauncherButton id={9} title="Sky Hop" detail="jump game" accent="#FBBF24" />
    </div>
  )
}

function LauncherMenu() {
  return (
    <div style={{ width: 410, height: 502, backgroundColor: '#05070B' }}>
      <span class="launcher-heading" style={{ position: 'absolute', left: 0, top: 12, width: 410, color: '#F8FAFC', textAlign: 'center' }}>App Launcher</span>
      <span class="launcher-description" style={{ position: 'absolute', left: 0, top: 78, width: 410, color: '#94A3B8', textAlign: 'center' }}>Installed apps</span>
      <LauncherList />
    </div>
  )
}

export class App extends Component {
  template() {
    return <LauncherMenu />
  }
}
