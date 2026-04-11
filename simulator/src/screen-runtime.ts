import { framebufferView, rgb565ToRgba } from './framebuffer'

type WasmModule = {
  HEAPU8: Uint8Array
  ccall: (ident: string, returnType: string | null, argTypes: string[], args: unknown[]) => number
}

type WasmModuleOptions = {
  locateFile?: (path: string, scriptDirectory: string) => string
}

type WasmModuleFactory = (options?: WasmModuleOptions) => Promise<WasmModule>
type WasmModuleNamespace = { default: WasmModuleFactory }

const screenRuntimeLoader = import.meta.glob('../../targets/web/dist/screen-runtime/module.js') as Record<
  string,
  () => Promise<WasmModuleNamespace>
>

export const SCREEN_RUNTIME_IMPORT_KEY = '../../targets/web/dist/screen-runtime/module.js'
export const SCREEN_RUNTIME_WASM_URL = '/screen-runtime/module.wasm'

export interface ScreenRuntime {
  module: WasmModule
  presentFramebuffer: () => void
  teardown: () => void
}

type NativeRequestAnimationFrame = (cb: (timestampMs: number) => void) => number
type NativeCancelAnimationFrame = (handle: number) => void

const nativeRaf = (typeof globalThis.requestAnimationFrame === 'function'
  ? globalThis.requestAnimationFrame.bind(globalThis)
  : undefined) as unknown as NativeRequestAnimationFrame
const nativeCaf = (typeof globalThis.cancelAnimationFrame === 'function'
  ? globalThis.cancelAnimationFrame.bind(globalThis)
  : undefined) as unknown as NativeCancelAnimationFrame

export function createManagedRequestAnimationFrame(
  nativeRaf: NativeRequestAnimationFrame,
  nativeCaf: NativeCancelAnimationFrame,
  presentFramebuffer: () => void
) {
  let rafHandle = 0
  let rafCallback: ((timestampMs: number) => void) | null = null
  let scheduledByCallback = false

  function frameLoop(timestampMs: number) {
    if (!rafCallback) return
    scheduledByCallback = false
    rafCallback(timestampMs)
    presentFramebuffer()
    if (!scheduledByCallback) {
      rafHandle = nativeRaf(frameLoop)
    }
  }

  return {
    requestAnimationFrame(cb: (timestampMs: number) => void): number {
      rafCallback = cb
      scheduledByCallback = true
      rafHandle = nativeRaf(frameLoop)
      return rafHandle
    },
    teardown() {
      rafCallback = null
      if (rafHandle) {
        nativeCaf(rafHandle)
        rafHandle = 0
      }
    }
  }
}

export async function initScreenRuntime(
  width: number,
  height: number,
  ctx: CanvasRenderingContext2D
): Promise<ScreenRuntime> {
  const loader = screenRuntimeLoader[SCREEN_RUNTIME_IMPORT_KEY]
  if (!loader) {
    throw new Error('Missing screen runtime WASM module. Run ./targets/web/build-screen-runtime.sh.')
  }

  const moduleFactory = (await loader()).default
  const module = await moduleFactory({
    locateFile(path) {
      return path === 'module.wasm' ? SCREEN_RUNTIME_WASM_URL : path
    }
  })

  const ok = module.ccall('screen_init', 'number', ['number', 'number'], [width, height])
  if (!ok) {
    throw new Error(`screen_init failed for ${width}x${height}`)
  }

  let cachedImageData: ImageData | null = null
  let cachedRgba: Uint8ClampedArray<ArrayBuffer> | null = null
  let cachedW = 0
  let cachedH = 0

  function presentFramebuffer() {
    const ptr = module.ccall('screen_get_framebuffer_ptr', 'number', [], [])
    const w = module.ccall('screen_get_width', 'number', [], [])
    const h = module.ccall('screen_get_height', 'number', [], [])
    const pixels = framebufferView(module.HEAPU8, ptr, w, h)

    if (w !== cachedW || h !== cachedH) {
      cachedRgba = new Uint8ClampedArray(new ArrayBuffer(w * h * 4))
      cachedImageData = new ImageData(cachedRgba, w, h)
      cachedW = w
      cachedH = h
    }

    rgb565ToRgba(pixels, cachedRgba!)
    ctx.putImageData(cachedImageData!, 0, 0)
  }

  const screenObj = {
    get width() {
      return module.ccall('screen_get_width', 'number', [], [])
    },
    get height() {
      return module.ccall('screen_get_height', 'number', [], [])
    },
    color(r: number, g: number, b: number): number {
      return module.ccall('screen_color', 'number', ['number', 'number', 'number'], [r, g, b])
    },
    clear() {
      module.ccall('screen_clear', null, [], [])
    },
    flush() {
      module.ccall('screen_flush', null, [], [])
      presentFramebuffer()
    },
    fillRect(x: number, y: number, w: number, h: number, color: number) {
      module.ccall('screen_fill_rect', null, ['number', 'number', 'number', 'number', 'number'], [x, y, w, h, color])
    },
    strokeRect(x: number, y: number, w: number, h: number, color: number) {
      module.ccall('screen_stroke_rect', null, ['number', 'number', 'number', 'number', 'number'], [x, y, w, h, color])
    },
    fillCircle(cx: number, cy: number, r: number, color: number) {
      module.ccall('screen_fill_circle', null, ['number', 'number', 'number', 'number'], [cx, cy, r, color])
    },
    strokeCircle(cx: number, cy: number, r: number, color: number) {
      module.ccall('screen_stroke_circle', null, ['number', 'number', 'number', 'number'], [cx, cy, r, color])
    },
    drawLine(x0: number, y0: number, x1: number, y1: number, color: number) {
      module.ccall(
        'screen_draw_line',
        null,
        ['number', 'number', 'number', 'number', 'number'],
        [x0, y0, x1, y1, color]
      )
    },
    drawArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number, color: number) {
      module.ccall(
        'screen_draw_arc',
        null,
        ['number', 'number', 'number', 'number', 'number', 'number'],
        [cx, cy, r, startDeg, endDeg, color]
      )
    },
    fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, color: number) {
      module.ccall(
        'screen_fill_triangle',
        null,
        ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
        [x0, y0, x1, y1, x2, y2, color]
      )
    },
    drawText(text: string, x: number, y: number, color: number, scale: number) {
      module.ccall(
        'screen_draw_text',
        null,
        ['string', 'number', 'number', 'number', 'number'],
        [text, x, y, color, scale]
      )
    },
    setPixel(x: number, y: number, color: number) {
      module.ccall('screen_set_pixel', null, ['number', 'number', 'number'], [x, y, color])
    },
    pushClip(x: number, y: number, w: number, h: number) {
      module.ccall('screen_push_clip', null, ['number', 'number', 'number', 'number'], [x, y, w, h])
    },
    popClip() {
      module.ccall('screen_pop_clip', null, [], [])
    },
    setAlpha(a: number) {
      module.ccall('screen_set_alpha', null, ['number'], [a])
    },
    fillRoundedRect(
      x: number,
      y: number,
      w: number,
      h: number,
      tl: number,
      tr: number,
      br: number,
      bl: number,
      color: number
    ) {
      module.ccall(
        'screen_fill_rounded_rect',
        null,
        ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
        [x, y, w, h, tl, tr, br, bl, color]
      )
    },
    strokeRoundedRect(
      x: number,
      y: number,
      w: number,
      h: number,
      tl: number,
      tr: number,
      br: number,
      bl: number,
      lw: number,
      color: number
    ) {
      module.ccall(
        'screen_stroke_rounded_rect',
        null,
        ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
        [x, y, w, h, tl, tr, br, bl, lw, color]
      )
    }
  }

  function copyBytesToWasm(data: ArrayBuffer | Uint8Array): { ptr: number; len: number } {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    const ptr = module.ccall('malloc', 'number', ['number'], [bytes.length])
    module.HEAPU8.set(bytes, ptr)
    return { ptr, len: bytes.length }
  }

  const imageObj = {
    loadBytes(data: ArrayBuffer | Uint8Array): number {
      const { ptr, len } = copyBytesToWasm(data)
      const id = module.ccall('screen_image_decode', 'number', ['number', 'number'], [ptr, len])
      module.ccall('free', null, ['number'], [ptr])
      return id
    },
    async loadUrl(url: string): Promise<number> {
      const resp = await fetch(url)
      if (!resp.ok) return -1
      const buf = await resp.arrayBuffer()
      return imageObj.loadBytes(buf)
    },
    width(id: number): number {
      return module.ccall('screen_image_width', 'number', ['number'], [id])
    },
    height(id: number): number {
      return module.ccall('screen_image_height', 'number', ['number'], [id])
    },
    frameCount(id: number): number {
      return module.ccall('screen_image_frame_count', 'number', ['number'], [id])
    },
    isAnimated(id: number): boolean {
      return !!module.ccall('screen_image_is_animated', 'number', ['number'], [id])
    },
    setPlaying(id: number, playing: number) {
      module.ccall('screen_image_set_playing', null, ['number', 'number'], [id, playing])
    },
    seek(id: number, frame: number) {
      module.ccall('screen_image_seek', null, ['number', 'number'], [id, frame])
    },
    advance(id: number, deltaMs: number): boolean {
      return !!module.ccall('screen_image_advance', 'number', ['number', 'number'], [id, deltaMs])
    },
    draw(id: number, dx: number, dy: number) {
      module.ccall('screen_image_draw', null, ['number', 'number', 'number'], [id, dx, dy])
    },
    drawScaled(id: number, dx: number, dy: number, dw: number, dh: number) {
      module.ccall(
        'screen_image_draw_scaled',
        null,
        ['number', 'number', 'number', 'number', 'number'],
        [id, dx, dy, dw, dh]
      )
    },
    dispose(id: number) {
      module.ccall('screen_image_dispose', null, ['number'], [id])
    }
  }

  Object.defineProperty(globalThis, '__gea_embedded_image', { value: imageObj, configurable: true })
  Object.defineProperty(globalThis, 'screen', { value: screenObj, configurable: true })

  const managedRaf = createManagedRequestAnimationFrame(nativeRaf, nativeCaf, presentFramebuffer)

  ;(
    globalThis as unknown as { requestAnimationFrame: (cb: (timestampMs: number) => void) => number }
  ).requestAnimationFrame = managedRaf.requestAnimationFrame

  return { module, presentFramebuffer, teardown: managedRaf.teardown }
}
