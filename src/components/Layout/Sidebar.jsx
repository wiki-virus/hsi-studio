import useAppStore from '../../stores/useAppStore'

const COLORMAPS = [
  'grayscale', 'viridis', 'plasma', 'inferno', 'magma',
  'jet', 'hot', 'cool', 'spring', 'bone',
]

const RGB_PRESETS = {
  'True Color':    { r: 29, g: 19, b: 9 },
  'False Color':   { r: 50, g: 29, b: 19 },
  'NDVI':          { r: 80, g: 50, b: 30 },
  'Custom':        null,
}

export default function Sidebar({ onBatchExportRois }) {
  const metadata = useAppStore(s => s.metadata)
  const currentBand = useAppStore(s => s.currentBand)
  const setCurrentBand = useAppStore(s => s.setCurrentBand)
  const viewMode = useAppStore(s => s.viewMode)
  const rgbBands = useAppStore(s => s.rgbBands)
  const setRGBBands = useAppStore(s => s.setRGBBands)
  const colormap = useAppStore(s => s.colormap)
  const setColormap = useAppStore(s => s.setColormap)
  const autoStretch = useAppStore(s => s.autoStretch)
  const setAutoStretch = useAppStore(s => s.setAutoStretch)
  const contrast = useAppStore(s => s.contrast)
  const setContrast = useAppStore(s => s.setContrast)
  const annotationMode = useAppStore(s => s.annotationMode)
  const brushSize = useAppStore(s => s.brushSize)
  const setBrushSize = useAppStore(s => s.setBrushSize)
  
  const wandTolerance = useAppStore(s => s.wandTolerance)
  const setWandTolerance = useAppStore(s => s.setWandTolerance)

  const classes = useAppStore(s => s.classes)
  const activeClassId = useAppStore(s => s.activeClassId)
  const setActiveClassId = useAppStore(s => s.setActiveClassId)
  const addClass = useAppStore(s => s.addClass)
  const updateClass = useAppStore(s => s.updateClass)
  const removeClass = useAppStore(s => s.removeClass)

  const maskOpacity = useAppStore(s => s.maskOpacity)
  const setMaskOpacity = useAppStore(s => s.setMaskOpacity)
  const showMaskOverlay = useAppStore(s => s.showMaskOverlay)
  const setShowMaskOverlay = useAppStore(s => s.setShowMaskOverlay)

  const rois = useAppStore(s => s.rois)
  const removeRoi = useAppStore(s => s.removeRoi)

  const totalBands = metadata?.bands ?? 0
  const wavelengths = metadata?.wavelengths ?? null

  const currentWavelength = wavelengths && wavelengths[currentBand] != null
    ? wavelengths[currentBand].toFixed(1)
    : null

  const handleBandChange = (e) => {
    const band = parseInt(e.target.value, 10)
    const delta = band - currentBand
    setCurrentBand(band)

    if (viewMode === 'rgb') {
      const clamp = (v) => Math.max(0, Math.min(totalBands - 1, v + delta))
      setRGBBands({
        r: clamp(rgbBands.r),
        g: clamp(rgbBands.g),
        b: clamp(rgbBands.b)
      })
    }
  }

  const handleRGBChannel = (channel, value) => {
    const band = parseInt(value, 10)
    const updated = { ...rgbBands, [channel]: band }
    setRGBBands(updated)
  }

  const handlePreset = (e) => {
    const preset = RGB_PRESETS[e.target.value]
    if (preset) {
      // Clamp to actual band count
      const clamp = (v) => Math.min(v, totalBands - 1)
      setRGBBands({ r: clamp(preset.r), g: clamp(preset.g), b: clamp(preset.b) })
    }
  }

  const handleGammaChange = (e) => {
    setContrast({ ...contrast, gamma: parseFloat(e.target.value) })
  }

  return (
    <div className="sidebar">
      {/* ─── Band Controls ─── */}
      <div className="sidebar-section">
        <div className="sidebar-section-title">Band Controls</div>

        <div className="control-row">
          <span className="control-label">Band</span>
          <span className="control-value">
            {currentBand}{currentWavelength ? ` — ${currentWavelength} nm` : ''}
          </span>
        </div>

        <input
          type="range"
          min={0}
          max={Math.max(totalBands - 1, 0)}
          value={currentBand}
          onChange={handleBandChange}
        />

        <div className="control-row" style={{ marginTop: 'var(--space-xs)' }}>
          <span className="control-label" style={{ fontSize: 'var(--font-xs)', color: 'var(--text-tertiary)' }}>
            0
          </span>
          <span className="control-label" style={{ fontSize: 'var(--font-xs)', color: 'var(--text-tertiary)' }}>
            {Math.max(totalBands - 1, 0)}
          </span>
        </div>
      </div>

      {/* ─── RGB Composer (only in RGB mode) ─── */}
      {viewMode === 'rgb' && (
        <div className="sidebar-section">
          <div className="sidebar-section-title">RGB Composer</div>

          <div className="control-row">
            <span className="control-label">Preset</span>
            <select onChange={handlePreset} defaultValue="Custom">
              {Object.keys(RGB_PRESETS).map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          {['r', 'g', 'b'].map(ch => {
            const label = ch === 'r' ? 'Red' : ch === 'g' ? 'Green' : 'Blue'
            return (
              <div key={ch} className="control-row">
                <span className="control-label">{label}</span>
                <input
                  type="number"
                  min={0}
                  max={Math.max(totalBands - 1, 0)}
                  value={rgbBands[ch]}
                  onChange={(e) => handleRGBChannel(ch, e.target.value)}
                  style={{
                    width: '60px',
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    border: 'var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-xs) var(--space-sm)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--font-sm)',
                  }}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* ─── Display ─── */}
      <div className="sidebar-section">
        <div className="sidebar-section-title">Display</div>

        <div className="control-row">
          <span className="control-label">Colormap</span>
          <select value={colormap} onChange={(e) => setColormap(e.target.value)}>
            {COLORMAPS.map(cm => (
              <option key={cm} value={cm}>{cm}</option>
            ))}
          </select>
        </div>

        <div className="control-row">
          <span className="control-label">Auto Stretch</span>
          <label className="toggle">
            <input
              type="checkbox"
              checked={autoStretch}
              onChange={(e) => setAutoStretch(e.target.checked)}
            />
            <div className="toggle-track" />
            <div className="toggle-thumb" />
          </label>
        </div>

        <div className="control-row">
          <span className="control-label">Gamma</span>
          <span className="control-value">{contrast.gamma.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0.1}
          max={3.0}
          step={0.05}
          value={contrast.gamma}
          onChange={handleGammaChange}
        />
      </div>

      {/* ─── Annotation (only when not in view mode) ─── */}
      {annotationMode !== 'view' && (
        <div className="sidebar-section">
          <div className="sidebar-section-title">Annotation</div>

          {['brush', 'eraser'].includes(annotationMode) && (
            <>
              <div className="control-row">
                <span className="control-label">Brush Size</span>
                <span className="control-value">{brushSize}px</span>
              </div>
              <input
                type="range"
                min={1}
                max={100}
                value={brushSize}
                onChange={(e) => setBrushSize(parseInt(e.target.value, 10))}
              />
            </>
          )}

          {annotationMode === 'wand' && (
            <>
              <div className="control-row" style={{ marginTop: 'var(--space-sm)' }}>
                <span className="control-label">Wand Tolerance</span>
                <span className="control-value">{wandTolerance.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.01}
                max={1.0}
                step={0.01}
                value={wandTolerance}
                onChange={(e) => setWandTolerance(parseFloat(e.target.value))}
              />
            </>
          )}
          
          <div className="sidebar-section-title" style={{ marginTop: 'var(--space-md)', fontSize: 'var(--font-xs)', color: 'var(--text-tertiary)' }}>Classes</div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', marginTop: 'var(--space-xs)' }}>
            {classes.map(cls => (
              <div 
                key={cls.id} 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 'var(--space-xs)',
                  padding: 'var(--space-xs)',
                  background: activeClassId === cls.id ? 'var(--bg-active)' : 'var(--bg-tertiary)',
                  border: activeClassId === cls.id ? 'var(--border-accent)' : 'var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer'
                }}
                onClick={() => setActiveClassId(cls.id)}
              >
                <input
                  type="color"
                  value={cls.color}
                  onChange={(e) => updateClass(cls.id, { color: e.target.value })}
                  onClick={(e) => { e.stopPropagation(); setActiveClassId(cls.id); }}
                  style={{
                    width: '24px',
                    height: '24px',
                    padding: 0,
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                />
                <input 
                  type="text" 
                  value={cls.name}
                  onChange={(e) => updateClass(cls.id, { name: e.target.value })}
                  onFocus={() => setActiveClassId(cls.id)}
                  onClick={(e) => { e.stopPropagation(); setActiveClassId(cls.id); }}
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-primary)',
                    fontSize: 'var(--font-sm)',
                    outline: 'none'
                  }}
                />
                {classes.length > 1 && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); removeClass(cls.id) }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      padding: '2px 6px',
                      fontSize: 'var(--font-xs)'
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            
            <button
              onClick={() => {
                const newId = Math.max(...classes.map(c => c.id), 0) + 1
                addClass({ id: newId, name: `Class ${newId}`, color: '#ffffff' })
                setActiveClassId(newId)
              }}
              style={{
                marginTop: 'var(--space-xs)',
                padding: 'var(--space-sm)',
                background: 'var(--bg-tertiary)',
                border: 'var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 'var(--font-sm)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center'
              }}
            >
              + Add Class
            </button>
          </div>
        </div>
      )}

      {/* ─── Mask Options (always visible) ─── */}
      <div className="sidebar-section">
        <div className="sidebar-section-title">Mask Overlay</div>

        <div className="control-row" style={{ marginTop: 'var(--space-sm)' }}>
          <span className="control-label">Mask Opacity</span>
          <span className="control-value">{(maskOpacity * 100).toFixed(0)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={maskOpacity}
          onChange={(e) => setMaskOpacity(parseFloat(e.target.value))}
        />

        <div className="control-row" style={{ marginTop: 'var(--space-sm)' }}>
          <span className="control-label">Show Mask</span>
          <label className="toggle">
            <input
              type="checkbox"
              checked={showMaskOverlay}
              onChange={(e) => setShowMaskOverlay(e.target.checked)}
            />
            <div className="toggle-track" />
            <div className="toggle-thumb" />
          </label>
        </div>
      </div>

      {/* ─── Regions of Interest (ROIs) ─── */}
      <div className="sidebar-section">
        <div className="sidebar-section-title">Regions of Interest (ROIs)</div>
        {rois.length === 0 ? (
          <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text-tertiary)', fontStyle: 'italic', padding: 'var(--space-xs) 0' }}>
            No ROIs drawn. Use the ROI tool to select patches.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
            {rois.map(roi => (
              <div key={roi.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-tertiary)', padding: 'var(--space-xs) var(--space-sm)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ fontSize: 'var(--font-sm)', fontFamily: 'var(--font-mono)' }}>{roi.name}</span>
                <div style={{ display: 'flex', gap: 'var(--space-xs)', alignItems: 'center' }}>
                  <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginRight: '4px' }}>{roi.w}x{roi.h}</span>
                  <button onClick={() => removeRoi(roi.id)} style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', padding: '2px' }} title="Delete">✕</button>
                </div>
              </div>
            ))}
            <button 
              className="btn btn-primary" 
              style={{ marginTop: 'var(--space-sm)', width: '100%', fontSize: 'var(--font-sm)', padding: 'var(--space-xs)' }}
              onClick={() => onBatchExportRois && onBatchExportRois(rois)}
            >
              Batch Export ROIs (.zip)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
