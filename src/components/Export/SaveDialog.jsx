import { useState, useCallback, useRef, useEffect } from 'react'
import useAppStore from '../../stores/useAppStore'

/**
 * SaveDialog — modal dialog for exporting/saving the current datacube + annotation mask.
 *
 * Supports:
 *  - NPZ: saves datacube array + mask + wavelengths as .npz
 *  - ENVI: saves .hdr + .dat pair
 *  - PNG (current view): screenshot of the currently rendered band
 *  - Mask Only (PNG): exports just the annotation mask
 *  - Mask Only (NPZ): exports mask as numpy array
 *
 * Props:
 *  - isOpen: boolean
 *  - onClose: () => void
 *  - workerRef: ref to the web worker
 *  - canvasRef: ref to the WebGL canvas (for screenshot)
 *  - maskRef: ref to the annotation mask Uint8Array
 *  - inputFormat: 'envi' | 'npz' — detected from the loaded file
 */

const EXPORT_FORMATS = [
  { id: 'npz',       label: 'NumPy Archive (.npz)',      group: 'Full Datacube' },
  { id: 'envi',      label: 'ENVI (.hdr + .dat)',        group: 'Full Datacube' },
  { id: 'png-view',  label: 'Current View (PNG)',        group: 'Image Export' },
  { id: 'mask-png',  label: 'Annotation Mask (PNG)',     group: 'Mask Export' },
  { id: 'mask-npz',  label: 'Annotation Mask (NPZ)',     group: 'Mask Export' },
  { id: 'mask-raw',  label: 'Annotation Mask (Raw Binary)', group: 'Mask Export' },
]

export default function SaveDialog({ isOpen, onClose, workerRef, canvasRef, maskRef, inputFormat }) {
  const metadata = useAppStore(s => s.metadata)
  const fileName = useAppStore(s => s.fileName)
  const currentBand = useAppStore(s => s.currentBand)

  const [selectedFormat, setSelectedFormat] = useState(inputFormat || 'npz')
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const dialogRef = useRef(null)

  // Default to the input format when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedFormat(inputFormat || 'npz')
      setStatusMsg('')
      setSaving(false)
    }
  }, [isOpen, inputFormat])

  // Close on Escape
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape' && isOpen) onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  // Close on backdrop click
  const handleBackdropClick = useCallback((e) => {
    if (e.target === dialogRef.current) onClose()
  }, [onClose])

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

          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
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

          for (let i = 0; i < mask.length; i++) {
            const v = mask[i]
            const idx = i * 4
            imageData.data[idx] = v       // R
            imageData.data[idx + 1] = v   // G
            imageData.data[idx + 2] = v   // B
            imageData.data[idx + 3] = 255 // A
          }
          ctx.putImageData(imageData, 0, 0)

          const blob = await new Promise(resolve => maskCanvas.toBlob(resolve, 'image/png'))
          triggerDownload(blob, `${baseName}_mask.png`)
          setStatusMsg('✓ Saved!')
          break
        }

        // ─── Mask as Raw Binary ───
        case 'mask-raw': {
          setStatusMsg('Exporting mask as raw binary...')
          const mask = maskRef?.current
          if (!mask) throw new Error('No annotation mask available')

          const blob = new Blob([mask.buffer], { type: 'application/octet-stream' })
          triggerDownload(blob, `${baseName}_mask_${metadata.samples}x${metadata.lines}.raw`)
          setStatusMsg('✓ Saved!')
          break
        }

        // ─── Mask as NPZ ───
        case 'mask-npz': {
          setStatusMsg('Exporting mask as NPZ...')
          const mask = maskRef?.current
          if (!mask) throw new Error('No annotation mask available')

          const { default: JSZip } = await import('jszip')
          const zip = new JSZip()

          // Create .npy file for the mask
          const npyBuffer = createNpyBuffer(mask, [metadata.lines, metadata.samples], '|u1')
          zip.file('mask.npy', npyBuffer)

          const content = await zip.generateAsync({ type: 'blob' })
          triggerDownload(content, `${baseName}_mask.npz`)
          setStatusMsg('✓ Saved!')
          break
        }

        // ─── Full datacube as NPZ ───
        case 'npz': {
          setStatusMsg('Preparing full datacube export — this may take a moment...')
          // We need to get the datacube data from the worker
          const worker = workerRef?.current
          if (!worker) throw new Error('Worker not available')

          // Ask worker to send back the datacube
          const datacubeData = await new Promise((resolve, reject) => {
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

            // Timeout after 30 seconds
            setTimeout(() => {
              worker.removeEventListener('message', handler)
              reject(new Error('Export timed out'))
            }, 30000)
          })

          setStatusMsg('Building NPZ file...')
          const { default: JSZip } = await import('jszip')
          const zip = new JSZip()

          // Datacube array (shape: [bands, lines, samples] since worker now exports BSQ)
          const cubeNpy = createNpyBuffer(
            datacubeData.data,
            [metadata.bands, metadata.lines, metadata.samples],
            '<f4'
          )
          zip.file('datacube.npy', cubeNpy)

          // Wavelengths array (if available)
          if (metadata.wavelengths) {
            const wlData = new Float32Array(metadata.wavelengths)
            const wlNpy = createNpyBuffer(wlData, [metadata.bands], '<f4')
            zip.file('wavelengths.npy', wlNpy)
          }

          // Annotation mask (if anything painted)
          const mask = maskRef?.current
          if (mask && mask.some(v => v > 0)) {
            const maskNpy = createNpyBuffer(mask, [metadata.lines, metadata.samples], '|u1')
            zip.file('mask.npy', maskNpy)
          }

          setStatusMsg('Compressing...')
          const content = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 5 },
          })
          triggerDownload(content, `${baseName}.npz`)
          setStatusMsg('✓ Saved!')
          break
        }

        // ─── Full datacube as ENVI ───
        case 'envi': {
          setStatusMsg('Preparing ENVI export — this may take a moment...')
          const worker = workerRef?.current
          if (!worker) throw new Error('Worker not available')

          const datacubeData = await new Promise((resolve, reject) => {
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

          setStatusMsg('Writing ENVI header...')
          // Generate .hdr file content
          const hdrContent = generateENVIHeader(metadata)
          const hdrBlob = new Blob([hdrContent], { type: 'text/plain' })
          triggerDownload(hdrBlob, `${baseName}.hdr`)

          setStatusMsg('Writing datacube binary...')
          // The binary is the raw Float32Array
          const datBlob = new Blob([datacubeData.data.buffer], { type: 'application/octet-stream' })
          triggerDownload(datBlob, `${baseName}.dat`)

          // Also save mask if painted
          const mask = maskRef?.current
          if (mask && mask.some(v => v > 0)) {
            const maskBlob = new Blob([mask.buffer], { type: 'application/octet-stream' })
            triggerDownload(maskBlob, `${baseName}_mask.raw`)
          }

          setStatusMsg('✓ Saved!')
          break
        }

        default:
          throw new Error(`Unknown format: ${selectedFormat}`)
      }
    } catch (err) {
      console.error('Save error:', err)
      setStatusMsg(`✗ Error: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }, [selectedFormat, metadata, fileName, currentBand, canvasRef, maskRef, workerRef, triggerDownload])

  if (!isOpen) return null

  // Group formats for the select dropdown
  const defaultLabel = inputFormat === 'envi' ? 'ENVI (.hdr + .dat)' : 'NumPy Archive (.npz)'

  return (
    <div
      ref={dialogRef}
      className="dialog-backdrop"
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        className="glass"
        style={{
          width: '440px',
          maxWidth: '90vw',
          padding: 'var(--space-xl)',
          borderRadius: 'var(--radius-lg)',
          animation: 'slideUp 0.25s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{
          margin: '0 0 var(--space-lg)',
          fontSize: 'var(--font-lg)',
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}>
          Save / Export
        </h2>

        <div style={{ marginBottom: 'var(--space-md)' }}>
          <label style={{
            display: 'block',
            fontSize: 'var(--font-sm)',
            color: 'var(--text-secondary)',
            marginBottom: 'var(--space-xs)',
          }}>
            Export Format
            {inputFormat && (
              <span style={{ color: 'var(--text-tertiary)', marginLeft: 'var(--space-sm)' }}>
                (input: {defaultLabel})
              </span>
            )}
          </label>
          <select
            value={selectedFormat}
            onChange={(e) => setSelectedFormat(e.target.value)}
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
          }}>
            {statusMsg}
          </div>
        )}

        {/* Actions */}
        <div style={{
          display: 'flex',
          gap: 'var(--space-sm)',
          justifyContent: 'flex-end',
        }}>
          <button
            className="toolbar-btn toolbar-btn-text"
            onClick={onClose}
            disabled={saving}
            style={{ padding: 'var(--space-sm) var(--space-lg)' }}
          >
            Cancel
          </button>
          <button
            className="toolbar-btn toolbar-btn-text active"
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: 'var(--space-sm) var(--space-lg)',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Helper: Create a .npy binary buffer
// ────────────────────────────────────────────────────────────────────────────
function createNpyBuffer(data, shape, dtype) {
  // .npy format: magic + version + header length + header + data
  const header = `{'descr': '${dtype}', 'fortran_order': False, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}), }`
  
  // Pad header to be aligned to 64 bytes (including magic + version + header-len)
  const preludeLen = 10 // magic(6) + version(2) + header_len(2)
  const totalHeaderLen = preludeLen + header.length + 1 // +1 for newline
  const padded = Math.ceil(totalHeaderLen / 64) * 64
  const paddingLen = padded - preludeLen - header.length - 1
  const paddedHeader = header + ' '.repeat(paddingLen) + '\n'

  const headerBytes = new TextEncoder().encode(paddedHeader)
  const dataBytes = data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)

  const totalLen = preludeLen + headerBytes.length + dataBytes.length
  const buffer = new ArrayBuffer(totalLen)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  // Magic: \x93NUMPY
  bytes[0] = 0x93
  bytes[1] = 0x4E // N
  bytes[2] = 0x55 // U
  bytes[3] = 0x4D // M
  bytes[4] = 0x50 // P
  bytes[5] = 0x59 // Y
  // Version 1.0
  bytes[6] = 0x01
  bytes[7] = 0x00
  // Header length (little-endian uint16)
  view.setUint16(8, headerBytes.length, true)
  // Header string
  bytes.set(headerBytes, 10)
  // Data
  bytes.set(dataBytes, 10 + headerBytes.length)

  return buffer
}

// ────────────────────────────────────────────────────────────────────────────
// Helper: Generate ENVI .hdr file content
// ────────────────────────────────────────────────────────────────────────────
function generateENVIHeader(metadata) {
  const lines = [
    'ENVI',
    `samples = ${metadata.samples}`,
    `lines   = ${metadata.lines}`,
    `bands   = ${metadata.bands}`,
    `header offset = 0`,
    `data type = 4`,
    `interleave = bip`,
    `byte order = 0`,
  ]

  if (metadata.wavelengths && metadata.wavelengths.length > 0) {
    const wlStr = metadata.wavelengths.map(w => typeof w === 'number' ? w.toFixed(2) : w).join(',\n ')
    lines.push(`wavelength = {\n ${wlStr}}`)
  }

  return lines.join('\n') + '\n'
}
