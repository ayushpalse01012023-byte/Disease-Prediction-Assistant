function CameraView({
  videoRef,
  isActive,
  isLoading,
  error,
  startCamera,
  stopCamera,

  isOpenCVReady,
  isOpenCVLoading,
  isProcessing,
  processedFrame,
  visionError,
  startProcessing,
  stopProcessing,

  isHandLandmarkerReady,
  isHandLandmarkerLoading,
  isTracking,
  handTrackingError,
  hands,
  indexFingerTips,
  startTracking,
  stopTracking,
}) {
  const handleStartCamera = () => {
    startCamera();
  };

  const handleStopCamera = () => {
    // Camera is the foundation subsystem — stopping it stops everything
    // that depends on a live video feed.
    stopTracking();
    stopProcessing();
    stopCamera();
  };

  const handleStartProcessing = () => {
    startProcessing();
  };

  const handleStopProcessing = () => {
    stopProcessing();
  };

  const handleStartTracking = () => {
    startTracking();
  };

  const handleStopTracking = () => {
    stopTracking();
  };

  const cameraStatusLabel = error
    ? `Camera error: ${error.message}`
    : isLoading
    ? 'Camera loading…'
    : isActive
    ? 'Camera active'
    : 'Camera inactive';

  const visionStatusLabel = visionError
    ? `OpenCV error: ${visionError.message}`
    : isOpenCVLoading
    ? 'OpenCV loading…'
    : isProcessing
    ? 'OpenCV processing'
    : isOpenCVReady
    ? 'OpenCV ready'
    : 'OpenCV not loaded';

  const handTrackingStatusLabel = handTrackingError
    ? `MediaPipe error: ${handTrackingError.message}`
    : isHandLandmarkerLoading
    ? 'MediaPipe loading…'
    : isTracking
    ? 'MediaPipe tracking'
    : isHandLandmarkerReady
    ? 'MediaPipe ready'
    : 'MediaPipe not loaded';

  const handDetected = hands.length > 0;

  return (
    <section className="camera-view">
      <h2>Visual Analysis</h2>
      <p>Live camera feed with OpenCV and hand-tracking diagnostics.</p>

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
        <p className="camera-status__camera">
          <span className="camera-status__label">Camera:</span> {cameraStatusLabel}
        </p>
        <p className="camera-status__vision">
          <span className="camera-status__label">OpenCV:</span> {visionStatusLabel}
        </p>
        <p className="camera-status__hand-tracking">
          <span className="camera-status__label">MediaPipe:</span> {handTrackingStatusLabel}
        </p>
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
          aria-label="Start OpenCV processing"
        >
          Start OpenCV Processing
        </button>

        <button
          type="button"
          onClick={handleStopProcessing}
          disabled={!isProcessing}
          aria-label="Stop OpenCV processing"
        >
          Stop OpenCV Processing
        </button>

        <button
          type="button"
          onClick={handleStartTracking}
          disabled={!isActive || isTracking || isHandLandmarkerLoading}
          aria-label="Start hand tracking"
        >
          Start Hand Tracking
        </button>

        <button
          type="button"
          onClick={handleStopTracking}
          disabled={!isTracking}
          aria-label="Stop hand tracking"
        >
          Stop Hand Tracking
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

      <div className="camera-hand-readout" aria-live="polite">
        <h3>Hand Tracking Readout</h3>
        <p className="camera-hand-readout__summary">
          {handDetected
            ? `${hands.length} hand${hands.length > 1 ? 's' : ''} detected`
            : 'No hand detected'}
        </p>

        {handDetected && (
          <ul className="camera-hand-readout__list">
            {indexFingerTips.map((tip, index) => (
              <li className="camera-hand-readout__item" key={index}>
                <span className="camera-hand-readout__handedness">
                  {tip.handedness || 'Unknown hand'}
                </span>
                <span className="camera-hand-readout__coords">
                  Index fingertip — x: {tip.x.toFixed(3)}, y: {tip.y.toFixed(3)}, z:{' '}
                  {tip.z.toFixed(3)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default CameraView;