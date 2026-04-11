import { Button, Text, View } from 'gea-embedded'
import { Settings } from './store'

export function SettingsPasswordEntry() {
  return (
    <View class="settings-screen settings-password-screen">
      <View class="settings-password-header">
        <Button class="settings-password-back-button" onClick={() => Settings.openWifi()}>
          <Text class="settings-button-text-muted">Back</Text>
        </Button>
        <Text class="settings-password-title">Connect</Text>
      </View>

      <View class="settings-password-network-card">
        <Text class="settings-password-network-name">{Settings.selectedSsid}</Text>
        <Text class="settings-password-network-meta">{Settings.selectedRssiText}</Text>
      </View>

      <Text class="settings-password-status">{Settings.status}</Text>

      <View class="settings-password-field">
        <Text class="settings-password-label">Password</Text>
        <input class="settings-password-input" type="password" value={Settings.inputPassword} placeholder="Enter password" autoFocus={Settings.selectedInput === 1} onFocus={() => Settings.selectPassword()} onInput={event => Settings.updatePassword(event.currentTarget.value)} onKeyDown={event => Settings.keydown(event.keyCode)} />
      </View>

      <View class="settings-password-actions">
        <Button class="settings-password-cancel-button" onClick={() => Settings.openWifi()}>
          <Text class="settings-button-text-muted">Cancel</Text>
        </Button>
        <Button class="settings-password-connect-button" onClick={() => Settings.connectToSelected()}>
          <Text class="settings-button-text-primary">Connect</Text>
        </Button>
      </View>
    </View>
  )
}
