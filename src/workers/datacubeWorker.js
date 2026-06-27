/**
 * datacubeWorker.js — Web Worker for heavy datacube operations
 * 
 * Handles all compute-intensive hyperspectral data processing off the main thread:
 *   - loadData:       Store the raw datacube buffer + metadata
 *   - extractBand:    Pull a single band image with percentile stats
 *   - extractSpectrum: Pull the full spectrum at a given pixel (x, y)
 *   - compositeRGB:   Build an interleaved RGBA buffer from 3 chosen bands
 * 
 * Supports BSQ, BIL, and BIP interleave layouts.
 * Uses Transferable Objects for zero-copy posting of typed arrays back to main thread.
 */

// ---------------------------------------------------------------------------
// State held inside the worker
// ---------------------------------------------------------------------------
let frames = []; // Array of { datacube: Float32Array, meta: object }
// For backwards compatibility and single-file workflow, datacube and meta 
// point to the active frame (usually frame 0).
let datacube = null;   
let meta     = null;   
let originalFrames = []; // To support crop reset

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------
self.onmessage = function (e) {
  const { type } = e.data;

  switch (type) {
    case 'loadData':
      handleLoadData(e.data);
      break;
    case 'loadTimeSeries':
      handleLoadTimeSeries(e.data);
      break;
    case 'extractBand':
      handleExtractBand(e.data);
      break;
    case 'extractSpectrum':
      handleExtractSpectrum(e.data);
      break;
    case 'compositeRGB':
      handleCompositeRGB(e.data);
      break;
    case 'exportDatacube':
      handleExportDatacube();
      break;
    case 'cropDatacube':
      handleCropDatacube(e.data);
      break;
    case 'resetCrop':
      handleResetCrop();
      break;
    case 'batchExportRois':
      handleBatchExportRois(e.data);
      break;
    case 'magicWand':
      handleMagicWand(e.data);
      break;
    default:
      self.postMessage({ type: 'error', message: `Unknown message type: ${type}` });
  }
};

// ---------------------------------------------------------------------------
// Data type byte-sizes & TypedArray constructors
// ---------------------------------------------------------------------------
const ENVI_DTYPE_MAP = {
  1:  { bytes: 1,  ArrayType: Uint8Array    },   // byte
  2:  { bytes: 2,  ArrayType: Int16Array    },   // 16-bit signed integer
  3:  { bytes: 4,  ArrayType: Int32Array    },   // 32-bit signed integer
  4:  { bytes: 4,  ArrayType: Float32Array  },   // 32-bit float
  5:  { bytes: 8,  ArrayType: Float64Array  },   // 64-bit float
  12: { bytes: 2,  ArrayType: Uint16Array   },   // 16-bit unsigned integer
  13: { bytes: 4,  ArrayType: Uint32Array   },   // 32-bit unsigned integer
  14: { bytes: 8,  ArrayType: BigInt64Array },   // 64-bit signed integer
  15: { bytes: 8,  ArrayType: BigUint64Array },  // 64-bit unsigned integer
};

// ---------------------------------------------------------------------------
// loadData — store the raw datacube and metadata (Single Frame)
// ---------------------------------------------------------------------------
function handleLoadData({ buffer, metadata }) {
  const dc = createFloat32Datacube(buffer, metadata);
  frames = [{ datacube: dc, meta: metadata }];
  originalFrames = [{ datacube: dc, meta: { ...metadata } }];
  datacube = dc;
  meta = metadata;

  self.postMessage({
    type: 'ready',
    samples: meta.samples,
    lines:   meta.lines,
    bands:   meta.bands,
  });
}

// ---------------------------------------------------------------------------
// loadTimeSeries — store an array of datacubes and metadata
// ---------------------------------------------------------------------------
function handleLoadTimeSeries({ series }) {
  frames = series.map(frame => ({
    meta: frame.metadata,
    datacube: createFloat32Datacube(frame.buffer, frame.metadata)
  }));
  originalFrames = frames.map(f => ({ datacube: f.datacube, meta: { ...f.meta } }));

  if (frames.length > 0) {
    datacube = frames[0].datacube;
    meta = frames[0].meta;
  }

  self.postMessage({
    type: 'timeSeriesReady',
    frameCount: frames.length,
    samples: meta.samples,
    lines:   meta.lines,
    bands:   meta.bands,
  });
}

function createFloat32Datacube(buffer, metadata) {
  const dtInfo = ENVI_DTYPE_MAP[metadata.dataType] || ENVI_DTYPE_MAP[4];
  const rawView = new dtInfo.ArrayType(buffer);

  if (dtInfo.ArrayType === Float32Array) {
    return rawView;
  } else {
    const dc = new Float32Array(rawView.length);
    for (let i = 0; i < rawView.length; i++) {
      dc[i] = Number(rawView[i]);
    }
    return dc;
  }
}

// ---------------------------------------------------------------------------
// Pixel offset helpers for each interleave format
// ---------------------------------------------------------------------------

/**
 * Returns strides for fast contiguous array indexing based on interleave format.
 */
function getStrides(samples, lines, bands, currentMeta = meta) {
  const { interleave, shapeOrder, fortranOrder } = currentMeta;
  let sampleStride, lineStride, bandStride;

  switch (String(interleave).toLowerCase()) {
    case 'bsq':
      sampleStride = 1;
      lineStride = samples;
      bandStride = lines * samples;
      break;
    case 'bil':
      sampleStride = 1;
      lineStride = bands * samples;
      bandStride = samples;
      break;
    case 'bip':
      sampleStride = bands;
      lineStride = samples * bands;
      bandStride = 1;
      break;
    case 'numpy': {
      if (shapeOrder === 'BHW') {
        if (fortranOrder) {
          bandStride = 1;
          lineStride = bands;
          sampleStride = bands * lines;
        } else {
          sampleStride = 1;
          lineStride = samples;
          bandStride = lines * samples;
        }
      } else { 
        if (fortranOrder) {
          lineStride = 1;
          sampleStride = lines;
          bandStride = lines * samples;
        } else {
          bandStride = 1;
          sampleStride = bands;
          lineStride = samples * bands;
        }
      }
      break;
    }
    default:
      sampleStride = 1;
      lineStride = samples;
      bandStride = lines * samples;
  }
  return { sampleStride, lineStride, bandStride };
}

// ---------------------------------------------------------------------------
// extractBand — pull a single spatial band image + percentile stats
// ---------------------------------------------------------------------------
function handleExtractBand({ bandIndex, frameIndex = 0 }) {
  const frame = frames[frameIndex] || { datacube, meta };
  if (!frame.datacube || !frame.meta) {
    self.postMessage({ type: 'error', message: 'No datacube loaded' });
    return;
  }

  const currentDatacube = frame.datacube;
  const currentMeta = frame.meta;
  const { samples, lines } = currentMeta;
  const pixelCount = samples * lines;
  const bandData = new Float32Array(pixelCount);

  // --- Extract band using interleave-aware indexing ---
  const { sampleStride, lineStride, bandStride } = getStrides(samples, lines, currentMeta.bands, currentMeta);
  const bandOffset = bandIndex * bandStride;

  let outIdx = 0;
  for (let line = 0; line < lines; line++) {
    const lineOffset = bandOffset + line * lineStride;
    for (let sample = 0; sample < samples; sample++) {
      bandData[outIdx++] = currentDatacube[lineOffset + sample * sampleStride];
    }
  }

  // --- Compute basic min / max ---
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pixelCount; i++) {
    const v = bandData[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }

  // --- Compute 1st and 99th percentile for robust contrast stretch ---
  const { p1, p99 } = computePercentiles(bandData, pixelCount);

  self.postMessage(
    {
      type: 'bandExtracted',
      bandData,
      min,
      max,
      percentile1:  p1,
      percentile99: p99,
    },
    [bandData.buffer]  // Transfer ownership (zero-copy)
  );
}

// ---------------------------------------------------------------------------
// extractSpectrum — get all band values for a specific pixel
// ---------------------------------------------------------------------------
function handleExtractSpectrum({ x, y, isPin = false, frameIndex = 0 }) {
  const frame = frames[frameIndex] || { datacube, meta };
  if (!frame.datacube || !frame.meta) {
    self.postMessage({ type: 'error', message: 'No datacube loaded' });
    return;
  }

  const currentDatacube = frame.datacube;
  const currentMeta = frame.meta;
  const { bands, wavelengths } = currentMeta;

  const spectrum = new Float32Array(bands);
  
  const { sampleStride, lineStride, bandStride } = getStrides(currentMeta.samples, currentMeta.lines, bands, currentMeta);
  const pixelOffset = y * lineStride + x * sampleStride;

  for (let band = 0; band < bands; band++) {
    spectrum[band] = currentDatacube[pixelOffset + band * bandStride];
  }

  // Build wavelengths array (if the header had them, pass through; else use indices)
  let wl;
  if (wavelengths && wavelengths.length === bands) {
    wl = new Float32Array(wavelengths);
  } else {
    wl = new Float32Array(bands);
    for (let b = 0; b < bands; b++) wl[b] = b;
  }

  self.postMessage(
    {
      type: 'spectrumExtracted',
      spectrum,
      wavelengths: wl,
      x,
      y,
      isPin,
    },
    [spectrum.buffer, wl.buffer]  // Transfer both
  );
}

// ---------------------------------------------------------------------------
// compositeRGB — construct an RGB interleaved buffer for display
// ---------------------------------------------------------------------------
function handleCompositeRGB({ rBand, gBand, bBand, frameIndex = 0 }) {
  const frame = frames[frameIndex] || { datacube, meta };
  if (!frame.datacube || !frame.meta) {
    self.postMessage({ type: 'error', message: 'No datacube loaded' });
    return;
  }

  const currentDatacube = frame.datacube;
  const currentMeta = frame.meta;
  const { samples, lines } = currentMeta;
  const pixelCount = samples * lines;
  
  const rData = new Float32Array(pixelCount);
  const gData = new Float32Array(pixelCount);
  const bData = new Float32Array(pixelCount);

  // Extract all 3 bands
  const { sampleStride, lineStride, bandStride } = getStrides(samples, lines, currentMeta.bands, currentMeta);
  const rOffset = rBand * bandStride;
  const gOffset = gBand * bandStride;
  const bOffset = bBand * bandStride;

  let outIdx = 0;
  for (let line = 0; line < lines; line++) {
    const lineBase = line * lineStride;
    for (let sample = 0; sample < samples; sample++) {
      const sampleOffset = lineBase + sample * sampleStride;
      rData[outIdx] = currentDatacube[rOffset + sampleOffset];
      gData[outIdx] = currentDatacube[gOffset + sampleOffset];
      bData[outIdx] = currentDatacube[bOffset + sampleOffset];
      outIdx++;
    }
  }

  // Per-band percentile stretch for balanced color rendering
  const rStats = computePercentiles(rData, pixelCount);
  const gStats = computePercentiles(gData, pixelCount);
  const bStats = computePercentiles(bData, pixelCount);

  // Build interleaved RGBA buffer for direct use with ImageData
  const rgbData = new Uint8ClampedArray(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    rgbData[offset]     = stretchToByte(rData[i], rStats.p1, rStats.p99); // R
    rgbData[offset + 1] = stretchToByte(gData[i], gStats.p1, gStats.p99); // G
    rgbData[offset + 2] = stretchToByte(bData[i], bStats.p1, bStats.p99); // B
    rgbData[offset + 3] = 255;                                             // A
  }

  self.postMessage(
    {
      type: 'rgbComposited',
      rgbData,
      width:  samples,
      height: lines,
    },
    [rgbData.buffer]  // Transfer ownership
  );
}

// ---------------------------------------------------------------------------
// Utility: percentile computation (selection via sorted copy)
// ---------------------------------------------------------------------------

/**
 * Compute the 1st and 99th percentiles of a Float32Array.
 * Uses reservoir sampling (10K samples) + sort instead of sorting the full
 * array. This drops percentile computation from O(n log n) to O(n) for
 * the scan + O(k log k) for the tiny sample sort — ~100× faster on large images.
 */
function computePercentiles(data, length) {
  const MAX_SAMPLES = 10000;

  if (length <= MAX_SAMPLES) {
    // Small array — just filter and sort directly
    const clean = [];
    for (let i = 0; i < length; i++) {
      const v = data[i];
      if (Number.isFinite(v)) clean.push(v);
    }
    if (clean.length === 0) return { p1: 0, p99: 1 };
    clean.sort((a, b) => a - b);
    return {
      p1:  clean[Math.floor(clean.length * 0.01)],
      p99: clean[Math.min(Math.floor(clean.length * 0.99), clean.length - 1)],
    };
  }

  // Fast O(k) random sampling for large arrays
  const sample = new Float32Array(MAX_SAMPLES);
  let filled = 0;

  // Try up to 2x MAX_SAMPLES times to handle sparse data/NaNs
  for (let i = 0; i < MAX_SAMPLES * 2 && filled < MAX_SAMPLES; i++) {
    const idx = Math.floor(Math.random() * length);
    const v = data[idx];
    if (Number.isFinite(v)) {
      sample[filled++] = v;
    }
  }

  if (filled === 0) return { p1: 0, p99: 1 };

  // Sort only the small sample
  const validSample = sample.subarray(0, filled);
  validSample.sort();

  return {
    p1:  validSample[Math.floor(filled * 0.01)],
    p99: validSample[Math.min(Math.floor(filled * 0.99), filled - 1)],
  };
}

// ---------------------------------------------------------------------------
// Utility: linear stretch a value into [0, 255]
// ---------------------------------------------------------------------------
function stretchToByte(value, low, high) {
  if (high === low) return 128;  // avoid division by zero
  const normalized = (value - low) / (high - low);
  return Math.round(Math.max(0, Math.min(1, normalized)) * 255);
}

// ---------------------------------------------------------------------------
// exportDatacube — send a copy of the full datacube back for saving
// ---------------------------------------------------------------------------
function handleExportDatacube() {
  if (!datacube || !meta) {
    self.postMessage({ type: 'error', message: 'No datacube loaded' });
    return;
  }

  // Create a BSQ-ordered copy for NPZ export
  const copy = new Float32Array(datacube.length);
  const { samples, lines, bands } = meta;
  const { sampleStride, lineStride, bandStride } = getStrides(samples, lines, bands, meta);

  let outIdx = 0;
  for (let band = 0; band < bands; band++) {
    const bandBase = band * bandStride;
    for (let line = 0; line < lines; line++) {
      const lineBase = bandBase + line * lineStride;
      for (let sample = 0; sample < samples; sample++) {
        copy[outIdx++] = datacube[lineBase + sample * sampleStride];
      }
    }
  }

  self.postMessage(
    {
      type: 'datacubeExport',
      data: copy,
      samples: meta.samples,
      lines: meta.lines,
      bands: meta.bands,
    },
    [copy.buffer]  // Transfer the copy
  );
}

// ---------------------------------------------------------------------------
// cropDatacube — extract a rectangular sub-region and replace working data
// ---------------------------------------------------------------------------
function handleCropDatacube({ x, y, width, height }) {
  if (frames.length === 0) {
    self.postMessage({ type: 'error', message: 'No datacube loaded' });
    return;
  }

  const baseMeta = frames[0].meta;
  const { samples, bands } = baseMeta;

  // Clamp to valid range
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(samples, x0 + Math.floor(width));
  const y1 = Math.min(baseMeta.lines, y0 + Math.floor(height));
  const newW = x1 - x0;
  const newH = y1 - y0;

  if (newW <= 0 || newH <= 0) {
    self.postMessage({ type: 'error', message: 'Invalid crop region' });
    return;
  }

  const newSize = newH * newW * bands;

  // Crop all frames in the time series (or just the single frame)
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const cropped = new Float32Array(newSize);
    const { sampleStride, lineStride, bandStride } = getStrides(samples, frame.meta.lines, bands, frame.meta);

    let outIdx = 0;
    for (let line = y0; line < y1; line++) {
      const lineBase = line * lineStride;
      for (let sample = x0; sample < x1; sample++) {
        const sampleBase = lineBase + sample * sampleStride;
        for (let band = 0; band < bands; band++) {
          cropped[outIdx++] = frame.datacube[sampleBase + band * bandStride];
        }
      }
    }

    // Replace frame data with cropped version (now BIP)
    frame.datacube = cropped;
    frame.meta = {
      ...frame.meta,
      samples: newW,
      lines: newH,
      interleave: 'bip', // we wrote it as BIP
    };
  }

  // Update global pointers to the first frame
  datacube = frames[0].datacube;
  meta = frames[0].meta;

  // Notify main thread of new dimensions
  self.postMessage({
    type: 'datacubeCropped',
    samples: newW,
    lines: newH,
    bands: bands,
    cropX: x0,
    cropY: y0
  });
}

// ---------------------------------------------------------------------------
// resetCrop — restore the original full-size datacube
// ---------------------------------------------------------------------------
function handleResetCrop() {
  if (originalFrames.length === 0) {
    self.postMessage({ type: 'error', message: 'No original datacube found to reset to.' });
    return;
  }
  
  // Restore frames from original reference
  frames = originalFrames.map(f => ({ datacube: f.datacube, meta: { ...f.meta } }));
  datacube = frames[0].datacube;
  meta = frames[0].meta;
  
  self.postMessage({
    type: 'datacubeCropped',
    samples: meta.samples,
    lines: meta.lines,
    bands: meta.bands,
    cropX: 0,
    cropY: 0,
    isReset: true
  });
}

// ---------------------------------------------------------------------------
// batchExportRois — extract multiple ROIs from the original datacube
// ---------------------------------------------------------------------------
function handleBatchExportRois({ rois, frameIndex = 0 }) {
  if (!datacube) return;
  
  // Extract from the CURRENT active frame so that ROI coordinates match perfectly.
  const frame = frames[frameIndex] || { datacube, meta };
  const { samples, lines, bands } = frame.meta;
  
  const extractedRois = rois.map(roi => {
    // clamp ROI
    const x0 = Math.max(0, Math.floor(roi.x));
    const y0 = Math.max(0, Math.floor(roi.y));
    const x1 = Math.min(samples, x0 + Math.floor(roi.w));
    const y1 = Math.min(lines, y0 + Math.floor(roi.h));
    const newW = x1 - x0;
    const newH = y1 - y0;
    
    if (newW <= 0 || newH <= 0) return null;
    
    const newSize = newW * newH * bands;
    const cropped = new Float32Array(newSize);
    const { sampleStride, lineStride, bandStride } = getStrides(samples, lines, bands, frame.meta);
    
    let outIdx = 0;
    for (let line = y0; line < y1; line++) {
      const lineBase = line * lineStride;
      for (let sample = x0; sample < x1; sample++) {
        const sampleBase = lineBase + sample * sampleStride;
        for (let band = 0; band < bands; band++) {
          cropped[outIdx++] = frame.datacube[sampleBase + band * bandStride];
        }
      }
    }
    
    return {
      id: roi.id,
      name: roi.name,
      x: roi.x,
      y: roi.y,
      w: newW,
      h: newH,
      buffer: cropped.buffer,
      meta: { ...frame.meta, samples: newW, lines: newH, interleave: 'bip' }
    };
  }).filter(Boolean);
  
  const transferables = extractedRois.map(r => r.buffer);
  self.postMessage({ type: 'roisExported', rois: extractedRois }, transferables);
}

// ---------------------------------------------------------------------------
// Magic Wand: Spectral Angle Mapper (SAM)
// ---------------------------------------------------------------------------
function handleMagicWand({ x, y, tolerance, frameIndex = 0 }) {
  const targetFrame = frames[frameIndex] || { datacube, meta };
  if (!targetFrame || !targetFrame.datacube) {
    self.postMessage({ type: 'error', message: 'No datacube loaded for wand.' });
    return;
  }
  const currentCube = targetFrame.datacube;
  const currentMeta = targetFrame.meta;
  const { samples, lines, bands } = currentMeta;

  if (x < 0 || x >= samples || y < 0 || y >= lines) return;

  const { sampleStride, lineStride, bandStride } = getStrides(samples, lines, bands, currentMeta);

  // 1. Extract reference spectrum at (x,y)
  const refSpectrum = new Float32Array(bands);
  let refNormSq = 0;
  for (let b = 0; b < bands; b++) {
    const val = currentCube[y * lineStride + x * sampleStride + b * bandStride];
    refSpectrum[b] = val;
    refNormSq += val * val;
  }
  const refNorm = Math.sqrt(refNormSq);

  if (refNorm === 0) {
    // Cannot compute angle with 0 vector
    self.postMessage({ type: 'wandCompleted', mask: new Uint8Array(samples * lines) }, []);
    return;
  }

  // 2. Perform BFS flood fill
  const outMask = new Uint8Array(samples * lines);
  const visited = new Uint8Array(samples * lines);
  const queue = [[x, y]];
  let head = 0;
  
  visited[y * samples + x] = 1;

  while (head < queue.length) {
    const [cx, cy] = queue[head++];
    
    // Check spectral angle
    let dot = 0;
    let normSq = 0;
    for (let b = 0; b < bands; b++) {
      const val = currentCube[cy * lineStride + cx * sampleStride + b * bandStride];
      dot += refSpectrum[b] * val;
      normSq += val * val;
    }
    const norm = Math.sqrt(normSq);
    let angle;
    if (norm > 0) {
      let cosTheta = dot / (refNorm * norm);
      if (cosTheta > 1) cosTheta = 1;
      if (cosTheta < -1) cosTheta = -1;
      angle = Math.acos(cosTheta);
    } else {
      angle = Math.PI; // max angle if zero vector
    }

    if (angle <= tolerance) {
      outMask[cy * samples + cx] = 1; // Mark as selected
      
      // Add neighbors
      const neighbors = [
        [cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]
      ];
      
      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < samples && ny >= 0 && ny < lines) {
          const idx = ny * samples + nx;
          if (visited[idx] === 0) {
            visited[idx] = 1;
            queue.push([nx, ny]);
          }
        }
      }
    }
  }

  // Post back the boolean mask
  self.postMessage({ type: 'wandCompleted', mask: outMask }, [outMask.buffer]);
}
