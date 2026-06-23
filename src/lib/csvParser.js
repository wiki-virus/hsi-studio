/**
 * csvParser.js — CSV file parser for HSI Studio (beta)
 *
 * Hyperspectral CSVs come in two main orientations and this parser
 * auto-detects which one it's looking at:
 *
 *   A) "wide" / pixel-per-row  — each ROW is a pixel, each COLUMN is a band.
 *      Band columns may be named with wavelengths ("450.5"), "band_N", or be
 *      bare numeric columns. Optional x/y/label columns are recognised.
 *
 *   B) "transposed" / band-per-row — each ROW is a band/wavelength, each
 *      COLUMN (after a leading wavelength column) is a pixel spectrum. This is
 *      the case the user flagged: "some csv might have bands and wavelength in
 *      opposite directions".
 *
 * The detector looks at every column/row so either direction is handled, and
 * falls back to the most plausible interpretation when ambiguous.
 *
 * Returns a datacube-like structure that can be fed straight to the worker.
 */

/**
 * Parse CSV text into a structured spectral dataset.
 *
 * @param {string} text — raw CSV text
 * @returns {{ datacube: Float32Array, metadata: object }}
 */
export function parseCsv(text) {
  const allLines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)

  if (allLines.length < 2) {
    throw new Error('CSV must have at least a header row and one data row.')
  }

  // Parse every line into cells (handles quotes, comma / tab / semicolon).
  const grid = allLines.map(parseRow)
  const numCols = grid[0].length

  // Keep only rows with the expected column count (tolerate stray blank cells).
  const headers = grid[0]
  const rows = grid.slice(1).filter((r) => r.length === numCols)

  if (rows.length === 0) {
    throw new Error('No valid data rows found in CSV.')
  }

  // ─── Decide orientation, then build the cube accordingly ───
  if (looksTransposed(headers, rows)) {
    return parseTransposed(headers, rows)
  }
  return parseWide(headers, rows)
}

// ─── Orientation detection ────────────────────────────────────────────────

const WAVELENGTH_AXIS_PATTERN =
  /^(wavelength|wavelengths|wave|wl|wvl|lambda|band|bands|nm|um|μm|frequency|channel)s?$/i

/**
 * Returns true when the data is laid out with bands down the rows and pixels
 * across the columns (orientation B).
 *
 * Signals (any strong one wins):
 *   - The first header cell names a wavelength/band axis, and there are
 *     multiple data columns to its right.
 *   - The first column's values are numeric and monotonic (a wavelength axis),
 *     while most of the other header cells are NOT plain band names — i.e. the
 *     spectral axis runs vertically rather than horizontally.
 */
function looksTransposed(headers, rows) {
  const firstHeader = (headers[0] || '').trim()
  const dataCols = headers.length - 1
  if (dataCols < 1) return false

  // Strong signal: leading column explicitly named as the wavelength axis.
  const namedAxis = WAVELENGTH_AXIS_PATTERN.test(firstHeader) || firstHeader === ''

  // Is the first column a monotonic numeric sequence (a wavelength ramp)?
  const firstColVals = rows.map((r) => parseFloat(r[0]))
  const firstColNumeric = firstColVals.every((v) => Number.isFinite(v))
  const firstColMonotonic = firstColNumeric && isMonotonic(firstColVals)

  // How "band-like" are the other column headers? In a wide layout they'd be
  // numeric wavelengths / band_N; in a transposed layout they're sample names.
  const otherHeaders = headers.slice(1)
  const bandLikeHeaders = otherHeaders.filter((h) => isBandHeader(h)).length
  const headersAreBandLike = bandLikeHeaders >= Math.max(2, otherHeaders.length * 0.5)

  if (namedAxis && dataCols >= 1 && (firstColMonotonic || firstColNumeric)) return true
  if (firstColMonotonic && !headersAreBandLike && rows.length >= 4) return true

  return false
}

function isMonotonic(vals) {
  let inc = true
  let dec = true
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] < vals[i - 1]) inc = false
    if (vals[i] > vals[i - 1]) dec = false
  }
  return inc || dec
}

function isBandHeader(h) {
  const t = (h || '').trim()
  return WAVELENGTH_PATTERN.test(t) || BAND_NAME_PATTERN.test(t)
}

// ─── Transposed layout (rows = bands, columns = pixels) ────────────────────

function parseTransposed(headers, rows) {
  const numBands = rows.length

  // First column = wavelength axis; every remaining column = one pixel spectrum.
  const wavelengths = rows.map((r) => {
    const v = parseFloat(r[0])
    return Number.isFinite(v) ? v : NaN
  })
  const haveWavelengths = wavelengths.every((v) => Number.isFinite(v))

  const pixelCols = []
  for (let c = 1; c < headers.length; c++) pixelCols.push(c)
  const numPixels = pixelCols.length

  if (numPixels < 1) {
    throw new Error('Transposed CSV has no pixel/spectrum columns.')
  }
  if (numBands < 2) {
    throw new Error(
      `Only found ${numBands} band row(s). A spectral dataset needs at least 2 bands.`
    )
  }

  // Arrange the pixel spectra into a roughly square grid (no spatial info given).
  const side = Math.ceil(Math.sqrt(numPixels))
  const samples = side
  const linesCount = Math.ceil(numPixels / side)

  // BIP order: [line, sample, band]
  const datacube = new Float32Array(linesCount * samples * numBands)
  for (let p = 0; p < numPixels; p++) {
    const col = pixelCols[p]
    for (let b = 0; b < numBands; b++) {
      const v = parseFloat(rows[b][col])
      datacube[p * numBands + b] = Number.isFinite(v) ? v : 0
    }
  }

  return {
    datacube,
    metadata: {
      samples,
      lines: linesCount,
      bands: numBands,
      dataType: 4,
      dataTypeSize: 4,
      interleave: 'bip',
      byteOrder: 0,
      wavelengths: haveWavelengths ? wavelengths : null,
      csvInfo: {
        orientation: 'transposed (rows = bands, columns = pixels)',
        totalRows: rows.length,
        totalCols: headers.length,
        wavelengthCol: headers[0] || '(unnamed)',
        pixelColumns: numPixels,
      },
    },
  }
}

// ─── Wide layout (rows = pixels, columns = bands) ──────────────────────────

function parseWide(headers, rows) {
  const numCols = headers.length
  const columnInfo = classifyColumns(headers, rows)

  const bandIndices = columnInfo.bandColumns
  const numBands = bandIndices.length

  if (numBands < 2) {
    throw new Error(
      `Only found ${numBands} spectral column(s). A spectral dataset needs at least 2 bands. ` +
        `Detected columns: ${headers.join(', ')}`
    )
  }

  const numPixels = rows.length

  // Determine spatial layout from coordinate columns when available.
  let samples
  let linesCount
  if (columnInfo.xCol !== null && columnInfo.yCol !== null) {
    const xVals = new Set(rows.map((r) => parseFloat(r[columnInfo.xCol])))
    const yVals = new Set(rows.map((r) => parseFloat(r[columnInfo.yCol])))
    samples = xVals.size
    linesCount = yVals.size
    if (samples * linesCount !== numPixels) {
      samples = numPixels
      linesCount = 1
    }
  } else {
    const side = Math.ceil(Math.sqrt(numPixels))
    samples = side
    linesCount = Math.ceil(numPixels / side)
  }

  // BIP order: [line, sample, band]
  const datacube = new Float32Array(linesCount * samples * numBands)
  for (let i = 0; i < numPixels; i++) {
    const row = rows[i]
    for (let b = 0; b < numBands; b++) {
      const value = parseFloat(row[bandIndices[b]])
      datacube[i * numBands + b] = Number.isFinite(value) ? value : 0
    }
  }

  const wavelengths = columnInfo.wavelengths

  return {
    datacube,
    metadata: {
      samples,
      lines: linesCount,
      bands: numBands,
      dataType: 4,
      dataTypeSize: 4,
      interleave: 'bip',
      byteOrder: 0,
      wavelengths: wavelengths.length === numBands ? wavelengths : null,
      csvInfo: {
        orientation: 'wide (rows = pixels, columns = bands)',
        totalRows: rows.length,
        totalCols: numCols,
        bandColumns: bandIndices.map((i) => headers[i]),
        xCol: columnInfo.xCol !== null ? headers[columnInfo.xCol] : null,
        yCol: columnInfo.yCol !== null ? headers[columnInfo.yCol] : null,
        labelCol: columnInfo.labelCol !== null ? headers[columnInfo.labelCol] : null,
      },
    },
  }
}

// ─── Column Classification (wide layout) ───────────────────────────────────

const COORD_X_PATTERNS = /^(x|col|column|sample|pixel_x|px|x_coord|x_pos|longitude|lon|easting)$/i
const COORD_Y_PATTERNS = /^(y|row|line|pixel_y|py|y_coord|y_pos|latitude|lat|northing)$/i
const SKIP_PATTERNS = /^(id|index|idx|class|label|category|target|mask|gt|ground_truth|name|filename|file|timestamp|date|time)$/i
const LABEL_PATTERNS = /^(class|label|category|target|mask|gt|ground_truth|classification)$/i
const BAND_NAME_PATTERN = /^band[_\s]?(\d+)$/i
const WAVELENGTH_PATTERN = /^(\d+\.?\d*)\s*(nm|um|μm)?$/

function classifyColumns(headers, rows) {
  let xCol = null
  let yCol = null
  let labelCol = null
  const bandColumns = []
  const wavelengths = []

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim()

    if (xCol === null && COORD_X_PATTERNS.test(h)) {
      xCol = i
      continue
    }
    if (yCol === null && COORD_Y_PATTERNS.test(h)) {
      yCol = i
      continue
    }
    if (labelCol === null && LABEL_PATTERNS.test(h)) {
      labelCol = i
      continue
    }
    if (SKIP_PATTERNS.test(h)) {
      continue
    }

    const wlMatch = h.match(WAVELENGTH_PATTERN)
    if (wlMatch) {
      bandColumns.push(i)
      wavelengths.push(parseFloat(wlMatch[1]))
      continue
    }

    const bandMatch = h.match(BAND_NAME_PATTERN)
    if (bandMatch) {
      bandColumns.push(i)
      wavelengths.push(parseInt(bandMatch[1], 10))
      continue
    }

    const isNumeric = rows.slice(0, Math.min(20, rows.length)).every((row) => {
      const v = row[i]
      return v !== '' && v !== null && v !== undefined && !isNaN(parseFloat(v))
    })

    if (isNumeric) {
      bandColumns.push(i)
      const numHeader = parseFloat(h)
      if (!isNaN(numHeader)) {
        wavelengths.push(numHeader)
      } else {
        wavelengths.push(bandColumns.length - 1)
      }
    }
  }

  return { xCol, yCol, labelCol, bandColumns, wavelengths }
}

// ─── Row Parsing ───────────────────────────────────────────────────────────

/**
 * Parse a CSV row, handling quoted fields and comma / tab / semicolon delimiters.
 */
function parseRow(line) {
  const result = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',' || ch === '\t' || ch === ';') {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
  }
  result.push(current.trim())
  return result
}
