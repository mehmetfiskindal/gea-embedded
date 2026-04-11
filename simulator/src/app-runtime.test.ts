import { describe, expect, it, vi } from 'vitest'

import {
  APP_RUNTIME_WASM_EXPORTS,
  dispatchAppPress,
  getMirrorSchema,
  hitTestApp,
  initializeAppRuntime,
  setMirrorScroll,
  setAppWifi,
  setAppWifiScan
} from './app-runtime'

describe('app runtime', () => {
  it('exposes the wasm entrypoints used by the simulator', () => {
    expect(APP_RUNTIME_WASM_EXPORTS).toEqual([
      'app_init',
      'app_frame',
      'app_touch',
      'app_touch_start_element',
      'app_touch_end_element',
      'app_touch_move_element',
      'app_hit_test',
      'app_touch_down',
      'app_touch_up',
      'app_touch_start',
      'app_touch_move',
      'app_touch_end',
      'app_mirror_set_int',
      'app_mirror_set_string',
      'app_mirror_set_array_len',
      'app_mirror_set_array_int',
      'app_mirror_set_scroll',
      'app_mirror_commit',
      'app_mirror_get_field_count',
      'app_mirror_get_schema_hash',
      'gea_embedded_imu_web_set_tilt',
      'gea_embedded_wifi_web_set_state',
      'gea_embedded_wifi_web_set_scan_count',
      'gea_embedded_wifi_web_set_scan_entry'
    ])
  })

  it('initializes the wasm app through app_init', () => {
    const ccall = vi.fn(() => 0)

    initializeAppRuntime({ ccall }, 410, 502)

    expect(ccall).toHaveBeenCalledWith('app_init', 'number', ['number', 'number'], [410, 502])
  })

  it('throws when app_init reports an initialization error', () => {
    const ccall = vi.fn(() => 3)

    expect(() => initializeAppRuntime({ ccall }, 410, 502)).toThrow('WASM app initialization failed with code 3')
  })

  it('runs touch handling before rendering the next frame', () => {
    const ccall = vi.fn(() => 0)

    dispatchAppPress({ ccall }, 8)

    const calls = ccall.mock.calls as unknown as Array<[string, string | null, string[], unknown[]]>
    const frameCall = calls[1]!

    expect(calls[0]).toEqual(['app_touch', null, ['number'], [8]])
    expect(frameCall[0]).toBe('app_frame')
    expect(frameCall[2]).toEqual(['number'])
    expect(typeof frameCall[3][0]).toBe('number')
  })

  it('preserves non-sequential press ids returned by hit testing', () => {
    const ccall = vi.fn((ident: string) => (ident === 'app_hit_test' ? 65 : 0))

    const pressId = hitTestApp({ ccall }, 120, 220)

    expect(pressId).toBe(65)
    expect(ccall).toHaveBeenCalledWith('app_hit_test', 'number', ['number', 'number'], [120, 220])
  })

  it('applies mirrored scroll offsets to the wasm app', () => {
    const ccall = vi.fn(() => 0)

    setMirrorScroll({ ccall }, 12, 96)

    expect(ccall).toHaveBeenCalledWith('app_mirror_set_scroll', null, ['number', 'number'], [12, 96])
  })

  it('syncs simulator wifi state into the wasm app', () => {
    const ccall = vi.fn(() => 0)

    setAppWifi({ ccall, _gea_embedded_wifi_web_set_state: vi.fn() }, true, 'Gea Lab', '192.168.4.22', -48)

    expect(ccall).toHaveBeenCalledWith(
      'gea_embedded_wifi_web_set_state',
      null,
      ['number', 'string', 'string', 'number'],
      [1, 'Gea Lab', '192.168.4.22', -48]
    )
  })

  it('pushes the simulator wifi scan list into the wasm app', () => {
    const ccall = vi.fn(() => 0)

    setAppWifiScan(
      {
        ccall,
        _gea_embedded_wifi_web_set_scan_count: vi.fn(),
        _gea_embedded_wifi_web_set_scan_entry: vi.fn()
      },
      [
        { ssid: 'Home', rssi: -45, secured: 1 },
        { ssid: 'Cafe', rssi: -72, secured: 0 }
      ]
    )

    expect(ccall).toHaveBeenNthCalledWith(1, 'gea_embedded_wifi_web_set_scan_count', null, ['number'], [2])
    expect(ccall).toHaveBeenNthCalledWith(
      2,
      'gea_embedded_wifi_web_set_scan_entry',
      null,
      ['number', 'string', 'number', 'number'],
      [0, 'Home', -45, 1]
    )
    expect(ccall).toHaveBeenNthCalledWith(
      3,
      'gea_embedded_wifi_web_set_scan_entry',
      null,
      ['number', 'string', 'number', 'number'],
      [1, 'Cafe', -72, 0]
    )
  })

  it('skips wifi scan sync for older wasm apps without scan shims', () => {
    const ccall = vi.fn(() => 0)

    setAppWifiScan({ ccall }, [{ ssid: 'Home', rssi: -45, secured: 1 }])

    expect(ccall).not.toHaveBeenCalled()
  })

  it('reads mirror schema metadata when exported by the wasm app', () => {
    const ccall = vi.fn((ident: string) => {
      if (ident === 'app_mirror_get_field_count') return 3
      if (ident === 'app_mirror_get_schema_hash') return 0x89abcdef
      return 0
    })

    expect(
      getMirrorSchema({
        ccall,
        _app_mirror_get_field_count: vi.fn(),
        _app_mirror_get_schema_hash: vi.fn()
      })
    ).toEqual({ fieldCount: 3, schemaHash: 0x89abcdef })
  })
})
