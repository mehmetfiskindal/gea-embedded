import { describe, expect, it } from 'vitest'
import { getAppScriptUrl, getModuleImportKey, getModuleWasmUrl } from './app-loader'

describe('app loader paths', () => {
  it('loads wasm modules from the web build output instead of public assets', () => {
    expect(getModuleImportKey('static-card')).toBe('../../targets/web/dist/static-card/module.js')
  })

  it('keeps the thin app bundle in public assets', () => {
    expect(getAppScriptUrl('static-card', '123')).toBe('/apps/static-card/app.js?v=123')
  })

  it('loads the wasm binary from the simulator public assets', () => {
    expect(getModuleWasmUrl('static-card')).toBe('/apps/static-card/module.wasm')
  })
})
