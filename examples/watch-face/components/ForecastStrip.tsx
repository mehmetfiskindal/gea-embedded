export function ForecastStrip() {
  return (
    <div style={{ position: 'absolute', left: 22, top: 370, width: 366, height: 58, flexDirection: 'row', gap: 8 }}>
      <div style={{ flex: 1, borderRadius: 16, backgroundColor: '#16161A', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 28, height: 4, borderRadius: 2, backgroundColor: '#64D2FF' }} />
        <span style={{ margin: '6px 0 0 0', fontFamily: 'Inter', fontSize: 12, color: '#8E8E93' }}>Now</span>
        <span style={{ margin: '4px 0 0 0', fontFamily: 'Inter', fontSize: 14, color: '#F5F5F7' }}>72F</span>
      </div>
      <div style={{ flex: 1, borderRadius: 16, backgroundColor: '#16161A', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 28, height: 4, borderRadius: 2, backgroundColor: '#30D158' }} />
        <span style={{ margin: '6px 0 0 0', fontFamily: 'Inter', fontSize: 12, color: '#8E8E93' }}>2 PM</span>
        <span style={{ margin: '4px 0 0 0', fontFamily: 'Inter', fontSize: 14, color: '#F5F5F7' }}>74F</span>
      </div>
      <div style={{ flex: 1, borderRadius: 16, backgroundColor: '#16161A', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 28, height: 4, borderRadius: 2, backgroundColor: '#FFD60A' }} />
        <span style={{ margin: '6px 0 0 0', fontFamily: 'Inter', fontSize: 12, color: '#8E8E93' }}>5 PM</span>
        <span style={{ margin: '4px 0 0 0', fontFamily: 'Inter', fontSize: 14, color: '#F5F5F7' }}>70F</span>
      </div>
    </div>
  )
}
