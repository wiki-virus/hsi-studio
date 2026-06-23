import { useState, useEffect, useCallback, useRef } from 'react'
import useAppStore from '../stores/useAppStore'
import Toolbar from '../components/Layout/Toolbar'
import Sidebar from '../components/Layout/Sidebar'
import StatusBar from '../components/Layout/StatusBar'
import DatacubeViewer from '../components/Viewer/DatacubeViewer'
import SpectralPlot from '../components/Spectral/SpectralPlot'
import SaveDialog from '../components/Export/SaveDialog'

/**
 * ViewerPage — main page shown after a file is loaded.
 *
 * Assembles the full layout and manages:
 *  - Worker communication (request bands, spectra, RGB composites)
 *  - Band image data in a ref (too large for React state / Zustand)
 *  - Spectrum data in local state (small, ~204 floats)
 *  - Spectral panel resize via drag handle
 */
export default function ViewerPage({ datacubeRef, workerRef, inputFormat }) {
  // ─── Store selectors ───
  const currentBand = useAppStore(s => s.currentBand)
  const viewMode = useAppStore(s => s.viewMode)
  const rgbBands = useAppStore(s => s.rgbBands)
  const metadata = useAppStore(s => s.metadata)
  const showSpectralPlot = useAppStore(s => s.showSpectralPlot)
  const setSelectedPixel = useAppStore(s => s.setSelectedPixel)
  const setFileLoaded = useAppStore(s => s.setFileLoaded)
  const fileName = useAppStore(s => s.fileName)
  const annotationMode = useAppStore(s => s.annotationMode)
  const setAnnotationMode = useAppStore(s => s.setAnnotationMode)

  // ─── Local state ───
  const [spectrumData, setSpectrumData] = useState(null) // { spectrum, wavelengths, x, y }
  const [pixelValue, setPixelValue] = useState(null)     // float: value at selected pixel
  const [bandStats, setBandStats] = useState(null)       // { min, max, percentile1, percentile99 }

  // ─── Refs for large data (never triggers re-render) ───
  const bandImageRef = useRef(null)   // Float32Array: current band image
  const rgbImageRef = useRef(null)    // { data: Uint8ClampedArray, width, height }

  // ─── Refs exposed from DatacubeViewer for saving ───
  const viewerCanvasRef = useRef(null)
  const viewerMaskRef = useRef(null)

  // ─── Save dialog state ───
  const [showSaveDialog, setShowSaveDialog] = useState(false)

  // ─── Crop state ───
  const [cropRegion, setCropRegion] = useState(null) // { x, y, w, h } or null

  // ─── Spectral panel resize state ───
  const [spectralHeight, setSpectralHeight] = useState(240)
  const isResizingRef = useRef(false)
  const resizeStartYRef = useRef(0)
  const resizeStartHeightRef = useRef(0)

  // ─── Force re-render trigger for when refs change ───
  const [renderTick, setRenderTick] = useState(0)

  // ─────────────────────────────────────────────────────────────
  // Worker message handler
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const worker = workerRef.current
    if (!worker) return

    const handleMessage = (e) => {
      const { type } = e.data

      switch (type) {
        case 'bandExtracted': {
          const { bandData, min, max, percentile1, percentile99 } = e.data
          bandImageRef.current = bandData
          setBandStats({ min, max, percentile1, percentile99 })
          setRenderTick(t => t + 1) // trigger re-render so viewer sees new data
          break
        }

        case 'spectrumExtracted': {
          const { spectrum, wavelengths, x, y } = e.data
          setSpectrumData({ spectrum, wavelengths, x, y })
          break
        }

        case 'rgbComposited': {
          const { rgbData, width, height } = e.data
          rgbImageRef.current = { data: rgbData, width, height }
          setRenderTick(t => t + 1)
          break
        }

        case 'error': {
          console.error('[Worker Error]', e.data.message)
          break
        }

        case 'datacubeCropped': {
          const { samples, lines, bands } = e.data
          // Update the store metadata with new dimensions
          const newMeta = {
            ...metadata,
            samples,
            lines,
            bands,
            interleave: 'bip',
          }
          setFileLoaded(fileName + ' (cropped)', newMeta)
          setCropRegion(null)
          // Request fresh band
          worker.postMessage({ type: 'extractBand', bandIndex: 0 })
          break
        }

        default:
          break
      }
    }

    worker.addEventListener('message', handleMessage)
    return () => worker.removeEventListener('message', handleMessage)
  }, [workerRef, metadata, fileName, setFileLoaded])

  // ─────────────────────────────────────────────────────────────
  // Request initial band on mount
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const worker = workerRef.current
    if (worker) {
      worker.postMessage({ type: 'extractBand', bandIndex: 0 })
    }
  }, [workerRef])

  // ─────────────────────────────────────────────────────────────
  // Request new band when currentBand changes
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const worker = workerRef.current
    if (!worker || viewMode !== 'single') return

    worker.postMessage({ type: 'extractBand', bandIndex: currentBand })
  }, [currentBand, viewMode, workerRef])

  // ─────────────────────────────────────────────────────────────
  // Request RGB composite when rgbBands or viewMode changes
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const worker = workerRef.current
    if (!worker || viewMode !== 'rgb') return

    worker.postMessage({
      type: 'compositeRGB',
      rBand: rgbBands.r,
      gBand: rgbBands.g,
      bBand: rgbBands.b,
    })
  }, [rgbBands, viewMode, workerRef])

  // ─────────────────────────────────────────────────────────────
  // Handle pixel click → request spectrum from worker
  // ─────────────────────────────────────────────────────────────
  const handlePixelClick = useCallback((x, y) => {
    setSelectedPixel({ x, y })

    // Look up pixel value from the current band image
    if (bandImageRef.current && metadata) {
      const idx = y * metadata.samples + x
      setPixelValue(bandImageRef.current[idx] ?? null)
    }

    // Request full spectrum at this pixel
    const worker = workerRef.current
    if (worker) {
      worker.postMessage({ type: 'extractSpectrum', x, y })
    }
  }, [metadata, setSelectedPixel, workerRef])

  // ─────────────────────────────────────────────────────────────
  // Spectral panel drag-resize
  // ─────────────────────────────────────────────────────────────
  const handleResizeStart = useCallback((e) => {
    e.preventDefault()
    isResizingRef.current = true
    resizeStartYRef.current = e.clientY
    resizeStartHeightRef.current = spectralHeight

    const handleResizeMove = (moveEvent) => {
      if (!isResizingRef.current) return
      const delta = resizeStartYRef.current - moveEvent.clientY
      const newHeight = Math.max(120, Math.min(600, resizeStartHeightRef.current + delta))
      setSpectralHeight(newHeight)
    }

    const handleResizeEnd = () => {
      isResizingRef.current = false
      document.removeEventListener('mousemove', handleResizeMove)
      document.removeEventListener('mouseup', handleResizeEnd)
    }

    document.addEventListener('mousemove', handleResizeMove)
    document.addEventListener('mouseup', handleResizeEnd)
  }, [spectralHeight])

  // ─────────────────────────────────────────────────────────────
  // Ctrl+S keyboard shortcut
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        setShowSaveDialog(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="app-layout">
      <Toolbar onSave={() => setShowSaveDialog(true)} />

      <div className="app-main">
        <Sidebar />

        <div className="viewer-area">
          <DatacubeViewer
            bandImage={bandImageRef.current}
            rgbImage={rgbImageRef.current}
            bandStats={bandStats}
            onPixelClick={handlePixelClick}
            onCropSelect={(rect) => setCropRegion(rect)}
            renderTick={renderTick}
            canvasRef={viewerCanvasRef}
            maskRef={viewerMaskRef}
          />

          {/* Crop confirmation bar */}
          {cropRegion && (
            <div style={{
              position: 'absolute',
              top: 'var(--space-lg)',
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
              zIndex: 100,
              animation: 'slideUp 0.2s ease-out',
            }}>
              <span style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                Crop: {cropRegion.w} × {cropRegion.h} px
              </span>
              <button
                className="toolbar-btn toolbar-btn-text active"
                onClick={() => {
                  const worker = workerRef.current
                  if (worker && cropRegion) {
                    worker.postMessage({
                      type: 'cropDatacube',
                      x: cropRegion.x,
                      y: cropRegion.y,
                      width: cropRegion.w,
                      height: cropRegion.h,
                    })
                    setAnnotationMode('view')
                  }
                }}
                style={{ padding: 'var(--space-xs) var(--space-md)' }}
              >
                ✓ Apply Crop
              </button>
              <button
                className="toolbar-btn toolbar-btn-text"
                onClick={() => setCropRegion(null)}
                style={{ padding: 'var(--space-xs) var(--space-md)' }}
              >
                ✕ Cancel
              </button>
            </div>
          )}

          {/* Spectral Panel (collapsible) */}
          {showSpectralPlot && (
            <>
              <div
                className="resize-handle"
                onMouseDown={handleResizeStart}
              />
              <div
                className="spectral-panel"
                style={{ height: `${spectralHeight}px` }}
              >
                <div className="spectral-panel-header">
                  <div className="spectral-panel-title">Spectral Profile</div>
                  {spectrumData && (
                    <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                      Pixel ({spectrumData.x}, {spectrumData.y}) — {spectrumData.spectrum?.length ?? 0} bands
                    </span>
                  )}
                </div>
                <div className="spectral-panel-content">
                  <SpectralPlot spectrumData={spectrumData} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <StatusBar pixelValue={pixelValue} />

      <SaveDialog
        isOpen={showSaveDialog}
        onClose={() => setShowSaveDialog(false)}
        workerRef={workerRef}
        canvasRef={viewerCanvasRef}
        maskRef={viewerMaskRef}
        inputFormat={inputFormat}
      />
    </div>
  )
}
