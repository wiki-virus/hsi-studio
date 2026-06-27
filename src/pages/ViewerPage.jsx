import { useState, useEffect, useCallback, useRef } from 'react'
import useAppStore from '../stores/useAppStore'
import Toolbar from '../components/Layout/Toolbar'
import Sidebar from '../components/Layout/Sidebar'
import StatusBar from '../components/Layout/StatusBar'
import DatacubeViewer from '../components/Viewer/DatacubeViewer'
import SpectralPlot from '../components/Spectral/SpectralPlot'
import ExportPane from '../components/Export/ExportPane'
import Timeline from '../components/Layout/Timeline'

/**
 * ViewerPage — main page shown after a file is loaded.
 *
 * Assembles the full layout and manages:
 *  - Worker communication (request bands, spectra, RGB composites)
 *  - Band image data in a ref (too large for React state / Zustand)
 *  - Spectrum data in local state (small, ~204 floats)
 *  - Spectral panel resize via drag handle
 */
export default function ViewerPage({ workerRef }) {
  // ─── Store selectors ───
  const currentBand = useAppStore(s => s.currentBand)
  const viewMode = useAppStore(s => s.viewMode)
  const rgbBands = useAppStore(s => s.rgbBands)
  const metadata = useAppStore(s => s.metadata)
  const currentFrame = useAppStore(s => s.currentFrame)
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
  const [showExportPane, setShowExportPane] = useState(false)

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
          const { spectrum, wavelengths, x, y, isPin } = e.data
          if (isPin) {
            const pinnedSpectra = useAppStore.getState().pinnedSpectra
            const addPinnedSpectrum = useAppStore.getState().addPinnedSpectrum
            const COLORS = ['#ff4757', '#ffa502', '#2ed573', '#1e90ff', '#3742fa', '#ff5285', '#be2edd']
            const color = COLORS[pinnedSpectra.length % COLORS.length]
            addPinnedSpectrum({
              x, y,
              spectrum,
              wavelengths,
              color: color,
              label: `Pixel ${pinnedSpectra.length + 1}`
            })
          } else {
            setSpectrumData({ spectrum, wavelengths, x, y })
          }
          break
        }

        case 'rgbComposited': {
          const { rgbData, width, height } = e.data
          rgbImageRef.current = { data: rgbData, width, height }
          setRenderTick(t => t + 1)
          break
        }

        case 'error': {
          console.error('Worker error:', e.data.message)
          alert('Worker error: ' + e.data.message)
          break
        }

        case 'datacubeCropped': {
          const { samples, lines, bands, cropX, cropY, isReset } = e.data
          
          if (isReset) {
            // Reset the mask when uncropping
            viewerMaskRef.current = new Uint8Array(samples * lines)
          } else if (viewerMaskRef.current && metadata) {
             // Crop the annotation mask to match the new image dimensions
             const oldMask = viewerMaskRef.current
             const newMask = new Uint8Array(samples * lines)
             const oldWidth = metadata.samples
             for (let y = 0; y < lines; y++) {
               for (let x = 0; x < samples; x++) {
                  newMask[y * samples + x] = oldMask[(cropY + y) * oldWidth + (cropX + x)]
               }
             }
             viewerMaskRef.current = newMask
          }

          // Update the store metadata with new dimensions
          const newMeta = {
            ...metadata,
            samples,
            lines,
            bands,
            interleave: 'bip',
          }
          
          const newName = isReset ? fileName.replace(' (cropped)', '') : fileName + ' (cropped)'
          setFileLoaded(newName, newMeta)
          setCropRegion(null)
          
          // Reset view state that might be invalid
          setSpectrumData(null)
          useAppStore.getState().clearPinnedSpectra()
          useAppStore.getState().setSelectedPixel(null)

          // Request the new band 0
          worker.postMessage({ type: 'extractBand', bandIndex: 0, frameIndex: currentFrame })
          break
        }

        case 'wandCompleted': {
          const { mask } = e.data
          if (viewerMaskRef.current && mask) {
            const activeClassId = useAppStore.getState().activeClassId
            for (let i = 0; i < mask.length; i++) {
              if (mask[i] === 1) {
                viewerMaskRef.current[i] = activeClassId
              }
            }
            setRenderTick(t => t + 1)
          }
          break
        }

        case 'roisExported': {
          const { rois } = e.data
          import('jszip').then(async ({ default: JSZip }) => {
            const zip = new JSZip()
            const { createNpyBuffer } = await import('../lib/npzParser')
            
            for (const roi of rois) {
               const arr = new Float32Array(roi.buffer)
               // The worker wrote it as BIP: [lines, samples, bands]
               const npyBuf = createNpyBuffer(arr, [roi.meta.lines, roi.meta.samples, roi.meta.bands], '<f4', false)
               
               const innerZip = new JSZip()
               innerZip.file('datacube.npy', npyBuf)
               
               // Check if there is an annotation mask, crop it to the ROI
               if (viewerMaskRef.current && metadata) {
                 const fullMask = viewerMaskRef.current
                 // roi.w and roi.h came from the worker calculation
                 const patchMask = new Uint8Array(roi.w * roi.h)
                 for (let y = 0; y < roi.h; y++) {
                   for (let x = 0; x < roi.w; x++) {
                     patchMask[y * roi.w + x] = fullMask[(roi.y + y) * metadata.samples + (roi.x + x)] || 0
                   }
                 }
                 const maskNpy = createNpyBuffer(patchMask, [roi.h, roi.w], '|u1', false)
                 innerZip.file('mask.npy', maskNpy)
               }
               
               const npzBlob = await innerZip.generateAsync({ type: 'blob', compression: 'STORE' })
               zip.file(`${roi.name.replace(/[^a-z0-9]/gi, '_')}.npz`, npzBlob)
            }
            const content = await zip.generateAsync({ type: 'blob' })
            const url = URL.createObjectURL(content)
            const a = document.createElement('a')
            a.href = url
            a.download = `${fileName}_ROIs.zip`
            a.click()
            URL.revokeObjectURL(url)
          }).catch(err => {
            alert('Failed to export ROIs: ' + err.message)
            console.error(err)
          })
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
      worker.postMessage({ type: 'extractBand', bandIndex: 0, frameIndex: currentFrame })
    }
  }, [workerRef, currentFrame])

  // ─────────────────────────────────────────────────────────────
  // Request new band when currentBand changes
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const worker = workerRef.current
    if (!worker || viewMode !== 'single') return

    worker.postMessage({ type: 'extractBand', bandIndex: currentBand, frameIndex: currentFrame })
  }, [currentBand, viewMode, workerRef, currentFrame])

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
      frameIndex: currentFrame
    })
  }, [rgbBands, viewMode, workerRef, currentFrame])

  // ─────────────────────────────────────────────────────────────
  // Handle pixel click → request spectrum from worker or wand
  // ─────────────────────────────────────────────────────────────
  const handlePixelClick = useCallback((x, y, isPin = false) => {
    const worker = workerRef.current
    if (!worker) return

    if (annotationMode === 'wand') {
      const state = useAppStore.getState()
      worker.postMessage({
        type: 'magicWand',
        x, y,
        tolerance: state.wandTolerance,
        frameIndex: currentFrame
      })
      return
    }

    setSelectedPixel({ x, y })

    // Look up pixel value from the current band image
    if (bandImageRef.current && metadata) {
      const idx = y * metadata.samples + x
      setPixelValue(bandImageRef.current[idx] ?? null)
    }

    // Request full spectrum at this pixel
    worker.postMessage({ type: 'extractSpectrum', x, y, isPin, frameIndex: currentFrame })
  }, [workerRef, metadata, currentFrame, annotationMode, setSelectedPixel, setPixelValue])

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
      window.dispatchEvent(new Event('resize'))
    }

    const handleResizeEnd = () => {
      isResizingRef.current = false
      document.removeEventListener('mousemove', handleResizeMove)
      document.removeEventListener('mouseup', handleResizeEnd)
      window.dispatchEvent(new Event('resize'))
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
        setShowExportPane(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────
  // Global Keyboard Shortcuts
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // Don't trigger if user is typing in an input
      if (e.target.tagName.toLowerCase() === 'input' || e.target.tagName.toLowerCase() === 'textarea') {
        return
      }
      
      const key = e.key.toLowerCase()
      switch (key) {
        case 'v': setAnnotationMode('view'); break;
        case 'c': setAnnotationMode('rectangle'); break;
        case 'b': setAnnotationMode('brush'); break;
        case 'e': setAnnotationMode('eraser'); break;
        case 'p': setAnnotationMode('polygon'); break;
        case 'l': setAnnotationMode('lasso'); break;
        case 's': useAppStore.getState().setViewMode('single'); break;
        case 'r': useAppStore.getState().setViewMode('rgb'); break;
        default: break;
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [setAnnotationMode])

  // Large image buffers live in refs (not state) to avoid copying; renderTick
  // drives re-renders when they change, so reading .current here is intentional.
  // eslint-disable-next-line react-hooks/refs
  const bandImage = bandImageRef.current
  // eslint-disable-next-line react-hooks/refs
  const rgbImage = rgbImageRef.current

  return (
    <div className="app-layout">
      <Toolbar
        onSave={() => setShowExportPane(true)} 
        onResetCrop={() => {
          if (workerRef.current) {
            workerRef.current.postMessage({ type: 'resetCrop' })
          }
        }}
      />

      <div className="app-main">
        <Sidebar 
          onBatchExportRois={(rois) => {
            if (workerRef.current) {
              workerRef.current.postMessage({ type: 'batchExportRois', rois })
            }
          }}
        />

        <div className="viewer-area">
          <Timeline />
          <DatacubeViewer
            bandImage={bandImage}
            rgbImage={rgbImage}
            bandStats={bandStats}
            onPixelClick={handlePixelClick}
            onCropSelect={(rect) => setCropRegion(rect)}
            onRoiSelect={(rect) => {
              const state = useAppStore.getState()
              state.addRoi({
                id: Math.random().toString(36).substring(2, 9),
                name: `Crop ${state.rois.length + 1}`,
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                w: Math.round(rect.w),
                h: Math.round(rect.h)
              })
            }}
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

        {/* Export Pane (Right Sidebar) */}
        {showExportPane && (
          <ExportPane
            onClose={() => setShowExportPane(false)}
            workerRef={workerRef}
            canvasRef={viewerCanvasRef}
            maskRef={viewerMaskRef}
          />
        )}
      </div>

      <StatusBar pixelValue={pixelValue} />
    </div>
  )
}
