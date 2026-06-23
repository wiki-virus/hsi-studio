import { useMemo } from 'react'
import Plot from 'react-plotly.js'
import { Activity } from 'lucide-react'
import useAppStore from '../../stores/useAppStore'

/**
 * SpectralPlot — renders spectral signature of selected pixel(s) using Plotly.
 *
 * Props:
 *  - spectrumData: { spectrum: Float32Array, wavelengths: Float32Array, x, y }
 */
export default function SpectralPlot({ spectrumData }) {
  const metadata = useAppStore(s => s.metadata)
  const pinnedSpectra = useAppStore(s => s.pinnedSpectra)
  const currentBand = useAppStore(s => s.currentBand)

  const plotData = useMemo(() => {
    const traces = []

    // Pinned spectra (faint background lines)
    pinnedSpectra.forEach((pinned, i) => {
      if (!pinned.spectrum) return
      const xValues = pinned.wavelengths
        ? Array.from(pinned.wavelengths)
        : Array.from({ length: pinned.spectrum.length }, (_, i) => i)

      traces.push({
        x: xValues,
        y: Array.from(pinned.spectrum),
        type: 'scatter',
        mode: 'lines',
        name: pinned.label || `Pinned (${pinned.x}, ${pinned.y})`,
        line: {
          color: pinned.color || `hsl(${(i * 60 + 180) % 360}, 70%, 60%)`,
          width: 1.5,
          dash: 'dot',
        },
        opacity: 0.6,
      })
    })

    // Current spectrum (main bold line)
    if (spectrumData?.spectrum) {
      const xValues = spectrumData.wavelengths
        ? Array.from(spectrumData.wavelengths)
        : metadata?.wavelengths
          ? metadata.wavelengths
          : Array.from({ length: spectrumData.spectrum.length }, (_, i) => i)

      traces.push({
        x: xValues,
        y: Array.from(spectrumData.spectrum),
        type: 'scatter',
        mode: 'lines',
        name: `Pixel (${spectrumData.x}, ${spectrumData.y})`,
        line: {
          color: '#4f8fff',
          width: 2,
        },
      })

      // Current band marker
      if (currentBand >= 0 && currentBand < xValues.length) {
        traces.push({
          x: [xValues[currentBand]],
          y: [spectrumData.spectrum[currentBand]],
          type: 'scatter',
          mode: 'markers',
          name: 'Current Band',
          marker: {
            color: '#ff4757',
            size: 8,
            symbol: 'circle',
            line: { color: '#fff', width: 1.5 },
          },
          showlegend: false,
        })
      }
    }

    return traces
  }, [spectrumData, pinnedSpectra, metadata, currentBand])

  const layout = useMemo(() => ({
    autosize: true,
    margin: { t: 10, r: 20, b: 40, l: 55 },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: {
      family: 'Inter, system-ui, sans-serif',
      size: 11,
      color: '#8888a0',
    },
    xaxis: {
      title: {
        text: metadata?.wavelengths ? 'Wavelength (nm)' : 'Band Index',
        font: { size: 11, color: '#5a5a72' },
      },
      gridcolor: 'rgba(255,255,255,0.04)',
      zerolinecolor: 'rgba(255,255,255,0.06)',
      linecolor: 'rgba(255,255,255,0.08)',
      tickfont: { size: 10, color: '#5a5a72' },
    },
    yaxis: {
      title: {
        text: 'Reflectance',
        font: { size: 11, color: '#5a5a72' },
      },
      gridcolor: 'rgba(255,255,255,0.04)',
      zerolinecolor: 'rgba(255,255,255,0.06)',
      linecolor: 'rgba(255,255,255,0.08)',
      tickfont: { size: 10, color: '#5a5a72' },
    },
    legend: {
      bgcolor: 'rgba(18, 18, 26, 0.8)',
      bordercolor: 'rgba(255,255,255,0.06)',
      borderwidth: 1,
      font: { size: 10, color: '#8888a0' },
      x: 1,
      xanchor: 'right',
      y: 1,
    },
    hovermode: 'x unified',
    hoverlabel: {
      bgcolor: '#1e1e32',
      bordercolor: 'rgba(79,143,255,0.3)',
      font: { size: 11, color: '#e8e8f0', family: 'JetBrains Mono, monospace' },
    },
    dragmode: 'zoom',
  }), [metadata])

  const config = useMemo(() => ({
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['autoScale2d', 'lasso2d', 'select2d', 'sendDataToCloud', 'toImage'],
    modeBarStyle: {
      backgroundColor: 'transparent',
    },
  }), [])

  if (!spectrumData) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon" style={{ opacity: 0.5 }}>
          <Activity size={32} />
        </div>
        <div className="empty-state-text">Click a pixel to see its spectrum</div>
      </div>
    )
  }

  return (
    <Plot
      data={plotData}
      layout={layout}
      config={config}
      style={{ width: '100%', height: '100%' }}
      useResizeHandler
    />
  )
}
