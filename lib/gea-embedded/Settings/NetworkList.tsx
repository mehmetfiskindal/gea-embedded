import { Button, Text, View } from 'gea-embedded'
import { Settings } from './store'

function NetworkRow0() {
  return (
    <Button
      class="settings-network-row"
      style={{ display: Settings.network0Ssid ? 'flex' : 'none' }}
      onClick={() => Settings.tapNetwork(0)}
    >
      <View class="settings-network-row-main">
        <Text class="settings-network-ssid">{Settings.network0Ssid}</Text>
        <Text class="settings-network-rssi-text">{Settings.network0RssiText}</Text>
      </View>
      <Text class="settings-network-lock" style={{ color: Settings.network0Secured ? '#FFD60A' : '#3A3A45' }}>{Settings.network0Secured ? 'LOCK' : 'OPEN'}</Text>
    </Button>
  )
}

function NetworkRow1() {
  return (
    <Button
      class="settings-network-row"
      style={{ display: Settings.network1Ssid ? 'flex' : 'none' }}
      onClick={() => Settings.tapNetwork(1)}
    >
      <View class="settings-network-row-main">
        <Text class="settings-network-ssid">{Settings.network1Ssid}</Text>
        <Text class="settings-network-rssi-text">{Settings.network1RssiText}</Text>
      </View>
      <Text class="settings-network-lock" style={{ color: Settings.network1Secured ? '#FFD60A' : '#3A3A45' }}>{Settings.network1Secured ? 'LOCK' : 'OPEN'}</Text>
    </Button>
  )
}

function NetworkRow2() {
  return (
    <Button
      class="settings-network-row"
      style={{ display: Settings.network2Ssid ? 'flex' : 'none' }}
      onClick={() => Settings.tapNetwork(2)}
    >
      <View class="settings-network-row-main">
        <Text class="settings-network-ssid">{Settings.network2Ssid}</Text>
        <Text class="settings-network-rssi-text">{Settings.network2RssiText}</Text>
      </View>
      <Text class="settings-network-lock" style={{ color: Settings.network2Secured ? '#FFD60A' : '#3A3A45' }}>{Settings.network2Secured ? 'LOCK' : 'OPEN'}</Text>
    </Button>
  )
}

function NetworkRow3() {
  return (
    <Button
      class="settings-network-row"
      style={{ display: Settings.network3Ssid ? 'flex' : 'none' }}
      onClick={() => Settings.tapNetwork(3)}
    >
      <View class="settings-network-row-main">
        <Text class="settings-network-ssid">{Settings.network3Ssid}</Text>
        <Text class="settings-network-rssi-text">{Settings.network3RssiText}</Text>
      </View>
      <Text class="settings-network-lock" style={{ color: Settings.network3Secured ? '#FFD60A' : '#3A3A45' }}>{Settings.network3Secured ? 'LOCK' : 'OPEN'}</Text>
    </Button>
  )
}

function NetworkRow4() {
  return (
    <Button
      class="settings-network-row"
      style={{ display: Settings.network4Ssid ? 'flex' : 'none' }}
      onClick={() => Settings.tapNetwork(4)}
    >
      <View class="settings-network-row-main">
        <Text class="settings-network-ssid">{Settings.network4Ssid}</Text>
        <Text class="settings-network-rssi-text">{Settings.network4RssiText}</Text>
      </View>
      <Text class="settings-network-lock" style={{ color: Settings.network4Secured ? '#FFD60A' : '#3A3A45' }}>{Settings.network4Secured ? 'LOCK' : 'OPEN'}</Text>
    </Button>
  )
}

function NetworkRow5() {
  return (
    <Button
      class="settings-network-row"
      style={{ display: Settings.network5Ssid ? 'flex' : 'none' }}
      onClick={() => Settings.tapNetwork(5)}
    >
      <View class="settings-network-row-main">
        <Text class="settings-network-ssid">{Settings.network5Ssid}</Text>
        <Text class="settings-network-rssi-text">{Settings.network5RssiText}</Text>
      </View>
      <Text class="settings-network-lock" style={{ color: Settings.network5Secured ? '#FFD60A' : '#3A3A45' }}>{Settings.network5Secured ? 'LOCK' : 'OPEN'}</Text>
    </Button>
  )
}

function NetworkRow6() {
  return (
    <Button
      class="settings-network-row"
      style={{ display: Settings.network6Ssid ? 'flex' : 'none' }}
      onClick={() => Settings.tapNetwork(6)}
    >
      <View class="settings-network-row-main">
        <Text class="settings-network-ssid">{Settings.network6Ssid}</Text>
        <Text class="settings-network-rssi-text">{Settings.network6RssiText}</Text>
      </View>
      <Text class="settings-network-lock" style={{ color: Settings.network6Secured ? '#FFD60A' : '#3A3A45' }}>{Settings.network6Secured ? 'LOCK' : 'OPEN'}</Text>
    </Button>
  )
}

function NetworkRow7() {
  return (
    <Button
      class="settings-network-row"
      style={{ display: Settings.network7Ssid ? 'flex' : 'none' }}
      onClick={() => Settings.tapNetwork(7)}
    >
      <View class="settings-network-row-main">
        <Text class="settings-network-ssid">{Settings.network7Ssid}</Text>
        <Text class="settings-network-rssi-text">{Settings.network7RssiText}</Text>
      </View>
      <Text class="settings-network-lock" style={{ color: Settings.network7Secured ? '#FFD60A' : '#3A3A45' }}>{Settings.network7Secured ? 'LOCK' : 'OPEN'}</Text>
    </Button>
  )
}

export function SettingsNetworkList() {
  return (
    <View class="settings-screen settings-network-screen">
      <View class="settings-network-header">
        <Button class="settings-network-back-button" onClick={() => Settings.showOverview()}>
          <Text class="settings-button-text-muted">Back</Text>
        </Button>
        <Text class="settings-network-title">Wi-Fi</Text>
      </View>

      <Text class="settings-network-status">{Settings.status}</Text>

      <View class="settings-network-empty" style={{ display: Settings.networkCount ? 'none' : 'flex' }}>
        <Text class="settings-network-empty-text">{Settings.wifiEnabled ? 'Scanning for networks...' : 'Enable Wi-Fi to scan'}</Text>
      </View>

      <View class="settings-network-list">
        <NetworkRow0 />
        <NetworkRow1 />
        <NetworkRow2 />
        <NetworkRow3 />
        <NetworkRow4 />
        <NetworkRow5 />
        <NetworkRow6 />
        <NetworkRow7 />
      </View>
    </View>
  )
}
