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
 * Overlay is portaled to document.body so `position: fixed` is always
 * viewport-relative, regardless of ancestor transforms/filters/contain.
 *
 * ROOT CAUSE THIS FIXES: the previous version only computed videoRect
 * inside a useEffect gated on videoRef.current being non-null AT THE
 * MOMENT THE EFFECT RAN, refreshed only by specific DOM events. If the
 * video element wasn't ready then (or videoRef didn't arrive as a prop
 * at all), videoRect silently stayed {0,0,0,0} forever and nothing
 * rendered — no error, no visible symptom besides "nothing shows up."
 * Polling with requestAnimationFrame removes the timing dependency
 * entirely: as soon as videoRef.current exists and has a real box, the
 * overlay picks it up on the next frame, no matter when that happens.
 */

const TARGET_MARGIN = 0.12;
const TARGET_RADIUS_PX = 28;
const FINGER_RADIUS_PX = 10;
const HIT_TOLERANCE_PX = 14;

// Set false if CameraView's CSS already mirrors the <video> itself
// (e.g. transform: scaleX(-1)) — otherwise you'd double-flip.
const MIRROR_FINGER_X = true;

// TEMPORARY: obvious styling to confirm the overlay renders at all.
// Set to false once you've visually confirmed it, then style properly
// via components.css (.wellness-challenge__target / __finger).
const DEBUG_FORCE_VISIBLE_TARGET = true;

function normalizedToOverlayCoords(point, size, { mirrorX = MIRROR_FINGER_X } = {}) {
  const cx = Math.min(Math.max(point.x, 0), 1);
  const cy = Math.min(Math.max(point.y, 0), 1);
  const ex = mirrorX ? 1 - cx : cx;
  return { x: ex * size.width, y: cy * size.height };
}

function generateRandomTarget() {
  const range = 1 - TARGET_MARGIN * 2;
  return {
    x: TARGET_MARGIN + Math.random() * range,
    y: TARGET_MARGIN + Math.random() * range,
  };
}

function isCollision(fingerPx, targetPx, radiusPx, tolerancePx) {
  const dx = fingerPx.x - targetPx.x;
  const dy = fingerPx.y - targetPx.y;
  return Math.sqrt(dx * dx + dy * dy) <= radiusPx + tolerancePx;
}

function WellnessChallenge({ videoRef, indexFingerTips = [], isTracking = false }) {
  const [videoRect, setVideoRect] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const [score, setScore] = useState(0);
  const [target, setTarget] = useState(() => generateRandomTarget());
  const [targetHit, setTargetHit] = useState(false);

  const hitLockRef = useRef(false);
  const rafIdRef = useRef(null);
  const lastRectRef = useRef({ top: 0, left: 0, width: 0, height: 0 });
  const warnedRef = useRef(false);

  // TEMPORARY diagnostic: fires once if videoRef never resolves.
  // Remove once the root cause is confirmed fixed.
  useEffect(() => {
    if (!videoRef && !warnedRef.current) {
      warnedRef.current = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[WellnessChallenge] No videoRef prop was received. ' +
        'Check that DiagnosticPage passes videoRef={videoRef} to <WellnessChallenge />.'
      );
    }
  }, [videoRef]);

  const rectsEqual = (a, b) =>
    a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

  // Self-healing rect tracking: polls every animation frame instead of
  // relying solely on events, so it works regardless of when the video
  // element becomes available or resized.
  useEffect(() => {
    const poll = () => {
      const videoEl = videoRef?.current;
      if (videoEl) {
        const r = videoEl.getBoundingClientRect();
        const next = { top: r.top, left: r.left, width: r.width, height: r.height };
        if (!rectsEqual(next, lastRectRef.current)) {
          lastRectRef.current = next;
          setVideoRect(next);
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
    const t = setTimeout(() => setTargetHit(false), 600);
    return () => clearTimeout(t);
  }, []);

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

  const targetPx = hasVideoBox ? normalizedToOverlayCoords(target, videoRect) : null;

  const statusLabel = !videoRef
    ? 'Camera video reference not connected.'
    : !hasVideoBox
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
            top: `${videoRect.top}px`,
            left: `${videoRect.left}px`,
            width: `${videoRect.width}px`,
            height: `${videoRect.height}px`,
            pointerEvents: 'none',
            zIndex: 999999,
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
                width: DEBUG_FORCE_VISIBLE_TARGET ? '60px' : `${TARGET_RADIUS_PX * 2}px`,
                height: DEBUG_FORCE_VISIBLE_TARGET ? '60px' : `${TARGET_RADIUS_PX * 2}px`,
                transform: 'translate(-50%, -50%)',
                ...(DEBUG_FORCE_VISIBLE_TARGET
                  ? {
                      backgroundColor: 'red',
                      border: '5px solid yellow',
                      borderRadius: '50%',
                      zIndex: 999999,
                    }
                  : {}),
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