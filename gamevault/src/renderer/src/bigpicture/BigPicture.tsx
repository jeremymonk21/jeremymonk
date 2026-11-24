export default function BigPicture({ onExit }: { onExit: () => void }): JSX.Element {
  return (
    <div className="center-load" style={{ height: '100%' }}>
      <p>Big Picture mode is coming in a later step.</p>
      <button className="btn" onClick={onExit}>Back</button>
    </div>
  )
}
