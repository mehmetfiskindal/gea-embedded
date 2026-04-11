import { watch } from '../stores/WatchStore'

export function Metrics() {
  return (
    <div style={{ position: 'absolute', left: 52, top: 226, width: 306, height: 128, flexDirection: 'row', justifyContent: 'space-between' }}>
      <div style={{ width: 128, height: 128, borderRadius: 64, borderWidth: 6, borderColor: '#222226', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', left: 49, bottom: 16, width: 30, height: watch.stepPct, borderRadius: 15, backgroundColor: '#30D158' }} />
        <span style={{ fontFamily: 'Inter', fontSize: 24, color: '#F5F5F7' }}>{watch.stepText}</span>
        <span style={{ margin: '8px 0 0 0', fontFamily: 'Inter', fontSize: 14, color: '#8E8E93' }}>steps</span>
      </div>
      <div style={{ width: 128, height: 128, borderRadius: 64, borderWidth: 6, borderColor: '#222226', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', left: 49, bottom: 16, width: 30, height: watch.batteryPct, borderRadius: 15, backgroundColor: watch.batteryPct < 25 ? '#FF453A' : '#30D158' }} />
        <span style={{ fontFamily: 'Inter', fontSize: 24, color: '#F5F5F7' }}>{watch.batteryText}</span>
        <span style={{ margin: '8px 0 0 0', fontFamily: 'Inter', fontSize: 14, color: '#8E8E93' }}>battery</span>
      </div>
    </div>
  )
}
