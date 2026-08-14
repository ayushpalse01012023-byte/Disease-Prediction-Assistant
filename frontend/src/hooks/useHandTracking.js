import { useRef, useState, useCallback, useEffect } from 'react';
import {
  loadHandLandmarker,
  detectHands,
} from '../services/handTracking';

/**
 * useHandTracking
 *
 * React lifecycle/state layer between CameraView.jsx and
 * services/handTracking.js. Owns MediaPipe readiness state and the
 * detection processing loop, and extracts index-fingertip data
 * (landmark 8) from MediaPipe results for later consumption by the
 * AI Wellness Challenge.
 *
 * This hook does NOT manage the webcam stream — that remains the sole
 * responsibility of useCamera.js. It only reads frames from the
 * videoRef it is given.
 *
 * Does NOT implement any game/target/scoring logic.
 */
export default function useHandTracking(
  videoRef,
  // 33ms (~30fps) balances responsiveness against CPU cost — noticeably
  // smoother than the previous 100ms (~10fps) default without running
  // detection on every single render frame. Callers on lower-powered
  // devices can still pass a larger processIntervalMs to reduce load.
  { processIntervalMs = 33, enabled = false } = {}
) {
  const [isHandLandmarkerReady, setIsHandLandmarkerReady] = useState(false);
  const [isHandLandmarkerLoading, setIsHandLandmarkerLoading] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [error, setError] = useState(null);
  const [handResults, setHandResults] = useState(null);
  const [hands, setHands] = useState([]);
  const [indexFingerTips, setIndexFingerTips] = useState([]);

  // Mutable loop/lifecycle state kept in refs to avoid re-renders and
  // stale closures inside the requestAnimationFrame loop.
  const rafIdRef = useRef(null);
  const isTrackingRef = useRef(false);
  const isMountedRef = useRef(true);
  const lastProcessTimeRef = useRef(0);
  const lastTimestampRef = useRef(-1); // guards against non-increasing MediaPipe timestamps
  const initPromiseRef = useRef(null); // prevents concurrent initialization calls
  const optionsRef = useRef({ processIntervalMs, enabled });

  useEffect(() => {
    optionsRef.current = { processIntervalMs, enabled };
  }, [processIntervalMs, enabled]);

  /**
   * Initializes MediaPipe HandLandmarker via the service layer.
   * Safe to call multiple times/concurrently — reuses the in-flight
   * promise and does not re-initialize once ready.
   */
  const initializeHandTracking = useCallback(async () => {
    if (isHandLandmarkerReady) return true;

    if (initPromiseRef.current) {
      return initPromiseRef.current;
    }

    setIsHandLandmarkerLoading(true);
    setError(null);

    initPromiseRef.current = (async () => {
      try {
        await loadHandLandmarker();
        if (isMountedRef.current) {
          setIsHandLandmarkerReady(true);
        }
        return true;
      } catch (err) {
        if (isMountedRef.current) {
          setError({
            type: 'hand-landmarker-load-failed',
            message: 'Failed to initialize hand tracking. Please try again.',
            raw: err,
          });
          setIsHandLandmarkerReady(false);
        }
        return false;
      } finally {
        if (isMountedRef.current) {
          setIsHandLandmarkerLoading(false);
        }
        // Allow retry after either success or failure.
        initPromiseRef.current = null;
      }
    })();

    return initPromiseRef.current;
  }, [isHandLandmarkerReady]);

  /**
   * Extracts index fingertip (landmark 8) info for every detected hand,
   * pairing it with the corresponding handedness classification when
   * available. Coordinates are left normalized (0-1) as returned by
   * MediaPipe — no screen/canvas conversion happens here.
   */
  const extractIndexFingerTips = (result) => {
    if (!result || !Array.isArray(result.landmarks)) return [];

    return result.landmarks.reduce((tips, landmarks, handIndex) => {
      const tip = landmarks?.[8];
      if (!tip) return tips;

      const handednessEntry = result.handedness?.[handIndex]?.[0];

      tips.push({
        x: tip.x,
        y: tip.y,
        z: tip.z,
        handedness: handednessEntry?.categoryName || null,
      });

      return tips;
    }, []);
  };

  /**
   * Builds a lightweight per-hand summary (landmarks + handedness)
   * without holding onto more than is useful for consumers.
   */
  const extractHands = (result) => {
    if (!result || !Array.isArray(result.landmarks)) return [];

    return result.landmarks.map((landmarks, handIndex) => ({
      landmarks,
      handedness: result.handedness?.[handIndex]?.[0]?.categoryName || null,
      handednessScore: result.handedness?.[handIndex]?.[0]?.score ?? null,
    }));
  };

  /**
   * Runs a single detection pass against the current video frame and
   * updates state with the result. A per-frame error is recorded but
   * does not stop the loop — only unrecoverable init failures do that.
   */
  const processSingleFrame = useCallback((timestamp) => {
    const video = videoRef?.current;
    if (!video) return;

    // MediaPipe VIDEO mode requires strictly increasing timestamps.
    let ts = timestamp;
    if (ts <= lastTimestampRef.current) {
      ts = lastTimestampRef.current + 1;
    }
    lastTimestampRef.current = ts;

    try {
      const result = detectHands(video, ts);
      if (!result) return; // not ready yet this tick; not a hard error

      if (!isMountedRef.current) return;

      setHandResults(result);
      setHands(extractHands(result));
      setIndexFingerTips(extractIndexFingerTips(result));
    } catch (err) {
      if (isMountedRef.current) {
        setError({
          type: 'hand-detection-failed',
          message: 'Hand detection failed on this frame.',
          raw: err,
        });
      }
    }
  }, [videoRef]);

  /**
   * The requestAnimationFrame loop, throttled to processIntervalMs so
   * MediaPipe isn't invoked on every browser paint.
   */
  const loop = useCallback(
    (timestamp) => {
      if (!isTrackingRef.current) return;

      const interval = optionsRef.current.processIntervalMs;
      if (timestamp - lastProcessTimeRef.current >= interval) {
        lastProcessTimeRef.current = timestamp;
        processSingleFrame(timestamp);
      }

      rafIdRef.current = requestAnimationFrame(loop);
    },
    [processSingleFrame]
  );

  /**
   * Starts the hand-tracking loop. Initializes MediaPipe first if
   * needed. Does not touch the camera stream — the video element must
   * already be active via useCamera.
   */
  const startTracking = useCallback(async () => {
    if (isTrackingRef.current) return; // prevent duplicate loops

    if (!videoRef?.current) {
      setError({
        type: 'hand-detection-failed',
        message: 'No video element available to track.',
        raw: null,
      });
      return;
    }

    const ready = isHandLandmarkerReady || (await initializeHandTracking());
    if (!ready || !isMountedRef.current) return;

    isTrackingRef.current = true;
    lastProcessTimeRef.current = 0;
    lastTimestampRef.current = -1;
    setIsTracking(true);
    rafIdRef.current = requestAnimationFrame(loop);
  }, [videoRef, isHandLandmarkerReady, initializeHandTracking, loop]);

  /**
   * Stops only the hand-tracking loop. Does NOT stop the camera and
   * does NOT close the shared MediaPipe instance (service-level
   * cleanup remains available separately via closeHandLandmarker()).
   */
  const stopTracking = useCallback(() => {
    isTrackingRef.current = false;
    setIsTracking(false);
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  // Auto start/stop based on the `enabled` option, if the caller wants
  // declarative control instead of calling startTracking/stopTracking
  // directly.
  useEffect(() => {
    if (enabled) {
      startTracking();
    } else {
      stopTracking();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Unmount cleanup: stop the loop and cancel any pending frame.
  // Deliberately does NOT stop the camera and does NOT call
  // closeHandLandmarker(), since the MediaPipe instance is cached and
  // shared at the service layer.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      isTrackingRef.current = false;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  return {
    isHandLandmarkerReady,
    isHandLandmarkerLoading,
    isTracking,
    error,

    handResults,
    hands,
    indexFingerTips,

    initializeHandTracking,
    startTracking,
    stopTracking,
  };
}