import { Cell } from './Cell'

export function Board() {
  return (
    <div style={{ flexDirection: 'column', gap: 4 }}>
      {[0, 1, 2].map(row => (
        <div style={{ flexDirection: 'row', gap: 4 }}>
          {[0, 1, 2].map(col => (
            <Cell index={row * 3 + col} />
          ))}
        </div>
      ))}
    </div>
  )
}
