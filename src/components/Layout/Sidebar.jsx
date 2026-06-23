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

export default function Sidebar({ onRequestBand, onRequestRGB }) {
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
  const brushHardness = useAppStore(s => s.brushHardness)
  const setBrushHardness = useAppStore(s => s.setBrushHardness)
  const brushOpacity = useAppStore(s => s.brushOpacity)
  const setBrushOpacity = useAppStore(s => s.setBrushOpacity)
  const maskColor = useAppStore(s => s.maskColor)
  const setMaskColor = useAppStore(s => s.setMaskColor)
  const maskOpacity = useAppStore(s => s.maskOpacity)
  const setMaskOpacity = useAppStore(s => s.setMaskOpacity)
  const showMaskOverlay = useAppStore(s => s.showMaskOverlay)
  const setShowMaskOverlay = useAppStore(s => s.setShowMaskOverlay)

  const totalBands = metadata?.bands ?? 0
  const wavelengths = metadata?.wavelengths ?? null

  const currentWavelength = wavelengths && wavelengths[currentBand] != null
    ? wavelengths[currentBand].toFixed(1)
    : null

  const handleBandChange = (e) => {
    const band = parseInt(e.target.value, 10)
    setCurrentBand(band)
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

          <div className="control-row" style={{ marginTop: 'var(--space-sm)' }}>
            <span className="control-label">Gradient Brush</span>
            <label className="toggle">
              <input
                type="checkbox"
                checked={brushHardness < 100}
                onChange={(e) => setBrushHardness(e.target.checked ? 0 : 100)}
              />
              <div className="toggle-track" />
              <div className="toggle-thumb" />
            </label>
          </div>

          <div className="control-row" style={{ marginTop: 'var(--space-sm)' }}>
            <span className="control-label">Opacity</span>
            <span className="control-value">{(brushOpacity * 100).toFixed(0)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={brushOpacity}
            onChange={(e) => setBrushOpacity(parseFloat(e.target.value))}
          />

          <div className="control-row" style={{ marginTop: 'var(--space-sm)' }}>
            <span className="control-label">Mask Color</span>
            <input
              type="color"
              value={maskColor}
              onChange={(e) => setMaskColor(e.target.value)}
              style={{
                width: '28px',
                height: '28px',
                border: 'var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '0',
                cursor: 'pointer',
                background: 'transparent',
              }}
            />
          </div>

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
      )}
    </div>
  )
}
