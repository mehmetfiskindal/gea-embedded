import { View } from 'gea-embedded'
import { SettingsContent } from './SettingsContent'
import { Settings } from './store'

export function SettingsPanel() {
  return (
    <View class="settings-panel">
      {Settings.visible ? (
        <View class="settings-panel-blocker" onClick={() => Settings.absorbTouch()}>
          <SettingsContent />
        </View>
      ) : (
        <View class="settings-hidden" />
      )}
    </View>
  )
}
