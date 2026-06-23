/**
 * tiffParser.js — (Geo)TIFF reader for HSI Studio
 *
 * Hyperspectral TIFFs usually store bands in one of two ways:
 *
 *   1. Multi-page TIFF — one page (IFD) per band. This is the common ENVI /
 *      QGIS export layout. bands = number of pages.
 *
 *   2. Single page, multi-sample — one page whose pixels carry N samples
 *      (SamplesPerPixel). bands = samples per pixel.
 *
 * We decode every page with UTIF, read the real sample values (respecting
 * bit depth + sample format: uint / int / float), and emit a BIP-ordered
 * Float32 datacube the worker can consume directly.
 *
 * @param {ArrayBuffer} buffer — raw .tif / .tiff bytes
 * @returns {{ datacube: Float32Array, metadata: object }}
 */
import * as UTIF from 'utif'

export function parseTiff(buffer) {
  const ifds = UTIF.decode(buffer)
  if (!ifds || ifds.length === 0) {
    throw new Error('No images found in TIFF file.')
  }

  // Decode pixel data for every page.
  ifds.forEach((ifd) => UTIF.decodeImage(buffer, ifd))

  const first = ifds[0]
  const width = first.width
  const height = first.height
  if (!width || !height) {
    throw new Error('TIFF is missing width/height — not a readable image.')
  }

  const spp = tag(first, 't277', tag(first, 't258', [1]).length)
  const pageCount = ifds.length

  // Decide where the spectral axis lives.
  const bands = pageCount > 1 ? pageCount : spp
  if (bands < 1) {
    throw new Error('Could not determine band count from TIFF.')
  }

  const pixelCount = width * height
  const datacube = new Float32Array(pixelCount * bands) // BIP: [pixel][band]

  if (pageCount > 1) {
    // One band per page. Take sample 0 from each page.
    for (let b = 0; b < pageCount; b++) {
      const ifd = ifds[b]
      if (ifd.width !== width || ifd.height !== height) {
        throw new Error(
          `TIFF page ${b} is ${ifd.width}×${ifd.height}, expected ${width}×${height}. ` +
            'All bands must share the same dimensions.'
        )
      }
      const read = makeSampleReader(ifd)
      const pageSpp = tag(ifd, 't277', 1)
      for (let p = 0; p < pixelCount; p++) {
        datacube[p * bands + b] = read(p * pageSpp) // sample 0 of pixel p
      }
    }
  } else {
    // Single page, interleaved samples (chunky). bands = spp.
    const read = makeSampleReader(first)
    for (let p = 0; p < pixelCount; p++) {
      for (let s = 0; s < bands; s++) {
        datacube[p * bands + s] = read(p * spp + s)
      }
    }
  }

  const bps = tag(first, 't258', [8])[0]
  const fmt = tag(first, 't339', [1])[0]

  return {
    datacube,
    metadata: {
      samples: width,
      lines: height,
      bands,
      dataType: 4, // we always emit float32
      dataTypeSize: 4,
      interleave: 'bip',
      byteOrder: 0,
      wavelengths: null,
      tiffInfo: {
        layout: pageCount > 1 ? `${pageCount} pages (1 band/page)` : `1 page, ${spp} samples/pixel`,
        bitsPerSample: bps,
        sampleFormat: fmt === 3 ? 'float' : fmt === 2 ? 'int' : 'uint',
      },
    },
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function tag(ifd, name, fallback) {
  return ifd[name] != null ? ifd[name][0] : fallback
}

/**
 * Build a function that reads sample index `i` (a flat sample offset within the
 * page, NOT a byte offset) from a decoded IFD, returning its numeric value as a
 * JS number. Handles 8/16/32/64-bit samples in uint / int / float formats.
 *
 * UTIF normalises 16-bit data to little-endian during decode; wider samples
 * keep the file's byte order (img.isLE), so we mirror that here.
 */
function makeSampleReader(ifd) {
  const bps = tag(ifd, 't258', 8)
  const fmt = tag(ifd, 't339', 1) // 1=uint, 2=int, 3=float
  const bytes = ifd.data
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const le = bps === 16 ? true : ifd.isLE !== false

  switch (bps) {
    case 8:
      return fmt === 2
        ? (i) => dv.getInt8(i)
        : (i) => dv.getUint8(i)
    case 16:
      return fmt === 2
        ? (i) => dv.getInt16(i * 2, le)
        : (i) => dv.getUint16(i * 2, le)
    case 32:
      if (fmt === 3) return (i) => dv.getFloat32(i * 4, le)
      return fmt === 2
        ? (i) => dv.getInt32(i * 4, le)
        : (i) => dv.getUint32(i * 4, le)
    case 64:
      return (i) => dv.getFloat64(i * 8, le)
    default:
      // Unusual bit depth — fall back to byte reads so we degrade gracefully.
      return (i) => dv.getUint8(i)
  }
}
