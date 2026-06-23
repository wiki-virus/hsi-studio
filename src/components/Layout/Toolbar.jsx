import useAppStore from '../../stores/useAppStore'
import { 
  Layers, Palette, MousePointer2, Crop, Paintbrush, 
  Eraser, Hexagon, Lasso, Save, RotateCcw, LineChart 
} from 'lucide-react'

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
          <Layers size={16} /> Single Band
        </button>
        <button
          className={`toolbar-btn toolbar-btn-text ${viewMode === 'rgb' ? 'active' : ''}`}
          onClick={() => setViewMode('rgb')}
          title="RGB Composite View"
        >
          <Palette size={16} /> RGB Composite
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* View & Crop */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn toolbar-btn-text ${annotationMode === 'view' ? 'active' : ''}`}
          onClick={() => setAnnotationMode('view')}
          title="View Mode"
        >
          <MousePointer2 size={16} /> View
        </button>
        <button
          className={`toolbar-btn toolbar-btn-text ${annotationMode === 'rectangle' ? 'active' : ''}`}
          onClick={() => setAnnotationMode('rectangle')}
          title="Crop / Rectangle Select"
        >
          <Crop size={16} /> Crop
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Draw Tools */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn ${annotationMode === 'brush' ? 'active' : ''}`}
          onClick={() => setAnnotationMode('brush')}
          title="Brush Tool"
        >
          <Paintbrush size={18} />
        </button>
        <button
          className={`toolbar-btn ${annotationMode === 'eraser' ? 'active' : ''}`}
          onClick={() => setAnnotationMode('eraser')}
          title="Eraser Tool"
        >
          <Eraser size={18} />
        </button>
        <button
          className={`toolbar-btn ${annotationMode === 'polygon' ? 'active' : ''}`}
          onClick={() => setAnnotationMode('polygon')}
          title="Polygon Select"
        >
          <Hexagon size={18} />
        </button>
        <button
          className={`toolbar-btn ${annotationMode === 'lasso' ? 'active' : ''}`}
          onClick={() => setAnnotationMode('lasso')}
          title="Lasso Select"
        >
          <Lasso size={18} />
        </button>
      </div>

      {/* Spacer pushes remaining items to the right */}
      <div className="toolbar-spacer" />

      {/* Right side controls */}
      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          onClick={onSave}
          title="Save / Export (Ctrl+S)"
        >
          <Save size={18} />
        </button>

        <div className="toolbar-divider" />

        <button
          className="toolbar-btn"
          onClick={resetView}
          title="Reset View (zoom & pan)"
        >
          <RotateCcw size={18} />
        </button>

        <div className="toolbar-divider" />

        <button
          className={`toolbar-btn toolbar-btn-text ${showSpectralPlot ? 'active' : ''}`}
          onClick={toggleSpectralPlot}
          title="Toggle Spectral Plot Panel"
        >
          <LineChart size={16} /> Spectra
        </button>
      </div>
    </div>
  )
}
