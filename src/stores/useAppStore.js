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

const useAppStore = create((set) => ({
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
  /** Any mask data found inside the uploaded file */
  initialMaskData: null,

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
  annotationMode: 'view', // 'view' | 'brush' | 'eraser' | 'polygon' | 'lasso' | 'wand'
  /** Brush diameter in pixels */
  brushSize: 10,
  /** Wand spectral similarity tolerance (radians for SAM) */
  wandTolerance: 0.1,
  /** Whether the annotation mask overlay is visible */
  showMaskOverlay: true,
  /** Opacity of the mask overlay (0.0–1.0) */
  maskOpacity: 0.4,

  /** List of regions of interest (ROIs) for batch export */
  rois: [], // [{ id, name, x, y, w, h }]

  /** ML Classes for discrete multi-class annotation */
  classes: [
    { id: 1, name: 'Class 1', color: '#ff4444' }
  ],
  /** The currently selected class ID for drawing/wand */
  activeClassId: 1,

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
  setFileLoaded: (fileName, metadata, initialMaskData = null) =>
    set({ 
      fileLoaded: true, 
      fileName, 
      fileNames: [fileName], 
      timeSeries: [{ ...metadata, originalSamples: metadata.samples, originalLines: metadata.lines }], 
      metadata: { ...metadata, originalSamples: metadata.samples, originalLines: metadata.lines }, 
      currentFrame: 0, 
      currentBand: 0, 
      initialMaskData 
    }),
  
  /** Load multiple files for time-series playback */
  setTimeSeriesLoaded: (fileNames, timeSeriesMetadata, initialMaskData = null) => {
    const enrichedTimeSeries = timeSeriesMetadata.map(m => ({ ...m, originalSamples: m.samples, originalLines: m.lines }))
    return set({ 
      fileLoaded: true, 
      fileName: fileNames[0], 
      fileNames, 
      timeSeries: enrichedTimeSeries, 
      metadata: enrichedTimeSeries[0], 
      currentFrame: 0, 
      currentBand: 0,
      initialMaskData 
    })
  },

  setCurrentFrame: (frame) => 
    set((s) => ({ 
      currentFrame: frame, 
      metadata: s.timeSeries[frame] || s.metadata,
      fileName: s.fileNames[frame] || s.fileName 
    })),

  // --- Viewer actions ---
  setCurrentBand: (band) => set({ currentBand: band }),
  setViewMode: (mode) => set((s) => {
    if (mode === 'rgb' && s.rgbBands.r === 0 && s.rgbBands.g === 0 && s.rgbBands.b === 0) {
      return { 
        viewMode: mode, 
        rgbBands: { r: s.currentBand, g: s.currentBand, b: s.currentBand } 
      }
    }
    return { viewMode: mode }
  }),
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

  /** Update a pinned spectrum by its index */
  updatePinnedSpectrum: (index, updates) =>
    set((s) => {
      const newSpectra = [...s.pinnedSpectra]
      newSpectra[index] = { ...newSpectra[index], ...updates }
      return { pinnedSpectra: newSpectra }
    }),

  /** Clear all pinned spectra */
  clearPinnedSpectra: () => set({ pinnedSpectra: [] }),

  /** Toggle spectral plot panel visibility */
  toggleSpectralPlot: () =>
    set((s) => ({ showSpectralPlot: !s.showSpectralPlot })),

  // --- Annotation actions ---
  setAnnotationMode: (mode) => set({ annotationMode: mode }),
  setBrushSize:      (size) => set({ brushSize: size }),
  setWandTolerance:  (tolerance) => set({ wandTolerance: tolerance }),
  setShowMaskOverlay:(visible) => set({ showMaskOverlay: visible }),
  setMaskOpacity:    (opacity) => set({ maskOpacity: opacity }),

  setActiveClassId:  (id) => set({ activeClassId: id }),
  addClass:          (newClass) => set((s) => ({ classes: [...s.classes, newClass] })),
  updateClass:       (id, updates) => set((s) => ({
    classes: s.classes.map(c => c.id === id ? { ...c, ...updates } : c)
  })),
  removeClass:       (id) => set((s) => ({
    classes: s.classes.filter(c => c.id !== id),
    activeClassId: s.activeClassId === id ? (s.classes.find(c => c.id !== id)?.id || 1) : s.activeClassId
  })),

  // --- ROI actions ---
  addRoi: (roi) => set((s) => ({ rois: [...s.rois, roi] })),
  updateRoi: (id, updates) => set((s) => ({
    rois: s.rois.map(r => r.id === id ? { ...r, ...updates } : r)
  })),
  removeRoi: (id) => set((s) => ({ rois: s.rois.filter(r => r.id !== id) })),
  clearRois: () => set({ rois: [] }),

  // --- Zoom / Pan actions ---
  setZoom:      (zoom) => set({ zoom }),
  setPanOffset: (offset) => set({ panOffset: offset }),

  /** Reset the viewport to default zoom and position */
  resetView: () => set({ zoom: 1.0, panOffset: { x: 0, y: 0 } }),

  /** Close the current file and return to the landing page */
  closeFile: () => set({ 
    fileLoaded: false, 
    metadata: null, 
    fileName: '', 
    fileNames: [], 
    timeSeries: [],
    initialMaskData: null,
    pinnedSpectra: [],
    rois: [],
    currentBand: 0,
    currentFrame: 0,
    selectedPixel: null,
    annotationMode: 'view'
  }),
}));

export default useAppStore;
