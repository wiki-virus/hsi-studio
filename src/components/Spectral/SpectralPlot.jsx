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

  const addPinnedSpectrum = useAppStore(s => s.addPinnedSpectrum)
  const removePinnedSpectrum = useAppStore(s => s.removePinnedSpectrum)
  const updatePinnedSpectrum = useAppStore(s => s.updatePinnedSpectrum)

  const config = useMemo(() => ({
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['autoScale2d', 'lasso2d', 'select2d', 'sendDataToCloud'],
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

  const handlePin = () => {
    if (!spectrumData) return
    const COLORS = ['#ff4757', '#ffa502', '#2ed573', '#1e90ff', '#3742fa', '#ff5285', '#be2edd']
    const color = COLORS[pinnedSpectra.length % COLORS.length]
    addPinnedSpectrum({
      x: spectrumData.x,
      y: spectrumData.y,
      spectrum: spectrumData.spectrum,
      wavelengths: spectrumData.wavelengths,
      color: color,
      label: `Pixel ${pinnedSpectra.length + 1}`
    })
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Plot
        data={plotData}
        layout={layout}
        config={config}
        style={{ width: '100%', height: '100%' }}
        useResizeHandler
      />
      
      {/* Pinned Spectra UI overlay */}
      <div style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        zIndex: 10
      }}>
        <button
          onClick={handlePin}
          style={{
            background: 'var(--bg-tertiary)',
            border: 'var(--border-default)',
            color: 'var(--text-primary)',
            padding: '4px 8px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          + Pin Current
        </button>

        {pinnedSpectra.map((pinned, i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'var(--bg-secondary)',
            border: 'var(--border-default)',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px'
          }}>
            <input 
              type="color" 
              value={pinned.color && pinned.color.startsWith('#') ? pinned.color : '#ffffff'} 
              // Convert hsl to hex or just store it. Actually, color picker needs hex! 
              // Wait, HTML color picker needs a hex color `#rrggbb`.
              // We should probably convert hsl to hex, or just let them pick and it will be hex.
              // To handle this simply without color conversion library:
              // Let's use a small invisible color picker overlay on top of the circle, or just the input.
              // We will just let the value be the color if it's hex, otherwise the browser will default to black, and picking a new one will set it to hex.
              // A better way is to provide a clean input:
              onChange={(e) => updatePinnedSpectrum(i, { color: e.target.value })}
              style={{
                width: 16, height: 16, padding: 0, border: 'none', borderRadius: '50%', cursor: 'pointer',
                background: 'transparent'
              }}
              title="Change trace color"
            />
            <input 
              type="text" 
              value={pinned.label}
              onChange={(e) => updatePinnedSpectrum(i, { label: e.target.value })}
              style={{ 
                background: 'transparent', border: 'none', color: 'var(--text-primary)', 
                width: '60px', outline: 'none', fontSize: '12px' 
              }}
              title="Rename trace"
            />
            <button
              onClick={() => removePinnedSpectrum(i)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: '0 4px',
                marginLeft: '4px'
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
