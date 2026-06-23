<div align="center">

# HSI Studio

**High-Performance In-Browser Hyperspectral Imaging & Annotation Interface**

![Frontend](https://img.shields.io/badge/Frontend-React_18-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Build](https://img.shields.io/badge/Build-Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Graphics](https://img.shields.io/badge/Graphics-WebGL2-990000?style=for-the-badge&logo=webgl&logoColor=white)
![State](https://img.shields.io/badge/State-Zustand-443E38?style=for-the-badge)

</div>

<br />

A fast, browser-based Hyperspectral Image (HSI) viewer and annotation tool. Built for scientific imaging data with high-performance WebGL rendering and Web Worker data processing.

## 🚀 Features

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

## 📖 Usage Directions

1. **Loading Data:** Drag and drop your `.hdr` and `.dat` files simultaneously (or a single `.npz` file) into the landing page.
2. **Navigating Bands:** Use the slider in the sidebar or simply scroll your mouse wheel over the image to cycle through the spectral bands.
3. **RGB Mode:** Toggle "RGB Composite" in the top toolbar to map specific wavelengths to the Red, Green, and Blue channels.
4. **Annotating:** Select the "Brush" tool from the top toolbar to paint masks. You can toggle between a soft gradient brush or a binary mask brush in the sidebar.
5. **Cropping:** Select the "Crop" tool, drag a rectangle over the image, and click "Apply Crop" to extract a sub-region.
6. **Exporting:** Click the "Save" button in the top right to download your cropped datacube, RGB image, or annotation masks.

## 💻 Local Development

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

## ⚖️ Copyright & License

**Copyright © 2026. All Rights Reserved.**

This software and its source code are the proprietary property of the author. Unauthorized copying, modification, distribution, or use of this code, via any medium, is strictly prohibited. This repository is provided for view-only purposes; no license is granted for external use or contribution.
