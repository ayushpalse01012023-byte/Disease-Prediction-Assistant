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
// PHASE 2 STEP 2 — PROGRESSIVE DIFFICULTY (PRESERVED, RETAINED
// BUT NOT INVOKED FROM THE PHASE 3 STEP 1/2 TARGET LOOP BELOW)
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
 *
 * Not called by the Phase 3 static-sequence target loop, but kept
 * intact and still used to seed targetVelRef's initial value (unused
 * for movement in Phase 3, but preserved per instructions).
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
// PHASE 2 STEP 3 — DYNAMIC MOVEMENT PATTERN (PRESERVED, RETAINED
// BUT NOT INVOKED FROM THE PHASE 3 TARGET LOOP BELOW)
// ============================================================
// How aggressively the current velocity steers toward a newly chosen
// direction each frame. Not used by the static Phase 3 target, but
// kept per instructions not to delete Phase 2 constants.
const STEERING_RATE = 6;

// Caps dt so a delayed/late animation frame (tab backgrounded, GC
// pause, device wake) can't produce a huge single-frame position
// jump. Retained; still applied to the frame-timing bookkeeping in
// the Phase 3 loop even though position is now static, to keep the
// animation-frame timing infrastructure consistent.
const MAX_DT_SECONDS = 0.1;

/**
 * PHASE 2 STEP 3 (PRESERVED)
 * Returns how often (in seconds) the target is allowed to pick a new
 * movement direction, based on score/difficulty. Not called by the
 * Phase 3 static-sequence target loop, but kept intact.
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

// ============================================================
// PHASE 3 STEP 1 — MEMORY / ORDERED TARGET
// ============================================================

// Fixed sequence length for each round.
const MEMORY_SEQUENCE_LENGTH = 5;

/**
 * PHASE 3 STEP 1 — MEMORY / ORDERED TARGET
 * Generates a fixed-length array of random normalized target
 * positions using the existing generateRandomTarget() helper, so
 * every position respects the existing TARGET_MARGIN boundary safety.
 */
function generateTargetSequence(length) {
  return Array.from(
    { length },
    () => generateRandomTarget()
  );
}

// ============================================================
// PHASE 3 STEP 2 — AUTOMATIC SEQUENCE RESTART
// ============================================================
// How long to hold on "Sequence Complete!" before the next round's
// first target appears. Short transition delay per requirement #3.
const SEQUENCE_RESTART_DELAY_MS = 1200;

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
  // PHASE 3 STEP 1 — MEMORY / ORDERED TARGET
  // ============================================================
  // The fixed sequence of 5 random target positions for the current
  // round. Generated once initially and REPLACED (not regenerated on
  // every re-render) whenever a new round starts — see Phase 3 Step 2
  // restart logic below.
  const targetSequenceRef = useRef(
    generateTargetSequence(MEMORY_SEQUENCE_LENGTH)
  );

  // Index of the currently active (collidable) target within the
  // sequence. Only this target participates in collision detection.
  const activeTargetIndexRef = useRef(0);

  // Mirrors sequence-complete state synchronously for the animation
  // loop to read without depending on React state timing (same
  // pattern as scoreRef below).
  const sequenceCompleteRef = useRef(false);

  // Display-only state, kept in sync with activeTargetIndexRef so the
  // "Sequence: X / 5" UI can render. 1-based for display.
  const [sequencePosition, setSequencePosition] = useState(1);
  const [sequenceComplete, setSequenceComplete] = useState(false);

  // PHASE 3 STEP 2 (NEW) — holds the pending "start next round" timer
  // so it can be cleared on unmount (requirement #13) and so a hit
  // that arrives during the transition window can never schedule a
  // second, overlapping restart.
  const sequenceRestartTimeoutRef = useRef(null);

  // PHASE 3 STEP 2 (NEW) — tracks whether this component is still
  // mounted, so the restart timeout callback can avoid calling
  // setState after unmount if it happens to fire in that window.
  const isMountedRef = useRef(true);

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
  // PHASE 3 STEP 1: targetPosRef is initialized directly from the
  // first sequence position, since Phase 3 targets are static and
  // driven by targetSequenceRef/activeTargetIndexRef rather than
  // physics. It remains the single source of truth for "where is the
  // target right now," which the DOM-position and collision code
  // below both continue to read from unchanged.
  const targetPosRef = useRef(targetSequenceRef.current[0]);

  // PHASE 2 STEP 2 (PRESERVED) — retained per instructions not to
  // delete Phase 2 state, but NOT read/written by the Phase 3
  // animation loop below (movement is disabled for Phase 3).
  const targetVelRef = useRef(
    generateRandomVelocity(getTargetSpeed(0))
  );

  const targetNodeRef = useRef(null);

  const targetAnimRafRef = useRef(null);

  const targetLastFrameTimeRef = useRef(null);

  // ============================================================
  // PHASE 2 STEP 3 — DYNAMIC MOVEMENT PATTERN (PRESERVED, UNUSED
  // BY THE PHASE 3 LOOP)
  // ============================================================
  const targetDirectionChangeRef = useRef(null);
  const targetDirectionIntervalRef = useRef(null);
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
  // depending on React's async state batching.
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
  // Keeps the displayed difficulty label in sync with score.
  // handleTargetHit remains the sole writer of scoreRef.current.

  useEffect(() => {
    setDifficultyLabel(getDifficultyLabel(score));
  }, [score]);

  // PHASE 3 STEP 2 (NEW) — mount/unmount tracking so the sequence
  // restart timeout can safely no-op if it fires after unmount.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ============================================================
  // PHASE 3 STEP 2 — AUTOMATIC SEQUENCE RESTART (NEW)
  // ============================================================
  /**
   * Starts a brand-new round: generates a fresh 5-target sequence,
   * resets the active index/progress/completion state, and clears
   * hitLockRef so the new round's first target can be collided with
   * immediately. Does NOT touch score/scoreRef — score is explicitly
   * preserved across rounds per requirement #7.
   */
  const startNewSequence = useCallback(() => {
    if (!isMountedRef.current) return;

    // Fresh 5 random positions, still respecting TARGET_MARGIN via
    // the existing generateTargetSequence()/generateRandomTarget()
    // helpers — unchanged from Phase 3 Step 1.
    targetSequenceRef.current = generateTargetSequence(
      MEMORY_SEQUENCE_LENGTH
    );

    activeTargetIndexRef.current = 0;
    targetPosRef.current = targetSequenceRef.current[0];

    // Re-enable collision detection for the new round BEFORE
    // resetting hitLockRef, so the very first frame of the new round
    // starts from a clean, unlocked state (requirement #6).
    sequenceCompleteRef.current = false;
    hitLockRef.current = false;

    setSequenceComplete(false);
    setSequencePosition(1);
  }, []);

  // ============================================================
  // TARGET HIT HANDLER
  // ============================================================

  const handleTargetHit = useCallback(() => {
    // PHASE 2 STEP 2 (PRESERVED) — compute the POST-increment score
    // synchronously via scoreRef, guaranteeing correctness even under
    // rapid consecutive hits. Never reset elsewhere — score persists
    // across sequence restarts per requirement #7.
    const nextScore = scoreRef.current + 1;
    scoreRef.current = nextScore;

    setScore(nextScore);
    setTargetHit(true);
    setDifficultyLabel(getDifficultyLabel(nextScore));

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

    // ==========================================================
    // PHASE 3 STEP 1 — MEMORY / ORDERED TARGET
    // ==========================================================
    // Advance to the next target in the fixed sequence. Only the
    // active (current) target can ever reach this handler, since
    // collision detection in the animation loop below only ever
    // checks targetPosRef.current, which always equals the CURRENT
    // sequence position — future targets are never rendered or
    // checked, so out-of-order hits are structurally impossible
    // rather than merely validated after the fact.
    const nextIndex = activeTargetIndexRef.current + 1;

    if (nextIndex >= MEMORY_SEQUENCE_LENGTH) {
      // Final target of the sequence was just hit.
      activeTargetIndexRef.current = MEMORY_SEQUENCE_LENGTH - 1;
      sequenceCompleteRef.current = true;
      setSequenceComplete(true);
      setSequencePosition(MEMORY_SEQUENCE_LENGTH);
      // Collision progression stops because the animation loop below
      // skips all collision checks once sequenceCompleteRef.current
      // is true — this is also what prevents target 5 from being
      // counted twice during the transition window (requirement #6).

      // ========================================================
      // PHASE 3 STEP 2 — AUTOMATIC SEQUENCE RESTART (NEW)
      // ========================================================
      // Schedule the next round to begin automatically after a short
      // transition delay. Any previously-pending restart timer is
      // cleared first as a safety net — under the current logic only
      // one such timer can ever be scheduled at a time (collision
      // detection is disabled the instant sequenceCompleteRef becomes
      // true, so a second "final hit" cannot occur before this timer
      // fires), but clearing defensively keeps this robust against
      // future changes.
      if (sequenceRestartTimeoutRef.current !== null) {
        clearTimeout(sequenceRestartTimeoutRef.current);
      }

      sequenceRestartTimeoutRef.current = setTimeout(() => {
        sequenceRestartTimeoutRef.current = null;
        startNewSequence();
      }, SEQUENCE_RESTART_DELAY_MS);
    } else {
      activeTargetIndexRef.current = nextIndex;
      setSequencePosition(nextIndex + 1);
      // targetPosRef.current is updated by the animation loop on its
      // next frame, reading the new activeTargetIndexRef — no manual
      // position assignment needed here.
    }
  }, [startNewSequence]);

  // ============================================================
  // PHASE 2 — MOVING TARGET + CONTINUOUS COLLISION
  // PHASE 3: the Phase 2/3 velocity, steering, and boundary-bounce
  // logic that used to run here has been REMOVED FROM THIS LOOP (not
  // deleted from the file — see the preserved constants/helpers
  // above). The target is STATIC: its position is simply read from
  // targetSequenceRef at the current activeTargetIndexRef every
  // frame. The loop still runs via the SAME single
  // requestAnimationFrame architecture as before, so DOM positioning
  // and continuous collision detection remain unchanged in structure
  // — only the "how is targetPosRef.current computed" step changed.
  // ============================================================

  useEffect(() => {
    const animateTarget = (timestamp) => {
      if (
        targetLastFrameTimeRef.current === null
      ) {
        targetLastFrameTimeRef.current =
          timestamp;
      }

      targetLastFrameTimeRef.current =
        timestamp;

      // ========================================================
      // PHASE 3 — STATIC ACTIVE TARGET POSITION
      // ========================================================
      // No velocity, no steering, no bouncing, no progressive speed —
      // the active target simply sits at its assigned sequence
      // position until hit. Position is only read from the sequence
      // while the round is still in progress; once complete,
      // targetPosRef.current is left exactly where it was (the final
      // target), so the completed target stays visible in place
      // during the transition delay, until startNewSequence() swaps
      // in the fresh sequence's first position.
      if (!sequenceCompleteRef.current) {
        targetPosRef.current =
          targetSequenceRef.current[
            activeTargetIndexRef.current
          ];
      }

      // ========================================================
      // TARGET DOM POSITION (existing mechanism, unchanged)
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
      // CONTINUOUS COLLISION DETECTION (existing mechanism,
      // unchanged geometry/functions — gated off while the sequence
      // is complete, i.e. during the Phase 3 Step 2 transition
      // window, per "stop collision progression" requirement)
      // ========================================================

      if (!sequenceCompleteRef.current) {
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

      // PHASE 2 STEP 3 (PRESERVED) — reset scheduling refs on
      // cleanup so a remount (e.g. React Strict Mode) starts with a
      // clean slate. Unused by the Phase 3 static loop, but reset for
      // consistency/safety should a later phase reintroduce movement.
      targetDirectionChangeRef.current = null;
      targetDirectionIntervalRef.current = null;
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

      // PHASE 3 STEP 2 (NEW) — clear any pending sequence-restart
      // timer on unmount, per requirement #13, so it can never fire
      // and call setState/startNewSequence after the component is
      // gone.
      if (sequenceRestartTimeoutRef.current !== null) {
        clearTimeout(sequenceRestartTimeoutRef.current);
        sequenceRestartTimeoutRef.current = null;
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

  // PHASE 3 STEP 1 (PRESERVED) — status text accounts for sequence
  // completion, ahead of the existing hit/idle branches. Camera and
  // hand-tracking status branches above it are unchanged. During the
  // Phase 3 Step 2 transition window, sequenceComplete stays true
  // until startNewSequence() flips it back to false, so this message
  // naturally covers that entire window without extra state.
  const statusLabel =
    !hasVideoBox
      ? 'Waiting for camera video to render…'
      : !isTracking
      ? 'Waiting for hand tracking to start…'
      : !lastKnownFingerTip
      ? 'Hand tracking active — show your hand to the camera.'
      : sequenceComplete
      ? 'Sequence Complete!'
      : targetHit
      ? 'Target hit! Find the next target.'
      : 'Hand detected — find the target.';

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
              ACTIVE SEQUENCE TARGET (PHASE 3)
              Still uses the existing .wellness-challenge__target
              class/styling — only ever one target rendered at a
              time, matching the "show only current target" rule.
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

      {/* ==============================================
          PHASE 3 STEP 1 — SEQUENCE PROGRESS INDICATOR
          (PHASE 3 STEP 2 note: this automatically returns to
          "Sequence: 1 / 5" once startNewSequence() runs, with no
          extra UI code needed — sequencePosition/sequenceComplete
          are the same state driving both steps.)
          ============================================== */}
      <div
        className="wellness-challenge__sequence"
        aria-label="Sequence progress"
      >
        {sequenceComplete
          ? 'Sequence Complete!'
          : `Sequence: ${sequencePosition} / ${MEMORY_SEQUENCE_LENGTH}`}
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