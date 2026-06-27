import { useState, useRef } from 'react'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import useAppStore from './stores/useAppStore'
import { Suspense, lazy } from 'react'
import LandingPage from './pages/LandingPage'
const ViewerPage = lazy(() => import('./pages/ViewerPage'))
export default function App() {
  const fileLoaded = useAppStore(s => s.fileLoaded)
  
  // Ref to hold the raw datacube ArrayBuffer (kept outside React state for performance)
  const datacubeRef = useRef(null)
  // Ref to hold the web worker
  const workerRef = useRef(null)
  // Track the input file format so save dialog can default to it
  const [inputFormat, setInputFormat] = useState(null) // 'envi' | 'npz'

  return (
    <>
      {fileLoaded ? (
        <Suspense fallback={<div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>Loading Viewer...</div>}>
          <ViewerPage datacubeRef={datacubeRef} workerRef={workerRef} inputFormat={inputFormat} />
        </Suspense>
      ) : (
        <LandingPage datacubeRef={datacubeRef} workerRef={workerRef} onFormatDetected={setInputFormat} />
      )}
      <Analytics />
      <SpeedInsights />
    </>
  )
}
