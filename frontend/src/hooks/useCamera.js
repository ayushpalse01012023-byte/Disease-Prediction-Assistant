import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * useCamera
 * Manages the browser webcam lifecycle: permissions, stream acquisition,
 * start/stop control, and cleanup. Exposes a video ref for consumers
 * (e.g. CameraView.jsx) to attach the live stream to a <video> element.
 *
 * Does NOT perform any vision/OpenCV processing — see useVision.js.
 */
export default function useCamera({ facingMode = 'user', width = 1280, height = 720 } = {}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [isActive, setIsActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (isLoading || isActive) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError({
        type: 'unsupported',
        message: 'Camera access is not supported in this browser.',
      });
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: width },
          height: { ideal: height },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setIsActive(true);
    } catch (err) {
      let type = 'unknown';
      let message = 'Unable to access the camera.';

      if (err && err.name === 'NotAllowedError') {
        type = 'permission-denied';
        message = 'Camera access was denied. Please grant camera permissions to continue.';
      } else if (err && err.name === 'NotFoundError') {
        type = 'no-device';
        message = 'No camera device was found.';
      } else if (err && err.name === 'NotReadableError') {
        type = 'device-busy';
        message = 'The camera is already in use by another application.';
      } else if (err && err.name === 'OverconstrainedError') {
        type = 'overconstrained';
        message = 'The requested camera configuration is not supported by this device.';
      }

      setError({ type, message, raw: err });
      streamRef.current = null;
      setIsActive(false);
    } finally {
      setIsLoading(false);
    }
  }, [facingMode, width, height, isLoading, isActive]);

  // Ensure the camera is released on unmount to prevent lingering
  // hardware locks / memory leaks.
  useEffect(() => {
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    videoRef,
    isActive,
    isLoading,
    error,
    startCamera,
    stopCamera,
  };
}