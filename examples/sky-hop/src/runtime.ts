export type GeaScreen = {
  readonly width: number
  readonly height: number
  color(r: number, g: number, b: number): number
  clear(): void
  flush(): void
  fillRect(x: number, y: number, w: number, h: number, color: number): void
  strokeRect(x: number, y: number, w: number, h: number, color: number): void
  fillCircle(x: number, y: number, r: number, color: number): void
  strokeCircle(x: number, y: number, r: number, color: number): void
  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, color: number): void
  drawText(text: string, x: number, y: number, color: number, scale: number): void
  setAlpha?(alpha: number): void
}

export type GeaImageRuntime = {
  loadBytes(data: ArrayBuffer | Uint8Array): number
  loadUrl(url: string): number | Promise<number>
  draw(id: number, dx: number, dy: number): void
  drawScaled(id: number, dx: number, dy: number, dw: number, dh: number): void
  width(id: number): number
  height(id: number): number
}

export type TouchSample = {
  touching: boolean
  x: number
  y: number
}

export type GeaTouchRuntime = {
  read(): TouchSample
}

declare const screen: GeaScreen
declare const __gea_embedded_image: GeaImageRuntime
declare const __gea_embedded_touch: GeaTouchRuntime | undefined
declare function requestAnimationFrame(cb: (timestampMs: number) => void): number

export const display = screen
export const images = __gea_embedded_image
export const touch = typeof __gea_embedded_touch === 'undefined' ? undefined : __gea_embedded_touch
export const requestFrame = requestAnimationFrame
