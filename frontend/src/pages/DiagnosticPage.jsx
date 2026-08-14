import { useEffect } from 'react';
import AppShell from '../components/layout/AppShell';
import ThreeScene from '../components/three/ThreeScene';
import DiagnosticPanel from '../components/ui/DiagnosticPanel';
import DiagnosticResult from '../components/ui/DiagnosticResult';
import CameraView from '../components/camera/CameraView';
import WellnessChallenge from '../components/wellness/WellnessChallenge';
import useCamera from '../hooks/useCamera';
import useVision from '../hooks/useVision';
import useHandTracking from '../hooks/useHandTracking';

function DiagnosticPage() {
  // DiagnosticPage owns the single shared camera stream, the single
  // OpenCV processing pipeline, and the single MediaPipe HandLandmarker
  // instance. CameraView and WellnessChallenge both consume this state
  // via props — neither creates its own instance of any of these hooks.
  const { videoRef, isActive, isLoading, error, startCamera, stopCamera } =
    useCamera();

  const {
    isOpenCVReady,
    isOpenCVLoading,
    isProcessing,
    processedFrame,
    error: visionError,
    startProcessing,
    stopProcessing,
  } = useVision(videoRef);

  const {
    isHandLandmarkerReady,
    isHandLandmarkerLoading,
    isTracking,
    error: handTrackingError,
    hands,
    indexFingerTips,
    startTracking,
    stopTracking,
  } = useHandTracking(videoRef);

  // Lifecycle cleanup lives here, since DiagnosticPage owns the hooks.
  useEffect(() => {
    return () => {
      stopTracking();
      stopProcessing();
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell>
      <main className="diagnostic-page">
        <ThreeScene />

        <DiagnosticPanel />

        <DiagnosticResult />

        <CameraView
          videoRef={videoRef}
          isActive={isActive}
          isLoading={isLoading}
          error={error}
          startCamera={startCamera}
          stopCamera={stopCamera}
          isOpenCVReady={isOpenCVReady}
          isOpenCVLoading={isOpenCVLoading}
          isProcessing={isProcessing}
          processedFrame={processedFrame}
          visionError={visionError}
          startProcessing={startProcessing}
          stopProcessing={stopProcessing}
          isHandLandmarkerReady={isHandLandmarkerReady}
          isHandLandmarkerLoading={isHandLandmarkerLoading}
          isTracking={isTracking}
          handTrackingError={handTrackingError}
          hands={hands}
          indexFingerTips={indexFingerTips}
          startTracking={startTracking}
          stopTracking={stopTracking}
        />

        <WellnessChallenge
  videoRef={videoRef}
  indexFingerTips={indexFingerTips}
  isTracking={isTracking}
/>
      </main>
    </AppShell>
  );
}

export default DiagnosticPage;