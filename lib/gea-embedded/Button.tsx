import { View, type Style } from 'gea-embedded'

export function Button({
  class: cls,
  style,
  pressId,
  pressValue,
  onPress,
  onClick,
  onTouchStart,
  onTouchEnd,
  onTouchMove,
  children
}: {
  class?: string
  style?: Style
  pressId?: number
  pressValue?: number
  onPress?: (pressId: number) => void
  onClick?: (pressId: number) => void
  onTouchStart?: (x: number, y: number) => void
  onTouchEnd?: (x: number, y: number) => void
  onTouchMove?: (x: number, y: number) => void
  children?: any
}) {
  return (
    <View
      class={cls}
      style={style}
      pressId={pressId}
      pressValue={pressValue}
      onPress={onPress}
      onClick={onClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchMove}
    >
      {children}
    </View>
  )
}
