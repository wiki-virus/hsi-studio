import useAppStore from '../../stores/useAppStore'

export default function Toolbar({ onSave }) {
  const fileName = useAppStore(s => s.fileName)
  const viewMode = useAppStore(s => s.viewMode)
  const setViewMode = useAppStore(s => s.setViewMode)
  const annotationMode = useAppStore(s => s.annotationMode)
  const setAnnotationMode = useAppStore(s => s.setAnnotationMode)
  const showSpectralPlot = useAppStore(s => s.showSpectralPlot)
  const toggleSpectralPlot = useAppStore(s => s.toggleSpectralPlot)
  const resetView = useAppStore(s => s.resetView)

  return (
    <div className="toolbar">
      {/* Logo */}
      <div className="toolbar-logo">
        <span>HSI Studio</span>
      </div>

      <div className="toolbar-divider" />

      {/* Filename */}
      <div className="toolbar-filename" title={fileName}>
        {fileName || 'Untitled'}
      </div>

      <div className="toolbar-divider" />

      {/* View Mode */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn toolbar-btn-text ${viewMode === 'single' ? 'active' : ''}`}
          onClick={() => setViewMode('single')}
          title="Single Band View"
        >
          🔲 Single Band
        </button>
        <button
          className={`toolbar-btn toolbar-btn-text ${viewMode === 'rgb' ? 'active' : ''}`}
          onClick={() => setViewMode('rgb')}
          title="RGB Composite View"
        >
          🎨 RGB Composite
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Annotation Mode */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn toolbar-btn-text ${annotationMode === 'view' ? 'active' : ''}`}
          onClick={() => setAnnotationMode('view')}
          title="View Mode"
        >
          👁 View
        </button>
        <button
          className={`toolbar-btn toolbar-btn-text ${annotationMode === 'brush' ? 'active' : ''}`}
          onClick={() => setAnnotationMode('brush')}
          title="Brush Tool"
        >
          🖌 Brush
        </button>
        <button
          className={`toolbar-btn toolbar-btn-text ${annotationMode === 'eraser' ? 'active' : ''}`}
          onClick={() => setAnnotationMode('eraser')}
          title="Eraser Tool"
        >
          ◻ Eraser
        </button>
        <button
          className={`toolbar-btn toolbar-btn-text ${annotationMode === 'rectangle' ? 'active' : ''}`}
          onClick={() => setAnnotationMode('rectangle')}
          title="Crop / Rectangle Select"
        >
          ✂ Crop
        </button>
      </div>

      {/* Spacer pushes remaining items to the right */}
      <div className="toolbar-spacer" />

      {/* Right side controls */}
      <div className="toolbar-group">
        <button
          className="toolbar-btn toolbar-btn-text"
          onClick={onSave}
          title="Save / Export (Ctrl+S)"
        >
          💾 Save
        </button>

        <div className="toolbar-divider" />

        <button
          className="toolbar-btn toolbar-btn-text"
          onClick={resetView}
          title="Reset View (zoom & pan)"
        >
          ⟲ Reset View
        </button>

        <div className="toolbar-divider" />

        <button
          className={`toolbar-btn toolbar-btn-text ${showSpectralPlot ? 'active' : ''}`}
          onClick={toggleSpectralPlot}
          title="Toggle Spectral Plot Panel"
        >
          📈 Spectra
        </button>
      </div>
    </div>
  )
}
