interface Screen {
  readonly width: number
  readonly height: number
  color(r: number, g: number, b: number): number
  clear(): void
  fillCircle(x: number, y: number, r: number, color: number): void
}

declare const screen: Screen
declare function requestAnimationFrame(cb: (timestampMs: number) => void): number
