import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * WellnessChallenge.jsx
 *
 * AI Wellness Challenge — Phase 1 foundation.
 *
 * An interactive hand-eye coordination exercise designed for engagement
 * and general wellness. It is not a medical treatment or rehabilitation
 * program.
 *
 * This component is intentionally independent of the camera/vision
 * lifecycle. It receives `videoRef` (the SAME ref owned and populated by
 * DiagnosticPage's useCamera() and rendered by CameraView), plus
 * `indexFingerTips` and `isTracking` from useHandTracking. It does NOT
 * create its own camera stream, its own <video> element, or its own
 * MediaPipe instance — it only reads the live video element's on-screen
 * position/size so it can render a target + fingertip cursor precisely
 * on top of it.
 *
 * The overlay is positioned with `position: fixed`, computed from the
 * video element's real getBoundingClientRect(). This lets the overlay
 * render correctly regardless of where in the component tree
 * WellnessChallenge is mounted relative to CameraView — no changes to
 * CameraView are required.
 *
 * KNOWN ASSUMPTION: position: fixed is relative to the viewport UNLESS
 * an ancestor element has a CSS `transform`, `filter`, `perspective`, or
 * `contain: layout/paint` applied — any of those create a new containing
 * block and would throw off alignment. If AppShell or any wrapper
 * between <body> and this component applies such a style, the overlay
 * will need to switch to being mounted via a portal at the document
 * body, or that ancestor style will need to be removed/adjusted.
 *
 * No timers, levels, moving targets, dual-hand mode, or scoring beyond
 * a simple counter are implemented yet — those are future phases.
 */

// Keep targets away from the extreme edges so they remain easy to hit.
const TARGET_MARGIN = 0.12; // normalized (0-1) inset from each edge
const TARGET_RADIUS_PX = 28;
const FINGER_RADIUS_PX = 10;
// Hit tolerance accounts for the visual size mismatch between the
// fingertip cursor and the target — tune this independently of the
// visual radii above.
const HIT_TOLERANCE_PX = 14;

// If CameraView's CSS already mirrors the <video> element itself (e.g.
// `transform: scaleX(-1)` for a natural "mirror" UX), set this to false
// to avoid double-flipping the fingertip/target horizontally. Centralized
// here so it can be adjusted without touching collision or render logic.
const MIRROR_FINGER_X = true;

/**
 * Converts a normalized MediaPipe coordinate into pixel coordinates
 * relative to the overlay (which is sized/positioned to exactly match
 * the live video element via getBoundingClientRect).
 *
 * Isolated on purpose: MediaPipe's coordinate origin/orientation and
 * any mirroring correction can be adjusted here later without touching
 * collision detection, rendering, or game logic.
 *
 * @param {{x:number,y:number}} normalizedPoint
 * @param {{width:number,height:number}} overlaySize
 * @param {{mirrorX?:boolean}} [options]
 * @returns {{x:number,y:number}} pixel coordinates within the overlay
 */
function normalizedToOverlayCoords(normalizedPoint, overlaySize, { mirrorX = MIRROR_FINGER_X } = {}) {
  const clampedX = Math.min(Math.max(normalizedPoint.x, 0), 1);
  const clampedY = Math.min(Math.max(normalizedPoint.y, 0), 1);

  const effectiveX = mirrorX ? 1 - clampedX : clampedX;

  return {
    x: effectiveX * overlaySize.width,
    y: clampedY * overlaySize.height,
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
function isCollision(fingerPx, targetPx, targetRadiusPx, toleranceCPx) {
  const dx = fingerPx.x - targetPx.x;
  const dy = fingerPx.y - targetPx.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return distance <= targetRadiusPx + toleranceCPx;
}

function WellnessChallenge({ videoRef, indexFingerTips = [], isTracking = false }) {
  // Tracks the live video element's on-screen box (viewport-relative),
  // so the overlay can be sized/positioned to match it exactly.
  const [videoRect, setVideoRect] = useState({ top: 0, left: 0, width: 0, height: 0 });

  const [score, setScore] = useState(0);
  const [target, setTarget] = useState(() => generateRandomTarget());
  const [targetHit, setTargetHit] = useState(false);

  // Prevents re-triggering a hit on every frame while the fingertip
  // lingers inside the target before a new target is generated.
  const hitLockRef = useRef(false);

  // Keep videoRect in sync with the video element's actual rendered
  // position/size — it can change on window resize, layout shifts,
  // scrolling, or when the camera stream starts and the video gains
  // its natural dimensions.
  useEffect(() => {
    const videoEl = videoRef?.current;
    if (!videoEl) return undefined;

    const updateRect = () => {
      const rect = videoEl.getBoundingClientRect();
      setVideoRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
    };

    updateRect();

    const handleWindowChange = () => updateRect();
    window.addEventListener('resize', handleWindowChange);
    // capture: true so scrolling on any nested scrollable ancestor
    // (not just the window) also triggers a recompute.
    window.addEventListener('scroll', handleWindowChange, true);

    let observer;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => updateRect());
      observer.observe(videoEl);
    }

    return () => {
      window.removeEventListener('resize', handleWindowChange);
      window.removeEventListener('scroll', handleWindowChange, true);
      if (observer) observer.disconnect();
    };
  }, [videoRef]);

  const activeFingerTip = indexFingerTips?.[0] || null;

  const handleTargetHit = useCallback(() => {
    setScore((prev) => prev + 1);
    setTargetHit(true);
    setTarget(generateRandomTarget());

    // Briefly surface the "hit" state, then clear it so the status
    // text returns to normal guidance for the next target.
    const clearHitTimeout = setTimeout(() => setTargetHit(false), 600);
    return () => clearTimeout(clearHitTimeout);
  }, []);

  // Run collision detection whenever a new fingertip position arrives.
  useEffect(() => {
    if (!activeFingerTip || !videoRect.width || !videoRect.height) return;

    const fingerPx = normalizedToOverlayCoords(activeFingerTip, videoRect);
    const targetPx = normalizedToOverlayCoords(target, videoRect);

    const hit = isCollision(fingerPx, targetPx, TARGET_RADIUS_PX, HIT_TOLERANCE_PX);

    if (hit && !hitLockRef.current) {
      hitLockRef.current = true;
      handleTargetHit();
    } else if (!hit) {
      hitLockRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFingerTip, videoRect, target]);

  const hasVideoBox = videoRect.width > 0 && videoRect.height > 0;

  const fingerPx = activeFingerTip && hasVideoBox
    ? normalizedToOverlayCoords(activeFingerTip, videoRect)
    : null;

  const targetPx = hasVideoBox
    ? normalizedToOverlayCoords(target, videoRect)
    : null;

  const statusLabel = !isTracking
    ? 'Waiting for hand tracking to start…'
    : !activeFingerTip
    ? 'Hand tracking active — show your hand to the camera.'
    : targetHit
    ? 'Target hit!'
    : 'Hand detected — move your index finger to the target.';

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

      <p
        className="wellness-challenge__status"
        role="status"
        aria-live="polite"
      >
        {statusLabel}
      </p>

      {/*
        Overlay is fixed-positioned and sized to match the live <video>
        element's on-screen box exactly, regardless of where this
        component sits in the DOM relative to CameraView. pointer-events
        is disabled so it never blocks camera controls underneath it.
      */}
      {hasVideoBox && (
        <div
          className="wellness-challenge__video-overlay"
          style={{
            position: 'fixed',
            top: `${videoRect.top}px`,
            left: `${videoRect.left}px`,
            width: `${videoRect.width}px`,
            height: `${videoRect.height}px`,
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
        </div>
      )}
    </section>
  );
}

export default WellnessChallenge;