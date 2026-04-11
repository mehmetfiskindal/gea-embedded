import { describe, expect, it } from 'vitest'
import { DEFAULT_ZOOM } from './defaults'

describe('simulator defaults', () => {
  it('uses 1x as the default zoom', () => {
    expect(DEFAULT_ZOOM).toBe(1)
  })
})
