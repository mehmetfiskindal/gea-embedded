export function accelerometerMemberToC(prop: string): string | undefined {
  if (prop === 'x') return 'gea_embedded_imu_get_acceleration_x()'
  if (prop === 'y') return 'gea_embedded_imu_get_acceleration_y()'
  if (prop === 'z') return 'gea_embedded_imu_get_acceleration_z()'
  if (prop === 'tiltX') return 'gea_embedded_imu_get_tilt_x()'
  if (prop === 'tiltY') return 'gea_embedded_imu_get_tilt_y()'
  if (prop === 'mouseButtons') return 'gea_embedded_imu_get_mouse_buttons()'
  if (prop === 'activated') return '1'
  if (prop === 'hasReading') return '1'
  if (prop === 'timestamp') return '0'
  return undefined
}

export function accelerometerCallToC(method: string, args: string[] = []): string | undefined {
  if (method === 'start') return 'gea_embedded_imu_init()'
  if (method === 'stop') return 'gea_embedded_imu_close()'
  if (method === 'calibrate') return 'gea_embedded_imu_calibrate_bias()'
  if (method === 'startMouse') return 'gea_embedded_imu_start_mouse()'
  if (method === 'stopMouse') return 'gea_embedded_imu_stop_mouse()'
  if (method === 'setMouseButtons') return `gea_embedded_imu_set_mouse_buttons(${args[0] ?? '0'})`
  if (method === 'getMouseButtons') return 'gea_embedded_imu_get_mouse_buttons()'
  return undefined
}
