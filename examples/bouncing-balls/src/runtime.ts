export type GeaScreen = {
  readonly width: number
  readonly height: number
  color(r: number, g: number, b: number): number
  clear(): void
  fillCircle(x: number, y: number, r: number, color: number): void
}

declare const screen: GeaScreen
declare function requestAnimationFrame(cb: (timestampMs: number) => void): number

export const display = screen
export const requestFrame = requestAnimationFrame
