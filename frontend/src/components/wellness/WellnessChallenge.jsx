import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * WellnessChallenge.jsx — Phase 1.
 *
 * Independent of the camera/vision lifecycle. Receives the SAME
 * videoRef owned by DiagnosticPage's useCamera() (rendered by
 * CameraView), plus indexFingerTips/isTracking from useHandTracking.
 * Creates no camera stream, no <video>, no MediaPipe instance.
 *
 * COORDINATE MAPPING:
 * MediaPipe's normalized (x, y) coordinates always describe a position
 * within the video's raw, decoded frame (videoWidth x videoHeight) —
 * CSS never affects what MediaPipe reads. To place the overlay
 * correctly on screen, we must map that raw-frame position into the
 * video element's actual rendered box, accounting for:
 *
 *   1. object-fit (cover/contain/none/fill) — if the rendered box's
 *      aspect ratio differs from the video's natural aspect ratio,
 *      the browser scales/crops/letterboxes the image, so the visible
 *      content rect is NOT simply the element's bounding box.
 *   2. CSS mirroring (e.g. transform: scaleX(-1)) — if the video is
 *      visually mirrored for a natural "selfie" look, the overlay must
 *      mirror too, or it will track the opposite side of the frame.
 *
 * Both are detected from the video element's actual computed style at
 * runtime (via computeVideoDisplayTransform), rather than hardcoded,
 * so this stays correct even if CameraView's CSS changes later.
 */

const TARGET_MARGIN = 0.12; // normalized (0-1) inset from each edge
const TARGET_RADIUS_PX = 28;
const FINGER_RADIUS_PX = 10;
const HIT_TOLERANCE_PX = 14;

/**
 * Computes how the video's natural (decoded) frame maps onto its
 * actual rendered CSS box: scale, offset (for letterboxing/cropping),
 * and whether it's horizontally mirrored — all read from the element's
 * real computed style, not assumed.
 *
 * @param {HTMLVideoElement} videoEl
 * @returns {{top:number,left:number,width:number,height:number,naturalWidth:number,naturalHeight:number,scaleX:number,scaleY:number,offsetX:number,offsetY:number,mirrored:boolean}}
 */
function computeVideoDisplayTransform(videoEl) {
  const boxRect = videoEl.getBoundingClientRect();
  const naturalWidth = videoEl.videoWidth;
  const naturalHeight = videoEl.videoHeight;

  const base = {
    top: boxRect.top,
    left: boxRect.left,
    width: boxRect.width,
    height: boxRect.height,
    naturalWidth: naturalWidth || boxRect.width,
    naturalHeight: naturalHeight || boxRect.height,
    scaleX: 1,
    scaleY: 1,
    offsetX: 0,
    offsetY: 0,
    mirrored: false,
  };

  if (!boxRect.width || !boxRect.height || !naturalWidth || !naturalHeight) {
    return base;
  }

  // Detect horizontal mirroring from the video's actual computed
  // transform, rather than assuming it. MediaPipe's coordinates are
  // always relative to the unmirrored raw frame, so if (and only if)
  // the video is visually mirrored via CSS, the overlay needs to
  // mirror too to match what's on screen.
  let mirrored = false;
  try {
    const computedTransform = window.getComputedStyle(videoEl).transform;
    if (computedTransform && computedTransform !== 'none') {
      const matrix = new DOMMatrixReadOnly(computedTransform);
      mirrored = matrix.a < 0;
    }
  } catch {
    mirrored = false;
  }

  let objectFit = 'fill';
  try {
    objectFit = window.getComputedStyle(videoEl).objectFit || 'fill';
  } catch {
    objectFit = 'fill';
  }

  let scaleX;
  let scaleY;
  let offsetX = 0;
  let offsetY = 0;

  if (objectFit === 'cover') {
    const scale = Math.max(boxRect.width / naturalWidth, boxRect.height / naturalHeight);
    scaleX = scale;
    scaleY = scale;
    offsetX = (boxRect.width - naturalWidth * scale) / 2;
    offsetY = (boxRect.height - naturalHeight * scale) / 2;
  } else if (objectFit === 'contain') {
    const scale = Math.min(boxRect.width / naturalWidth, boxRect.height / naturalHeight);
    scaleX = scale;
    scaleY = scale;
    offsetX = (boxRect.width - naturalWidth * scale) / 2;
    offsetY = (boxRect.height - naturalHeight * scale) / 2;
  } else if (objectFit === 'none') {
    scaleX = 1;
    scaleY = 1;
    offsetX = (boxRect.width - naturalWidth) / 2;
    offsetY = (boxRect.height - naturalHeight) / 2;
  } else {
    // 'fill' — the native <video> stretch behavior when no object-fit
    // is set (confirmed: components.css defines no object-fit rule
    // for .camera-viewport video), non-uniform scale, no offset.
    scaleX = boxRect.width / naturalWidth;
    scaleY = boxRect.height / naturalHeight;
  }

  return { ...base, scaleX, scaleY, offsetX, offsetY, mirrored };
}

/**
 * Converts a normalized MediaPipe coordinate into overlay pixel space
 * using the video's real display transform (mirror + object-fit aware).
 */
function normalizedToOverlayCoords(point, transform) {
  const clampedX = Math.min(Math.max(point.x, 0), 1);
  const clampedY = Math.min(Math.max(point.y, 0), 1);

  const effectiveX = transform.mirrored ? 1 - clampedX : clampedX;

  const naturalX = effectiveX * transform.naturalWidth;
  const naturalY = clampedY * transform.naturalHeight;

  return {
    x: transform.offsetX + naturalX * transform.scaleX,
    y: transform.offsetY + naturalY * transform.scaleY,
  };
}

/**
 * Generates a new random target position in normalized (0-1) space,
 * inset from the edges by TARGET_MARGIN so targets stay reachable.
 */
function generateRandomTarget() {
  const range = 1 - TARGET_MARGIN * 2;
  return {
    x: TARGET_MARGIN + Math.random() * range,
    y: TARGET_MARGIN + Math.random() * range,
  };
}

/**
 * Euclidean distance-based collision check between the fingertip and
 * the target, both already converted to overlay pixel space.
 */
function isCollision(fingerPx, targetPx, radiusPx, tolerancePx) {
  const dx = fingerPx.x - targetPx.x;
  const dy = fingerPx.y - targetPx.y;
  return Math.sqrt(dx * dx + dy * dy) <= radiusPx + tolerancePx;
}

function WellnessChallenge({ videoRef, indexFingerTips = [], isTracking = false }) {
  const [displayTransform, setDisplayTransform] = useState(null);

  const [score, setScore] = useState(0);
  const [target, setTarget] = useState(() => generateRandomTarget());
  const [targetHit, setTargetHit] = useState(false);

  // Prevents re-triggering a hit on every frame while the fingertip
  // lingers inside the target before a new target is generated.
  const hitLockRef = useRef(false);
  const rafIdRef = useRef(null);
  const lastTransformRef = useRef(null);

  const transformsEqual = (a, b) => {
    if (!a || !b) return a === b;
    return (
      a.top === b.top &&
      a.left === b.left &&
      a.width === b.width &&
      a.height === b.height &&
      a.scaleX === b.scaleX &&
      a.scaleY === b.scaleY &&
      a.offsetX === b.offsetX &&
      a.offsetY === b.offsetY &&
      a.mirrored === b.mirrored
    );
  };

  // Self-healing display-transform tracking: polls every animation
  // frame (instead of relying only on resize/scroll events) so it
  // stays correct across video load timing, container resizes, and
  // any layout/CSS changes, without needing to know when they happen.
  useEffect(() => {
    const poll = () => {
      const videoEl = videoRef?.current;
      if (videoEl) {
        const next = computeVideoDisplayTransform(videoEl);
        if (!transformsEqual(next, lastTransformRef.current)) {
          lastTransformRef.current = next;
          setDisplayTransform(next);
        }
      }
      rafIdRef.current = requestAnimationFrame(poll);
    };

    rafIdRef.current = requestAnimationFrame(poll);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [videoRef]);

  const activeFingerTip = indexFingerTips?.[0] || null;

  const handleTargetHit = useCallback(() => {
    setScore((prev) => prev + 1);
    setTargetHit(true);
    setTarget(generateRandomTarget());

    const clearHitTimeout = setTimeout(() => setTargetHit(false), 600);
    return () => clearTimeout(clearHitTimeout);
  }, []);

  // Run collision detection whenever a new fingertip position arrives.
  useEffect(() => {
    if (!activeFingerTip || !displayTransform || !displayTransform.width || !displayTransform.height) {
      return;
    }

    const fingerPx = normalizedToOverlayCoords(activeFingerTip, displayTransform);
    const targetPx = normalizedToOverlayCoords(target, displayTransform);

    const hit = isCollision(fingerPx, targetPx, TARGET_RADIUS_PX, HIT_TOLERANCE_PX);

    if (hit && !hitLockRef.current) {
      hitLockRef.current = true;
      handleTargetHit();
    } else if (!hit) {
      hitLockRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFingerTip, displayTransform, target]);

  const hasVideoBox = !!displayTransform && displayTransform.width > 0 && displayTransform.height > 0;

  const fingerPx = activeFingerTip && hasVideoBox
    ? normalizedToOverlayCoords(activeFingerTip, displayTransform)
    : null;

  const targetPx = hasVideoBox
    ? normalizedToOverlayCoords(target, displayTransform)
    : null;

  const statusLabel = !hasVideoBox
    ? 'Waiting for camera video to render…'
    : !isTracking
    ? 'Waiting for hand tracking to start…'
    : !activeFingerTip
    ? 'Hand tracking active — show your hand to the camera.'
    : targetHit
    ? 'Target hit!'
    : 'Hand detected — move your index finger to the target.';

  const overlay = hasVideoBox
    ? createPortal(
        <div
          className="wellness-challenge__video-overlay"
          style={{
            position: 'fixed',
            top: `${displayTransform.top}px`,
            left: `${displayTransform.left}px`,
            width: `${displayTransform.width}px`,
            height: `${displayTransform.height}px`,
            pointerEvents: 'none',
          }}
          aria-hidden="true"
        >
          {targetPx && (
            <div
              className="wellness-challenge__target"
              style={{
                position: 'absolute',
                left: `${targetPx.x}px`,
                top: `${targetPx.y}px`,
                width: `${TARGET_RADIUS_PX * 2}px`,
                height: `${TARGET_RADIUS_PX * 2}px`,
                transform: 'translate(-50%, -50%)',
              }}
            />
          )}

          {fingerPx && (
            <div
              className="wellness-challenge__finger"
              style={{
                position: 'absolute',
                left: `${fingerPx.x}px`,
                top: `${fingerPx.y}px`,
                width: `${FINGER_RADIUS_PX * 2}px`,
                height: `${FINGER_RADIUS_PX * 2}px`,
                transform: 'translate(-50%, -50%)',
              }}
            />
          )}
        </div>,
        document.body
      )
    : null;

  return (
    <section className="wellness-challenge" aria-labelledby="wellness-challenge-heading">
      <header className="wellness-challenge__header">
        <h2 id="wellness-challenge-heading">AI Wellness Challenge</h2>
        <p className="wellness-challenge__disclaimer">
          An interactive hand-eye coordination exercise designed for engagement and
          general wellness. It is not a medical treatment or rehabilitation program.
        </p>
      </header>

      <div className="wellness-challenge__score" aria-label="Current score">
        Score: <span className="wellness-challenge__score-value">{score}</span>
      </div>

      <p className="wellness-challenge__status" role="status" aria-live="polite">
        {statusLabel}
      </p>

      {overlay}
    </section>
  );
}

export default WellnessChallenge;