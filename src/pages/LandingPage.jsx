import { useState, useCallback, useRef } from 'react'
import useAppStore from '../stores/useAppStore'
import { parseHeader } from '../lib/enviParser'

export default function LandingPage({ datacubeRef, workerRef, onFormatDetected }) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState('')
  const [error, setError] = useState(null)
  // When a partial ENVI pair is supplied we hold what we have and prompt for
  // the rest: { kind: 'data' | 'hdr', name } — see processFiles below.
  const [needMore, setNeedMore] = useState(null)
  const fileInputRef = useRef(null)
  // Files supplied so far across multiple drops/clicks (for the ENVI .hdr+data
  // pair, where the user may add the two files in separate steps).
  const accumulatedFilesRef = useRef([])
  const setFileLoaded = useAppStore(s => s.setFileLoaded)

  // Extensions we treat as the raw binary half of an ENVI pair.
  const DATA_EXT = /\.(dat|raw|img|bil|bip|bsq)$/i

  /** Locate the binary data file that pairs with a given .hdr. */
  const findDataFile = (hdrFile, allFiles) => {
    const baseName = hdrFile.name.replace(/\.hdr$/i, '')
    const dataExtensions = ['.dat', '.raw', '.img', '.bil', '.bip', '.bsq', '']
    for (const ext of dataExtensions) {
      const target = (baseName + ext).toLowerCase()
      const match = allFiles.find(f => f.name.toLowerCase() === target)
      if (match) return match
    }
    // Fall back to any companion file that isn't itself a recognised format.
    return allFiles.find(f => {
      const n = f.name.toLowerCase()
      return !n.endsWith('.hdr') && !n.endsWith('.npz') &&
             !n.endsWith('.csv') && !n.endsWith('.tif') && !n.endsWith('.tiff')
    }) || null
  }

  const startOver = useCallback(() => {
    accumulatedFilesRef.current = []
    setNeedMore(null)
    setError(null)
    setIsLoading(false)
  }, [])

  const processFiles = useCallback(async (files) => {
    setError(null)

    // Merge newly supplied files with anything we're still waiting to complete.
    const fileArray = [...accumulatedFilesRef.current, ...Array.from(files)]
    accumulatedFilesRef.current = fileArray

    const has = (re) => fileArray.find(f => re.test(f.name))
    const hdrFile = has(/\.hdr$/i)
    const npzFile = has(/\.npz$/i)
    const csvFile = has(/\.csv$/i)
    const tiffFile = has(/\.tiff?$/i)
    const dataFile = has(DATA_EXT)

    setIsLoading(true)
    try {
      if (hdrFile) {
        // ENVI: need the matching binary data file too.
        const data = findDataFile(hdrFile, fileArray)
        if (!data) {
          setNeedMore({ kind: 'data', name: hdrFile.name })
          setIsLoading(false)
          return
        }
        setNeedMore(null)
        onFormatDetected?.('envi')
        await loadENVI(hdrFile, data)
        accumulatedFilesRef.current = []
      } else if (dataFile) {
        // Raw binary without a header — we can't interpret it. Ask for the .hdr.
        setNeedMore({ kind: 'hdr', name: dataFile.name })
        setIsLoading(false)
        return
      } else if (npzFile) {
        onFormatDetected?.('npz')
        await loadNPZ(npzFile)
        accumulatedFilesRef.current = []
      } else if (csvFile) {
        onFormatDetected?.('csv')
        await loadCSV(csvFile)
        accumulatedFilesRef.current = []
      } else if (tiffFile) {
        onFormatDetected?.('tiff')
        await loadTIFF(tiffFile)
        accumulatedFilesRef.current = []
      } else {
        accumulatedFilesRef.current = []
        throw new Error('Unsupported format. Upload ENVI (.hdr + data), NumPy (.npz), TIFF (.tif/.tiff), or CSV (.csv).')
      }
    } catch (err) {
      console.error('File load error:', err)
      setError(err.message)
      setIsLoading(false)
      setNeedMore(null)
      accumulatedFilesRef.current = []
    }
  }, [])

  const loadENVI = async (hdrFile, dataFile) => {
    setLoadingStatus('Parsing header file...')
    const hdrText = await hdrFile.text()
    const rawHeader = parseHeader(hdrText)

    // Normalize ENVI header keys to the metadata format the app expects
    const dataType = rawHeader['data type'] || 4
    const dtInfo = { 1: 1, 2: 2, 3: 4, 4: 4, 5: 8, 12: 2, 13: 4, 14: 8, 15: 8 }

    const metadata = {
      samples: rawHeader.samples,
      lines: rawHeader.lines,
      bands: rawHeader.bands,
      dataType: dataType,
      dataTypeSize: dtInfo[dataType] || 4,
      interleave: (rawHeader.interleave || 'BSQ').toLowerCase(),
      byteOrder: rawHeader['byte order'] || 0,
      wavelengths: rawHeader.wavelength || null,
      headerOffset: rawHeader['header offset'] || 0,
    }

    if (!metadata.samples || !metadata.lines || !metadata.bands) {
      throw new Error('Invalid ENVI header: missing samples, lines, or bands.')
    }

    setLoadingStatus(`Loading datacube (${dataFile.name})...`)
    const buffer = await dataFile.arrayBuffer()

    // Validate file size
    const bytesPerPixel = metadata.dataTypeSize || 4
    const expectedSize = metadata.samples * metadata.lines * metadata.bands * bytesPerPixel
    if (buffer.byteLength < expectedSize) {
      throw new Error(
        `Data file too small. Expected ${(expectedSize / 1024 / 1024).toFixed(1)} MB but got ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB.`
      )
    }

    setLoadingStatus('Initializing worker...')
    await initWorker(buffer, metadata, hdrFile.name.replace(/\.hdr$/i, ''))
  }

  const loadNPZ = async (npzFile) => {
    setLoadingStatus('Loading NPZ archive...')
    const { parseNpz } = await import('../lib/npzParser')
    const buffer = await npzFile.arrayBuffer()
    const arrays = await parseNpz(buffer)

    // Find the datacube array (look for common keys)
    const cubeKeys = ['datacube', 'image', 'data', 'cube', 'X', 'x']
    let cubeKey = cubeKeys.find(k => arrays[k])
    
    // If not found, use the first 3D array
    if (!cubeKey) {
      cubeKey = Object.keys(arrays).find(k => arrays[k].shape.length === 3)
    }
    
    if (!cubeKey) {
      throw new Error('Could not find a 3D datacube array in the NPZ file. Found keys: ' + Object.keys(arrays).join(', '))
    }

    const cube = arrays[cubeKey]
    const [lines, samples, bands] = cube.shape

    // Look for wavelengths array
    const wlKeys = ['wavelengths', 'wavelength', 'wl', 'wvl', 'lambda']
    const wlKey = wlKeys.find(k => arrays[k])
    const wavelengths = wlKey ? Array.from(arrays[wlKey].data) : null

    // Look for mask
    const maskKeys = ['mask', 'labels', 'gt', 'ground_truth', 'annotation']
    const maskKey = maskKeys.find(k => arrays[k])

    const metadata = {
      samples,
      lines,
      bands,
      dataType: 4, // float32
      dataTypeSize: 4,
      interleave: 'bip', // numpy default: [H, W, B] = BIP
      byteOrder: 0, // little endian
      wavelengths,
      hasMask: !!maskKey,
      maskKey,
    }

    // Convert to Float32Array if needed
    let dataBuffer
    if (cube.data instanceof Float32Array) {
      dataBuffer = cube.data.buffer
    } else {
      const float32 = new Float32Array(cube.data.length)
      for (let i = 0; i < cube.data.length; i++) {
        float32[i] = cube.data[i]
      }
      dataBuffer = float32.buffer
    }

    setLoadingStatus('Initializing worker...')
    await initWorker(dataBuffer, metadata, npzFile.name.replace(/\.npz$/i, ''))
  }

  const loadCSV = async (csvFile) => {
    setLoadingStatus('Parsing CSV...')
    const text = await csvFile.text()
    const { parseCsv } = await import('../lib/csvParser')
    const { datacube, metadata } = parseCsv(text)
    setLoadingStatus('Initializing worker...')
    await initWorker(datacube.buffer, metadata, csvFile.name.replace(/\.csv$/i, ''))
  }

  const loadTIFF = async (tiffFile) => {
    setLoadingStatus('Decoding TIFF...')
    const { parseTiff } = await import('../lib/tiffParser')
    const buffer = await tiffFile.arrayBuffer()
    const { datacube, metadata } = parseTiff(buffer)
    setLoadingStatus('Initializing worker...')
    await initWorker(datacube.buffer, metadata, tiffFile.name.replace(/\.tiff?$/i, ''))
  }

  const initWorker = async (buffer, metadata, fileName) => {
    // Create web worker
    const worker = new Worker(
      new URL('../workers/datacubeWorker.js', import.meta.url),
      { type: 'module' }
    )

    workerRef.current = worker
    datacubeRef.current = buffer

    return new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        if (e.data.type === 'ready') {
          setIsLoading(false)
          setFileLoaded(fileName, metadata)
          resolve()
        } else if (e.data.type === 'error') {
          reject(new Error(e.data.message))
        }
      }

      worker.onerror = (err) => {
        reject(new Error('Worker initialization failed: ' + err.message))
      }

      // Send datacube to worker
      worker.postMessage(
        { type: 'loadData', buffer, metadata },
        [buffer]
      )
    })
  }

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files)
    }
  }, [processFiles])

  const handleClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback((e) => {
    if (e.target.files.length > 0) {
      processFiles(e.target.files)
    }
  }, [processFiles])

  return (
    <div className="landing-page">
      <div className="landing-content animate-slide-up">
        <h1 className="landing-title">HSI Studio</h1>
        <p className="landing-subtitle">
          View, analyze, and annotate hyperspectral images directly in your browser.
          No installation required. Your data stays on your machine.
        </p>

        {error && (
          <div style={{
            background: 'var(--accent-red-dim)',
            border: '1px solid rgba(255, 71, 87, 0.3)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-md) var(--space-lg)',
            marginBottom: 'var(--space-xl)',
            color: 'var(--accent-red)',
            fontSize: 'var(--font-sm)',
            textAlign: 'left',
          }}>
            ⚠️ {error}
          </div>
        )}

        <div
          className={`dropzone ${isDragOver ? 'drag-over' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleClick}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".hdr,.dat,.raw,.img,.bil,.bip,.bsq,.npz,.csv,.tif,.tiff"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />

          {isLoading ? (
            <>
              <div className="spinner" style={{ margin: '0 auto var(--space-lg)' }}></div>
              <div className="dropzone-text">{loadingStatus}</div>
              <div className="dropzone-hint">This may take a moment for large files</div>
            </>
          ) : needMore ? (
            <>
              <div className="dropzone-icon">📂</div>
              <div className="dropzone-text">
                {needMore.kind === 'data'
                  ? `Got the header "${needMore.name}". Now add its data file.`
                  : `Got the data file "${needMore.name}". Now add its .hdr header.`}
              </div>
              <div className="dropzone-hint">
                {needMore.kind === 'data'
                  ? 'Drop or click to add the matching .dat / .raw / .img / .bil / .bip / .bsq file.'
                  : 'Drop or click to add the matching .hdr file so the data can be interpreted.'}
              </div>
              <div style={{ marginTop: 'var(--space-md)' }}>
                <span
                  className="format-badge"
                  role="button"
                  onClick={(e) => { e.stopPropagation(); startOver() }}
                  style={{ cursor: 'pointer' }}
                >
                  ✕ Start over
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="dropzone-icon">📡</div>
              <div className="dropzone-text">
                Drop your hyperspectral data here, or click to browse
              </div>
              <div className="dropzone-hint">
                Upload the .hdr header + data file together, or a single .npz / .tif / .csv file
              </div>
              <div className="dropzone-formats">
                <span className="format-badge">ENVI .hdr</span>
                <span className="format-badge">.dat / .raw</span>
                <span className="format-badge">.npz</span>
                <span className="format-badge">TIFF</span>
                <span className="format-badge">CSV (beta)</span>
                <span className="format-badge">BIL / BIP / BSQ</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
