import { watch } from '../stores/WatchStore'

export function HeroTime() {
  return (
    <div style={{ position: 'absolute', left: 24, top: 22, width: 362, height: 92 }}>
      <span style={{ fontFamily: 'Inter', fontSize: 16, color: '#FF453A' }}>{watch.dateText}</span>
      <span style={{ margin: '8px 0 0 0', fontFamily: 'Inter', fontSize: 70, color: '#F5F5F7' }}>{watch.timeText}</span>
    </div>
  )
}
