// ============================================================================
// NPZ / NPY Parser — HSI Studio
// Reads NumPy .npy binary files and .npz archives (ZIP of .npy).
// Uses JSZip for ZIP decompression.
// ============================================================================

import JSZip from 'jszip';

// ---- Dtype helpers ---------------------------------------------------------

/**
 * Map a NumPy dtype descriptor string to a JS TypedArray constructor and
 * byte-width.
 *
 * Supported descriptors (both little-endian `<` and native `|` prefixes):
 *   <f4 / >f4  → Float32Array   (4 bytes)
 *   <f8 / >f8  → Float64Array   (8 bytes)
 *   |u1        → Uint8Array     (1 byte)
 *   <u2 / >u2  → Uint16Array    (2 bytes)
 *   <i2 / >i2  → Int16Array     (2 bytes)
 *   <i4 / >i4  → Int32Array     (4 bytes)
 *   <u4 / >u4  → Uint32Array    (4 bytes)
 *
 * @param {string} dtype  e.g. "<f4"
 * @returns {{ constructor: Function, bytes: number, name: string }}
 */
function dtypeToTypedArray(dtype) {
  // Strip endian prefix for matching; we'll handle byte-order separately.
  const core = dtype.replace(/^[<>|=]/, '');
  const map = {
    'f4': { constructor: Float32Array,  bytes: 4, name: 'float32' },
    'f8': { constructor: Float64Array,  bytes: 8, name: 'float64' },
    'u1': { constructor: Uint8Array,    bytes: 1, name: 'uint8'   },
    'u2': { constructor: Uint16Array,   bytes: 2, name: 'uint16'  },
    'i2': { constructor: Int16Array,    bytes: 2, name: 'int16'   },
    'i4': { constructor: Int32Array,    bytes: 4, name: 'int32'   },
    'u4': { constructor: Uint32Array,   bytes: 4, name: 'uint32'  },
  };

  const info = map[core];
  if (!info) {
    throw new Error(`Unsupported NumPy dtype: "${dtype}"`);
  }
  return info;
}

/**
 * Returns true when the dtype's byte order differs from the platform's native
 * order (and therefore the raw bytes need to be swapped after construction).
 */
function needsByteSwap(dtype) {
  if (dtype.startsWith('|') || dtype.length < 2) return false; // single-byte or not-applicable
  const platform = new Uint8Array(new Uint16Array([0x0102]).buffer)[0] === 0x02
    ? '<'   // little-endian
    : '>';   // big-endian
  const file = dtype[0] === '=' ? platform : dtype[0];
  return file !== platform;
}

/**
 * In-place byte swap for TypedArray elements wider than 1 byte.
 */
function swapBytesInPlace(typedArray, bytesPerElement) {
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

// ---- NPY format ------------------------------------------------------------
//
// .npy layout (NumPy format 1.0 / 2.0):
//   Bytes  0–5:    magic  \x93NUMPY
//   Byte   6:      major version (1 or 2)
//   Byte   7:      minor version (0)
//   Bytes  8–9:    (v1) header length as uint16-LE
//   Bytes  8–11:   (v2) header length as uint32-LE
//   Then:          ASCII header string (Python dict literal), padded to 64-byte
//                  boundary with spaces + trailing \n.
//   Then:          raw data
// ============================================================================

/**
 * Parse the Python dict-like header string found inside .npy files.
 *
 * Example header:
 *   {'descr': '<f4', 'fortran_order': False, 'shape': (480, 640, 224), }
 *
 * We extract `descr`, `fortran_order`, and `shape`.
 *
 * @param {string} headerStr
 * @returns {{ descr: string, fortranOrder: boolean, shape: number[] }}
 */
function parsePythonDictHeader(headerStr) {
  // descr
  const descrMatch = headerStr.match(/'descr'\s*:\s*'([^']+)'/);
  if (!descrMatch) throw new Error('Could not parse descr from .npy header');
  const descr = descrMatch[1];

  // fortran_order
  const fortranMatch = headerStr.match(/'fortran_order'\s*:\s*(True|False)/);
  const fortranOrder = fortranMatch ? fortranMatch[1] === 'True' : false;

  // shape — a Python tuple like (480,) or (480, 640, 224)
  const shapeMatch = headerStr.match(/'shape'\s*:\s*\(([^)]*)\)/);
  if (!shapeMatch) throw new Error('Could not parse shape from .npy header');
  const shapeStr = shapeMatch[1].trim();
  const shape = shapeStr.length === 0
    ? []                                                    // scalar ()
    : shapeStr.split(',').map(s => s.trim()).filter(s => s.length > 0).map(Number);

  return { descr, fortranOrder, shape };
}

/**
 * Parse a single .npy buffer.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @returns {{ data: TypedArray, shape: number[], dtype: string }}
 */
export function parseNpy(arrayBuffer) {
  const view = new DataView(arrayBuffer);

  // ---- Verify magic bytes: \x93NUMPY ---
  const magic = [0x93, 0x4E, 0x55, 0x4D, 0x50, 0x59]; // \x93NUMPY
  for (let i = 0; i < magic.length; i++) {
    if (view.getUint8(i) !== magic[i]) {
      throw new Error('Not a valid .npy file (bad magic bytes)');
    }
  }

  const majorVersion = view.getUint8(6);
  // const minorVersion = view.getUint8(7);   // unused but read for completeness

  let headerLen;
  let dataOffset;

  if (majorVersion === 1) {
    headerLen = view.getUint16(8, true);    // little-endian uint16
    dataOffset = 10 + headerLen;
  } else if (majorVersion === 2 || majorVersion === 3) {
    headerLen = view.getUint32(8, true);    // little-endian uint32
    dataOffset = 12 + headerLen;
  } else {
    throw new Error(`Unsupported .npy version: ${majorVersion}`);
  }

  // ---- Decode ASCII header string -----------------------------------------
  const headerBytes = new Uint8Array(arrayBuffer, majorVersion === 1 ? 10 : 12, headerLen);
  const headerStr = new TextDecoder('ascii').decode(headerBytes);
  const { descr, fortranOrder, shape } = parsePythonDictHeader(headerStr);

  // ---- Build TypedArray from raw data -------------------------------------
  const typeInfo = dtypeToTypedArray(descr);
  const elementCount = shape.length === 0 ? 1 : shape.reduce((a, b) => a * b, 1);
  const expectedBytes = elementCount * typeInfo.bytes;

  // We need an *aligned* copy because TypedArray constructors require the
  // byte offset to be a multiple of the element size.
  const rawSlice = arrayBuffer.slice(dataOffset, dataOffset + expectedBytes);
  const data = new typeInfo.constructor(rawSlice);

  // Byte-swap if needed
  if (needsByteSwap(descr)) {
    swapBytesInPlace(data, typeInfo.bytes);
  }

  // If the data is Fortran-order (column-major) we do NOT transpose it here —
  // we store the flag so the caller can handle it if required.
  return {
    data,
    shape,
    dtype: descr,
    fortranOrder,
  };
}

// ---- NPZ format ------------------------------------------------------------
// An .npz file is a standard ZIP archive where each entry is a .npy file.
// Entry names correspond to the variable names saved via numpy.savez.
// ============================================================================

/**
 * Parse an .npz archive.
 *
 * @param {ArrayBuffer} arrayBuffer  The raw bytes of the .npz file.
 * @returns {Promise<Object>}        Keys = array names (without `.npy`),
 *                                   Values = { data, shape, dtype }.
 */
export async function parseNpz(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const result = {};

  const entries = Object.keys(zip.files);

  for (const entryName of entries) {
    const file = zip.files[entryName];
    if (file.dir) continue;                   // skip directories

    // Extract to ArrayBuffer
    const entryBuffer = await file.async('arraybuffer');

    // Derive the variable name by stripping the .npy extension
    const varName = entryName.endsWith('.npy')
      ? entryName.slice(0, -4)
      : entryName;

    try {
      const parsed = parseNpy(entryBuffer);
      result[varName] = {
        data: parsed.data,
        shape: parsed.shape,
        dtype: parsed.dtype,
        fortranOrder: parsed.fortranOrder,
      };
    } catch (err) {
      console.warn(`[npzParser] Skipping entry "${entryName}": ${err.message}`);
    }
  }

  return result;
}
