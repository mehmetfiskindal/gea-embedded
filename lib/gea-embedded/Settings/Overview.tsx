import { Button, Text, View } from 'gea-embedded'
import { Settings } from './store'
import { SettingsRow } from './SettingsRow'

export function SettingsOverview() {
  return (
    <View class="settings-screen settings-overview-screen">
      <View class="settings-header">
        <View class="settings-heading">
          <Text class="settings-title">Settings</Text>
          <Text class="settings-status-text">{Settings.status}</Text>
        </View>
      </View>

      <View class="settings-overview-scroll">
        <View class="settings-inline-actions">
          <Button
            class="settings-inline-action-button"
            style={{ backgroundColor: Settings.wifiEnabled ? '#0A84FF' : '#4A4A52' }}
            onClick={() => Settings.toggleWifi()}
            onTouchStart={(x, y) => Settings.startWifiHold(x, y)}
            onTouchMove={(x, y) => Settings.moveWifiHold(x, y)}
            onTouchEnd={() => Settings.endWifiHold()}
          >
            <Text class="settings-button-text-primary settings-inline-action-label">{Settings.wifiToggleLabel}</Text>
          </Button>
          <Button
            class="settings-inline-action-button"
            style={{ backgroundColor: Settings.bluetoothEnabled ? '#0A84FF' : '#4A4A52' }}
            onClick={() => Settings.toggleBluetooth()}
          >
            <Text class="settings-button-text-primary settings-inline-action-label">{Settings.bluetoothToggleLabel}</Text>
          </Button>
        </View>

        <Button
          class="settings-wifi-card"
          onTouchStart={(x, y) => Settings.startWifiHold(x, y)}
          onTouchMove={(x, y) => Settings.moveWifiHold(x, y)}
          onTouchEnd={() => Settings.endWifiHold()}
        >
          <View class="settings-wifi-card-copy">
            <Text class="settings-wifi-card-label">Wi-Fi connection</Text>
            <Text class="settings-wifi-card-network">{Settings.currentNetwork}</Text>
          </View>
          <View
            class="settings-wifi-status-badge"
            style={{ backgroundColor: Settings.wifiConnected ? '#123D2B' : '#3A1D22' }}
          >
            <Text class="settings-wifi-status-text" style={{ color: Settings.wifiConnected ? '#30D158' : '#FF453A' }}>
              {Settings.wifiStatus}
            </Text>
          </View>
        </Button>

        <View class="settings-row-list">
          <View class="settings-volume-row">
            <Text class="settings-row-label">Volume</Text>
            <View class="settings-volume-controls">
              <Button class="settings-volume-button" onClick={() => Settings.volumeDown()}>
                <Text class="settings-volume-button-text">-</Text>
              </Button>
              <Text class="settings-volume-value">{Settings.volumeText}</Text>
              <Button class="settings-volume-button" onClick={() => Settings.volumeUp()}>
                <Text class="settings-volume-button-text">+</Text>
              </Button>
            </View>
          </View>
          <View class="settings-volume-row">
            <Text class="settings-row-label">Brightness</Text>
            <View class="settings-volume-controls">
              <Button class="settings-volume-button" onClick={() => Settings.brightnessDown()}>
                <Text class="settings-volume-button-text">-</Text>
              </Button>
              <Text class="settings-volume-value">{Settings.brightnessText}</Text>
              <Button class="settings-volume-button" onClick={() => Settings.brightnessUp()}>
                <Text class="settings-volume-button-text">+</Text>
              </Button>
            </View>
          </View>
          <SettingsRow label="Bluetooth name" value={Settings.bluetoothDisplayName} />
          <SettingsRow label="Battery" value={Settings.batteryText} />
          <SettingsRow label="IP address" value={Settings.ipAddress} />
          <SettingsRow label="Wi-Fi MAC" value={Settings.wifiMac} />
          <SettingsRow label="Bluetooth" value={Settings.bluetoothStatus} />
          <SettingsRow label="Bluetooth MAC" value={Settings.bluetoothMac} />
          <SettingsRow label="Signal" value={Settings.wifiRssiText} />
        </View>
      </View>
    </View>
  )
}
