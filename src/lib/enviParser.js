// ============================================================================
// ENVI Format Parser — HSI Studio
// Parses ENVI .hdr header files and extracts data from binary datacubes.
// Supports BSQ, BIL, BIP interleave; all major ENVI data types; byte swapping.
// ============================================================================

/**
 * ENVI data-type mapping.
 * Maps the integer code found in the .hdr "data type" field to metadata about
 * the corresponding JavaScript TypedArray constructor, byte width, and name.
 */
const DATA_TYPE_MAP = {
  1:  { constructor: Uint8Array,    bytes: 1, name: 'uint8'   },
  2:  { constructor: Int16Array,    bytes: 2, name: 'int16'   },
  3:  { constructor: Int32Array,    bytes: 4, name: 'int32'   },
  4:  { constructor: Float32Array,  bytes: 4, name: 'float32' },
  5:  { constructor: Float64Array,  bytes: 8, name: 'float64' },
  12: { constructor: Uint16Array,   bytes: 2, name: 'uint16'  },
  13: { constructor: Uint32Array,   bytes: 4, name: 'uint32'  },
  14: { constructor: BigInt64Array, bytes: 8, name: 'int64'   },
  15: { constructor: BigUint64Array,bytes: 8, name: 'uint64'  },
};

/**
 * Return type info for a given ENVI data-type integer code.
 * @param {number} enviDataType
 * @returns {{ constructor: Function, bytes: number, name: string } | null}
 */
export function getDataTypeInfo(enviDataType) {
  return DATA_TYPE_MAP[enviDataType] || null;
}

// ---- Header Parsing --------------------------------------------------------

/**
 * Parse an ENVI .hdr text file into a plain object.
 *
 * Rules handled:
 * - `key = value` lines (trimmed)
 * - Multi-line values enclosed in `{ … }` (may span many lines)
 * - Lines beginning with `;` are comments and are skipped
 * - The first line *may* be the literal text `ENVI` (spec requirement); we
 *   accept files with or without it.
 *
 * Array-like values (comma-separated inside braces) are automatically split
 * into JS arrays of trimmed strings.
 *
 * @param {string} text  Raw contents of the .hdr file.
 * @returns {object}     Parsed metadata dictionary.
 */
export function parseHeader(text) {
  const meta = {};
  // Normalise line endings
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let i = 0;

  // Skip the optional leading "ENVI" marker line
  if (lines.length > 0 && lines[0].trim().toUpperCase() === 'ENVI') {
    i = 1;
  }

  while (i < lines.length) {
    const line = lines[i].trim();
    i++;

    // Skip blanks & comments
    if (line === '' || line.startsWith(';')) continue;

    // Expect `key = value`
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;               // malformed – skip

    const key = line.substring(0, eqIdx).trim().toLowerCase();
    let value = line.substring(eqIdx + 1).trim();

    // Handle multi-line brace-delimited values
    if (value.includes('{') && !value.includes('}')) {
      // Collect subsequent lines until we find the closing brace
      while (i < lines.length) {
        value += '\n' + lines[i];
        i++;
        if (value.includes('}')) break;
      }
    }

    // If value is wrapped in braces, parse as array
    if (value.startsWith('{') || value.includes('{')) {
      const braceContent = value.substring(
        value.indexOf('{') + 1,
        value.lastIndexOf('}')
      ).trim();

      if (braceContent.length > 0) {
        // Split on commas; trim each element
        value = braceContent.split(',').map(s => s.trim()).filter(s => s.length > 0);
      } else {
        value = [];
      }
    }

    meta[key] = value;
  }

  // ---- Post-processing: cast known numeric fields --------------------------
  const intFields = [
    'samples', 'lines', 'bands', 'data type', 'byte order',
    'header offset', 'x start', 'y start',
  ];
  for (const field of intFields) {
    if (meta[field] !== undefined && typeof meta[field] === 'string') {
      meta[field] = parseInt(meta[field], 10);
    }
  }

  // Normalise interleave to uppercase
  if (typeof meta['interleave'] === 'string') {
    meta['interleave'] = meta['interleave'].trim().toUpperCase();
  }

  // Parse wavelength array to numbers
  if (Array.isArray(meta['wavelength'])) {
    meta['wavelength'] = meta['wavelength'].map(Number);
  }

  // Parse fwhm to numbers if present
  if (Array.isArray(meta['fwhm'])) {
    meta['fwhm'] = meta['fwhm'].map(Number);
  }

  // Default header offset
  if (meta['header offset'] === undefined) {
    meta['header offset'] = 0;
  }

  return meta;
}

// ---- Byte-order helpers ----------------------------------------------------

/**
 * Detect the native byte order of the current platform.
 * @returns {boolean} True if the platform is little-endian.
 */
function isNativeLittleEndian() {
  const buf = new ArrayBuffer(2);
  new Uint16Array(buf)[0] = 0x0102;
  return new Uint8Array(buf)[0] === 0x02;
}

/**
 * Swap byte order in-place for a TypedArray whose elements are wider than 1
 * byte.
 * @param {TypedArray} typedArray
 * @param {number}     bytesPerElement
 */
function swapBytes(typedArray, bytesPerElement) {
  if (bytesPerElement <= 1) return;
  const raw = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  for (let i = 0; i < raw.length; i += bytesPerElement) {
    for (let lo = 0, hi = bytesPerElement - 1; lo < hi; lo++, hi--) {
      const tmp = raw[i + lo];
      raw[i + lo] = raw[i + hi];
      raw[i + hi] = tmp;
    }
  }
}

/**
 * Determine whether byte swapping is necessary given the file's byte order
 * field.
 *
 * ENVI convention: byte order 0 = little-endian (Intel), 1 = big-endian.
 * We need to swap whenever the file endianness differs from the platform's
 * native endianness.
 *
 * @param {number} byteOrderFlag  The `byte order` value from the header.
 * @returns {boolean}
 */
function needsSwap(byteOrderFlag) {
  const nativeLE = isNativeLittleEndian();
  const fileLE = byteOrderFlag === 0;
  return nativeLE !== fileLE;
}

// ---- Band extraction -------------------------------------------------------

/**
 * Extract a single band image from a raw binary datacube.
 *
 * @param {ArrayBuffer} buffer      The raw binary datacube (no header offset
 *                                  handling needed — pass the *data* portion).
 * @param {object}      metadata    Object returned by `parseHeader`.
 * @param {number}      bandIndex   0-based band index.
 * @returns {Float32Array}          Band image as row-major Float32 pixels
 *                                  (length = lines × samples).
 */
export function extractBand(buffer, metadata, bandIndex) {
  const samples = metadata['samples'];
  const lines   = metadata['lines'];
  const bands   = metadata['bands'];
  const interleave = (metadata['interleave'] || 'BSQ').toUpperCase();
  const offset  = metadata['header offset'] || 0;
  const typeInfo = getDataTypeInfo(metadata['data type']);

  if (!typeInfo) {
    throw new Error(`Unsupported ENVI data type: ${metadata['data type']}`);
  }

  if (bandIndex < 0 || bandIndex >= bands) {
    throw new RangeError(`Band index ${bandIndex} out of range [0, ${bands - 1}]`);
  }

  const { constructor: TypedCtor, bytes: bpe } = typeInfo;
  const totalPixels = lines * samples;
  const result = new Float32Array(totalPixels);

  // Create a DataView for the raw data portion
  const dataStart = offset;

  // We need to handle int64/uint64 specially (BigInt arrays)
  const isBigInt = (TypedCtor === BigInt64Array || TypedCtor === BigUint64Array);
  const swap = needsSwap(metadata['byte order'] ?? 0);

  if (interleave === 'BSQ') {
    // Band Sequential: [band][line][sample]
    // Each band is a contiguous block of lines × samples pixels.
    const bandOffset = dataStart + bandIndex * totalPixels * bpe;
    const rawSlice = buffer.slice(bandOffset, bandOffset + totalPixels * bpe);
    const typed = new TypedCtor(rawSlice);
    if (swap) swapBytes(typed, bpe);
    for (let i = 0; i < totalPixels; i++) {
      result[i] = isBigInt ? Number(typed[i]) : typed[i];
    }

  } else if (interleave === 'BIL') {
    // Band Interleaved by Line: [line][band][sample]
    // For each line, we jump to the correct band within that line.
    let outIdx = 0;
    for (let line = 0; line < lines; line++) {
      const lineStart = dataStart + (line * bands + bandIndex) * samples * bpe;
      const rawSlice = buffer.slice(lineStart, lineStart + samples * bpe);
      const typed = new TypedCtor(rawSlice);
      if (swap) swapBytes(typed, bpe);
      for (let s = 0; s < samples; s++) {
        result[outIdx++] = isBigInt ? Number(typed[s]) : typed[s];
      }
    }

  } else if (interleave === 'BIP') {
    // Band Interleaved by Pixel: [line][sample][band]
    // For each pixel we pick the single value at the band offset.
    let outIdx = 0;
    for (let line = 0; line < lines; line++) {
      for (let samp = 0; samp < samples; samp++) {
        const addr = dataStart + (line * samples + samp) * bands * bpe + bandIndex * bpe;
        const rawSlice = buffer.slice(addr, addr + bpe);
        const typed = new TypedCtor(rawSlice);
        if (swap) swapBytes(typed, bpe);
        result[outIdx++] = isBigInt ? Number(typed[0]) : typed[0];
      }
    }

  } else {
    throw new Error(`Unknown interleave format: ${interleave}`);
  }

  return result;
}

// ---- Pixel spectrum extraction ---------------------------------------------

/**
 * Extract the full spectral signature for a single pixel.
 *
 * @param {ArrayBuffer} buffer    Raw binary datacube (data portion).
 * @param {object}      metadata  Object returned by `parseHeader`.
 * @param {number}      x         Column (sample) index, 0-based.
 * @param {number}      y         Row (line) index, 0-based.
 * @returns {Float32Array}        Spectral values, length = bands.
 */
export function extractPixelSpectrum(buffer, metadata, x, y) {
  const samples = metadata['samples'];
  const lines   = metadata['lines'];
  const bands   = metadata['bands'];
  const interleave = (metadata['interleave'] || 'BSQ').toUpperCase();
  const offset  = metadata['header offset'] || 0;
  const typeInfo = getDataTypeInfo(metadata['data type']);

  if (!typeInfo) {
    throw new Error(`Unsupported ENVI data type: ${metadata['data type']}`);
  }
  if (x < 0 || x >= samples || y < 0 || y >= lines) {
    throw new RangeError(`Pixel (${x}, ${y}) out of bounds (${samples}×${lines})`);
  }

  const { constructor: TypedCtor, bytes: bpe } = typeInfo;
  const isBigInt = (TypedCtor === BigInt64Array || TypedCtor === BigUint64Array);
  const swap = needsSwap(metadata['byte order'] ?? 0);
  const spectrum = new Float32Array(bands);

  if (interleave === 'BIP') {
    // All bands for one pixel are contiguous — fast path
    const pixelStart = offset + (y * samples + x) * bands * bpe;
    const rawSlice = buffer.slice(pixelStart, pixelStart + bands * bpe);
    const typed = new TypedCtor(rawSlice);
    if (swap) swapBytes(typed, bpe);
    for (let b = 0; b < bands; b++) {
      spectrum[b] = isBigInt ? Number(typed[b]) : typed[b];
    }

  } else if (interleave === 'BIL') {
    // For each band within the line, pick the sample
    for (let b = 0; b < bands; b++) {
      const addr = offset + (y * bands + b) * samples * bpe + x * bpe;
      const rawSlice = buffer.slice(addr, addr + bpe);
      const typed = new TypedCtor(rawSlice);
      if (swap) swapBytes(typed, bpe);
      spectrum[b] = isBigInt ? Number(typed[0]) : typed[0];
    }

  } else {
    // BSQ — one seek per band
    const totalPixels = lines * samples;
    for (let b = 0; b < bands; b++) {
      const addr = offset + (b * totalPixels + y * samples + x) * bpe;
      const rawSlice = buffer.slice(addr, addr + bpe);
      const typed = new TypedCtor(rawSlice);
      if (swap) swapBytes(typed, bpe);
      spectrum[b] = isBigInt ? Number(typed[0]) : typed[0];
    }
  }

  return spectrum;
}
