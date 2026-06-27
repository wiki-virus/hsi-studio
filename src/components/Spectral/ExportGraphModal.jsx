import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import Plot from 'react-plotly.js'
import useAppStore from '../../stores/useAppStore'
import { X, Download, Trash2 } from 'lucide-react'

export default function ExportGraphModal({ onClose }) {
  const metadata = useAppStore(s => s.metadata)
  const globalPinnedSpectra = useAppStore(s => s.pinnedSpectra)
  const spectrumData = useAppStore(s => s.spectrumData)

  // Local state for export customization
  const [width, setWidth] = useState(800)
  const [height, setHeight] = useState(500)
  const [theme, setTheme] = useState('light') // 'light' or 'dark'
  
  // Clone pinned spectra into local state so edits (thickness/dash) don't affect main app
  const [traces, setTraces] = useState(() => {
    return globalPinnedSpectra.map(t => ({
      ...t,
      width: 2,
      dash: 'solid', // 'solid', 'dot', 'dash', 'longdash', 'dashdot'
    }))
  })

  const handleTraceChange = (index, field, value) => {
    setTraces(prev => {
      const newTraces = [...prev]
      newTraces[index] = { ...newTraces[index], [field]: value }
      return newTraces
    })
  }

  const handleDeleteTrace = (index) => {
    setTraces(prev => prev.filter((_, i) => i !== index))
  }

  const plotData = useMemo(() => {
    const data = []
    traces.forEach((pinned) => {
      data.push({
        x: pinned.wavelengths || metadata?.wavelengths,
        y: Array.from(pinned.spectrum),
        type: 'scatter',
        mode: 'lines',
        name: pinned.label || `Pixel (${pinned.x}, ${pinned.y})`,
        line: {
          color: pinned.color,
          width: Number(pinned.width),
          dash: pinned.dash,
        },
      })
    })

    // Include the main spectrum line if it exists
    if (spectrumData?.spectrum) {
      data.push({
        x: spectrumData.wavelengths || metadata?.wavelengths,
        y: Array.from(spectrumData.spectrum),
        type: 'scatter',
        mode: 'lines',
        name: `Current Pixel`,
        showlegend: false,
        line: {
          color: '#4f8fff',
          width: 2,
          dash: 'solid',
        },
      })
    }

    return data
  }, [traces, spectrumData, metadata])

  const layout = useMemo(() => {
    const isDark = theme === 'dark'
    const bgColor = isDark ? '#1a1a24' : '#ffffff'
    const fontColor = isDark ? '#d0d0d0' : '#333333'
    const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'

    return {
      autosize: false,
      width,
      height,
      margin: { t: 40, r: 40, b: 60, l: 60 },
      paper_bgcolor: bgColor,
      plot_bgcolor: bgColor,
      font: {
        family: 'Inter, system-ui, sans-serif',
        color: fontColor,
      },
      xaxis: {
        title: { text: metadata?.wavelengths ? 'Wavelength (nm)' : 'Band Index' },
        gridcolor: gridColor,
        zerolinecolor: gridColor,
      },
      yaxis: {
        title: { text: 'Reflectance' },
        gridcolor: gridColor,
        zerolinecolor: gridColor,
      },
      legend: {
        x: 1,
        y: 1,
        xanchor: 'right',
        bgcolor: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.8)',
      }
    }
  }, [width, height, theme, metadata])

  const handleDownload = () => {
    const btn = document.querySelector('#export-plotly-graph .modebar-btn[data-title*="ownload"]')
    if (btn) btn.click()
  }

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '40px'
    }}>
      <div style={{
        background: 'var(--bg-secondary)',
        borderRadius: '8px',
        width: '100%', maxWidth: '1200px', height: '100%', maxHeight: '800px',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 24px', borderBottom: 'var(--border-default)',
          background: 'var(--bg-primary)'
        }}>
          <h2 style={{ margin: 0, fontSize: '18px', color: 'var(--text-primary)' }}>Extended Graph Export</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Sidebar Controls */}
          <div style={{
            width: '320px', borderRight: 'var(--border-default)', padding: '20px',
            overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px'
          }}>
            {/* Dimensions */}
            <div>
              <h3 style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Dimensions (px)</h3>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>Width</label>
                  <input type="number" value={width} onChange={e => setWidth(Number(e.target.value))} style={{ width: '100%', background: 'var(--bg-tertiary)', border: 'var(--border-default)', color: 'var(--text-primary)', padding: '6px', borderRadius: '4px' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>Height</label>
                  <input type="number" value={height} onChange={e => setHeight(Number(e.target.value))} style={{ width: '100%', background: 'var(--bg-tertiary)', border: 'var(--border-default)', color: 'var(--text-primary)', padding: '6px', borderRadius: '4px' }} />
                </div>
              </div>
            </div>

            {/* Theme */}
            <div>
              <h3 style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Theme</h3>
              <select value={theme} onChange={e => setTheme(e.target.value)} style={{ width: '100%', background: 'var(--bg-tertiary)', border: 'var(--border-default)', color: 'var(--text-primary)', padding: '6px', borderRadius: '4px' }}>
                <option value="light">Light (Print-Friendly)</option>
                <option value="dark">Dark (Presentation)</option>
              </select>
            </div>

            {/* Traces */}
            <div>
              <h3 style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Traces</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {traces.map((trace, i) => (
                  <div key={i} style={{ background: 'var(--bg-primary)', padding: '12px', borderRadius: '6px', border: 'var(--border-default)' }}>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                      <input type="color" value={trace.color || '#ffffff'} onChange={e => handleTraceChange(i, 'color', e.target.value)} style={{ width: 20, height: 20, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                      <input type="text" value={trace.label} onChange={e => handleTraceChange(i, 'label', e.target.value)} style={{ flex: 1, background: 'var(--bg-tertiary)', border: 'var(--border-default)', color: 'var(--text-primary)', padding: '4px 8px', borderRadius: '4px', fontSize: '12px' }} />
                      <button onClick={() => handleDeleteTrace(i)} style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '4px' }} title="Delete Trace">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '10px', color: 'var(--text-tertiary)', display: 'block', marginBottom: '2px' }}>Line Type</label>
                        <select value={trace.dash} onChange={e => handleTraceChange(i, 'dash', e.target.value)} style={{ width: '100%', background: 'var(--bg-tertiary)', border: 'var(--border-default)', color: 'var(--text-primary)', padding: '4px', borderRadius: '4px', fontSize: '12px' }}>
                          <option value="solid">Solid</option>
                          <option value="dot">Dotted</option>
                          <option value="dash">Dashed</option>
                          <option value="longdash">Long Dash</option>
                          <option value="dashdot">Dash Dot</option>
                        </select>
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '10px', color: 'var(--text-tertiary)', display: 'block', marginBottom: '2px' }}>Width</label>
                        <input type="number" min="1" max="10" value={trace.width} onChange={e => handleTraceChange(i, 'width', e.target.value)} style={{ width: '100%', background: 'var(--bg-tertiary)', border: 'var(--border-default)', color: 'var(--text-primary)', padding: '4px', borderRadius: '4px', fontSize: '12px' }} />
                      </div>
                    </div>
                  </div>
                ))}
                {traces.length === 0 && <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>No pinned traces available.</div>}
              </div>
            </div>

            {/* Action */}
            <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
              <button onClick={handleDownload} style={{ width: '100%', background: 'var(--accent-primary)', color: '#fff', border: 'none', padding: '10px', borderRadius: '6px', fontSize: '14px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }}>
                <Download size={18} />
                Download High-Res PNG
              </button>
            </div>
          </div>

          {/* Graph Preview Area */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)', padding: '20px', overflow: 'auto' }}>
            {/* We wrap Plotly in a fixed dimension div so it doesn't auto-resize, showing exact export size */}
            <div id="export-plotly-graph" style={{ width, height, boxShadow: '0 4px 12px rgba(0,0,0,0.2)', background: theme === 'dark' ? '#1a1a24' : '#fff' }}>
              <style>{`
                #export-plotly-graph .modebar-container { display: none !important; }
              `}</style>
              <Plot
                data={plotData}
                layout={layout}
                config={{ displayModeBar: true, displaylogo: false }}
                style={{ width: '100%', height: '100%' }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
