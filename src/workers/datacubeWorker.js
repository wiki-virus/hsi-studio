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
 * Returns the flat index into the datacube for a given (sample, line, band).
 *   BSQ: band * lines * samples + line * samples + sample
 *   BIL: line * bands * samples + band * samples + sample
 *   BIP: line * samples * bands + sample * bands + band
 */
function pixelIndex(sample, line, band, currentMeta = meta) {
  const { samples, lines, bands, interleave } = currentMeta;

  switch (interleave) {
    case 'bsq':
      return band * lines * samples + line * samples + sample;
    case 'bil':
      return line * bands * samples + band * samples + sample;
    case 'bip':
      return line * samples * bands + sample * bands + band;
    case 'numpy': {
      const { shapeOrder, fortranOrder } = currentMeta;
      if (shapeOrder === 'BHW') {
        if (fortranOrder) {
          // (B, H, W) F-order: B changes fastest
          return band + line * bands + sample * bands * lines;
        } else {
          // (B, H, W) C-order: W changes fastest
          return band * lines * samples + line * samples + sample;
        }
      } else { 
        // 'HWB'
        if (fortranOrder) {
          // (H, W, B) F-order: H changes fastest
          return line + sample * lines + band * lines * samples;
        } else {
          // (H, W, B) C-order: B changes fastest
          return line * samples * bands + sample * bands + band;
        }
      }
    }
    default:
      // Fallback: assume BSQ
      return band * lines * samples + line * samples + sample;
  }
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
  for (let line = 0; line < lines; line++) {
    for (let sample = 0; sample < samples; sample++) {
      bandData[line * samples + sample] = currentDatacube[pixelIndex(sample, line, bandIndex, currentMeta)];
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
function handleExtractSpectrum({ x, y, frameIndex = 0 }) {
  const frame = frames[frameIndex] || { datacube, meta };
  if (!frame.datacube || !frame.meta) {
    self.postMessage({ type: 'error', message: 'No datacube loaded' });
    return;
  }

  const currentDatacube = frame.datacube;
  const currentMeta = frame.meta;
  const { bands, wavelengths } = currentMeta;

  const spectrum = new Float32Array(bands);
  
  for (let band = 0; band < bands; band++) {
    spectrum[band] = currentDatacube[pixelIndex(x, y, band, currentMeta)];
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
    },
    [spectrum.buffer, wl.buffer]  // Transfer both
  );
}

// ---------------------------------------------------------------------------
// compositeRGB — construct an RGB interleaved buffer for display
// ---------------------------------------------------------------------------
function handleCompositeRGB({ rBand, gBand, bBand, autoStretch = true, frameIndex = 0 }) {
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
  for (let line = 0; line < lines; line++) {
    for (let sample = 0; sample < samples; sample++) {
      const flatIdx = line * samples + sample;
      rData[flatIdx] = currentDatacube[pixelIndex(sample, line, rBand, currentMeta)];
      gData[flatIdx] = currentDatacube[pixelIndex(sample, line, gBand, currentMeta)];
      bData[flatIdx] = currentDatacube[pixelIndex(sample, line, bBand, currentMeta)];
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

  // Reservoir sampling for large arrays
  const reservoir = new Float32Array(MAX_SAMPLES);
  let filled = 0;

  // Fill reservoir with first MAX_SAMPLES valid values
  for (let i = 0; i < length && filled < MAX_SAMPLES; i++) {
    const v = data[i];
    if (Number.isFinite(v)) {
      reservoir[filled++] = v;
    }
  }

  if (filled === 0) return { p1: 0, p99: 1 };

  // Replace elements with decreasing probability (reservoir sampling)
  let seen = filled;
  for (let i = filled; i < length; i++) {
    const v = data[i];
    if (!Number.isFinite(v)) continue;
    seen++;
    const j = Math.floor(Math.random() * seen);
    if (j < MAX_SAMPLES) {
      reservoir[j] = v;
    }
  }

  // Sort only the small sample
  const sample = reservoir.subarray(0, filled);
  sample.sort();

  return {
    p1:  sample[Math.floor(filled * 0.01)],
    p99: sample[Math.min(Math.floor(filled * 0.99), filled - 1)],
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

  // Create a copy so we don't transfer and lose the working data
  const copy = new Float32Array(datacube.length);
  copy.set(datacube);

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
  if (!datacube || !meta) {
    self.postMessage({ type: 'error', message: 'No datacube loaded' });
    return;
  }

  const { samples, bands } = meta;

  // Clamp to valid range
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(samples, x0 + Math.floor(width));
  const y1 = Math.min(meta.lines, y0 + Math.floor(height));
  const newW = x1 - x0;
  const newH = y1 - y0;

  if (newW <= 0 || newH <= 0) {
    self.postMessage({ type: 'error', message: 'Invalid crop region' });
    return;
  }

  // Build new BIP-ordered datacube
  const newSize = newH * newW * bands;
  const cropped = new Float32Array(newSize);

  let outIdx = 0;
  for (let line = y0; line < y1; line++) {
    for (let sample = x0; sample < x1; sample++) {
      for (let band = 0; band < bands; band++) {
        cropped[outIdx++] = datacube[pixelIndex(sample, line, band)];
      }
    }
  }

  // Replace working data with cropped version (now BIP)
  datacube = cropped;
  meta = {
    ...meta,
    samples: newW,
    lines: newH,
    interleave: 'bip', // we wrote it as BIP
  };

  // Notify main thread of new dimensions
  self.postMessage({
    type: 'datacubeCropped',
    samples: newW,
    lines: newH,
    bands: bands,
  });
}
