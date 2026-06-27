import useAppStore from '../../stores/useAppStore'
import { undoMask, redoMask } from '../../stores/useAppStore'
import {
  Layers, Palette, MousePointer2, Crop, Paintbrush,
  Eraser, Hexagon, Lasso, Save, RotateCcw, LineChart, Upload, Wand2, Undo2, Redo2
} from 'lucide-react'
import FeedbackWidget from '../Feedback/FeedbackWidget'

export default function Toolbar({ onSave, onResetCrop, maskRef }) {
  const fileName = useAppStore(s => s.fileName)
  const metadata = useAppStore(s => s.metadata)
  const viewMode = useAppStore(s => s.viewMode)
  const setViewMode = useAppStore(s => s.setViewMode)
  const annotationMode = useAppStore(s => s.annotationMode)
  const setAnnotationMode = useAppStore(s => s.setAnnotationMode)
  const showSpectralPlot = useAppStore(s => s.showSpectralPlot)
  const toggleSpectralPlot = useAppStore(s => s.toggleSpectralPlot)
  const resetView = useAppStore(s => s.resetView)
  const closeFile = useAppStore(s => s.closeFile)
  const undoCount = useAppStore(s => s.undoCount)
  const redoCount = useAppStore(s => s.redoCount)

  const isCropped = metadata && metadata.originalSamples && 
    (metadata.samples < metadata.originalSamples || metadata.lines < metadata.originalLines)

  const handleOpenFile = () => {
    if (window.confirm("This will replace the current image. Are you sure you want to upload a new file? Any unsaved annotations will be lost.")) {
      closeFile()
    }
  }

  return (
    <div className="toolbar">
      {/* Logo */}
      <div className="toolbar-logo">
        <span>HSI Studio</span>
      </div>

      <div className="toolbar-divider" />

      {/* Open File / Filename */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
        <button
          className="toolbar-btn toolbar-btn-text"
          onClick={handleOpenFile}
          title="Upload New File"
          style={{ padding: '4px 8px' }}
        >
          <Upload size={16} /> Upload
        </button>
        <div className="toolbar-filename" title={fileName}>
          {fileName || 'Untitled'}
          {isCropped && <span style={{ marginLeft: 8, color: 'var(--accent-teal)', fontSize: '11px' }}>(Cropped)</span>}
        </div>
        {isCropped && (
          <button className="toolbar-btn toolbar-btn-text" onClick={onResetCrop} style={{ fontSize: '11px', padding: '2px 6px' }}>
            Reset Crop
          </button>
        )}
      </div>

      <div className="toolbar-divider" />

      {/* View Mode */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn toolbar-btn-text ${viewMode === 'single' ? 'active' : ''}`}
          onClick={() => setViewMode('single')}
        >
          <Layers size={16} /> Single Band
        </button>
        <button
          className={`toolbar-btn toolbar-btn-text ${viewMode === 'rgb' ? 'active' : ''}`}
          onClick={() => setViewMode('rgb')}
        >
          <Palette size={16} /> RGB Composite
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Basic Tools */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn toolbar-btn-text ${annotationMode === 'view' ? 'active' : ''}`}
          onClick={() => setAnnotationMode('view')}
          title="View / Pan"
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
        <button
          className={`toolbar-btn toolbar-btn-text ${annotationMode === 'roi' ? 'active' : ''}`}
          onClick={() => setAnnotationMode('roi')}
          title="Draw Region of Interest (ROI)"
        >
          🎯 ROI
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Draw Tools */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn toolbar-btn-text ${annotationMode === 'brush' ? 'active' : ''}`}
          onClick={() => setAnnotationMode('brush')}
          title="Draw (Brush Tool)"
        >
          <Paintbrush size={16} /> Draw
        </button>
        
        {['brush', 'eraser', 'polygon', 'lasso', 'wand'].includes(annotationMode) && (
          <>
            <button
              className={`toolbar-btn ${annotationMode === 'eraser' ? 'active' : ''}`}
              onClick={() => setAnnotationMode('eraser')}
              title="Eraser Tool"
            >
              <Eraser size={18} />
            </button>
            <button
              className={`toolbar-btn ${annotationMode === 'wand' ? 'active' : ''}`}
              onClick={() => setAnnotationMode('wand')}
              title="Magic Wand"
            >
              <Wand2 size={18} />
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
          </>
        )}
      </div>

      {/* Undo / Redo */}
      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          onClick={() => undoMask(maskRef)}
          disabled={undoCount === 0}
          title="Undo (Ctrl+Z)"
          style={{ opacity: undoCount === 0 ? 0.35 : 1 }}
        >
          <Undo2 size={18} />
        </button>
        <button
          className="toolbar-btn"
          onClick={() => redoMask(maskRef)}
          disabled={redoCount === 0}
          title="Redo (Ctrl+Y)"
          style={{ opacity: redoCount === 0 ? 0.35 : 1 }}
        >
          <Redo2 size={18} />
        </button>
      </div>
      <div className="toolbar-spacer" />

      {/* Right side controls */}
      <div className="toolbar-group">
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

        <div className="toolbar-divider" />

        <button
          className="toolbar-btn toolbar-btn-text"
          onClick={onSave}
          title="Save / Export (Ctrl+S)"
          style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none' }}
        >
          <Save size={16} /> Save
        </button>

        <div className="toolbar-divider" />

        <FeedbackWidget label="Feedback" />

        <div className="toolbar-divider" />

        <a
          href="https://github.com/wiki-virus/HSI-STUDIO"
          target="_blank"
          rel="noopener noreferrer"
          className="toolbar-btn"
          title="View Source on GitHub"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
            <path d="M9 18c-4.51 2-5-2-7-2" />
          </svg>
        </a>
      </div>
    </div>
  )
}
