export default function TuskLogo({ size = 'md' }) {
  const widths = { sm: 70, md: 100, lg: 150, xl: 220 }
  const w = widths[size] ?? 100

  return (
    <div style={{ mixBlendMode: 'screen', width: w, flexShrink: 0 }}>
      <img
        src="/tusk-logo.png"
        alt="Tusk Management Group"
        width={w}
        style={{ display: 'block', width: '100%', height: 'auto' }}
        draggable={false}
      />
    </div>
  )
}
