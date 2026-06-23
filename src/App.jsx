import { useState, useCallback, useRef } from 'react'
import useAppStore from './stores/useAppStore'
import LandingPage from './pages/LandingPage'
import ViewerPage from './pages/ViewerPage'

import { Analytics } from "@vercel/analytics/react"

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
        <ViewerPage datacubeRef={datacubeRef} workerRef={workerRef} inputFormat={inputFormat} />
      ) : (
        <LandingPage datacubeRef={datacubeRef} workerRef={workerRef} onFormatDetected={setInputFormat} />
      )}
      <Analytics />
    </>
  )
}
