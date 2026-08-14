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
 * lifecycle. It receives `indexFingerTips` and `isTracking` as props
 * (sourced from useHandTracking via a parent, e.g. DiagnosticPage) and
 * only handles: rendering the challenge arena, converting normalized
 * fingertip coordinates into arena pixel space, rendering a target +
 * fingertip cursor, detecting collisions, and tracking score.
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

/**
 * Converts a normalized MediaPipe coordinate into arena pixel space.
 *
 * Isolated on purpose: MediaPipe's coordinate origin/orientation and
 * any mirroring correction (front-facing webcam feeds are typically
 * mirrored for a "natural" UX) can be adjusted here later without
 * touching collision detection, rendering, or game logic.
 *
 * @param {{x:number,y:number}} normalizedPoint
 * @param {{width:number,height:number}} arenaSize
 * @param {{mirrorX?:boolean}} [options]
 * @returns {{x:number,y:number}} pixel coordinates within the arena
 */
function normalizedToArenaCoords(normalizedPoint, arenaSize, { mirrorX = true } = {}) {
  const clampedX = Math.min(Math.max(normalizedPoint.x, 0), 1);
  const clampedY = Math.min(Math.max(normalizedPoint.y, 0), 1);

  const effectiveX = mirrorX ? 1 - clampedX : clampedX;

  return {
    x: effectiveX * arenaSize.width,
    y: clampedY * arenaSize.height,
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
 * the target, both already converted to arena pixel space.
 */
function isCollision(fingerPx, targetPx, targetRadiusPx, toleranceCPx) {
  const dx = fingerPx.x - targetPx.x;
  const dy = fingerPx.y - targetPx.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return distance <= targetRadiusPx + toleranceCPx;
}

function WellnessChallenge({ indexFingerTips = [], isTracking = false }) {
  const arenaRef = useRef(null);
  const [arenaSize, setArenaSize] = useState({ width: 0, height: 0 });

  const [score, setScore] = useState(0);
  const [target, setTarget] = useState(() => generateRandomTarget());
  const [targetHit, setTargetHit] = useState(false);

  // Prevents re-triggering a hit on every frame while the fingertip
  // lingers inside the target before a new target is generated.
  const hitLockRef = useRef(false);

  // Measure the arena's actual rendered size so normalized coordinates
  // can be converted responsively, regardless of container size.
  useEffect(() => {
    const arenaEl = arenaRef.current;
    if (!arenaEl) return undefined;

    const updateSize = (entry) => {
      const { width, height } = entry
        ? entry.contentRect
        : arenaEl.getBoundingClientRect();
      setArenaSize({ width, height });
    };

    updateSize();

    if (typeof ResizeObserver === 'undefined') {
      // Fallback for environments without ResizeObserver support.
      // Store the handler reference so it can be correctly removed.
      const handleResize = () => updateSize();
      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }

    const observer = new ResizeObserver(([entry]) => updateSize(entry));
    observer.observe(arenaEl);

    return () => observer.disconnect();
  }, []);

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
    if (!activeFingerTip || !arenaSize.width || !arenaSize.height) return;

    const fingerPx = normalizedToArenaCoords(activeFingerTip, arenaSize);
    const targetPx = normalizedToArenaCoords(target, arenaSize);

    const hit = isCollision(fingerPx, targetPx, TARGET_RADIUS_PX, HIT_TOLERANCE_PX);

    if (hit && !hitLockRef.current) {
      hitLockRef.current = true;
      handleTargetHit();
    } else if (!hit) {
      hitLockRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFingerTip, arenaSize, target]);

  const fingerPx = activeFingerTip && arenaSize.width
    ? normalizedToArenaCoords(activeFingerTip, arenaSize)
    : null;

  const targetPx = arenaSize.width
    ? normalizedToArenaCoords(target, arenaSize)
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

      <div className="wellness-challenge__arena" ref={arenaRef}>
        {targetPx && (
          <div
            className="wellness-challenge__target"
            style={{
              left: `${targetPx.x}px`,
              top: `${targetPx.y}px`,
              width: `${TARGET_RADIUS_PX * 2}px`,
              height: `${TARGET_RADIUS_PX * 2}px`,
              transform: 'translate(-50%, -50%)',
            }}
            aria-hidden="true"
          />
        )}

        {fingerPx && (
          <div
            className="wellness-challenge__finger"
            style={{
              left: `${fingerPx.x}px`,
              top: `${fingerPx.y}px`,
              width: `${FINGER_RADIUS_PX * 2}px`,
              height: `${FINGER_RADIUS_PX * 2}px`,
              transform: 'translate(-50%, -50%)',
            }}
            aria-hidden="true"
          />
        )}

        {!isTracking && (
          <p className="wellness-challenge__arena-placeholder">
            Hand tracking is not active. Start hand tracking to begin.
          </p>
        )}
      </div>
    </section>
  );
}

export default WellnessChallenge;