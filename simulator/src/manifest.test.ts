import { describe, expect, it } from 'vitest'
import { getAppRuntime } from './manifest'

describe('manifest helpers', () => {
  it('returns screen runtime for bouncing-balls', () => {
    expect(getAppRuntime('bouncing-balls')).toBe('screen')
  })

  it('returns app-render runtime for static-card', () => {
    expect(getAppRuntime('static-card')).toBe('app-render')
  })

  it('returns app-render runtime for tic-tac-toe', () => {
    expect(getAppRuntime('tic-tac-toe')).toBe('app-render')
  })
})
