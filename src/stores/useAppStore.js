/**
 * useAppStore.js — Zustand global state for HSI Studio
 *
 * This store holds ONLY lightweight UI / metadata state.
 * Large binary data (datacube, band images, RGB composites) is managed
 * inside the Web Worker and passed through refs — never stored here.
 *
 * Sections:
 *   1. File state       — loaded flag, file name, header metadata
 *   2. Viewer state     — band selection, view mode, contrast, colormap
 *   3. Interaction      — selected pixel, pinned spectra, spectral plot toggle
 *   4. Annotation       — tool mode, brush settings, mask overlay config
 *   5. Zoom / Pan       — viewport transform
 *   6. Actions          — setter functions for all of the above
 */

import { create } from 'zustand';

const useAppStore = create((set, get) => ({
  // -----------------------------------------------------------------------
  // 1. File state
  // -----------------------------------------------------------------------
  /** Whether a valid datacube has been loaded */
  fileLoaded: false,
  /** Display name of the loaded file (or primary file) */
  fileName: '',
  /** Array of file names loaded in the time series */
  fileNames: [],
  /** Array of metadata objects for each frame */
  timeSeries: [],
  /** Currently active time frame index */
  currentFrame: 0,
  /**
   * Parsed ENVI header metadata for the current frame
   * Shape: { samples, lines, bands, dataType, interleave, wavelengths, byteOrder }
   */
  metadata: null,

  // -----------------------------------------------------------------------
  // 2. Viewer state
  // -----------------------------------------------------------------------
  /** Currently displayed band index (0-based) */
  currentBand: 0,
  /** Display mode — single greyscale band or three-band RGB composite */
  viewMode: 'single', // 'single' | 'rgb'
  /** Band indices used for the RGB composite */
  rgbBands: { r: 0, g: 0, b: 0 },
  /** Contrast / brightness controls */
  contrast: { min: 0, max: 1, gamma: 1.0 },
  /** When true, auto-stretch using 1st / 99th percentile (recommended) */
  autoStretch: true,
  /** Active colormap for single-band display */
  colormap: 'grayscale',

  // -----------------------------------------------------------------------
  // 3. Interaction state
  // -----------------------------------------------------------------------
  /** Currently hovered / clicked pixel coordinates */
  selectedPixel: null, // { x, y }
  /** Spectra that the user has pinned for comparison */
  pinnedSpectra: [], // [{ x, y, color, label }]
  /** Whether the spectral plot panel is visible */
  showSpectralPlot: true,

  // -----------------------------------------------------------------------
  // 4. Annotation state
  // -----------------------------------------------------------------------
  /** Current annotation tool mode */
  annotationMode: 'view', // 'view' | 'brush' | 'eraser' | 'rectangle' | 'polygon' | 'lasso'
  /** Brush diameter in pixels */
  brushSize: 10,
  /** Brush edge hardness (0–100) */
  brushHardness: 100,
  /** Brush stroke opacity (0.0–1.0) */
  brushOpacity: 1.0,
  /** Whether the annotation mask overlay is visible */
  showMaskOverlay: true,
  /** Opacity of the mask overlay (0.0–1.0) */
  maskOpacity: 0.4,
  /** Color used to render the mask overlay */
  maskColor: '#ff4444',

  // -----------------------------------------------------------------------
  // 5. Zoom / Pan
  // -----------------------------------------------------------------------
  /** Current zoom level (1.0 = 100 %) */
  zoom: 1.0,
  /** Pixel offset for panning */
  panOffset: { x: 0, y: 0 },

  // -----------------------------------------------------------------------
  // 6. Actions
  // -----------------------------------------------------------------------

  // --- File actions ---
  /** Mark a file as loaded and store its metadata; resets band to 0 */
  setFileLoaded: (fileName, metadata) =>
    set({ fileLoaded: true, fileName, fileNames: [fileName], timeSeries: [metadata], metadata, currentFrame: 0, currentBand: 0 }),
  
  /** Load multiple files for time-series playback */
  setTimeSeriesLoaded: (fileNames, timeSeriesMetadata) =>
    set({ 
      fileLoaded: true, 
      fileName: fileNames[0], 
      fileNames, 
      timeSeries: timeSeriesMetadata, 
      metadata: timeSeriesMetadata[0], 
      currentFrame: 0, 
      currentBand: 0 
    }),

  setCurrentFrame: (frame) => 
    set((s) => ({ 
      currentFrame: frame, 
      metadata: s.timeSeries[frame] || s.metadata,
      fileName: s.fileNames[frame] || s.fileName 
    })),

  // --- Viewer actions ---
  setCurrentBand: (band) => set({ currentBand: band }),
  setViewMode:    (mode) => set({ viewMode: mode }),
  setRGBBands:    (bands) => set({ rgbBands: bands }),
  setContrast:    (contrast) => set({ contrast }),
  setAutoStretch: (enabled) => set({ autoStretch: enabled }),
  setColormap:    (colormap) => set({ colormap }),

  // --- Interaction actions ---
  setSelectedPixel: (pixel) => set({ selectedPixel: pixel }),

  /** Append a spectrum to the pinned list */
  addPinnedSpectrum: (spectrum) =>
    set((s) => ({ pinnedSpectra: [...s.pinnedSpectra, spectrum] })),

  /** Remove a pinned spectrum by its index */
  removePinnedSpectrum: (index) =>
    set((s) => ({
      pinnedSpectra: s.pinnedSpectra.filter((_, i) => i !== index),
    })),

  /** Clear all pinned spectra */
  clearPinnedSpectra: () => set({ pinnedSpectra: [] }),

  /** Toggle spectral plot panel visibility */
  toggleSpectralPlot: () =>
    set((s) => ({ showSpectralPlot: !s.showSpectralPlot })),

  // --- Annotation actions ---
  setAnnotationMode: (mode) => set({ annotationMode: mode }),
  setBrushSize:      (size) => set({ brushSize: size }),
  setBrushHardness:  (hardness) => set({ brushHardness: hardness }),
  setBrushOpacity:   (opacity) => set({ brushOpacity: opacity }),
  setShowMaskOverlay:(visible) => set({ showMaskOverlay: visible }),
  setMaskOpacity:    (opacity) => set({ maskOpacity: opacity }),
  setMaskColor:      (color) => set({ maskColor: color }),

  // --- Zoom / Pan actions ---
  setZoom:      (zoom) => set({ zoom }),
  setPanOffset: (offset) => set({ panOffset: offset }),

  /** Reset the viewport to default zoom and position */
  resetView: () => set({ zoom: 1.0, panOffset: { x: 0, y: 0 } }),
}));

export default useAppStore;
