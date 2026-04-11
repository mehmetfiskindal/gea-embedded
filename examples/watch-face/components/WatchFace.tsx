import { Complications } from './Complications'
import { ForecastStrip } from './ForecastStrip'
import { HeroTime } from './HeroTime'
import { Metrics } from './Metrics'
import { WifiFooter } from './WifiFooter'

export function WatchFace() {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: 410, height: 502, fontFamily: 'Inter', fontSize: 15 }}>
      <div style={{ position: 'absolute', left: -90, top: -74, width: 230, height: 230, borderRadius: 115, backgroundColor: '#261010' }} />
      <div style={{ position: 'absolute', right: -70, top: 190, width: 180, height: 180, borderRadius: 90, backgroundColor: '#092018' }} />
      <HeroTime />
      <Complications />
      <Metrics />
      <ForecastStrip />
      <WifiFooter />
    </div>
  )
}
