export type GeaScreen = {
  width: number
  height: number
  clear(): void
  flush(): void
  color(r: number, g: number, b: number): number
  fillRect(x: number, y: number, w: number, h: number, color: number): void
  drawText(text: string, x: number, y: number, color: number, scale: number): void
}

export type GeaImageRuntime = {
  loadBytes(data: ArrayBuffer | Uint8Array): number
  loadUrl(url: string): number | Promise<number>
  width(id: number): number
  height(id: number): number
  frameCount(id: number): number
  isAnimated(id: number): boolean
  setPlaying(id: number, playing: number): void
  seek(id: number, frame: number): void
  advance(id: number, deltaMs: number): boolean
  draw(id: number, dx: number, dy: number): void
  drawScaled?(id: number, dx: number, dy: number, dw: number, dh: number): void
  dispose(id: number): void
}

type FetchInit = {
  method?: string
  headers?: Record<string, string>
  body?: string | ArrayBuffer | ArrayBufferView
}

type FetchResponse = {
  ok: boolean
  status: number
  url: string
  headers: {
    get(name: string): string | null
    has(name: string): boolean
    forEach(cb: (value: string, key: string) => void): void
  }
  text(): string | Promise<string>
  json(): unknown | Promise<unknown>
  arrayBuffer(): ArrayBuffer | Promise<ArrayBuffer>
}

declare const screen: GeaScreen
declare const __gea_embedded_image: GeaImageRuntime
declare function fetch(url: string, init?: FetchInit): Promise<FetchResponse>
declare function requestAnimationFrame(cb: (timestampMs: number) => void): number

export const display = screen
export const images = __gea_embedded_image
export const fetchBytes = fetch
export const requestFrame = requestAnimationFrame
export const W = screen.width
export const H = screen.height
export const WHITE = screen.color(255, 255, 255)
export const DARK = screen.color(17, 24, 39)
