import { watch } from '../stores/WatchStore'

export function Complications() {
  return (
    <div style={{ position: 'absolute', left: 22, top: 126, width: 366, height: 78, flexDirection: 'row', gap: 18 }}>
      <div style={{ width: 174, height: 78, borderRadius: 18, backgroundColor: '#16161A', padding: '12px 0 0 16px' }}>
        <div style={{ position: 'absolute', top: 14, left: 14, width: 12, height: 12, borderRadius: 6, backgroundColor: '#64D2FF' }} />
        <span style={{ margin: '0 0 0 18px', fontFamily: 'Inter', fontSize: 16, color: '#F5F5F7' }}>{watch.weatherText}</span>
        <span style={{ margin: '10px 0 0 0', fontFamily: 'Inter', fontSize: 14, color: '#8E8E93' }}>{watch.weatherDetail}</span>
      </div>
      <div style={{ width: 174, height: 78, borderRadius: 18, backgroundColor: '#16161A', padding: '12px 0 0 16px' }}>
        <div style={{ position: 'absolute', top: 14, left: 14, width: 12, height: 12, borderRadius: 6, backgroundColor: '#FF453A' }} />
        <span style={{ margin: '0 0 0 18px', fontFamily: 'Inter', fontSize: 16, color: '#F5F5F7' }}>{watch.calendarTime}</span>
        <span style={{ margin: '10px 0 0 0', fontFamily: 'Inter', fontSize: 14, color: '#8E8E93' }}>{watch.calendarDetail}</span>
      </div>
    </div>
  )
}
