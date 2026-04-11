import { View } from 'gea-embedded'
import { SettingsOverview } from './Overview'
import { SettingsNetworkList } from './NetworkList'
import { SettingsPasswordEntry } from './PasswordEntry'
import { Settings } from './store'

export function SettingsContent() {
  return (
    <View class="settings-content">
      {Settings.screen === 0 && <SettingsOverview />}
      {Settings.screen === 1 && <SettingsNetworkList />}
      {Settings.screen === 2 && <SettingsPasswordEntry />}
    </View>
  )
}
