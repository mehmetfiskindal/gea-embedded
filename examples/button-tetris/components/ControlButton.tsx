export function ControlButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <div
      onPress={onPress}
      style={{ width: 126, height: 72, borderRadius: 10, backgroundColor: '#1F2937', justifyContent: 'center', alignItems: 'center' }}
    >
      <span class="tetris-button-label" style={{ color: '#F8FAFC' }}>{label}</span>
    </div>
  )
}
