import { useState, useCallback, useEffect } from 'react'
import { X, Archive, Database, FileSpreadsheet, Image as ImageIcon, PaintBucket, Layers, FileBox, CheckCircle2 } from 'lucide-react'
import useAppStore from '../../stores/useAppStore'

const EXPORT_FORMATS = [
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
            header.push('Class')
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
                 rowStr += mask[p] || 0
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
  }, [selectedFormat, metadata, fileName, currentBand, canvasRef, excludeMasks, maskRef, triggerDownload, workerRef])

  return (
    <div style={{
      width: '400px',
      background: 'var(--bg-secondary)',
      borderLeft: 'var(--border-default)',
      display: 'flex',
      flexDirection: 'column',
      padding: 'var(--space-md)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
      overflowY: 'auto'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
        <h2 style={{ fontSize: 'var(--font-lg)', fontWeight: 600, margin: 0 }}>Export</h2>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            fontSize: 'var(--font-xl)',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >
          <X size={20} />
        </button>
      </div>

      <div style={{ marginBottom: 'var(--space-md)' }}>
        <label style={{ display: 'block', fontSize: 'var(--font-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-xs)' }}>
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
            cursor: 'pointer',
          }}
        >
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

      {['npz', 'csv', 'png-view'].includes(selectedFormat) && (
        <div style={{ marginBottom: 'var(--space-md)', padding: 'var(--space-sm) 0' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={excludeMasks} 
              onChange={(e) => setExcludeMasks(e.target.checked)}
              style={{ accentColor: 'var(--accent-blue)' }}
            />
            <span style={{ fontSize: 'var(--font-sm)' }}>Exclude annotations (Export raw data only)</span>
          </label>
        </div>
      )}

      {/* Format description */}
      <div style={{
        fontSize: 'var(--font-xs)',
        color: 'var(--text-tertiary)',
        background: 'var(--bg-tertiary)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--space-sm) var(--space-md)',
        marginBottom: 'var(--space-lg)',
        lineHeight: 1.5,
      }}>
        {selectedFormat === 'npz' && '💾 Saves the full datacube, wavelengths, and annotation mask as a compressed NumPy archive. Compatible with Python/NumPy.'}
        {selectedFormat === 'envi' && '💾 Saves as ENVI format (.hdr header + .dat binary). Standard format for ENVI, MATLAB, and many remote sensing tools.'}
        {selectedFormat === 'csv' && '📄 Exports all pixels + bands to a CSV file. Adds a "Class" column if annotations are present.'}
        {selectedFormat === 'png-view' && '🖼️ Saves a screenshot of the currently displayed band/composite view as a PNG image.'}
        {selectedFormat === 'mask-png' && '🎭 Exports only the annotation mask as a grayscale PNG (white = annotated, black = background).'}
        {selectedFormat === 'mask-npz' && '🎭 Exports only the annotation mask as a NumPy array inside a .npz file.'}
        {selectedFormat === 'mask-raw' && '🎭 Exports the raw annotation mask as a flat binary file (uint8, row-major).'}
      </div>

      {/* Status */}
      {statusMsg && (
        <div style={{
          fontSize: 'var(--font-sm)',
          color: statusMsg.startsWith('✓') ? 'var(--accent-green)' :
                 statusMsg.startsWith('✗') ? 'var(--accent-red)' :
                 'var(--accent-teal)',
          marginBottom: 'var(--space-md)',
          fontFamily: 'var(--font-mono)',
        }} dangerouslySetInnerHTML={{ __html: statusMsg.replace(/\n/g, '<br/>') }} />
      )}

      {/* Actions */}
      <div style={{ marginTop: 'auto', display: 'flex', gap: 'var(--space-sm)' }}>
        <button
          onClick={handleSave}
          disabled={saving || !metadata}
          style={{
            flex: 1,
            background: saving ? 'var(--bg-tertiary)' : 'var(--accent-blue)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-sm) var(--space-md)',
            fontWeight: 600,
            cursor: saving || !metadata ? 'not-allowed' : 'pointer',
            opacity: saving || !metadata ? 0.7 : 1,
          }}
        >
          {saving ? 'Exporting...' : 'Export File'}
        </button>
      </div>
    </div>
  )
}
