# HSI Studio

A fast, browser-based Hyperspectral Image (HSI) viewer and annotation tool. Built for scientific imaging data with high-performance WebGL rendering and Web Worker data processing.

## Features

- **Format Support:** 
  - ENVI (`.hdr` + `.dat` / `.raw`)
  - NumPy Archives (`.npz` containing datacubes)
  - CSV spectral data
- **Fast WebGL Rendering:** Renders massive hyperspectral datacubes instantly using custom WebGL shaders.
- **RGB Compositing:** Dynamic True Color and False Color composites with customizable RGB band mapping.
- **Interactive Spectral Plots:** Click any pixel to view its full spectral signature across all bands in an interactive Plotly chart.
- **Annotation Tools:**
  - Brush and Eraser tools with adjustable size, hardness (soft/binary), and opacity.
  - Rectangle / Crop tool to sub-select regions of interest.
- **Export & Save:** Export full datacubes (ENVI/NPZ) or just annotation masks (PNG/NPZ/Raw).

## Tech Stack

- **React + Vite:** Fast, modern frontend architecture.
- **Zustand:** Lightweight global state management.
- **WebGL2:** For hardware-accelerated 32-bit float texture rendering.
- **Web Workers:** Offloads heavy data parsing and array manipulation (percentile calculations, band extraction) to prevent UI blocking.
- **Plotly.js:** High-performance charting for spectral signatures.

## Getting Started

### Prerequisites
- Node.js (v16+ recommended)
- npm or yarn

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

## Deployment (Vercel)

This project is fully ready to be deployed on Vercel:
1. Import this repository in your Vercel dashboard.
2. The default Vite build settings will be automatically detected:
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Click **Deploy**.
