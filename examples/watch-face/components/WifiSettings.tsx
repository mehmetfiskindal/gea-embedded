import { watch } from '../stores/WatchStore'

export function WifiSettings() {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: 410, height: 502, backgroundColor: '#050507', fontFamily: 'Inter', fontSize: 15 }}>
      <div style={{ position: 'absolute', left: -88, top: -92, width: 242, height: 242, borderRadius: 121, backgroundColor: '#061A2F' }} />
      <div style={{ position: 'absolute', right: -90, bottom: -86, width: 220, height: 220, borderRadius: 110, backgroundColor: '#1C1602' }} />

      <div style={{ position: 'absolute', left: 22, top: 18, width: 72, height: 36, borderRadius: 18, backgroundColor: '#1C1C22', alignItems: 'center', justifyContent: 'center' }} onClick={() => watch.closeSettings()}>
        <span style={{ fontFamily: 'Inter', fontSize: 15, color: '#F5F5F7' }}>Back</span>
      </div>
      <span style={{ position: 'absolute', left: 112, top: 22, fontFamily: 'Inter', fontSize: 24, color: '#F5F5F7' }}>Wi-Fi Setup</span>
      <span style={{ position: 'absolute', left: 25, top: 60, fontFamily: 'Inter', fontSize: 14, color: '#8E8E93' }}>{watch.settingsStatus}</span>

      <span style={{ position: 'absolute', left: 27, top: 78, fontFamily: 'Inter', fontSize: 13, color: watch.selectedInput === 0 ? '#64D2FF' : '#8E8E93' }}>
        Network name
      </span>
      <div style={{ position: 'absolute', left: 25, top: 94, width: 360, height: 52 }}>
        <input style={{ fontFamily: 'Inter', fontSize: 15 }} value={watch.wifiSsid} placeholder="Tap to enter SSID" onFocus={() => watch.selectSsid()} onInput={event => watch.updateSsid(event.currentTarget.value)} onKeyDown={event => watch.keydown(event.keyCode)} />
      </div>

      <span style={{ position: 'absolute', left: 27, top: 148, fontFamily: 'Inter', fontSize: 13, color: watch.selectedInput === 1 ? '#64D2FF' : '#8E8E93' }}>
        Password
      </span>
      <div style={{ position: 'absolute', left: 25, top: 164, width: 360, height: 52 }}>
        <input style={{ fontFamily: 'Inter', fontSize: 15 }} type="password" value={watch.wifiPassword} placeholder="Tap to enter password" onFocus={() => watch.selectPassword()} onInput={event => watch.updatePassword(event.currentTarget.value)} onKeyDown={event => watch.keydown(event.keyCode)} />
      </div>

      <div style={{ position: 'absolute', left: 48, top: 226, width: 132, height: 30, borderRadius: 15, backgroundColor: '#1C1C22', alignItems: 'center', justifyContent: 'center' }} onClick={() => watch.closeSettings()}>
        <span style={{ fontFamily: 'Inter', fontSize: 15, color: '#8E8E93' }}>Cancel</span>
      </div>
      <div style={{ position: 'absolute', left: 230, top: 226, width: 132, height: 30, borderRadius: 15, backgroundColor: '#0A84FF', alignItems: 'center', justifyContent: 'center' }} onClick={() => watch.saveWifi()}>
        <span style={{ fontFamily: 'Inter', fontSize: 15, color: '#FFFFFF' }}>Save</span>
      </div>
    </div>
  )
}
