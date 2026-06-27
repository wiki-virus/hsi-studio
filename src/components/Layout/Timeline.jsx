import useAppStore from '../../stores/useAppStore'

export default function Timeline() {
  const fileNames = useAppStore(s => s.fileNames)
  const currentFrame = useAppStore(s => s.currentFrame)
  const setCurrentFrame = useAppStore(s => s.setCurrentFrame)

  if (!fileNames || fileNames.length <= 1) return null

  return (
    <div
      className="timeline-container"
      style={{
        position: 'absolute',
        top: 'var(--space-md)',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-md)',
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(16px)',
        border: 'var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-sm) var(--space-lg)',
        zIndex: 50,
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
      }}
    >
      <span style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
        Frame {currentFrame + 1} / {fileNames.length}
      </span>
      
      <input
        type="range"
        min="0"
        max={fileNames.length - 1}
        value={currentFrame}
        onChange={(e) => setCurrentFrame(parseInt(e.target.value, 10))}
        style={{ width: '300px', cursor: 'pointer' }}
      />
      
      <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {fileNames[currentFrame]}
      </span>
    </div>
  )
}
