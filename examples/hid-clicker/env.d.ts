declare function requestAnimationFrame(cb: (timestampMs: number) => void): number

declare module '*.css'

declare function gea_embedded_ble_key_tap(hidCode: number): void
declare function gea_embedded_ble_key_down(modifier: number, hidCode: number): void
declare function gea_embedded_ble_key_up(): void
declare function gea_embedded_ble_mouse_move(dx: number, dy: number, buttons: number, wheel: number): void
declare function gea_embedded_ble_mouse_click(button: number): void
