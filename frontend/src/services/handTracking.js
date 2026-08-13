import {
  HandLandmarker,
  FilesetResolver,
} from '@mediapipe/tasks-vision';

/**
 * handTracking.js
 *
 * Reusable MediaPipe Hand Landmarker service.
 *
 * This service is intentionally independent of React and of the camera
 * lifecycle (useCamera.js). It does not manage component state, does not
 * start/stop the webcam, and does not render anything. It only knows how
 * to initialize MediaPipe's HandLandmarker, run detection against a given
 * <video> element/timestamp, and release resources.
 *
 * Consumed later by hooks/useHandTracking.js, which will own React state
 * and the detection loop, and eventually by the AI Wellness Challenge game
 * logic (index-finger tracking -> virtual target collision detection).
 *
 * Why VIDEO mode:
 * MediaPipe's Hand Landmarker supports IMAGE, VIDEO, and LIVE_STREAM
 * running modes. VIDEO mode is the correct choice for a webcam feed that
 * we poll frame-by-frame via detectForVideo() with monotonically
 * increasing timestamps (as opposed to LIVE_STREAM mode, which uses an
 * async callback pattern). It gives us synchronous, predictable results
 * per call, which is simpler to integrate with a requestAnimationFrame
 * loop driven by a React hook.
 *
 * What the returned landmarks represent:
 * Each detected hand yields 21 normalized landmarks (x, y, z in [0, 1]
 * relative to image width/height/depth), following MediaPipe's standard
 * hand landmark topology (wrist, thumb, index/middle/ring/pinky fingers).
 * Landmark index 8 is the INDEX FINGERTIP — this is the point the AI
 * Wellness Challenge will track for pointer/collision interactions later.
 * The result also includes `worldLandmarks` (metric 3D coordinates) and
 * `handedness` (Left/Right classification with confidence score).
 */

// Centralized model/config so it can be changed easily later.
const HAND_LANDMARKER_CONFIG = {
  wasmBasePath:
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm',
  modelAssetPath:
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  numHands: 2,
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  runningMode: 'VIDEO',
};

// Module-level cache so MediaPipe is only ever initialized once, no
// matter how many times loadHandLandmarker() is called.
let handLandmarkerInstance = null;
let initializationPromise = null;

/**
 * Lazily initializes the MediaPipe HandLandmarker.
 *
 * Safe to call multiple times/concurrently:
 *  - If already initialized, resolves immediately with the cached instance.
 *  - If initialization is already in progress, returns the same in-flight
 *    promise rather than starting a second load.
 *
 * @returns {Promise<HandLandmarker>} the initialized HandLandmarker
 * @throws {Error} if initialization fails (caller should catch)
 */
export async function loadHandLandmarker() {
  if (handLandmarkerInstance) {
    return handLandmarkerInstance;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        HAND_LANDMARKER_CONFIG.wasmBasePath
      );

      const landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: HAND_LANDMARKER_CONFIG.modelAssetPath,
          delegate: 'GPU',
        },
        runningMode: HAND_LANDMARKER_CONFIG.runningMode,
        numHands: HAND_LANDMARKER_CONFIG.numHands,
        minHandDetectionConfidence:
          HAND_LANDMARKER_CONFIG.minHandDetectionConfidence,
        minHandPresenceConfidence:
          HAND_LANDMARKER_CONFIG.minHandPresenceConfidence,
        minTrackingConfidence:
          HAND_LANDMARKER_CONFIG.minTrackingConfidence,
      });

      handLandmarkerInstance = landmarker;
      return handLandmarkerInstance;
    } catch (err) {
      // Reset so a future call can retry initialization instead of
      // being stuck on a rejected promise forever.
      initializationPromise = null;
      throw new Error(
        `Failed to initialize MediaPipe HandLandmarker: ${err?.message || err}`
      );
    }
  })();

  return initializationPromise;
}

/**
 * Returns true if the HandLandmarker has already been initialized.
 */
export function isHandLandmarkerReady() {
  return !!handLandmarkerInstance;
}

/**
 * Runs hand detection on a single video frame using MediaPipe's VIDEO mode.
 *
 * Does not manage React state and does not control the webcam — the
 * caller (a hook) is responsible for supplying a ready <video> element
 * and a suitable timestamp on each call.
 *
 * @param {HTMLVideoElement} videoElement - a playing/ready <video> element
 * @param {number} timestamp - monotonically increasing timestamp in ms
 *   (e.g. from performance.now() or a requestAnimationFrame callback).
 *   MediaPipe VIDEO mode requires timestamps to strictly increase between
 *   calls for the same instance.
 * @returns {import('@mediapipe/tasks-vision').HandLandmarkerResult|null}
 *   the detection result (with `landmarks`, `worldLandmarks`, and
 *   `handedness` arrays, one entry per detected hand — index 8 in each
 *   hand's landmark array is the index fingertip), or null if detection
 *   could not be run (e.g. not initialized or video not ready).
 */
export function detectHands(videoElement, timestamp) {
  if (!handLandmarkerInstance) {
    // Detection attempted before initialization — fail safely rather
    // than throwing, since this may be called from a tight render/loop.
    return null;
  }

  if (!videoElement) {
    return null;
  }

  // readyState < 2 (HAVE_CURRENT_DATA) means there's no frame data yet.
  if (videoElement.readyState < 2) {
    return null;
  }

  if (typeof timestamp !== 'number' || Number.isNaN(timestamp)) {
    return null;
  }

  try {
    return handLandmarkerInstance.detectForVideo(videoElement, timestamp);
  } catch (err) {
    // Detection errors (e.g. transient decode issues) should not crash
    // the caller's loop — surface as null and let the caller decide
    // whether/how to report it.
    return null;
  }
}

/**
 * Safely closes/releases the MediaPipe HandLandmarker instance and its
 * underlying WASM resources.
 *
 * Safe to call multiple times, or when the landmarker was never
 * initialized / already closed.
 */
export function closeHandLandmarker() {
  if (!handLandmarkerInstance) {
    initializationPromise = null;
    return;
  }

  try {
    handLandmarkerInstance.close();
  } catch {
    // Already closed or invalid — ignore.
  } finally {
    handLandmarkerInstance = null;
    initializationPromise = null;
  }
}