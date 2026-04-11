export function Card() {
  return (
    <div
      style={{
        width: 320,
        backgroundColor: '#1F2937',
        borderRadius: 16,
        borderWidth: 2,
        borderColor: '#374151',
        padding: '20px',
        gap: 12
      }}
    >
      <span style={{ fontSize: 18, color: '#F9FAFB' }}>Pixel-faithful browser preview</span>
      <span style={{ fontSize: 14, color: '#9CA3AF' }}>
        Shared C layout and raster output in the browser.
      </span>
    </div>
  )
}
