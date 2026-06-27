import { useState, useCallback, useRef } from 'react'
import { AlertTriangle, FolderUp, UploadCloud, X } from 'lucide-react'
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
    const hdrFiles = fileArray.filter(f => /\.hdr$/i.test(f.name))
    const npzFiles = fileArray.filter(f => /\.npz$/i.test(f.name))
    const csvFile = has(/\.csv$/i)
    const tiffFile = has(/\.tiff?$/i)

    setIsLoading(true)

    try {
      if (hdrFiles.length > 0) {
        onFormatDetected?.('envi')
        
        // Find matching data files for all HDRs
        const validPairs = []
        for (const hdr of hdrFiles) {
          const dataFile = findDataFile(hdr, fileArray)
          if (dataFile) {
            validPairs.push({ hdr, dataFile })
          } else {
            // Need more files
            setNeedMore({ kind: 'data', name: hdr.name })
            setIsLoading(false)
            return
          }
        }

        setNeedMore(null)
        const series = []
        for (const pair of validPairs) {
          series.push(await loadENVI(pair.hdr, pair.dataFile))
        }
        await initWorkerTimeSeries(series)
        accumulatedFilesRef.current = []

      } else if (has(DATA_EXT) && hdrFiles.length === 0) {
        // Raw binary without a header — we can't interpret it. Ask for the .hdr.
        setNeedMore({ kind: 'hdr', name: has(DATA_EXT).name })
        setIsLoading(false)
        return
      } else if (npzFiles.length > 0) {
        onFormatDetected?.('npz')
        const series = []
        for (const npz of npzFiles) {
          series.push(await loadNPZ(npz))
        }
        await initWorkerTimeSeries(series)
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
      console.error(err)
      setError(err.message)
      setIsLoading(false)
      alert('Error parsing file: ' + err.message)
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

    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          const buffer = e.target.result
          
          // Validate file size
          const bytesPerPixel = metadata.dataTypeSize || 4
          const expectedSize = metadata.samples * metadata.lines * metadata.bands * bytesPerPixel
          if (buffer.byteLength < expectedSize) {
            throw new Error(`Data file too small. Expected ${(expectedSize / 1024 / 1024).toFixed(1)} MB.`)
          }

          // Use enviParser helpers to map to Float32Array and handle endianness
          const { getDataTypeInfo } = await import('../lib/enviParser')
          const typeInfo = getDataTypeInfo(metadata.dataType)
          if (!typeInfo) throw new Error(`Unsupported ENVI data type: ${metadata.dataType}`)

          const { constructor: TypedCtor, bytes: bpe } = typeInfo
          const isBigInt = (TypedCtor === BigInt64Array || TypedCtor === BigUint64Array)
          
          // Check endianness
          const platformIsLE = new Uint8Array(new Uint16Array([0x0102]).buffer)[0] === 0x02
          const fileIsLE = metadata.byteOrder === 0
          const swap = platformIsLE !== fileIsLE
          
          const totalPixels = metadata.samples * metadata.lines * metadata.bands
          const offset = metadata.headerOffset || 0
          const rawSlice = buffer.slice(offset, offset + totalPixels * bpe)
          const typed = new TypedCtor(rawSlice)
          
          // Byte swap if necessary
          if (swap && bpe > 1) {
            const raw = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength)
            for (let i = 0; i < raw.length; i += bpe) {
              for (let lo = 0, hi = bpe - 1; lo < hi; lo++, hi--) {
                const tmp = raw[i + lo]
                raw[i + lo] = raw[i + hi]
                raw[i + hi] = tmp
              }
            }
          }
          
          // Convert to Float32Array
          const floatData = new Float32Array(totalPixels)
          for (let i = 0; i < totalPixels; i++) {
            floatData[i] = isBigInt ? Number(typed[i]) : typed[i]
          }
          
          // Update metadata so the worker knows we've converted it
          metadata.dataType = 4
          metadata.dataTypeSize = 4
          metadata.byteOrder = platformIsLE ? 0 : 1
          metadata.headerOffset = 0

          resolve({ buffer: floatData.buffer, metadata, fileName: hdrFile.name.replace(/\.hdr$/i, '') })
        } catch (err) {
          reject(err)
        }
      }
      reader.onerror = () => reject(new Error('Failed to read data file'))
      reader.readAsArrayBuffer(dataFile)
    })
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
    
    // Look for wavelengths array first so we can use its length to detect shape
    const wlKeys = ['wavelengths', 'wavelength', 'wl', 'wvl', 'lambda']
    const wlKey = wlKeys.find(k => arrays[k])
    const wavelengths = wlKey ? Array.from(arrays[wlKey].data) : null

    let lines, samples, bands, shapeOrder;
    const numBands = wavelengths ? wavelengths.length : -1;

    if (cube.shape[0] === numBands || (!wavelengths && cube.shape[0] <= cube.shape[1] && cube.shape[0] <= cube.shape[2])) {
      // (B, H, W)
      bands = cube.shape[0]
      lines = cube.shape[1]
      samples = cube.shape[2]
      shapeOrder = 'BHW'
    } else {
      // (H, W, B)
      lines = cube.shape[0]
      samples = cube.shape[1]
      bands = cube.shape[2]
      shapeOrder = 'HWB'
    }

    // Look for mask
    const maskKeys = ['mask', 'labels', 'gt', 'ground_truth', 'annotation', 'binary_mapped_mask', 'binary_mask', 'segmentation', 'seg']
    const maskKey = maskKeys.find(k => arrays[k])

    const metadata = {
      samples,
      lines,
      bands,
      dataType: 4, // float32
      dataTypeSize: 4,
      interleave: 'numpy', // Custom flag
      shapeOrder,
      fortranOrder: cube.fortranOrder,


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

    let maskBuffer = null
    if (maskKey && arrays[maskKey]) {
      const maskArray = arrays[maskKey].data
      maskBuffer = new Uint8Array(maskArray.length)
      for (let i = 0; i < maskArray.length; i++) {
        maskBuffer[i] = maskArray[i] > 0 ? 255 : 0
      }
    }

    return { buffer: dataBuffer, metadata, maskBuffer, fileName: npzFile.name.replace(/\.npz$/i, '') }
  }

  const loadCSV = async (csvFile) => {
    setLoadingStatus('Parsing CSV...')
    const text = await csvFile.text()
    const { parseCsv } = await import('../lib/csvParser')
    const { datacube, metadata } = parseCsv(text)
    const series = [{ buffer: datacube.buffer, metadata, fileName: csvFile.name.replace(/\.csv$/i, '') }]
    await initWorkerTimeSeries(series)
  }

  const loadTIFF = async (tiffFile) => {
    setLoadingStatus('Decoding TIFF...')
    const { parseTiff } = await import('../lib/tiffParser')
    const buffer = await tiffFile.arrayBuffer()
    const { datacube, metadata } = parseTiff(buffer)
    const series = [{ buffer: datacube.buffer, metadata, fileName: tiffFile.name.replace(/\.tiff?$/i, '') }]
    await initWorkerTimeSeries(series)
  }

  const initWorkerTimeSeries = async (series) => {
    // Sort series alphabetically by filename
    series.sort((a, b) => a.fileName.localeCompare(b.fileName))

    setLoadingStatus('Initializing worker...')

    // Create web worker
    const worker = new Worker(
      new URL('../workers/datacubeWorker.js', import.meta.url),
      { type: 'module' }
    )

    workerRef.current = worker
    datacubeRef.current = series[0].buffer // Store first frame buffer for backward compatibility

    return new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        if (e.data.type === 'ready' || e.data.type === 'timeSeriesReady') {
          setIsLoading(false)
          
          const setTimeSeriesLoaded = useAppStore.getState().setTimeSeriesLoaded
          // Pass mask data from the first file (if any)
          const firstMask = series[0]?.maskBuffer || null
          setTimeSeriesLoaded(
            series.map(s => s.fileName),
            series.map(s => s.metadata),
            firstMask
          )
          resolve()
        } else if (e.data.type === 'error') {
          reject(new Error(e.data.message))
        }
      }

      worker.onerror = (err) => {
        reject(new Error('Worker initialization failed: ' + err.message))
      }

      if (series.length === 1) {
        worker.postMessage(
          { type: 'loadData', buffer: series[0].buffer, metadata: series[0].metadata },
          [series[0].buffer]
        )
      } else {
        const buffers = series.map(s => s.buffer)
        worker.postMessage(
          { type: 'loadTimeSeries', series },
          buffers
        )
      }
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
        <p className="landing-subtitle" style={{ maxWidth: '600px', margin: '0 auto var(--space-xl)' }}>
          Free online hyperspectral image analysis and datacube viewer. 
          Load ENVI and NPZ formats, extract spectral signatures, and annotate directly in your browser. 
          No installation required. Fast, secure, and your data never leaves your machine.
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
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-sm)'
          }}>
            <AlertTriangle size={18} /> {error}
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
              <div className="dropzone-icon" style={{ display: 'flex', justifyContent: 'center' }}><FolderUp size={48} strokeWidth={1.5} /></div>
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
                  style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  <X size={14} /> Start over
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="dropzone-icon" style={{ display: 'flex', justifyContent: 'center' }}><UploadCloud size={48} strokeWidth={1.5} /></div>
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

        <div style={{ marginTop: 'var(--space-2xl)', textAlign: 'center' }}>
          <a
            href="https://github.com/wiki-virus/HSI-STUDIO"
            target="_blank"
            rel="noopener noreferrer"
            style={{ 
              display: 'inline-flex', 
              alignItems: 'center', 
              gap: '8px',
              color: 'var(--text-tertiary)',
              textDecoration: 'none',
              fontSize: 'var(--font-sm)',
              transition: 'color 0.2s ease',
              opacity: 0.8
            }}
            onMouseOver={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.opacity = '1' }}
            onMouseOut={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.opacity = '0.8' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
              <path d="M9 18c-4.51 2-5-2-7-2" />
            </svg>
            Open Source on GitHub
          </a>
        </div>
      </div>
    </div>
  )
}
