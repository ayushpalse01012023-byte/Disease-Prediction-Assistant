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
 *
 * FINGERTIP PERSISTENCE (HARD REQUIREMENT):
 * Once MediaPipe reports an index fingertip for the first time, the
 * cursor must render continuously and NEVER disappear again — not on
 * a missed detection frame, not on target hit/relocation, not on any
 * score/target/targetHit state change, not on any re-render — until
 * this component unmounts. There is deliberately NO timeout or grace
 * period that hides it.
 *
 * CURSOR RENDERING (PERFORMANCE):
 * The cursor's on-screen position is intentionally NOT driven by
 * React state/re-render. MediaPipe only reports a new position every
 * ~33ms (~30fps, see useHandTracking.js), but the browser paints at a
 * higher rate — updating the cursor only on React state changes makes
 * motion look stepped, since it's tied to detection cadence rather
 * than paint cadence. Instead:
 *   - The latest valid fingertip is also written into fingerTipRawRef
 *     (a plain ref, not state) every time a new detection arrives.
 *   - A dedicated requestAnimationFrame loop reads that ref every
 *     paint frame, applies light exponential smoothing to remove
 *     visible steps between detections, and writes the result
 *     directly to the cursor DOM node's style.transform via
 *     fingerNodeRef — bypassing React's render cycle entirely for
 *     movement.
 * Collision detection is unaffected by this and continues to run off
 * React state (lastKnownFingerTip), exactly as before.
 */

const TARGET_MARGIN = 0.12; // normalized (0-1) inset from each edge
const TARGET_RADIUS_PX = 28;
const FINGER_RADIUS_PX = 10;
const HIT_TOLERANCE_PX = 14;

// Exponential smoothing factor for the imperative cursor render loop.
// High value = converges to the real position within ~2-3 frames
// (well under 50ms) — enough to remove visible stepping between
// detections without introducing noticeable artificial lag.
const CURSOR_SMOOTHING_FACTOR = 0.55;

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

  // The last valid fingertip position MediaPipe reported, used for
  // COLLISION DETECTION only. Once set, this is ONLY ever overwritten
  // by a newer valid detection — never cleared by a missed frame, a
  // hit, a target change, or any other re-render.
  const [lastKnownFingerTip, setLastKnownFingerTip] = useState(null);

  // Becomes true the first time a hand is ever detected, and never
  // reverts to false — controls whether the cursor DOM node is
  // mounted at all. Once mounted, it stays mounted until unmount.
  const [hasDetectedFinger, setHasDetectedFinger] = useState(false);

  // Mirrors lastKnownFingerTip but as a plain ref, read every animation
  // frame by the imperative cursor-render loop below — this is what
  // makes cursor movement independent of React's render cycle.
  const fingerTipRawRef = useRef(null);

  // Direct DOM reference to the cursor element; its position is set
  // imperatively via style.transform inside the rAF loop, not via
  // React-computed inline style, so it can update every paint frame
  // regardless of how often React re-renders this component.
  const fingerNodeRef = useRef(null);
  const smoothedFingerPxRef = useRef(null);
  const cursorRafRef = useRef(null);

  // Prevents re-triggering a hit on every frame while the fingertip
  // lingers inside the target before a new target is generated.
  const hitLockRef = useRef(false);
  const rafIdRef = useRef(null);
  const lastTransformRef = useRef(null);
  // Tracks the pending "target hit" flash timeout so it can be
  // superseded (instead of stacking) on rapid consecutive hits, and
  // cancelled on unmount to avoid a setState-after-unmount warning.
  const targetHitTimeoutRef = useRef(null);

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

  // Adopt the newest valid fingertip the instant one arrives — for
  // both collision detection (state) and cursor rendering (ref).
  useEffect(() => {
    const rawTip = indexFingerTips?.[0] || null;
    if (rawTip) {
      setLastKnownFingerTip(rawTip);
      fingerTipRawRef.current = rawTip;
      if (!hasDetectedFinger) {
        setHasDetectedFinger(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexFingerTips]);

  // Imperative cursor render loop: runs every animation frame,
  // independent of MediaPipe's detection rate, reading the latest
  // fingertip/transform from refs and writing directly to the DOM.
  // This is what makes the cursor move smoothly at display refresh
  // rate instead of stepping at ~30fps.
  useEffect(() => {
    const renderCursor = () => {
      const tip = fingerTipRawRef.current;
      const transform = lastTransformRef.current;
      const node = fingerNodeRef.current;

      if (tip && transform && transform.width && transform.height && node) {
        const rawPx = normalizedToOverlayCoords(tip, transform);

        if (!smoothedFingerPxRef.current) {
          smoothedFingerPxRef.current = { x: rawPx.x, y: rawPx.y };
        } else {
          smoothedFingerPxRef.current = {
            x:
              smoothedFingerPxRef.current.x +
              (rawPx.x - smoothedFingerPxRef.current.x) * CURSOR_SMOOTHING_FACTOR,
            y:
              smoothedFingerPxRef.current.y +
              (rawPx.y - smoothedFingerPxRef.current.y) * CURSOR_SMOOTHING_FACTOR,
          };
        }

        const { x, y } = smoothedFingerPxRef.current;
        node.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      }

      cursorRafRef.current = requestAnimationFrame(renderCursor);
    };

    cursorRafRef.current = requestAnimationFrame(renderCursor);

    return () => {
      if (cursorRafRef.current !== null) {
        cancelAnimationFrame(cursorRafRef.current);
        cursorRafRef.current = null;
      }
    };
  }, []);

  const handleTargetHit = useCallback(() => {
    setScore((prev) => prev + 1);
    setTargetHit(true);
    setTarget(generateRandomTarget());

    // Clear any previously-pending "target hit" timeout before
    // starting a new one, so overlapping timers can't stack up, and
    // so this timer can be reliably cancelled on unmount. This only
    // controls the "Target hit!" status text flash — it never touches
    // the fingertip cursor.
    if (targetHitTimeoutRef.current !== null) {
      clearTimeout(targetHitTimeoutRef.current);
    }
    targetHitTimeoutRef.current = setTimeout(() => {
      setTargetHit(false);
      targetHitTimeoutRef.current = null;
    }, 600);
  }, []);

  // Run collision detection whenever a new fingertip position arrives.
  // Uses lastKnownFingerTip (state) — unchanged from before, unrelated
  // to the cursor's visual smoothing/render path above.
  useEffect(() => {
    if (!lastKnownFingerTip || !displayTransform || !displayTransform.width || !displayTransform.height) {
      return;
    }

    const fingerPx = normalizedToOverlayCoords(lastKnownFingerTip, displayTransform);
    const targetPx = normalizedToOverlayCoords(target, displayTransform);

    const hit = isCollision(fingerPx, targetPx, TARGET_RADIUS_PX, HIT_TOLERANCE_PX);

    if (hit && !hitLockRef.current) {
      hitLockRef.current = true;
      handleTargetHit();
    } else if (!hit) {
      hitLockRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKnownFingerTip, displayTransform, target]);

  // Cancel any pending "target hit" flash timeout on unmount to avoid
  // calling setState on an unmounted component.
  useEffect(() => {
    return () => {
      if (targetHitTimeoutRef.current !== null) {
        clearTimeout(targetHitTimeoutRef.current);
        targetHitTimeoutRef.current = null;
      }
    };
  }, []);

  const hasVideoBox = !!displayTransform && displayTransform.width > 0 && displayTransform.height > 0;

  // Used only as the cursor's initial paint position, before the rAF
  // loop above takes over on the next frame — avoids a first-frame
  // flash at (0,0). All subsequent movement bypasses this value.
  const initialFingerPx = lastKnownFingerTip && hasVideoBox
    ? normalizedToOverlayCoords(lastKnownFingerTip, displayTransform)
    : null;

  const targetPx = hasVideoBox
    ? normalizedToOverlayCoords(target, displayTransform)
    : null;

  const statusLabel = !hasVideoBox
    ? 'Waiting for camera video to render…'
    : !isTracking
    ? 'Waiting for hand tracking to start…'
    : !lastKnownFingerTip
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

          {hasDetectedFinger && (
            <div
              ref={fingerNodeRef}
              className="wellness-challenge__finger"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: `${FINGER_RADIUS_PX * 2}px`,
                height: `${FINGER_RADIUS_PX * 2}px`,
                willChange: 'transform',
                transform: initialFingerPx
                  ? `translate(${initialFingerPx.x}px, ${initialFingerPx.y}px) translate(-50%, -50%)`
                  : undefined,
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