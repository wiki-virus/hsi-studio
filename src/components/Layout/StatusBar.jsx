import useAppStore from '../../stores/useAppStore'

export default function StatusBar({ pixelValue }) {
  const metadata = useAppStore(s => s.metadata)
  const selectedPixel = useAppStore(s => s.selectedPixel)
  const currentBand = useAppStore(s => s.currentBand)
  const zoom = useAppStore(s => s.zoom)

  const totalBands = metadata?.bands ?? 0
  const samples = metadata?.samples ?? 0
  const lines = metadata?.lines ?? 0
  const wavelengths = metadata?.wavelengths ?? null

  const currentWavelength = wavelengths && wavelengths[currentBand] != null
    ? wavelengths[currentBand].toFixed(1)
    : null

  return (
    <div className="statusbar">
      {/* Pixel coordinates */}
      <div className="statusbar-item">
        <span className="label">Pixel:</span>
        <span className="value">
          {selectedPixel
            ? `x: ${selectedPixel.x}, y: ${selectedPixel.y}`
            : '—, —'
          }
        </span>
      </div>

      {/* Current band */}
      <div className="statusbar-item">
        <span className="label">Band:</span>
        <span className="value">
          {totalBands > 0 ? `${currentBand} / ${totalBands}` : '—'}
        </span>
      </div>

      {/* Wavelength */}
      <div className="statusbar-item">
        <span className="label">λ:</span>
        <span className="value">
          {currentWavelength ? `${currentWavelength} nm` : '—'}
        </span>
      </div>

      {/* Pixel value */}
      <div className="statusbar-item">
        <span className="label">Value:</span>
        <span className="value">
          {pixelValue != null ? pixelValue.toFixed(4) : '—'}
        </span>
      </div>

      {/* Spacer */}
      <div className="statusbar-spacer" />

      {/* Zoom level */}
      <div className="statusbar-item">
        <span className="label">Zoom:</span>
        <span className="value">{(zoom * 100).toFixed(0)}%</span>
      </div>

      {/* Image dimensions */}
      <div className="statusbar-item">
        <span className="label">Size:</span>
        <span className="value">
          {samples > 0 ? `${samples} × ${lines} × ${totalBands}` : '—'}
        </span>
      </div>
    </div>
  )
}
