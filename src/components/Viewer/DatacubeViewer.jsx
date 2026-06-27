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
export default function DatacubeViewer({
  bandImage,
  rgbImage,
  bandStats,
  onPixelClick,
  onCropSelect,
  onRoiSelect,
  renderTick,
  canvasRef: externalCanvasRef,
  maskRef: externalMaskRef
}) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const rendererRef = useRef(null)
  const maskCanvasRef = useRef(null)
  const vectorCanvasRef = useRef(null)

  // Store selectors
  const metadata = useAppStore(s => s.metadata)
  const viewMode = useAppStore(s => s.viewMode)
  const rgbBands = useAppStore(s => s.rgbBands)
  const setRGBBands = useAppStore(s => s.setRGBBands)
  const contrast = useAppStore(s => s.contrast)
  const colormap = useAppStore(s => s.colormap)
  const autoStretch = useAppStore(s => s.autoStretch)
  const zoom = useAppStore(s => s.zoom)
  const setZoom = useAppStore(s => s.setZoom)
  const panOffset = useAppStore(s => s.panOffset)
  const setPanOffset = useAppStore(s => s.setPanOffset)
  const currentBand = useAppStore(s => s.currentBand)
  const setCurrentBand = useAppStore(s => s.setCurrentBand)
  const annotationMode = useAppStore(s => s.annotationMode)
  const rois = useAppStore(s => s.rois)
  const brushSize = useAppStore(s => s.brushSize)
  const showMaskOverlay = useAppStore(s => s.showMaskOverlay)
  const maskOpacity = useAppStore(s => s.maskOpacity)
  const classes = useAppStore(s => s.classes)
  const activeClassId = useAppStore(s => s.activeClassId)

  // Panning state
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0 })
  const panOffsetStartRef = useRef({ x: 0, y: 0 })

  // Brush cursor state
  const [cursorPos, setCursorPos] = useState(null)
  const [screenMousePos, setScreenMousePos] = useState(null)
  const [cursorScale, setCursorScale] = useState(1)

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

  // Polygon & Lasso state
  const [polygonPoints, setPolygonPoints] = useState([])
  const isLassoingRef = useRef(false)
  const lassoPointsRef = useRef([])
  const isSpaceDownRef = useRef(false)

  // Crop rectangle state
  const [cropRect, setCropRect] = useState(null) // { x, y, w, h } in image coords
  const cropStartRef = useRef(null) // starting image coords for rectangle drag
  const isCroppingRef = useRef(false)
  const isDraggingCropRef = useRef(false)
  const dragCropOffsetRef = useRef({ dx: 0, dy: 0 })

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

  const initialMaskData = useAppStore(s => s.initialMaskData)

  // ─── Initialize annotation mask ───
  useEffect(() => {
    if (metadata) {
      if (initialMaskData && initialMaskData.length === metadata.samples * metadata.lines) {
        // Copy the initial mask into our mutable ref
        const newMask = new Uint8Array(initialMaskData)
        
        const existingClasses = useAppStore.getState().classes
        const existingIds = new Set(existingClasses.map(c => c.id))
        const foundIds = new Set()

        // Convert legacy opacity masks (e.g. 255) to Class 1
        for (let i = 0; i < newMask.length; i++) {
          if (newMask[i] > 0) {
            if (newMask[i] > 10) { 
              newMask[i] = 1 
            }
            foundIds.add(newMask[i])
          }
        }
        
        // Add any discovered classes that aren't already in the store,
        // preferring imported names (e.g. from a CSV Class_Name column).
        const addClass = useAppStore.getState().addClass
        const importedNames = useAppStore.getState().initialClassNames || {}
        foundIds.forEach(id => {
          if (!existingIds.has(id)) {
            // Generate a random bright color
            const color = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')
            addClass({ id, name: importedNames[id] || `Imported Class ${id}`, color })
          }
        })

        maskRef.current = newMask
      } else {
        maskRef.current = new Uint8Array(metadata.samples * metadata.lines)
      }
    }
  }, [metadata, initialMaskData])

  // ─── Render band image when data changes ───
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || !metadata) return

    if (viewMode === 'single' && bandImage) {
      const min = autoStretch && bandStats ? bandStats.percentile1 : (contrast.min ?? 0)
      const max = autoStretch && bandStats ? bandStats.percentile99 : (contrast.max ?? 1)
      const gamma = contrast.gamma ?? 1.0

      renderer.setColormap(colormap)
      renderer.renderBand(bandImage, metadata.samples, metadata.lines, min, max, gamma)
    } else if (viewMode === 'rgb' && rgbImage) {
      renderer.renderRGB(rgbImage.data, rgbImage.width, rgbImage.height)
    }
  }, [bandImage, rgbImage, bandStats, viewMode, metadata, contrast, autoStretch, renderTick, colormap])

  // ─── Convert screen coords to image coords ───
  const screenToImage = useCallback((clientX, clientY) => {
    const container = containerRef.current
    if (!container || !metadata) return null

    const rect = container.getBoundingClientRect()

    const containerW = rect.width
    const containerH = rect.height
    const containerX = clientX - rect.left
    const containerY = clientY - rect.top

    // Aspect-fit size of the image inside the container
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

    // Update the visual scale of a single image pixel on screen
    const currentScale = zoom * (displayW / metadata.samples)
    setCursorScale(currentScale)

    // The wrapper is centered in the container and transformed with
    // transform-origin:center as `scale(zoom) translate(pan/zoom)`, which maps a
    // point at offset p from the image centre to: centre + zoom*p + pan. Invert
    // that to recover the image-local point (relative to the image centre).
    const localX = (containerX - containerW / 2 - panOffset.x) / zoom
    const localY = (containerY - containerH / 2 - panOffset.y) / zoom

    // Map to 0-1 range
    const normX = (localX + displayW / 2) / displayW
    const normY = (localY + displayH / 2) / displayH

    // Map to pixel coords
    const px = Math.floor(normX * metadata.samples)
    const py = Math.floor(normY * metadata.lines)

    if (px < 0 || py < 0 || px >= metadata.samples || py >= metadata.lines) return null

    return { x: px, y: py }
  }, [metadata, zoom, panOffset])

  // ─── Draw overlays (mask and shapes) ───
  const redrawMask = useCallback((dirtyRect = null) => {
    const canvas = maskCanvasRef.current
    if (!canvas || !metadata) return

    const { samples, lines } = metadata
    let x0 = 0, y0 = 0, w = samples, h = lines
    if (dirtyRect) {
      x0 = dirtyRect.x
      y0 = dirtyRect.y
      w = dirtyRect.w
      h = dirtyRect.h
    } else {
      canvas.width = samples
      canvas.height = lines
    }

    const ctx = canvas.getContext('2d')
    if (!showMaskOverlay || !maskRef.current) {
      if (!dirtyRect) ctx.clearRect(0, 0, canvas.width, canvas.height)
      return
    }

    const imgData = ctx.createImageData(w, h)
    const data = imgData.data
    const mask = maskRef.current
    
    // Create a fast lookup for class colors
    const classColors = {}
    classes.forEach(c => {
      classColors[c.id] = {
        r: parseInt(c.color.slice(1, 3), 16),
        g: parseInt(c.color.slice(3, 5), 16),
        b: parseInt(c.color.slice(5, 7), 16)
      }
    })

    let dataIdx = 0
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const classId = mask[y * samples + x]
        if (classId > 0 && classColors[classId]) {
          const color = classColors[classId]
          data[dataIdx] = color.r
          data[dataIdx + 1] = color.g
          data[dataIdx + 2] = color.b
          data[dataIdx + 3] = Math.floor(maskOpacity * 255)
        }
        dataIdx += 4
      }
    }

    if (!dirtyRect) {
      ctx.clearRect(0, 0, samples, lines)
    }
    ctx.putImageData(imgData, x0, y0)
  }, [metadata, showMaskOverlay, maskOpacity, classes])

  const redrawVectors = useCallback(() => {
    const canvas = vectorCanvasRef.current
    if (!canvas || !metadata) return

    canvas.width = metadata.samples
    canvas.height = metadata.lines

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (polygonPoints.length > 0 || lassoPointsRef.current.length > 0) {
      const activeColor = classes.find(c => c.id === activeClassId)?.color || '#ff0000'
      ctx.strokeStyle = activeColor
      ctx.lineWidth = 2 / zoom
      ctx.setLineDash([5 / zoom, 5 / zoom])
      
      const drawPath = (points, close) => {
        if (points.length === 0) return
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }
        if (close) ctx.closePath()
        ctx.stroke()
      }

      if (polygonPoints.length > 0) {
        drawPath(polygonPoints, false)
        if (screenMousePos) {
          const mCoords = screenToImage(screenMousePos.x, screenMousePos.y)
          if (mCoords) {
            ctx.beginPath()
            ctx.moveTo(polygonPoints[polygonPoints.length - 1].x, polygonPoints[polygonPoints.length - 1].y)
            ctx.lineTo(mCoords.x, mCoords.y)
            ctx.stroke()
          }
        }
      }

      if (lassoPointsRef.current.length > 0) {
        drawPath(lassoPointsRef.current, false)
      }
      ctx.setLineDash([])
    }
  }, [metadata, classes, activeClassId, polygonPoints, screenMousePos, screenToImage, zoom])

  useEffect(() => {
    redrawMask()
    redrawVectors()
  }, [redrawMask, redrawVectors, renderTick, initialMaskData])

  // ─── Fill Polygon Algorithm ───
  const fillPolygon = useCallback((points) => {
    if (!metadata || !maskRef.current || points.length < 3) return
    const canvas = document.createElement('canvas')
    canvas.width = metadata.samples
    canvas.height = metadata.lines
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y)
    }
    ctx.closePath()
    ctx.fill()
    
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const mask = maskRef.current
    for (let i = 0; i < mask.length; i++) {
      if (imgData[i * 4] > 0) {
        mask[i] = 255
      }
    }
    redrawMask()
    redrawVectors()
  }, [metadata, redrawMask, redrawVectors])

  // ─── Keyboard Shortcuts ───
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !isSpaceDownRef.current) {
        e.preventDefault()
        isSpaceDownRef.current = true
        if (containerRef.current) containerRef.current.style.cursor = 'grab'
      } else if (e.key === '[') {
        useAppStore.setState(s => ({ brushSize: Math.max(1, s.brushSize - 2) }))
      } else if (e.key === ']') {
        useAppStore.setState(s => ({ brushSize: Math.min(100, s.brushSize + 2) }))
      }
    }
    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        isSpaceDownRef.current = false
        if (containerRef.current) containerRef.current.style.cursor = 'crosshair'
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  // ─── Paint on annotation mask ───
  const paintAt = useCallback((cx, cy, erase = false) => {
    if (!maskRef.current || !metadata) return
    const mask = maskRef.current
    const radius = brushSize
    const samples = metadata.samples
    const lines = metadata.lines

    let modified = false
    let minX = cx, maxX = cx, minY = cy, maxY = cy

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > radius) continue

        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < samples && y >= 0 && y < lines) {
          const idx = y * samples + x
          
          if (erase) {
            if (mask[idx] !== 0) {
              mask[idx] = 0
              modified = true
            }
          } else {
            if (mask[idx] !== activeClassId) {
              mask[idx] = activeClassId
              modified = true
            }
          }

          if (modified) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
      }
    }
  }, [brushSize, activeClassId, metadata])

  // ─── Interpolated line painting (no gaps) ───
  const paintLine = useCallback((x0, y0, x1, y1, erase) => {
    const minX = Math.max(0, Math.min(x0, x1) - brushSize)
    const minY = Math.max(0, Math.min(y0, y1) - brushSize)
    const maxX = Math.min(metadata.samples - 1, Math.max(x0, x1) + brushSize)
    const maxY = Math.min(metadata.lines - 1, Math.max(y0, y1) + brushSize)
    const w = maxX - minX + 1
    const h = maxY - minY + 1
    
    const dx = Math.abs(x1 - x0)
    const dy = Math.abs(y1 - y0)
    const steps = Math.max(dx, dy, 1)

    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps
      const x = Math.round(x0 + (x1 - x0) * t)
      const y = Math.round(y0 + (y1 - y0) * t)
      paintAt(x, y, erase)
    }
    
    return { x: minX, y: minY, w, h }
  }, [paintAt, metadata, brushSize])

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
        redrawMask()
        redrawVectors()
      }
      return
    }

    // Middle mouse or view mode: start panning
    if (e.button === 1 || isSpaceDownRef.current || (e.button === 0 && annotationMode === 'view' && e.shiftKey)) {
      isPanningRef.current = true
      panStartRef.current = { x: e.clientX, y: e.clientY }
      panOffsetStartRef.current = { ...panOffset }
      if (containerRef.current) containerRef.current.style.cursor = 'grabbing'
      e.preventDefault()
      return
    }

    // Left click in view mode: pixel select (now pins by default)
    if (e.button === 0 && annotationMode === 'view') {
      const coords = screenToImage(e.clientX, e.clientY)
      if (coords && onPixelClick) {
        onPixelClick(coords.x, coords.y, true)
      }
    }

    // Wand mode
    if (e.button === 0 && annotationMode === 'wand') {
      const coords = screenToImage(e.clientX, e.clientY)
      if (coords && onPixelClick) {
        onPixelClick(coords.x, coords.y)
      }
      return
    }
    if (e.button === 0 && (annotationMode === 'rectangle' || annotationMode === 'roi')) {
      const coords = screenToImage(e.clientX, e.clientY)
      if (coords) {
        // If clicking inside an existing crop box, drag it
        setCropRect(currentCrop => {
          if (currentCrop && currentCrop.w > 0 && 
              coords.x >= currentCrop.x && coords.x <= currentCrop.x + currentCrop.w &&
              coords.y >= currentCrop.y && coords.y <= currentCrop.y + currentCrop.h) {
            isDraggingCropRef.current = true
            dragCropOffsetRef.current = { dx: coords.x - currentCrop.x, dy: coords.y - currentCrop.y }
            if (containerRef.current) containerRef.current.style.cursor = 'move'
            return currentCrop
          }
          // Otherwise start a new crop box
          isCroppingRef.current = true
          cropStartRef.current = coords
          return { x: coords.x, y: coords.y, w: 0, h: 0 }
        })
      }
      return
    }

    // Polygon mode
    if (e.button === 0 && annotationMode === 'polygon') {
      const coords = screenToImage(e.clientX, e.clientY)
      if (coords) {
        if (polygonPoints.length > 2) {
          const first = polygonPoints[0]
          // Calculate distance in screen pixels to be zoom-independent
          const dx = coords.x - first.x
          const dy = coords.y - first.y
          // Convert image pixel distance to screen pixel distance
          const distScreen = Math.sqrt(dx * dx + dy * dy) * zoom
          
          // If clicked within 10 screen pixels of the first point, close it
          if (distScreen < 10) {
            fillPolygon(polygonPoints)
            setPolygonPoints([])
            return
          }
        }
        setPolygonPoints(prev => [...prev, coords])
      }
      return
    }

    // Lasso mode
    if (e.button === 0 && annotationMode === 'lasso') {
      const coords = screenToImage(e.clientX, e.clientY)
      if (coords) {
        isLassoingRef.current = true
        lassoPointsRef.current = [coords]
      }
      return
    }
  }, [annotationMode, screenToImage, onPixelClick, panOffset, paintAt, redrawMask, redrawVectors])

  const handleMouseMove = useCallback((e) => {
    // Update cursor position for brush preview
    const coords = screenToImage(e.clientX, e.clientY)
    setCursorPos(coords)
    setScreenMousePos({ x: e.clientX, y: e.clientY })

    // Dynamic spectrum preview on shift hover
    if (e.shiftKey && coords && annotationMode === 'view' && !isPanningRef.current) {
      if (onPixelClick) {
        onPixelClick(coords.x, coords.y, false)
      }
    }

    if (polygonPoints.length > 0 || isLassoingRef.current) redrawVectors()

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
        const dirtyRect = paintLine(lastPaintPosRef.current.x, lastPaintPosRef.current.y, coords.x, coords.y, annotationMode === 'eraser')
        lastPaintPosRef.current = coords

        // Quick mask redraw (only dirty rect)
        redrawMask(dirtyRect)
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
    } else if (isDraggingCropRef.current && metadata) {
      const coords = screenToImage(e.clientX, e.clientY)
      if (coords && dragCropOffsetRef.current) {
        setCropRect(currentCrop => {
          if (!currentCrop) return null
          let newX = coords.x - dragCropOffsetRef.current.dx
          let newY = coords.y - dragCropOffsetRef.current.dy
          // Clamp to image bounds
          newX = Math.max(0, Math.min(metadata.samples - currentCrop.w, newX))
          newY = Math.max(0, Math.min(metadata.lines - currentCrop.h, newY))
          return { ...currentCrop, x: newX, y: newY }
        })
      }
    }

    // Lasso drag
    if (isLassoingRef.current) {
      const coords = screenToImage(e.clientX, e.clientY)
      if (coords) {
        lassoPointsRef.current.push(coords)
      }
    }
  }, [screenToImage, setPanOffset, annotationMode, paintLine, redrawMask, redrawVectors, polygonPoints])

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false
    isPaintingRef.current = false
    lastPaintPosRef.current = null
    if (containerRef.current && !isSpaceDownRef.current) {
      containerRef.current.style.cursor = 'crosshair'
    }

    // Finalize crop rectangle
    if (isCroppingRef.current && cropRect && cropRect.w > 2 && cropRect.h > 2) {
      isCroppingRef.current = false
      if (annotationMode === 'roi') {
        if (onRoiSelect) onRoiSelect(cropRect)
        setCropRect(null)
      } else {
        // Report the crop region to parent
        if (onCropSelect) onCropSelect(cropRect)
      }
    } else if (isDraggingCropRef.current) {
      isDraggingCropRef.current = false
      if (containerRef.current && !isSpaceDownRef.current) {
        containerRef.current.style.cursor = 'crosshair'
      }
      if (annotationMode === 'roi') {
        if (onRoiSelect && cropRect) onRoiSelect(cropRect)
        setCropRect(null)
      } else {
        if (onCropSelect && cropRect) onCropSelect(cropRect)
      }
    } else {
      isCroppingRef.current = false
    }

    // Finalize Lasso
    if (isLassoingRef.current) {
      isLassoingRef.current = false
      if (lassoPointsRef.current.length > 2) {
        fillPolygon(lassoPointsRef.current)
      }
      lassoPointsRef.current = []
    }
  }, [cropRect, onCropSelect, fillPolygon])

  const handleDoubleClick = useCallback(() => {
    if (annotationMode === 'polygon' && polygonPoints.length > 2) {
      fillPolygon(polygonPoints)
      setPolygonPoints([])
    }
  }, [annotationMode, polygonPoints, fillPolygon])

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
          const newBand = clamp(currentBand)
          if (newBand !== currentBand) {
            setCurrentBand(newBand)
          }
        }
      }
    }
  }, [zoom, setZoom, currentBand, setCurrentBand, viewMode, metadata, rgbBands, setRGBBands])

  // ─── Attach wheel listener non-passively ───
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    
    // We attach it manually with { passive: false } so we can call e.preventDefault()
    // without the browser throwing passive event listener errors.
    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

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

  // getDisplayStyle / isPanningRef are read at render time intentionally; the
  // component re-renders on the state (zoom/pan/mode) that drives these.
  // eslint-disable-next-line react-hooks/refs
  const displayStyle = getDisplayStyle()

  // Determine cursor style
  // eslint-disable-next-line react-hooks/refs
  const isPanning = isPanningRef.current
  let cursorStyle = 'crosshair'
  if (annotationMode === 'brush' || annotationMode === 'eraser') {
    cursorStyle = 'none' // We render a custom brush cursor
  } else if (isPanning) {
    cursorStyle = 'grabbing'
  }

  return (
    <div
      ref={containerRef}
      className="datacube-canvas-container"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        cursor: cursorStyle,
        touchAction: 'none', // Prevent browser panning
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {metadata ? (
        <div className="viewer-canvas-wrapper" style={displayStyle}>
          {/* WebGL canvas for band rendering */}
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }}
          />
          {/* Annotation mask canvas */}
          <canvas
            ref={maskCanvasRef}
            className="annotation-canvas"
            style={{
              width: '100%',
              height: '100%',
              imageRendering: 'pixelated',
              pointerEvents: 'none',
            }}
          />
          {/* Vector overlay canvas */}
          <canvas
            ref={vectorCanvasRef}
            className="annotation-canvas"
            style={{
              width: '100%',
              height: '100%',
              imageRendering: 'pixelated',
              pointerEvents: 'none',
              position: 'absolute',
              top: 0,
              left: 0
            }}
          />

          {/* ROIs overlay */}
          {rois && rois.length > 0 && metadata && rois.map(roi => (
            <div
              key={roi.id}
              style={{
                position: 'absolute',
                left: `${(roi.x / metadata.samples) * 100}%`,
                top: `${(roi.y / metadata.lines) * 100}%`,
                width: `${(roi.w / metadata.samples) * 100}%`,
                height: `${(roi.h / metadata.lines) * 100}%`,
                border: '2px solid yellow',
                background: 'rgba(255, 255, 0, 0.1)',
                pointerEvents: 'none',
                boxSizing: 'border-box',
              }}
            >
              <span style={{
                position: 'absolute',
                top: '-22px',
                left: '-2px',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                color: '#222',
                background: 'yellow',
                padding: '1px 6px',
                borderRadius: 'var(--radius-sm)',
                whiteSpace: 'nowrap',
              }}>
                {roi.name} ({roi.w} × {roi.h})
              </span>
            </div>
          ))}

          {/* Crop rectangle overlay */}
          {cropRect && cropRect.w > 0 && cropRect.h > 0 && metadata && (
            <div
              style={{
                position: 'absolute',
                left: `${(cropRect.x / metadata.samples) * 100}%`,
                top: `${(cropRect.y / metadata.lines) * 100}%`,
                width: `${(cropRect.w / metadata.samples) * 100}%`,
                height: `${(cropRect.h / metadata.lines) * 100}%`,
                border: `2px dashed ${annotationMode === 'roi' ? 'yellow' : 'var(--accent-teal)'}`,
                background: annotationMode === 'roi' ? 'rgba(255, 255, 0, 0.08)' : 'rgba(79, 223, 210, 0.08)',
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
                color: annotationMode === 'roi' ? '#222' : 'var(--accent-teal)',
                background: annotationMode === 'roi' ? 'yellow' : 'var(--bg-primary)',
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
      {(annotationMode === 'brush' || annotationMode === 'eraser') && screenMousePos && (
        <div
          style={{
            position: 'fixed',
            left: `${screenMousePos.x}px`,
            top: `${screenMousePos.y}px`,
            width: `${brushSize * 2 * cursorScale}px`,
            height: `${brushSize * 2 * cursorScale}px`,
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
