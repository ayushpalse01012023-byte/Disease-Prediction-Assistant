import { useEffect } from 'react';
import useCamera from '../../hooks/useCamera';
import useVision from '../../hooks/useVision';

function CameraView() {
  const { videoRef, isActive, isLoading, error, startCamera, stopCamera } = useCamera();

  const {
    isOpenCVReady,
    isOpenCVLoading,
    isProcessing,
    processedFrame,
    error: visionError,
    startProcessing,
    stopProcessing,
  } = useVision(videoRef);

  // Ensure vision processing and camera stream are released together
  // when this view unmounts. useCamera/useVision each handle their own
  // internal cleanup; this just guarantees ordering at the integration level.
  useEffect(() => {
    return () => {
      stopProcessing();
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartCamera = () => {
    startCamera();
  };

  const handleStopCamera = () => {
    stopProcessing();
    stopCamera();
  };

  const handleStartProcessing = () => {
    startProcessing();
  };

  const handleStopProcessing = () => {
    stopProcessing();
  };

  const cameraStatusLabel = error
    ? `Camera error: ${error.message}`
    : isLoading
    ? 'Camera loading…'
    : isActive
    ? 'Camera active'
    : 'Camera inactive';

  const visionStatusLabel = visionError
    ? `Vision error: ${visionError.message}`
    : isOpenCVLoading
    ? 'OpenCV loading…'
    : isProcessing
    ? 'Processing frames'
    : isOpenCVReady
    ? 'OpenCV ready'
    : 'OpenCV not loaded';

  return (
    <section className="camera-view">
      <h2>Visual Analysis</h2>
      <p>The camera analysis module will appear here.</p>

      <div className="camera-viewport">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          aria-label="Live camera feed"
        />
      </div>

      <div className="camera-status" role="status" aria-live="polite">
        <p className="camera-status__camera">{cameraStatusLabel}</p>
        <p className="camera-status__vision">{visionStatusLabel}</p>
      </div>

      <div className="camera-controls">
        <button
          type="button"
          onClick={handleStartCamera}
          disabled={isLoading || isActive}
          aria-label="Start camera"
        >
          Start Camera
        </button>

        <button
          type="button"
          onClick={handleStopCamera}
          disabled={!isActive}
          aria-label="Stop camera"
        >
          Stop Camera
        </button>

        <button
          type="button"
          onClick={handleStartProcessing}
          disabled={!isActive || isProcessing || isOpenCVLoading}
          aria-label="Start vision processing"
        >
          Start Vision Processing
        </button>

        <button
          type="button"
          onClick={handleStopProcessing}
          disabled={!isProcessing}
          aria-label="Stop vision processing"
        >
          Stop Vision Processing
        </button>
      </div>

      {processedFrame?.dataUrl && (
        <div className="camera-processed-preview">
          <h3>Processed Frame Preview</h3>
          <img
            src={processedFrame.dataUrl}
            alt="Processed camera frame output"
            width={processedFrame.width}
            height={processedFrame.height}
          />
        </div>
      )}
    </section>
  );
}

export default CameraView;