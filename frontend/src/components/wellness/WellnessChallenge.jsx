import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

const TARGET_MARGIN = 0.12;
const TARGET_RADIUS_PX = 28;
const FINGER_RADIUS_PX = 10;
const HIT_TOLERANCE_PX = 14;

// Phase 1 — fingertip cursor smoothing.
// KEEP FROZEN.
const CURSOR_SMOOTHING_FACTOR = 0.55;

// ============================================================
// PHASE 2 STEP 2 — PROGRESSIVE DIFFICULTY (PRESERVED)
// ============================================================
// Base/starting speed (same value as Step 1's old constant) and a
// sensible maximum so the challenge never becomes unplayable.
// Normalized units per second.
const BASE_TARGET_SPEED = 0.05;
const MAX_TARGET_SPEED = 0.22;

// Score at which speed reaches MAX_TARGET_SPEED. Progression beyond
// this score is clamped, not extrapolated further.
const SPEED_RAMP_SCORE = 25;

/**
 * PHASE 2 STEP 2 (PRESERVED)
 * Computes the target's movement speed for a given score. Increases
 * smoothly (not in abrupt steps) from BASE_TARGET_SPEED up to
 * MAX_TARGET_SPEED as score approaches SPEED_RAMP_SCORE, then stays
 * capped at MAX_TARGET_SPEED beyond that. Never returns undefined —
 * negative/undefined/NaN scores fall back to 0.
 */
function getTargetSpeed(score) {
  const safeScore = Number.isFinite(score) && score > 0 ? score : 0;
  const progress = Math.min(safeScore / SPEED_RAMP_SCORE, 1);
  return BASE_TARGET_SPEED + (MAX_TARGET_SPEED - BASE_TARGET_SPEED) * progress;
}

/**
 * PHASE 2 STEP 2 (PRESERVED)
 * Derives a human-readable difficulty label from score, kept in sync
 * with getTargetSpeed's thresholds purely for display purposes.
 */
function getDifficultyLabel(score) {
  const safeScore = Number.isFinite(score) && score > 0 ? score : 0;
  if (safeScore >= 20) return 'Expert';
  if (safeScore >= 10) return 'Hard';
  if (safeScore >= 5) return 'Medium';
  return 'Easy';
}

// ============================================================
// PHASE 2 STEP 3 — DYNAMIC MOVEMENT PATTERN (NEW)
// ============================================================
// How aggressively the current velocity steers toward a newly chosen
// direction each frame. Higher = snappier turn-in. Tuned so direction
// changes read as smooth curves rather than instant snaps, even at
// Expert's short interval.
const STEERING_RATE = 6;

/**
 * PHASE 2 STEP 3 (NEW)
 * Returns how often (in seconds) the target is allowed to pick a new
 * movement direction, based on score/difficulty. Thresholds
 * intentionally match getDifficultyLabel's (5 / 10 / 20) so the
 * direction-change behavior and the displayed difficulty label always
 * agree. Easy returns Infinity — no scheduled direction changes, so
 * movement stays the Step 2 straight-line-plus-bounce behavior.
 */
function getDirectionChangeInterval(score) {
  const safeScore = Number.isFinite(score) && score > 0 ? score : 0;
  if (safeScore >= 20) return 0.6; // Expert — frequent, unpredictable
  if (safeScore >= 10) return 1.2; // Hard — noticeably more frequent
  if (safeScore >= 5) return 2.5; // Medium — occasional changes
  return Infinity; // Easy — effectively straight-line + bounce only
}

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
    const scale = Math.max(
      boxRect.width / naturalWidth,
      boxRect.height / naturalHeight
    );

    scaleX = scale;
    scaleY = scale;

    offsetX = (boxRect.width - naturalWidth * scale) / 2;
    offsetY = (boxRect.height - naturalHeight * scale) / 2;
  } else if (objectFit === 'contain') {
    const scale = Math.min(
      boxRect.width / naturalWidth,
      boxRect.height / naturalHeight
    );

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
    scaleX = boxRect.width / naturalWidth;
    scaleY = boxRect.height / naturalHeight;
  }

  return {
    ...base,
    scaleX,
    scaleY,
    offsetX,
    offsetY,
    mirrored,
  };
}

function normalizedToOverlayCoords(point, transform) {
  const clampedX = Math.min(Math.max(point.x, 0), 1);
  const clampedY = Math.min(Math.max(point.y, 0), 1);

  const effectiveX = transform.mirrored
    ? 1 - clampedX
    : clampedX;

  const naturalX = effectiveX * transform.naturalWidth;
  const naturalY = clampedY * transform.naturalHeight;

  return {
    x: transform.offsetX + naturalX * transform.scaleX,
    y: transform.offsetY + naturalY * transform.scaleY,
  };
}

function generateRandomTarget() {
  const range = 1 - TARGET_MARGIN * 2;

  return {
    x: TARGET_MARGIN + Math.random() * range,
    y: TARGET_MARGIN + Math.random() * range,
  };
}

function generateRandomVelocity(speed) {
  const angle = Math.random() * Math.PI * 2;

  return {
    x: Math.cos(angle) * speed,
    y: Math.sin(angle) * speed,
  };
}

function isCollision(
  fingerPx,
  targetPx,
  radiusPx,
  tolerancePx
) {
  const dx = fingerPx.x - targetPx.x;
  const dy = fingerPx.y - targetPx.y;

  return (
    Math.sqrt(dx * dx + dy * dy) <=
    radiusPx + tolerancePx
  );
}

function WellnessChallenge({
  videoRef,
  indexFingerTips = [],
  isTracking = false,
}) {
  const [displayTransform, setDisplayTransform] = useState(null);

  const [score, setScore] = useState(0);
  const [targetHit, setTargetHit] = useState(false);

  // PHASE 2 STEP 2 (PRESERVED) — difficulty label for display, kept
  // in sync with score via the effect below.
  const [difficultyLabel, setDifficultyLabel] = useState(() => getDifficultyLabel(0));

  const [lastKnownFingerTip, setLastKnownFingerTip] = useState(null);
  const [hasDetectedFinger, setHasDetectedFinger] = useState(false);

  // ============================================================
  // PHASE 1 — FINGERTIP TRACKING
  // KEEP THIS SECTION FROZEN
  // ============================================================

  const fingerTipRawRef = useRef(null);
  const fingerNodeRef = useRef(null);
  const smoothedFingerPxRef = useRef(null);
  const cursorRafRef = useRef(null);

  // ============================================================
  // PHASE 2 — MOVING TARGET
  // ============================================================

  const targetPosRef = useRef(generateRandomTarget());

  // PHASE 2 STEP 2 (PRESERVED) — initial velocity uses getTargetSpeed(0)
  // instead of a flat constant, so difficulty is consistent from the
  // very first target.
  const targetVelRef = useRef(
    generateRandomVelocity(getTargetSpeed(0))
  );

  const targetNodeRef = useRef(null);

  const targetAnimRafRef = useRef(null);

  const targetLastFrameTimeRef = useRef(null);

  // ============================================================
  // PHASE 2 STEP 3 — DYNAMIC MOVEMENT PATTERN (NEW)
  // ============================================================
  // Timestamp (ms, matches requestAnimationFrame's timestamp) at
  // which the target is next allowed to pick a new direction. null
  // means "not yet initialized" — set on the first animation frame.
  const targetDirectionChangeRef = useRef(null);

  // The velocity we're currently steering the target's actual
  // velocity toward. null means no direction change is in progress —
  // the target continues on its current straight-line velocity
  // (subject to boundary bouncing) exactly as in Step 1/Step 2.
  const targetDesiredVelRef = useRef(null);

  // ============================================================
  // SHARED REFS
  // ============================================================

  const hitLockRef = useRef(false);

  const rafIdRef = useRef(null);

  const lastTransformRef = useRef(null);

  const targetHitTimeoutRef = useRef(null);

  // PHASE 2 STEP 2 (PRESERVED) — mirrors `score` synchronously so
  // handleTargetHit can compute the *post-increment* score without
  // depending on React's async state batching (avoids a stale-score
  // bug where the new velocity would be calculated from the old
  // score on rapid consecutive hits).
  const scoreRef = useRef(0);

  // ============================================================
  // VIDEO TRANSFORM
  // ============================================================

  const transformsEqual = (a, b) => {
    if (!a || !b) {
      return a === b;
    }

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

  useEffect(() => {
    const poll = () => {
      const videoEl = videoRef?.current;

      if (videoEl) {
        const next = computeVideoDisplayTransform(videoEl);

        if (
          !transformsEqual(
            next,
            lastTransformRef.current
          )
        ) {
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

  // ============================================================
  // PHASE 1 — RECEIVE MEDIAPIPE FINGERTIP
  // KEEP THIS FROZEN
  // ============================================================

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

  // ============================================================
  // PHASE 1 — FINGERTIP RENDER LOOP
  // KEEP THIS FROZEN
  // ============================================================

  useEffect(() => {
    const renderCursor = () => {
      const tip = fingerTipRawRef.current;
      const transform = lastTransformRef.current;
      const node = fingerNodeRef.current;

      if (
        tip &&
        transform &&
        transform.width &&
        transform.height &&
        node
      ) {
        const rawPx = normalizedToOverlayCoords(
          tip,
          transform
        );

        if (!smoothedFingerPxRef.current) {
          smoothedFingerPxRef.current = {
            x: rawPx.x,
            y: rawPx.y,
          };
        } else {
          smoothedFingerPxRef.current = {
            x:
              smoothedFingerPxRef.current.x +
              (rawPx.x -
                smoothedFingerPxRef.current.x) *
                CURSOR_SMOOTHING_FACTOR,

            y:
              smoothedFingerPxRef.current.y +
              (rawPx.y -
                smoothedFingerPxRef.current.y) *
                CURSOR_SMOOTHING_FACTOR,
          };
        }

        const {
          x,
          y,
        } = smoothedFingerPxRef.current;

        node.style.transform =
          `translate(${x}px, ${y}px) ` +
          `translate(-50%, -50%)`;
      }

      cursorRafRef.current =
        requestAnimationFrame(renderCursor);
    };

    cursorRafRef.current =
      requestAnimationFrame(renderCursor);

    return () => {
      if (cursorRafRef.current !== null) {
        cancelAnimationFrame(
          cursorRafRef.current
        );

        cursorRafRef.current = null;
      }
    };
  }, []);

  // ============================================================
  // PHASE 2 STEP 2 — DIFFICULTY SYNC (PRESERVED)
  // ============================================================
  // Keeps scoreRef and the displayed difficulty label in sync with
  // React's `score` state whenever it changes.

  useEffect(() => {
    scoreRef.current = score;
    setDifficultyLabel(getDifficultyLabel(score));
  }, [score]);

  // ============================================================
  // TARGET HIT HANDLER
  // ============================================================

  const handleTargetHit = useCallback(() => {
    // PHASE 2 STEP 2 (PRESERVED) — compute the POST-increment score
    // synchronously via scoreRef, rather than reading the (stale,
    // pre-update) `score` closure variable or relying on setScore's
    // updater callback timing. This guarantees the new target's speed
    // always reflects the score the player just achieved, even under
    // rapid consecutive hits.
    const nextScore = scoreRef.current + 1;
    scoreRef.current = nextScore;

    setScore(nextScore);
    setTargetHit(true);
    setDifficultyLabel(getDifficultyLabel(nextScore));

    // New random position after successful hit.
    targetPosRef.current =
      generateRandomTarget();

    // PHASE 2 STEP 2 (PRESERVED) — new direction/speed uses the
    // difficulty speed derived from the updated score.
    const nextSpeed = getTargetSpeed(nextScore);
    targetVelRef.current =
      generateRandomVelocity(nextSpeed);

    // PHASE 2 STEP 3 (NEW) — reset the direction-change schedule and
    // clear any in-progress steering so the new target starts on a
    // clean straight-line velocity, exactly like a freshly spawned
    // target. Setting the timer ref to null makes the animation loop
    // reinitialize it on its next frame using the current timestamp
    // and the (now-updated) difficulty's interval.
    targetDirectionChangeRef.current = null;
    targetDesiredVelRef.current = null;

    if (
      targetHitTimeoutRef.current !== null
    ) {
      clearTimeout(
        targetHitTimeoutRef.current
      );
    }

    targetHitTimeoutRef.current =
      setTimeout(() => {
        setTargetHit(false);

        targetHitTimeoutRef.current = null;
      }, 600);
  }, []);

  // ============================================================
  // PHASE 2 — MOVING TARGET + CONTINUOUS COLLISION
  // ============================================================

  useEffect(() => {
    const animateTarget = (timestamp) => {
      if (
        targetLastFrameTimeRef.current === null
      ) {
        targetLastFrameTimeRef.current =
          timestamp;
      }

      const dt =
        (timestamp -
          targetLastFrameTimeRef.current) /
        1000;

      targetLastFrameTimeRef.current =
        timestamp;

      const pos = targetPosRef.current;
      const vel = targetVelRef.current;

      // ========================================================
      // PHASE 2 STEP 3 — DYNAMIC MOVEMENT PATTERN (NEW)
      // ========================================================
      // Decide whether it's time to pick a new direction, then
      // smoothly steer the current velocity toward it. This runs
      // BEFORE position integration so the steered velocity is what
      // actually moves the target this frame. Speed (Step 2's
      // concern) is explicitly preserved — only direction changes.

      const directionInterval = getDirectionChangeInterval(
        scoreRef.current
      );

      if (targetDirectionChangeRef.current === null) {
        targetDirectionChangeRef.current =
          directionInterval === Infinity
            ? Infinity
            : timestamp + directionInterval * 1000;
      }

      if (timestamp >= targetDirectionChangeRef.current) {
        // Preserve the target's CURRENT speed magnitude — Step 3
        // only ever changes direction, never speed. Step 2 remains
        // solely responsible for how fast the target moves.
        const currentSpeed =
          Math.sqrt(vel.x * vel.x + vel.y * vel.y) ||
          getTargetSpeed(scoreRef.current);

        const angle = Math.random() * Math.PI * 2;

        targetDesiredVelRef.current = {
          x: Math.cos(angle) * currentSpeed,
          y: Math.sin(angle) * currentSpeed,
        };

        targetDirectionChangeRef.current =
          directionInterval === Infinity
            ? Infinity
            : timestamp + directionInterval * 1000;
      }

      if (targetDesiredVelRef.current) {
        const desired = targetDesiredVelRef.current;

        // Blend current velocity toward the desired direction —
        // smooth steering rather than an instant snap. Clamped to 1
        // so a large dt (e.g. after a tab was backgrounded) can't
        // overshoot into an unstable value.
        const steer = Math.min(STEERING_RATE * dt, 1);

        vel.x += (desired.x - vel.x) * steer;
        vel.y += (desired.y - vel.y) * steer;

        // Re-normalize to the desired magnitude every frame during
        // steering — blending two vectors of equal magnitude can
        // otherwise produce a slightly shorter resultant vector
        // (this is the standard "vector lerp shortens length"
        // effect), which would very slightly slow the target down
        // mid-turn if left uncorrected.
        const desiredSpeed = Math.sqrt(
          desired.x * desired.x + desired.y * desired.y
        );
        const currentBlendSpeed = Math.sqrt(
          vel.x * vel.x + vel.y * vel.y
        );

        if (currentBlendSpeed > 0.0001 && desiredSpeed > 0.0001) {
          const scale = desiredSpeed / currentBlendSpeed;
          vel.x *= scale;
          vel.y *= scale;
        }

        // Once the velocity has essentially reached the desired
        // direction, stop steering (idle cost avoidance) until the
        // next scheduled direction change.
        const dot =
          (vel.x * desired.x + vel.y * desired.y) /
          (desiredSpeed * desiredSpeed || 1);

        if (dot > 0.999) {
          targetDesiredVelRef.current = null;
        }
      }

      // ========================================================
      // POSITION INTEGRATION (existing, unchanged formula)
      // ========================================================

      let nextX =
        pos.x + vel.x * dt;

      let nextY =
        pos.y + vel.y * dt;

      const minX = TARGET_MARGIN;
      const maxX = 1 - TARGET_MARGIN;

      const minY = TARGET_MARGIN;
      const maxY = 1 - TARGET_MARGIN;

      // ========================================================
      // TARGET BOUNCING
      // ========================================================

      if (nextX <= minX) {
        nextX = minX;
        vel.x = Math.abs(vel.x);
      } else if (nextX >= maxX) {
        nextX = maxX;
        vel.x = -Math.abs(vel.x);
      }

      if (nextY <= minY) {
        nextY = minY;
        vel.y = Math.abs(vel.y);
      } else if (nextY >= maxY) {
        nextY = maxY;
        vel.y = -Math.abs(vel.y);
      }

      targetPosRef.current = {
        x: nextX,
        y: nextY,
      };

      // ========================================================
      // TARGET DOM POSITION
      // ========================================================

      const transform =
        lastTransformRef.current;

      const node =
        targetNodeRef.current;

      if (
        transform &&
        transform.width &&
        transform.height &&
        node
      ) {
        const targetPx =
          normalizedToOverlayCoords(
            targetPosRef.current,
            transform
          );

        node.style.left =
          `${targetPx.x}px`;

        node.style.top =
          `${targetPx.y}px`;
      }

      // ========================================================
      // CONTINUOUS COLLISION DETECTION
      // ========================================================

      const fingerTip =
        fingerTipRawRef.current;

      if (
        fingerTip &&
        transform &&
        transform.width &&
        transform.height
      ) {
        const fingerPx =
          normalizedToOverlayCoords(
            fingerTip,
            transform
          );

        const targetPx =
          normalizedToOverlayCoords(
            targetPosRef.current,
            transform
          );

        const hit = isCollision(
          fingerPx,
          targetPx,
          TARGET_RADIUS_PX,
          HIT_TOLERANCE_PX
        );

        if (
          hit &&
          !hitLockRef.current
        ) {
          hitLockRef.current = true;

          handleTargetHit();
        } else if (!hit) {
          hitLockRef.current = false;
        }
      }

      targetAnimRafRef.current =
        requestAnimationFrame(
          animateTarget
        );
    };

    targetAnimRafRef.current =
      requestAnimationFrame(
        animateTarget
      );

    return () => {
      if (
        targetAnimRafRef.current !== null
      ) {
        cancelAnimationFrame(
          targetAnimRafRef.current
        );

        targetAnimRafRef.current = null;
      }

      targetLastFrameTimeRef.current =
        null;

      // PHASE 2 STEP 3 (NEW) — reset scheduling refs on cleanup so a
      // remount (e.g. React Strict Mode) starts with a clean slate
      // rather than a stale scheduled timestamp from a previous run.
      targetDirectionChangeRef.current = null;
      targetDesiredVelRef.current = null;
    };
  }, [handleTargetHit]);

  // ============================================================
  // CLEANUP
  // ============================================================

  useEffect(() => {
    return () => {
      if (
        targetHitTimeoutRef.current !== null
      ) {
        clearTimeout(
          targetHitTimeoutRef.current
        );

        targetHitTimeoutRef.current = null;
      }
    };
  }, []);

  // ============================================================
  // UI STATE
  // ============================================================

  const hasVideoBox =
    !!displayTransform &&
    displayTransform.width > 0 &&
    displayTransform.height > 0;

  const initialFingerPx =
    lastKnownFingerTip &&
    hasVideoBox
      ? normalizedToOverlayCoords(
          lastKnownFingerTip,
          displayTransform
        )
      : null;

  const initialTargetPx =
    hasVideoBox
      ? normalizedToOverlayCoords(
          targetPosRef.current,
          displayTransform
        )
      : null;

  const statusLabel =
    !hasVideoBox
      ? 'Waiting for camera video to render…'
      : !isTracking
      ? 'Waiting for hand tracking to start…'
      : !lastKnownFingerTip
      ? 'Hand tracking active — show your hand to the camera.'
      : targetHit
      ? 'Target hit!'
      : 'Hand detected — move your index finger to the target.';

  // ============================================================
  // OVERLAY
  // ============================================================

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
          {/* ==================================================
              MOVING TARGET
              ================================================== */}

          <div
            ref={targetNodeRef}
            className="wellness-challenge__target"
            style={{
              position: 'absolute',

              left: initialTargetPx
                ? `${initialTargetPx.x}px`
                : '0px',

              top: initialTargetPx
                ? `${initialTargetPx.y}px`
                : '0px',

              width:
                `${TARGET_RADIUS_PX * 2}px`,

              height:
                `${TARGET_RADIUS_PX * 2}px`,

              transform:
                'translate(-50%, -50%)',

              willChange:
                'left, top',
            }}
          />

          {/* ==================================================
              FINGERTIP CURSOR
              PHASE 1 — PRESERVED
              ================================================== */}

          {hasDetectedFinger && (
            <div
              ref={fingerNodeRef}
              className="wellness-challenge__finger"
              style={{
                position: 'absolute',

                left: 0,
                top: 0,

                width:
                  `${FINGER_RADIUS_PX * 2}px`,

                height:
                  `${FINGER_RADIUS_PX * 2}px`,

                willChange:
                  'transform',

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

  // ============================================================
  // COMPONENT UI
  // ============================================================

  return (
    <section
      className="wellness-challenge"
      aria-labelledby="wellness-challenge-heading"
    >
      <header className="wellness-challenge__header">
        <h2 id="wellness-challenge-heading">
          AI Wellness Challenge
        </h2>

        <p className="wellness-challenge__disclaimer">
          An interactive hand-eye coordination
          exercise designed for engagement and
          general wellness. It is not a medical
          treatment or rehabilitation program.
        </p>
      </header>

      <div
        className="wellness-challenge__score"
        aria-label="Current score"
      >
        Score:{' '}
        <span className="wellness-challenge__score-value">
          {score}
        </span>
      </div>

      <div
        className="wellness-challenge__difficulty"
        aria-label="Current difficulty"
      >
        Difficulty:{' '}
        <span className="wellness-challenge__difficulty-value">
          {difficultyLabel}
        </span>
      </div>

      <p
        className="wellness-challenge__status"
        role="status"
        aria-live="polite"
      >
        {statusLabel}
      </p>

      {overlay}
    </section>
  );
}

export default WellnessChallenge;