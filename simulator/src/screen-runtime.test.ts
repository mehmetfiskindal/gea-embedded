import { describe, expect, it, vi } from 'vitest'
import { SCREEN_RUNTIME_WASM_URL, createManagedRequestAnimationFrame } from './screen-runtime'

describe('screen runtime', () => {
  it('serves the shared screen runtime wasm from a fixed public path', () => {
    expect(SCREEN_RUNTIME_WASM_URL).toBe('/screen-runtime/module.wasm')
  })

  it('forwards native RAF timestamps into the managed callback', () => {
    const nativeCallbacks: Array<(timestampMs: number) => void> = []
    const nativeRaf = vi.fn((cb: (timestampMs: number) => void) => {
      nativeCallbacks.push(cb)
      return nativeCallbacks.length
    })
    const nativeCaf = vi.fn()
    const presentFramebuffer = vi.fn()
    const seenTimestamps: number[] = []

    const managedRaf = createManagedRequestAnimationFrame(nativeRaf, nativeCaf, presentFramebuffer)
    const handle = managedRaf.requestAnimationFrame(timestampMs => {
      seenTimestamps.push(timestampMs)
    })

    expect(handle).toBe(1)
    expect(nativeCallbacks).toHaveLength(1)

    nativeCallbacks[0](16.67)

    expect(seenTimestamps).toEqual([16.67])
    expect(presentFramebuffer).toHaveBeenCalledTimes(1)
    expect(nativeCallbacks).toHaveLength(2)
  })
})
