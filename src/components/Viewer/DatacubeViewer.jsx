import { useEffect, useRef, useCallback, useState } from 'react'
import useAppStore from '../../stores/useAppStore'
import { WebGLBandRenderer } from './WebGLRenderer'

/**
 * DatacubeViewer — renders hyperspectral band images using WebGL2
 * with zoom/pan support and pixel click interaction.
 *
 * Props:
 *  - bandImage: Float32Array of current band pixel values
 *  - rgbImage: { data: Uint8ClampedArray, width, height } for RGB mode
 *  - bandStats: { min, max, percentile1, percentile99 }
 *  - onPixelClick: (x, y) => void
 *  - renderTick: number — changes when new data arrives (triggers re-render)
 */
export default function DatacubeViewer({ bandImage, rgbImage, bandStats, onPixelClick, onCropSelect, renderTick, canvasRef: externalCanvasRef, maskRef: externalMaskRef }) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const rendererRef = useRef(null)
  const annotationCanvasRef = useRef(null)

  // Store selectors
  const metadata = useAppStore(s => s.metadata)
  const viewMode = useAppStore(s => s.viewMode)
  const rgbBands = useAppStore(s => s.rgbBands)
  const setRGBBands = useAppStore(s => s.setRGBBands)
  const contrast = useAppStore(s => s.contrast)
  const autoStretch = useAppStore(s => s.autoStretch)
  const zoom = useAppStore(s => s.zoom)
  const panOffset = useAppStore(s => s.panOffset)
  const setZoom = useAppStore(s => s.setZoom)
  const setPanOffset = useAppStore(s => s.setPanOffset)
  const currentBand = useAppStore(s => s.currentBand)
  const setCurrentBand = useAppStore(s => s.setCurrentBand)
  const annotationMode = useAppStore(s => s.annotationMode)
  const brushSize = useAppStore(s => s.brushSize)
  const brushHardness = useAppStore(s => s.brushHardness)
  const showMaskOverlay = useAppStore(s => s.showMaskOverlay)
  const maskOpacity = useAppStore(s => s.maskOpacity)
  const maskColor = useAppStore(s => s.maskColor)

  // Panning state
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0 })
  const panOffsetStartRef = useRef({ x: 0, y: 0 })

  // Brush cursor state
  const [cursorPos, setCursorPos] = useState(null)
  const [screenMousePos, setScreenMousePos] = useState(null)

  // Annotation mask ref (Uint8Array, same size as image)
  const maskRef = useRef(null)

  // Sync internal refs to external refs so parent (ViewerPage) can access them for saving
  useEffect(() => {
    if (externalCanvasRef) externalCanvasRef.current = canvasRef.current
  })
  useEffect(() => {
    if (externalMaskRef) externalMaskRef.current = maskRef.current
  })

  // Painting state
  const isPaintingRef = useRef(false)
  const lastPaintPosRef = useRef(null)

  // Crop rectangle state
  const [cropRect, setCropRect] = useState(null) // { x, y, w, h } in image coords
  const cropStartRef = useRef(null) // starting image coords for rectangle drag
  const isCroppingRef = useRef(false)

  // ─── Initialize WebGL renderer ───
  useEffect(() => {
    if (!canvasRef.current) return

    try {
      rendererRef.current = new WebGLBandRenderer(canvasRef.current)
    } catch (err) {
      console.error('WebGL init failed:', err)
    }

    return () => {
      rendererRef.current?.destroy()
      rendererRef.current = null
    }
  }, [])

  // ─── Initialize annotation mask ───
  useEffect(() => {
    if (metadata) {
      maskRef.current = new Uint8Array(metadata.samples * metadata.lines)
    }
  }, [metadata])

  // ─── Render band image when data changes ───
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || !metadata) return

    if (viewMode === 'single' && bandImage) {
      const min = autoStretch && bandStats ? bandStats.percentile1 : (contrast.min ?? 0)
      const max = autoStretch && bandStats ? bandStats.percentile99 : (contrast.max ?? 1)
      const gamma = contrast.gamma ?? 1.0

      renderer.renderBand(bandImage, metadata.samples, metadata.lines, min, max, gamma)
    } else if (viewMode === 'rgb' && rgbImage) {
      renderer.renderRGB(rgbImage.data, rgbImage.width, rgbImage.height)
    }
  }, [bandImage, rgbImage, bandStats, viewMode, metadata, contrast, autoStretch, renderTick])

  // ─── Redraw annotation overlay ───
  useEffect(() => {
    const canvas = annotationCanvasRef.current
    if (!canvas || !metadata) return

    canvas.width = metadata.samples
    canvas.height = metadata.lines

    if (!showMaskOverlay || !maskRef.current) return

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Parse mask color
    const r = parseInt(maskColor.slice(1, 3), 16)
    const g = parseInt(maskColor.slice(3, 5), 16)
    const b = parseInt(maskColor.slice(5, 7), 16)

    const imageData = ctx.createImageData(canvas.width, canvas.height)
    const mask = maskRef.current

    for (let i = 0; i < mask.length; i++) {
      if (mask[i] > 0) {
        const idx = i * 4
        imageData.data[idx] = r
        imageData.data[idx + 1] = g
        imageData.data[idx + 2] = b
        imageData.data[idx + 3] = Math.floor(maskOpacity * 255 * (mask[i] / 255))
      }
    }

    ctx.putImageData(imageData, 0, 0)
  }, [metadata, showMaskOverlay, maskOpacity, maskColor, renderTick])

  // ─── Convert screen coords to image coords ───
  const screenToImage = useCallback((clientX, clientY) => {
    const container = containerRef.current
    if (!container || !metadata) return null

    const rect = container.getBoundingClientRect()
    const containerW = rect.width
    const containerH = rect.height

    // Image display dimensions (fit inside container with aspect ratio)
    const imageAspect = metadata.samples / metadata.lines
    const containerAspect = containerW / containerH

    let displayW, displayH
    if (imageAspect > containerAspect) {
      displayW = containerW * zoom
      displayH = (containerW / imageAspect) * zoom
    } else {
      displayH = containerH * zoom
      displayW = (containerH * imageAspect) * zoom
    }

    // Image origin in container space
    const originX = (containerW - displayW) / 2 + panOffset.x
    const originY = (containerH - displayH) / 2 + panOffset.y

    // Mouse position relative to image origin
    const relX = clientX - rect.left - originX
    const relY = clientY - rect.top - originY

    // Convert to image pixel coords
    const imgX = Math.floor((relX / displayW) * metadata.samples)
    const imgY = Math.floor((relY / displayH) * metadata.lines)

    if (imgX >= 0 && imgX < metadata.samples && imgY >= 0 && imgY < metadata.lines) {
      return { x: imgX, y: imgY }
    }
    return null
  }, [metadata, zoom, panOffset])

  // ─── Paint on annotation mask ───
  const paintAt = useCallback((imgX, imgY, erase = false) => {
    if (!maskRef.current || !metadata) return

    const radius = brushSize
    const { samples, lines } = metadata

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > radius) continue

        const px = imgX + dx
        const py = imgY + dy
        if (px < 0 || px >= samples || py < 0 || py >= lines) continue

        const idx = py * samples + px
        if (erase) {
          maskRef.current[idx] = 0
        } else {
          let strength = 255
          if (brushHardness < 100) {
            // Soft gradient brush: stronger in center
            strength = Math.floor(255 * (1 - dist / radius))
          }
          maskRef.current[idx] = Math.max(maskRef.current[idx], strength)
        }
      }
    }
  }, [brushSize, brushHardness, metadata])

  // ─── Interpolated line painting (no gaps) ───
  const paintLine = useCallback((x0, y0, x1, y1, erase) => {
    const dx = Math.abs(x1 - x0)
    const dy = Math.abs(y1 - y0)
    const steps = Math.max(dx, dy, 1)

    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps
      const x = Math.round(x0 + (x1 - x0) * t)
      const y = Math.round(y0 + (y1 - y0) * t)
      paintAt(x, y, erase)
    }
  }, [paintAt])

  // ─── Mouse handlers ───
  const handleMouseDown = useCallback((e) => {
    const isAnnotating = annotationMode === 'brush' || annotationMode === 'eraser'

    if (isAnnotating) {
      // Start painting
      const coords = screenToImage(e.clientX, e.clientY)
      if (coords) {
        isPaintingRef.current = true
        lastPaintPosRef.current = coords
        paintAt(coords.x, coords.y, annotationMode === 'eraser')
        // Force overlay re-render
        const canvas = annotationCanvasRef.current
        if (canvas && metadata) {
          const ctx = canvas.getContext('2d')
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          // Redraw mask
          const r = parseInt(maskColor.slice(1, 3), 16)
          const g = parseInt(maskColor.slice(3, 5), 16)
          const b = parseInt(maskColor.slice(5, 7), 16)
          const imageData = ctx.createImageData(canvas.width, canvas.height)
          const mask = maskRef.current
          for (let i = 0; i < mask.length; i++) {
            if (mask[i] > 0) {
              const idx = i * 4
              imageData.data[idx] = r
              imageData.data[idx + 1] = g
              imageData.data[idx + 2] = b
              imageData.data[idx + 3] = Math.floor(maskOpacity * 255 * (mask[i] / 255))
            }
          }
          ctx.putImageData(imageData, 0, 0)
        }
      }
      return
    }

    // Middle mouse or view mode: start panning
    if (e.button === 1 || (e.button === 0 && annotationMode === 'view' && e.shiftKey)) {
      isPanningRef.current = true
      panStartRef.current = { x: e.clientX, y: e.clientY }
      panOffsetStartRef.current = { ...panOffset }
      e.preventDefault()
      return
    }

    // Left click in view mode: pixel select
    if (e.button === 0 && annotationMode === 'view') {
      const coords = screenToImage(e.clientX, e.clientY)
      if (coords && onPixelClick) {
        onPixelClick(coords.x, coords.y)
      }
    }

    // Rectangle selection mode: start crop rectangle
    if (e.button === 0 && annotationMode === 'rectangle') {
      const coords = screenToImage(e.clientX, e.clientY)
      if (coords) {
        isCroppingRef.current = true
        cropStartRef.current = coords
        setCropRect({ x: coords.x, y: coords.y, w: 0, h: 0 })
      }
    }
  }, [annotationMode, screenToImage, onPixelClick, panOffset, paintAt, maskColor, maskOpacity, metadata])

  const handleMouseMove = useCallback((e) => {
    // Update cursor position for brush preview
    const coords = screenToImage(e.clientX, e.clientY)
    setCursorPos(coords)
    setScreenMousePos({ x: e.clientX, y: e.clientY })

    if (isPanningRef.current) {
      const dx = e.clientX - panStartRef.current.x
      const dy = e.clientY - panStartRef.current.y
      setPanOffset({
        x: panOffsetStartRef.current.x + dx,
        y: panOffsetStartRef.current.y + dy,
      })
      return
    }

    if (isPaintingRef.current) {
      const coords = screenToImage(e.clientX, e.clientY)
      if (coords && lastPaintPosRef.current) {
        paintLine(lastPaintPosRef.current.x, lastPaintPosRef.current.y, coords.x, coords.y, annotationMode === 'eraser')
        lastPaintPosRef.current = coords

        // Quick overlay redraw
        const canvas = annotationCanvasRef.current
        if (canvas && metadata) {
          const ctx = canvas.getContext('2d')
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          const r = parseInt(maskColor.slice(1, 3), 16)
          const g = parseInt(maskColor.slice(3, 5), 16)
          const b = parseInt(maskColor.slice(5, 7), 16)
          const imageData = ctx.createImageData(canvas.width, canvas.height)
          const mask = maskRef.current
          for (let i = 0; i < mask.length; i++) {
            if (mask[i] > 0) {
              const idx = i * 4
              imageData.data[idx] = r
              imageData.data[idx + 1] = g
              imageData.data[idx + 2] = b
              imageData.data[idx + 3] = Math.floor(maskOpacity * 255 * (mask[i] / 255))
            }
          }
          ctx.putImageData(imageData, 0, 0)
        }
      }
    }

    // Rectangle drag
    if (isCroppingRef.current) {
      const coords = screenToImage(e.clientX, e.clientY)
      if (coords && cropStartRef.current) {
        const sx = cropStartRef.current.x
        const sy = cropStartRef.current.y
        setCropRect({
          x: Math.min(sx, coords.x),
          y: Math.min(sy, coords.y),
          w: Math.abs(coords.x - sx),
          h: Math.abs(coords.y - sy),
        })
      }
    }
  }, [screenToImage, setPanOffset, annotationMode, paintLine, maskColor, maskOpacity, metadata])

  const handleMouseUp = useCallback((e) => {
    isPanningRef.current = false
    isPaintingRef.current = false
    lastPaintPosRef.current = null

    // Finalize crop rectangle
    if (isCroppingRef.current && cropRect && cropRect.w > 2 && cropRect.h > 2) {
      isCroppingRef.current = false
      // Report the crop region to parent
      if (onCropSelect) {
        onCropSelect(cropRect)
      }
    } else {
      isCroppingRef.current = false
    }
  }, [cropRect, onCropSelect])

  // ─── Zoom/Scroll with mouse wheel ───
  const handleWheel = useCallback((e) => {
    e.preventDefault()
    
    // Ctrl/Meta + scroll = zoom
    if (e.ctrlKey || e.metaKey) {
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const newZoom = Math.max(0.1, Math.min(20, zoom * delta))
      setZoom(newZoom)
      return
    }

    // No modifiers = scroll bands
    if (metadata) {
      const deltaBand = e.deltaY > 0 ? 1 : -1

      if (viewMode === 'single') {
        const newBand = Math.max(0, Math.min(metadata.bands - 1, currentBand + deltaBand))
        if (newBand !== currentBand) {
          setCurrentBand(newBand)
        }
      } else if (viewMode === 'rgb') {
        // Shift all 3 RGB bands together
        const clamp = (v) => Math.max(0, Math.min(metadata.bands - 1, v + deltaBand))
        const newR = clamp(rgbBands.r)
        const newG = clamp(rgbBands.g)
        const newB = clamp(rgbBands.b)
        if (newR !== rgbBands.r || newG !== rgbBands.g || newB !== rgbBands.b) {
          setRGBBands({ r: newR, g: newG, b: newB })
        }
      }
    }
  }, [zoom, setZoom, currentBand, setCurrentBand, viewMode, metadata, rgbBands, setRGBBands])

  // ─── Compute display dimensions ───
  const getDisplayStyle = useCallback(() => {
    if (!metadata || !containerRef.current) return {}

    const container = containerRef.current
    const rect = container.getBoundingClientRect()
    const containerW = rect.width
    const containerH = rect.height

    const imageAspect = metadata.samples / metadata.lines
    const containerAspect = containerW / containerH

    let displayW, displayH
    if (imageAspect > containerAspect) {
      displayW = containerW
      displayH = containerW / imageAspect
    } else {
      displayH = containerH
      displayW = containerH * imageAspect
    }

    return {
      width: `${displayW}px`,
      height: `${displayH}px`,
      transform: `scale(${zoom}) translate(${panOffset.x / zoom}px, ${panOffset.y / zoom}px)`,
    }
  }, [metadata, zoom, panOffset])

  const displayStyle = getDisplayStyle()

  // Determine cursor style
  let cursorStyle = 'crosshair'
  if (annotationMode === 'brush' || annotationMode === 'eraser') {
    cursorStyle = 'none' // We render a custom brush cursor
  } else if (isPanningRef.current) {
    cursorStyle = 'grabbing'
  }

  return (
    <div
      ref={containerRef}
      className="viewer-container"
      style={{ cursor: cursorStyle }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      {metadata ? (
        <div className="viewer-canvas-wrapper" style={displayStyle}>
          {/* WebGL canvas for band rendering */}
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }}
          />
          {/* Annotation overlay canvas */}
          <canvas
            ref={annotationCanvasRef}
            className="annotation-canvas"
            style={{
              width: '100%',
              height: '100%',
              imageRendering: 'pixelated',
              pointerEvents: 'none',
            }}
          />

          {/* Crop rectangle overlay */}
          {cropRect && cropRect.w > 0 && cropRect.h > 0 && metadata && (
            <div
              style={{
                position: 'absolute',
                left: `${(cropRect.x / metadata.samples) * 100}%`,
                top: `${(cropRect.y / metadata.lines) * 100}%`,
                width: `${(cropRect.w / metadata.samples) * 100}%`,
                height: `${(cropRect.h / metadata.lines) * 100}%`,
                border: '2px dashed var(--accent-teal)',
                background: 'rgba(79, 223, 210, 0.08)',
                pointerEvents: 'none',
                boxSizing: 'border-box',
              }}
            >
              <span style={{
                position: 'absolute',
                top: '-22px',
                left: '0',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--accent-teal)',
                background: 'var(--bg-primary)',
                padding: '1px 6px',
                borderRadius: 'var(--radius-sm)',
                whiteSpace: 'nowrap',
              }}>
                {cropRect.w} × {cropRect.h}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state-icon">🔬</div>
          <div className="empty-state-text">No data loaded</div>
        </div>
      )}

      {/* Custom brush cursor */}
      {(annotationMode === 'brush' || annotationMode === 'eraser') && screenMousePos && containerRef.current && (
        <div
          style={{
            position: 'fixed',
            left: `${screenMousePos.x}px`,
            top: `${screenMousePos.y}px`,
            width: `${brushSize * 2 * zoom}px`,
            height: `${brushSize * 2 * zoom}px`,
            borderRadius: '50%',
            border: `2px solid ${annotationMode === 'eraser' ? 'var(--accent-red)' : 'var(--accent-teal)'}`,
            pointerEvents: 'none',
            zIndex: 999,
            transform: 'translate(-50%, -50%)',
          }}
        />
      )}

      {/* Pixel info tooltip */}
      {cursorPos && annotationMode === 'view' && (
        <div
          className="pixel-info"
          style={{
            bottom: 'var(--space-lg)',
            right: 'var(--space-lg)',
          }}
        >
          <div className="coords">
            x: {cursorPos.x}, y: {cursorPos.y}
          </div>
          {bandImage && metadata && (
            <div className="value">
              Value: {bandImage[cursorPos.y * metadata.samples + cursorPos.x]?.toFixed(4) ?? '—'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
