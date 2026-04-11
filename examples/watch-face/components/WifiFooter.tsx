import { watch } from '../stores/WatchStore'

export function WifiFooter() {
  return (
    <div style={{ position: 'absolute', left: 54, top: 444, width: 302, height: 42, borderRadius: 18, backgroundColor: '#16161A', padding: '8px 0 0 20px' }} onClick={() => watch.openSettings()}>
      <span style={{ fontFamily: 'Inter', fontSize: 13, color: '#8E8E93' }}>{watch.wifiTitle}</span>
      <span style={{ margin: '3px 0 0 0', fontFamily: 'Inter', fontSize: 13, color: '#F5F5F7' }}>{watch.wifiDetail}</span>
    </div>
  )
}
