import { useState, useCallback } from 'react'
import { X, Archive, Database, FileSpreadsheet, Image as ImageIcon, PaintBucket, Layers, FileBox, FileJson, Download, AlertCircle, CheckCircle2, Settings2, ChevronDown } from 'lucide-react'
import useAppStore from '../../stores/useAppStore'

const EXPORT_FORMATS = [
  { id: 'hz',   label: 'HSI Studio Project (.hz)', group: 'Project', icon: Archive, desc: 'Saves your current view state, mask, ROIs, and classes. Can be loaded later.' },
  { id: 'json', label: 'JSON (.json)',             group: 'Project', icon: FileJson, desc: 'Human-readable metadata, mask, classes, ROIs + data. Re-importable.' },
  { id: 'npz',       label: 'NumPy Archive (.npz)',      group: 'Full Datacube', icon: Archive, desc: 'Saves full datacube, wavelengths, and mask. (Python compatible)' },
  { id: 'envi',      label: 'ENVI (.hdr + .dat)',        group: 'Full Datacube', icon: Database, desc: 'Standard format for ENVI, MATLAB, and remote sensing tools.' },
  { id: 'csv',       label: 'Pixel-wise Data (.csv)',    group: 'Full Datacube', icon: FileSpreadsheet, desc: 'Exports all pixels + bands. Adds mask Class if present.' },
  { id: 'png-view',  label: 'Current View (PNG)',        group: 'Image Export', icon: ImageIcon, desc: 'Saves a screenshot of the currently displayed band view.' },
  { id: 'mask-png',  label: 'Annotation Mask (PNG)',     group: 'Mask Export', icon: PaintBucket, desc: 'Grayscale image of mask (white = annotated, black = back).' },
  { id: 'mask-npz',  label: 'Annotation Mask (NPZ)',     group: 'Mask Export', icon: FileBox, desc: 'NumPy array of the mask inside a .npz file.' },
  { id: 'mask-raw',  label: 'Annotation Mask (Raw)',     group: 'Mask Export', icon: Layers, desc: 'Raw binary file of the annotation mask.' },
]
export default function ExportPane({
  workerRef,
  canvasRef,
  maskRef,
  onClose
}) {
  const metadata = useAppStore(s => s.metadata)
  const fileName = useAppStore(s => s.fileName)
  const currentBand = useAppStore(s => s.currentBand)

  const [selectedFormat, setSelectedFormat] = useState('npz')
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [excludeMasks, setExcludeMasks] = useState(false)

  // ─── CSV class-column options ───
  const [showCsvConfig, setShowCsvConfig] = useState(false)
  const [csvClassFormat, setCsvClassFormat] = useState('id-name') // 'id-name' | 'id' | 'name'
  const [defaultClassName, setDefaultClassName] = useState('')

  const triggerDownload = useCallback((blob, filename) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [])

  const handleSave = useCallback(async () => {
    if (!metadata) return
    setSaving(true)
    setStatusMsg('Preparing export...')

    const baseName = fileName || 'datacube'

    try {
      switch (selectedFormat) {
        // ─── HSI Studio Project ───
        case 'hz': {
          setStatusMsg('Extracting datacube...')
          const worker = workerRef?.current
          if (!worker) throw new Error('Worker not available')

          const msg = await new Promise((resolve, reject) => {
            const handler = (e) => {
              if (e.data.type === 'datacubeExport') {
                worker.removeEventListener('message', handler)
                resolve(e.data)
              } else if (e.data.type === 'error') {
                worker.removeEventListener('message', handler)
                reject(new Error(e.data.message))
              }
            }
            worker.addEventListener('message', handler)
            worker.postMessage({ type: 'exportDatacube' })
            setTimeout(() => {
              worker.removeEventListener('message', handler)
              reject(new Error('Export timed out'))
            }, 30000)
          })

          setStatusMsg('Packaging project...')
          import('jszip').then(async ({ default: JSZip }) => {
            const zip = new JSZip()
            const { createNpyBuffer } = await import('../../lib/npzParser')

            const state = useAppStore.getState()
            
            // 1. Save project state (JSON)
            const projectData = {
              version: 1,
              filename: fileName, // To check against loaded datacube
              metadata: {
                samples: metadata.samples,
                lines: metadata.lines,
                bands: metadata.bands,
                wavelengths: metadata.wavelengths
              },
              viewState: {
                currentBand,
                viewMode: state.viewMode,
                rgbBands: state.rgbBands,
                contrast: state.contrast,
                autoStretch: state.autoStretch,
                colormap: state.colormap,
                zoom: state.zoom,
                panOffset: state.panOffset
              },
              annotationState: {
                classes: state.classes,
                rois: state.rois,
                maskOpacity: state.maskOpacity
              }
            }
            zip.file('project.json', JSON.stringify(projectData, null, 2))

            // 2. Save datacube (NPY)
            const datacubeArr = new Float32Array(msg.data)
            // It's BSQ, so shape is (bands, lines, samples) if we treat it as Python
            const datacubeNpy = createNpyBuffer(datacubeArr, [metadata.bands, metadata.lines, metadata.samples], '<f4')
            zip.file('datacube.npy', datacubeNpy)

            // 3. Save mask (NPZ / NPY)
            const mask = maskRef?.current
            if (mask && !excludeMasks) {
              const maskNpy = createNpyBuffer(mask, [metadata.lines, metadata.samples], '|u1')
              zip.file('mask.npy', maskNpy)
            }

            setStatusMsg('Compressing project...')
            const blob = await zip.generateAsync({
              type: 'blob',
              compression: 'DEFLATE',
              compressionOptions: { level: 6 }
            })
            triggerDownload(blob, `${baseName}.hz`)
            setStatusMsg('✓ Project Saved!')
            setSaving(false)
            setTimeout(() => onClose(), 1500)
          }).catch(err => {
            setStatusMsg(`Error: ${err.message}`)
            setSaving(false)
          })
          return // Async handled in promise, exit early
        }

        // ─── JSON (metadata + mask + classes + data) ───
        case 'json': {
          setStatusMsg('Extracting datacube...')
          const worker = workerRef?.current
          if (!worker) throw new Error('Worker not available')

          const msg = await new Promise((resolve, reject) => {
            const handler = (e) => {
              if (e.data.type === 'datacubeExport') {
                worker.removeEventListener('message', handler)
                resolve(e.data)
              } else if (e.data.type === 'error') {
                worker.removeEventListener('message', handler)
                reject(new Error(e.data.message))
              }
            }
            worker.addEventListener('message', handler)
            worker.postMessage({ type: 'exportDatacube' })
            setTimeout(() => {
              worker.removeEventListener('message', handler)
              reject(new Error('Export timed out'))
            }, 30000)
          })

          setStatusMsg('Building JSON...')
          const state = useAppStore.getState()
          const mask = maskRef?.current
          const datacubeArr = new Float32Array(msg.data) // BSQ order: [bands, lines, samples]

          // metadata is kept in full here AND remains on the loaded image (this
          // export is non-destructive — it only produces a file).
          const exportObj = {
            format: 'hsi-studio-json',
            version: 1,
            filename: fileName,
            metadata: {
              samples: metadata.samples,
              lines: metadata.lines,
              bands: metadata.bands,
              wavelengths: metadata.wavelengths || null,
              interleave: 'bsq',
              dataType: 4,
              isRGBImage: metadata.isRGBImage || false,
            },
            viewState: {
              currentBand,
              viewMode: state.viewMode,
              rgbBands: state.rgbBands,
              contrast: state.contrast,
              autoStretch: state.autoStretch,
              colormap: state.colormap,
            },
            classes: state.classes,
            rois: state.rois,
            maskOpacity: state.maskOpacity,
            mask: (mask && !excludeMasks) ? Array.from(mask) : null,
            data: Array.from(datacubeArr),
          }

          setStatusMsg('Serializing JSON...')
          await new Promise(r => setTimeout(r, 0))
          const blob = new Blob([JSON.stringify(exportObj)], { type: 'application/json' })
          triggerDownload(blob, `${baseName}.json`)
          setStatusMsg('✓ JSON Saved!')
          break
        }

        // ─── Current View Screenshot ───
        case 'png-view': {
          setStatusMsg('Capturing current view...')
          const canvas = canvasRef?.current
          if (!canvas) throw new Error('No canvas available')

          let finalCanvas = canvas
          
          // If we want to include annotations, we combine them
          if (!excludeMasks) {
            const annotationCanvases = document.querySelectorAll('.annotation-canvas')
            if (annotationCanvases.length > 0) {
              finalCanvas = document.createElement('canvas')
              finalCanvas.width = canvas.width
              finalCanvas.height = canvas.height
              const ctx = finalCanvas.getContext('2d')
              ctx.drawImage(canvas, 0, 0)
              annotationCanvases.forEach(mCanvas => {
                ctx.drawImage(mCanvas, 0, 0, canvas.width, canvas.height)
              })
            }
          }

          const blob = await new Promise(resolve => finalCanvas.toBlob(resolve, 'image/png'))
          triggerDownload(blob, `${baseName}_band${currentBand}.png`)
          setStatusMsg('✓ Saved!')
          break
        }

        // ─── Mask as PNG ───
        case 'mask-png': {
          setStatusMsg('Exporting mask as PNG...')
          const mask = maskRef?.current
          if (!mask) throw new Error('No annotation mask available')

          const { samples, lines } = metadata
          const maskCanvas = document.createElement('canvas')
          maskCanvas.width = samples
          maskCanvas.height = lines
          const ctx = maskCanvas.getContext('2d')
          const imageData = ctx.createImageData(samples, lines)

          const classes = useAppStore.getState().classes
          const classColors = { 0: { r: 0, g: 0, b: 0 } }
          classes.forEach(c => {
            classColors[c.id] = {
              r: parseInt(c.color.slice(1, 3), 16),
              g: parseInt(c.color.slice(3, 5), 16),
              b: parseInt(c.color.slice(5, 7), 16)
            }
          })

          for (let i = 0; i < mask.length; i++) {
            const val = mask[i]
            const color = classColors[val] || { r: 255, g: 255, b: 255 }
            const offset = i * 4
            imageData.data[offset] = color.r
            imageData.data[offset + 1] = color.g
            imageData.data[offset + 2] = color.b
            imageData.data[offset + 3] = 255
          }
          ctx.putImageData(imageData, 0, 0)

          const blob = await new Promise(resolve => maskCanvas.toBlob(resolve, 'image/png'))
          triggerDownload(blob, `${baseName}_mask.png`)
          setStatusMsg('✓ Saved!')
          break
        }

        // ─── Mask as NPZ ───
        case 'mask-npz': {
          setStatusMsg('Building Mask NPZ...')
          const mask = maskRef?.current
          if (!mask) throw new Error('No annotation mask available')

          const { createNpyBuffer } = await import('../../lib/npzParser')
          const { default: JSZip } = await import('jszip')

          const zip = new JSZip()
          const maskNpy = createNpyBuffer(mask, [metadata.lines, metadata.samples], '|u1')
          zip.file('mask.npy', maskNpy)

          const blob = await zip.generateAsync({ type: 'blob' })
          triggerDownload(blob, `${baseName}_mask.npz`)
          setStatusMsg('✓ Saved!')
          break
        }

        // ─── Mask as Raw Binary ───
        case 'mask-raw': {
          setStatusMsg('Exporting raw mask binary...')
          const mask = maskRef?.current
          if (!mask) throw new Error('No annotation mask available')

          const blob = new Blob([mask.buffer], { type: 'application/octet-stream' })
          triggerDownload(blob, `${baseName}_mask.raw`)
          setStatusMsg('✓ Saved!')
          break
        }

        // ─── Full NPZ Archive ───
        case 'npz': {
          const worker = workerRef?.current
          if (!worker) throw new Error('Worker not available')

          setStatusMsg('Extracting BSQ datacube...')
          const msg = await new Promise((resolve, reject) => {
            const handler = (e) => {
              if (e.data.type === 'datacubeExport') {
                worker.removeEventListener('message', handler)
                resolve(e.data)
              } else if (e.data.type === 'error') {
                worker.removeEventListener('message', handler)
                reject(new Error(e.data.message))
              }
            }
            worker.addEventListener('message', handler)
            worker.postMessage({ type: 'exportDatacube' })

            setTimeout(() => {
              worker.removeEventListener('message', handler)
              reject(new Error('Export timed out'))
            }, 30000)
          })

          setStatusMsg('Building NPZ file...')
          const { default: JSZip } = await import('jszip')
          const zip = new JSZip()

          const { createNpyBuffer } = await import('../../lib/npzParser')

          const cubeNpy = createNpyBuffer(
            msg.data,
            [metadata.bands, metadata.lines, metadata.samples],
            '<f4'
          )
          zip.file('datacube.npy', cubeNpy)

          if (metadata.wavelengths) {
            const wlData = new Float32Array(metadata.wavelengths)
            const wlNpy = createNpyBuffer(wlData, [metadata.bands], '<f4')
            zip.file('wavelengths.npy', wlNpy)
          }

          const mask = maskRef?.current
          if (!excludeMasks && mask && mask.some(v => v > 0)) {
            const maskNpy = createNpyBuffer(mask, [metadata.lines, metadata.samples], '|u1')
            zip.file('mask.npy', maskNpy)
          }

          setStatusMsg('Compressing ZIP archive...')
          const blob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
          })

          triggerDownload(blob, `${baseName}_archive.npz`)
          setStatusMsg('✓ NPZ Saved!')
          break
        }
        // ─── Pixel-wise CSV ───
        case 'csv': {
          const worker = workerRef?.current
          if (!worker) throw new Error('Worker not available')

          setStatusMsg('Extracting BSQ datacube...')
          const msg = await new Promise((resolve, reject) => {
            const handler = (e) => {
              if (e.data.type === 'datacubeExport') {
                worker.removeEventListener('message', handler)
                resolve(e.data)
              } else if (e.data.type === 'error') {
                worker.removeEventListener('message', handler)
                reject(new Error(e.data.message))
              }
            }
            worker.addEventListener('message', handler)
            worker.postMessage({ type: 'exportDatacube' })
            setTimeout(() => {
              worker.removeEventListener('message', handler)
              reject(new Error('Export timed out'))
            }, 30000)
          })

          setStatusMsg('Formatting CSV data...')
          const { bands, lines, samples } = metadata
          const data = new Float32Array(msg.data)
          const mask = maskRef?.current
          
          await new Promise(r => setTimeout(r, 50))
          
          // Class id → name lookup (used for both CSV class formats)
          const classes = useAppStore.getState().classes
          const classNameById = {}
          classes.forEach(c => { classNameById[c.id] = c.name })
          const bgName = defaultClassName.trim()
          const nameFor = (id) => {
            if (id === 0) return bgName
            return classNameById[id] || `Class ${id}`
          }
          const csvEscape = (v) => {
            const s = String(v ?? '')
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
          }

          const header = ['Pixel_X', 'Pixel_Y']
          for (let b = 0; b < bands; b++) {
            const wl = metadata.wavelengths ? metadata.wavelengths[b] : `Band_${b+1}`
            header.push(wl)
          }
          // Only add Class if there is ANY mask drawn AND we are not excluding masks
          let hasMask = false
          if (!excludeMasks && mask) {
            for (let i = 0; i < mask.length; i++) {
              if (mask[i] > 0) {
                hasMask = true
                break
              }
            }
          }
          if (hasMask) {
            if (csvClassFormat === 'id-name') header.push('Class', 'Class_Name')
            else header.push('Class')
          }

          const chunks = []
          chunks.push(header.join(',') + '\n')
          
          const totalPixels = lines * samples
          const chunkSize = 10000
          
          for (let i = 0; i < totalPixels; i += chunkSize) {
            setStatusMsg(`Formatting CSV... ${Math.round((i / totalPixels) * 100)}%`)
            await new Promise(r => setTimeout(r, 0))
            
            let chunkStr = ''
            const end = Math.min(i + chunkSize, totalPixels)
            for (let p = i; p < end; p++) {
              const y = Math.floor(p / samples)
              const x = p % samples
              let rowStr = `${x},${y},`
              for (let b = 0; b < bands; b++) {
                 // BSQ index: b * (lines * samples) + p
                 rowStr += data[b * totalPixels + p]
                 if (b < bands - 1 || hasMask) rowStr += ','
              }
              if (hasMask) {
                 const id = mask[p] || 0
                 if (csvClassFormat === 'id') rowStr += id
                 else if (csvClassFormat === 'name') rowStr += csvEscape(nameFor(id) || String(id))
                 else rowStr += `${id},${csvEscape(nameFor(id))}`
              }
              chunkStr += rowStr + '\n'
            }
            chunks.push(chunkStr)
          }
          
          setStatusMsg('Saving CSV file...')
          const blob = new Blob(chunks, { type: 'text/csv' })
          triggerDownload(blob, `${baseName}.csv`)
          setStatusMsg('✓ Saved!')
          break
        }

        // ─── Full ENVI Archive ───
        case 'envi': {
          const worker = workerRef?.current
          if (!worker) throw new Error('Worker not available')

          setStatusMsg('Extracting BSQ datacube...')
          const msg = await new Promise((resolve, reject) => {
            const handler = (e) => {
              if (e.data.type === 'datacubeExport') {
                worker.removeEventListener('message', handler)
                resolve(e.data)
              } else if (e.data.type === 'error') {
                worker.removeEventListener('message', handler)
                reject(new Error(e.data.message))
              }
            }
            worker.addEventListener('message', handler)
            worker.postMessage({ type: 'exportDatacube' })
            setTimeout(() => {
              worker.removeEventListener('message', handler)
              reject(new Error('Export timed out'))
            }, 30000)
          })

          setStatusMsg('Building ENVI header...')
          let hdr = `ENVI
description = { Exported from HSI Studio }
samples = ${metadata.samples}
lines   = ${metadata.lines}
bands   = ${metadata.bands}
header offset = 0
file type = ENVI Standard
data type = 4
interleave = bsq
byte order = 0`

          if (metadata.wavelengths && metadata.wavelengths.length > 0) {
            const wlStr = metadata.wavelengths.map(w => typeof w === 'number' ? w.toFixed(2) : w).join(',\n ')
            hdr += `\nwavelength = {\n ${wlStr}\n}`
          }

          const hdrBlob = new Blob([hdr], { type: 'text/plain' })
          triggerDownload(hdrBlob, `${baseName}.hdr`)

          setStatusMsg('Downloading binary data...')
          const datBlob = new Blob([msg.data.buffer], { type: 'application/octet-stream' })
          triggerDownload(datBlob, `${baseName}.dat`)

          setStatusMsg('✓ ENVI Saved!')
          break
        }
      }
    } catch (err) {
      console.error(err)
      setStatusMsg(`✗ Error: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }, [selectedFormat, metadata, fileName, currentBand, canvasRef, excludeMasks, maskRef, triggerDownload, workerRef, csvClassFormat, defaultClassName])

  const selectedMeta = EXPORT_FORMATS.find(f => f.id === selectedFormat)
  const SelectedIcon = selectedMeta?.icon || Download
  const isError = statusMsg.startsWith('✗')
  const isSuccess = statusMsg.startsWith('✓')
  const cleanStatus = statusMsg.replace(/^[✓✗]\s*/, '')

  return (
    <div style={{
      width: '400px',
      background: 'var(--bg-secondary)',
      borderLeft: 'var(--border-subtle)',
      display: 'flex',
      flexDirection: 'column',
      padding: 'var(--space-lg)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
      overflowY: 'auto',
      animation: 'slideIn var(--transition-smooth) forwards',
    }}>
      {/* ─── Header ─── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-xl)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 'var(--radius-md)',
            background: 'var(--gradient-subtle)',
            border: 'var(--border-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-blue)',
            flexShrink: 0,
          }}>
            <Download size={20} />
          </div>
          <div>
            <h2 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Export</h2>
            <div style={{
              fontSize: 'var(--font-xs)',
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)',
              maxWidth: 240,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {fileName || 'datacube'}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close export panel"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: 6,
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all var(--transition-fast)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-secondary)' }}
        >
          <X size={18} />
        </button>
      </div>

      {/* ─── Format selector ─── */}
      <div style={{ marginBottom: 'var(--space-lg)' }}>
        <label style={{
          display: 'block',
          fontSize: 'var(--font-xs)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--text-tertiary)',
          marginBottom: 'var(--space-sm)',
        }}>
          Format
        </label>
        <select
          value={selectedFormat}
          onChange={e => {
            setSelectedFormat(e.target.value)
            setStatusMsg('')
          }}
          disabled={saving}
          style={{
            width: '100%',
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: 'var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-sm) var(--space-md)',
            fontSize: 'var(--font-sm)',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          <optgroup label="Project">
            {EXPORT_FORMATS.filter(f => f.group === 'Project').map(f => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </optgroup>
          <optgroup label="Full Datacube">
            {EXPORT_FORMATS.filter(f => f.group === 'Full Datacube').map(f => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </optgroup>
          <optgroup label="Image Export">
            {EXPORT_FORMATS.filter(f => f.group === 'Image Export').map(f => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </optgroup>
          <optgroup label="Mask Export">
            {EXPORT_FORMATS.filter(f => f.group === 'Mask Export').map(f => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </optgroup>
        </select>
      </div>

      {/* ─── Selected format description card ─── */}
      <div style={{
        display: 'flex',
        gap: 'var(--space-md)',
        background: 'var(--bg-tertiary)',
        border: 'var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-md)',
        marginBottom: 'var(--space-lg)',
      }}>
        <div style={{
          width: 36,
          height: 36,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--accent-blue-dim)',
          color: 'var(--accent-blue)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <SelectedIcon size={18} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-sm)', fontWeight: 600, marginBottom: 2 }}>
            {selectedMeta?.label}
          </div>
          <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            {selectedMeta?.desc}
          </div>
        </div>
      </div>

      {/* ─── Annotation toggle ─── */}
      {['npz', 'csv', 'png-view'].includes(selectedFormat) && (
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm)',
          cursor: 'pointer',
          background: 'var(--bg-tertiary)',
          border: 'var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-sm) var(--space-md)',
          marginBottom: 'var(--space-lg)',
        }}>
          <input
            type="checkbox"
            checked={excludeMasks}
            onChange={(e) => setExcludeMasks(e.target.checked)}
            style={{ accentColor: 'var(--accent-blue)', width: 14, height: 14, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 'var(--font-sm)' }}>Exclude annotations <span style={{ color: 'var(--text-tertiary)' }}>(raw data only)</span></span>
        </label>
      )}

      {/* ─── CSV class-column configuration ─── */}
      {selectedFormat === 'csv' && !excludeMasks && (
        <div style={{
          border: 'var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--space-lg)',
          overflow: 'hidden',
        }}>
          <button
            onClick={() => setShowCsvConfig(v => !v)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--bg-tertiary)',
              border: 'none',
              color: 'var(--text-primary)',
              padding: 'var(--space-sm) var(--space-md)',
              fontSize: 'var(--font-sm)',
              cursor: 'pointer',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
              <Settings2 size={14} style={{ color: 'var(--text-secondary)' }} />
              Configure class column
            </span>
            <ChevronDown
              size={16}
              style={{
                color: 'var(--text-secondary)',
                transform: showCsvConfig ? 'rotate(180deg)' : 'none',
                transition: 'transform var(--transition-fast)',
              }}
            />
          </button>

          {showCsvConfig && (
            <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {/* Format choice */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                {[
                  { id: 'id-name', label: 'Class id + name (recommended)', desc: 'Numeric "Class" column plus a "Class_Name" column. Re-imports cleanly.' },
                  { id: 'id', label: 'Class id only', desc: 'Single numeric "Class" column.' },
                  { id: 'name', label: 'Class name only', desc: 'Single "Class" column holding the class name.' },
                ].map(opt => {
                  const active = csvClassFormat === opt.id
                  return (
                    <label
                      key={opt.id}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 'var(--space-sm)',
                        cursor: 'pointer',
                        background: active ? 'var(--accent-blue-dim)' : 'var(--bg-tertiary)',
                        border: active ? 'var(--border-accent)' : 'var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        padding: 'var(--space-sm) var(--space-md)',
                      }}
                    >
                      <input
                        type="radio"
                        name="csvClassFormat"
                        checked={active}
                        onChange={() => setCsvClassFormat(opt.id)}
                        style={{ accentColor: 'var(--accent-blue)', marginTop: 2, cursor: 'pointer' }}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 'var(--font-sm)', fontWeight: 500 }}>{opt.label}</span>
                        <span style={{ display: 'block', fontSize: 'var(--font-xs)', color: 'var(--text-tertiary)' }}>{opt.desc}</span>
                      </span>
                    </label>
                  )
                })}
              </div>

              {/* Re-import warning for lossy formats */}
              {csvClassFormat !== 'id-name' && (
                <div style={{
                  display: 'flex',
                  gap: 'var(--space-sm)',
                  alignItems: 'flex-start',
                  background: 'rgba(255, 140, 66, 0.1)',
                  border: '1px solid var(--accent-orange)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--space-sm) var(--space-md)',
                  fontSize: 'var(--font-xs)',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                }}>
                  <AlertCircle size={14} style={{ color: 'var(--accent-orange)', flexShrink: 0, marginTop: 1 }} />
                  <span>
                    {csvClassFormat === 'id'
                      ? 'Class names are not stored, so re-importing restores the mask but class names will be generic.'
                      : 'Re-importing keeps the class names but assigns new ids, so the original class ids may differ.'}
                  </span>
                </div>
              )}

              {/* Optional default (background) class name */}
              <div>
                <label style={{
                  display: 'block',
                  fontSize: 'var(--font-xs)',
                  color: 'var(--text-secondary)',
                  marginBottom: 'var(--space-xs)',
                }}>
                  Default class name <span style={{ color: 'var(--text-tertiary)' }}>(optional, for class 0)</span>
                </label>
                <input
                  type="text"
                  value={defaultClassName}
                  onChange={e => setDefaultClassName(e.target.value)}
                  placeholder="e.g. Background"
                  style={{
                    width: '100%',
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    border: 'var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-sm) var(--space-md)',
                    fontSize: 'var(--font-sm)',
                    fontFamily: 'var(--font-sans)',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Status ─── */}
      {statusMsg && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm)',
          fontSize: 'var(--font-sm)',
          color: isSuccess ? 'var(--accent-teal)' : isError ? 'var(--accent-red)' : 'var(--text-secondary)',
          background: isSuccess ? 'var(--accent-teal-dim)' : isError ? 'var(--accent-red-dim)' : 'var(--bg-tertiary)',
          border: 'var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-sm) var(--space-md)',
          marginBottom: 'var(--space-md)',
        }}>
          {saving && <span className="spinner" style={{ width: 14, height: 14, flexShrink: 0 }} />}
          {isSuccess && <CheckCircle2 size={16} style={{ flexShrink: 0 }} />}
          {isError && <AlertCircle size={16} style={{ flexShrink: 0 }} />}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-xs)' }}>{cleanStatus}</span>
        </div>
      )}

      {/* ─── Action ─── */}
      <div style={{ marginTop: 'auto', paddingTop: 'var(--space-md)' }}>
        <button
          onClick={handleSave}
          disabled={saving || !metadata}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-sm)',
            background: saving || !metadata ? 'var(--bg-tertiary)' : 'var(--gradient-primary)',
            color: saving || !metadata ? 'var(--text-secondary)' : 'white',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-md)',
            fontSize: 'var(--font-sm)',
            fontWeight: 600,
            cursor: saving || !metadata ? 'not-allowed' : 'pointer',
            boxShadow: saving || !metadata ? 'none' : '0 2px 12px var(--accent-blue-glow)',
            transition: 'all var(--transition-normal)',
          }}
          onMouseEnter={e => { if (!(saving || !metadata)) { e.currentTarget.style.boxShadow = '0 4px 20px var(--accent-blue-glow)'; e.currentTarget.style.transform = 'translateY(-1px)' } }}
          onMouseLeave={e => { e.currentTarget.style.boxShadow = saving || !metadata ? 'none' : '0 2px 12px var(--accent-blue-glow)'; e.currentTarget.style.transform = 'translateY(0)' }}
        >
          {saving
            ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Exporting…</>
            : <><Download size={16} /> Export File</>}
        </button>
      </div>
    </div>
  )
}
