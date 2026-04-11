import { Text, View } from 'gea-embedded'

export function SettingsRow({ label, value }: { label: string; value: string }) {
  return (
    <View class="settings-row">
      <Text class="settings-row-label">{label}</Text>
      <Text class="settings-row-value">{value}</Text>
    </View>
  )
}
