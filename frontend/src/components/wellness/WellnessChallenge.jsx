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
// PHASE 2 STEP 2 — PROGRESSIVE DIFFICULTY
// PRESERVED FOR FUTURE PHASE 2 USE
// ============================================================

const BASE_TARGET_SPEED = 0.05;
const MAX_TARGET_SPEED = 0.22;
const SPEED_RAMP_SCORE = 25;

function getTargetSpeed(score) {
  const safeScore =
    Number.isFinite(score) && score > 0 ? score : 0;

  const progress = Math.min(
    safeScore / SPEED_RAMP_SCORE,
    1
  );

  return (
    BASE_TARGET_SPEED +
    (MAX_TARGET_SPEED - BASE_TARGET_SPEED) * progress
  );
}

function getDifficultyLabel(score) {
  const safeScore =
    Number.isFinite(score) && score > 0 ? score : 0;

  if (safeScore >= 20) return 'Expert';
  if (safeScore >= 10) return 'Hard';
  if (safeScore >= 5) return 'Medium';

  return 'Easy';
}

// ============================================================
// PHASE 2 STEP 3 — DYNAMIC MOVEMENT PATTERN
// PRESERVED FOR FUTURE PHASE 2 USE
// ============================================================

const STEERING_RATE = 6;
const MAX_DT_SECONDS = 0.1;

function getDirectionChangeInterval(score) {
  const safeScore =
    Number.isFinite(score) && score > 0 ? score : 0;

  if (safeScore >= 20) return 0.6;
  if (safeScore >= 10) return 1.2;
  if (safeScore >= 5) return 2.5;

  return Infinity;
}

// ============================================================
// VIDEO TRANSFORM
// ============================================================

function computeVideoDisplayTransform(videoEl) {
  const boxRect = videoEl.getBoundingClientRect();

  const naturalWidth = videoEl.videoWidth;
  const naturalHeight = videoEl.videoHeight;

  const base = {
    top: boxRect.top,
    left: boxRect.left,
    width: boxRect.width,
    height: boxRect.height,

    naturalWidth:
      naturalWidth || boxRect.width,

    naturalHeight:
      naturalHeight || boxRect.height,

    scaleX: 1,
    scaleY: 1,

    offsetX: 0,
    offsetY: 0,

    mirrored: false,
  };

  if (
    !boxRect.width ||
    !boxRect.height ||
    !naturalWidth ||
    !naturalHeight
  ) {
    return base;
  }

  let mirrored = false;

  try {
    const computedTransform =
      window.getComputedStyle(videoEl).transform;

    if (
      computedTransform &&
      computedTransform !== 'none'
    ) {
      const matrix =
        new DOMMatrixReadOnly(computedTransform);

      mirrored = matrix.a < 0;
    }
  } catch {
    mirrored = false;
  }

  let objectFit = 'fill';

  try {
    objectFit =
      window.getComputedStyle(videoEl).objectFit ||
      'fill';
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

    offsetX =
      (boxRect.width -
        naturalWidth * scale) /
      2;

    offsetY =
      (boxRect.height -
        naturalHeight * scale) /
      2;
  } else if (objectFit === 'contain') {
    const scale = Math.min(
      boxRect.width / naturalWidth,
      boxRect.height / naturalHeight
    );

    scaleX = scale;
    scaleY = scale;

    offsetX =
      (boxRect.width -
        naturalWidth * scale) /
      2;

    offsetY =
      (boxRect.height -
        naturalHeight * scale) /
      2;
  } else if (objectFit === 'none') {
    scaleX = 1;
    scaleY = 1;

    offsetX =
      (boxRect.width - naturalWidth) / 2;

    offsetY =
      (boxRect.height - naturalHeight) / 2;
  } else {
    scaleX =
      boxRect.width / naturalWidth;

    scaleY =
      boxRect.height / naturalHeight;
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

function normalizedToOverlayCoords(
  point,
  transform
) {
  const clampedX = Math.min(
    Math.max(point.x, 0),
    1
  );

  const clampedY = Math.min(
    Math.max(point.y, 0),
    1
  );

  const effectiveX = transform.mirrored
    ? 1 - clampedX
    : clampedX;

  const naturalX =
    effectiveX * transform.naturalWidth;

  const naturalY =
    clampedY * transform.naturalHeight;

  return {
    x:
      transform.offsetX +
      naturalX * transform.scaleX,

    y:
      transform.offsetY +
      naturalY * transform.scaleY,
  };
}

// ============================================================
// TARGET GENERATION
// ============================================================

function generateRandomTarget() {
  const range =
    1 - TARGET_MARGIN * 2;

  return {
    x:
      TARGET_MARGIN +
      Math.random() * range,

    y:
      TARGET_MARGIN +
      Math.random() * range,
  };
}

// ============================================================
// PHASE 2 — PRESERVED MOVEMENT HELPER
// ============================================================

function generateRandomVelocity(speed) {
  const angle =
    Math.random() * Math.PI * 2;

  return {
    x: Math.cos(angle) * speed,
    y: Math.sin(angle) * speed,
  };
}

// ============================================================
// COLLISION
// ============================================================

function isCollision(
  fingerPx,
  targetPx,
  radiusPx,
  tolerancePx
) {
  const dx =
    fingerPx.x - targetPx.x;

  const dy =
    fingerPx.y - targetPx.y;

  return (
    Math.sqrt(
      dx * dx + dy * dy
    ) <=
    radiusPx + tolerancePx
  );
}

// ============================================================
// PHASE 3 — MEMORY / ORDERED TARGET
// ============================================================

const MEMORY_SEQUENCE_LENGTH = 5;

function generateTargetSequence(length) {
  return Array.from(
    { length },
    () => generateRandomTarget()
  );
}

// ============================================================
// PHASE 3 TIMING
// ============================================================

const SEQUENCE_RESTART_DELAY_MS = 2000;

const PREVIEW_DURATION_MS = 1800;

const PREVIEW_GAP_MS = 800;

// ============================================================
// COMPONENT
// ============================================================

function WellnessChallenge({
  videoRef,
  indexFingerTips = [],
  isTracking = false,
}) {
  // ==========================================================
  // VIDEO TRANSFORM STATE
  // ==========================================================

  const [displayTransform, setDisplayTransform] =
    useState(null);

  // ==========================================================
  // SCORE
  // ==========================================================

  const [score, setScore] = useState(0);

  const [targetHit, setTargetHit] =
    useState(false);

  const [
    difficultyLabel,
    setDifficultyLabel,
  ] = useState(() =>
    getDifficultyLabel(0)
  );

  // ==========================================================
  // FINGER STATE
  // ==========================================================

  const [
    lastKnownFingerTip,
    setLastKnownFingerTip,
  ] = useState(null);

  const [
    hasDetectedFinger,
    setHasDetectedFinger,
  ] = useState(false);

  // ==========================================================
  // PHASE 3 — TARGET SEQUENCE
  // ==========================================================

  const targetSequenceRef = useRef(
    generateTargetSequence(
      MEMORY_SEQUENCE_LENGTH
    )
  );

  const activeTargetIndexRef =
    useRef(0);

  const sequenceCompleteRef =
    useRef(false);

  const [
    sequencePosition,
    setSequencePosition,
  ] = useState(1);

  const [
    sequenceComplete,
    setSequenceComplete,
  ] = useState(false);

  // ==========================================================
  // PHASE 3 — GAME PHASE
  // ==========================================================

  const gamePhaseRef =
    useRef('memorizing');

  const [
    isMemorizing,
    setIsMemorizing,
  ] = useState(true);

  // ==========================================================
  // PHASE 3 — PREVIEW
  // ==========================================================

  const previewIndexRef =
    useRef(0);

  const previewVisibleRef =
    useRef(false);

  const previewTimeoutRef =
    useRef(null);

  // ==========================================================
  // PHASE 3 — ROUND GENERATION
  //
  // Every new sequence receives a new generation number.
  // Old timeout callbacks become invalid automatically.
  // ==========================================================

  const sequenceGenerationRef =
    useRef(0);

  // ==========================================================
  // PHASE 3 — RECALL PERFORMANCE
  // ==========================================================

  const currentRecallCountRef =
    useRef(0);

  const [
    currentRecallCount,
    setCurrentRecallCount,
  ] = useState(0);

  const totalRecalledTargetsRef =
    useRef(0);

  const totalTargetsAttemptedRef =
    useRef(0);

  const completedSequenceCountRef =
    useRef(0);

  const [
    completedSequenceCount,
    setCompletedSequenceCount,
  ] = useState(0);

  const [
    totalRecalledTargets,
    setTotalRecalledTargets,
  ] = useState(0);

  const [
    memoryAccuracy,
    setMemoryAccuracy,
  ] = useState(null);

  // ==========================================================
  // PHASE 1 — FINGERTIP TRACKING
  // KEEP THIS SECTION FROZEN
  // ==========================================================

  const fingerTipRawRef =
    useRef(null);

  const fingerNodeRef =
    useRef(null);

  const smoothedFingerPxRef =
    useRef(null);

  const cursorRafRef =
    useRef(null);

  // ==========================================================
  // PHASE 2 — MOVING TARGET
  // PRESERVED FOR FUTURE PHASE 2
  //
  // IMPORTANT:
  // These are NOT used by Phase 3.
  // ==========================================================

  const targetPosRef =
    useRef(
      targetSequenceRef.current[0]
    );

  const targetVelRef =
    useRef(
      generateRandomVelocity(
        getTargetSpeed(0)
      )
    );

  const targetNodeRef =
    useRef(null);

  const targetAnimRafRef =
    useRef(null);

  const targetLastFrameTimeRef =
    useRef(null);

  const targetDirectionChangeRef =
    useRef(null);

  const targetDirectionIntervalRef =
    useRef(null);

  const targetDesiredVelRef =
    useRef(null);

  // ==========================================================
  // SHARED REFS
  // ==========================================================

  const hitLockRef =
    useRef(false);

  const rafIdRef =
    useRef(null);

  const lastTransformRef =
    useRef(null);

  const targetHitTimeoutRef =
    useRef(null);

  const sequenceRestartTimeoutRef =
    useRef(null);

  const scoreRef =
    useRef(0);

  const isMountedRef =
    useRef(true);

  // ==========================================================
  // VIDEO TRANSFORM COMPARISON
  // ==========================================================

  const transformsEqual = (
    a,
    b
  ) => {
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

  // ==========================================================
  // VIDEO TRANSFORM RAF
  // ==========================================================

  useEffect(() => {
    const poll = () => {
      if (!isMountedRef.current) {
        return;
      }

      const videoEl =
        videoRef?.current;

      if (videoEl) {
        const next =
          computeVideoDisplayTransform(
            videoEl
          );

        if (
          !transformsEqual(
            next,
            lastTransformRef.current
          )
        ) {
          lastTransformRef.current =
            next;

          setDisplayTransform(
            next
          );
        }
      }

      rafIdRef.current =
        requestAnimationFrame(poll);
    };

    rafIdRef.current =
      requestAnimationFrame(poll);

    return () => {
      if (
        rafIdRef.current !== null
      ) {
        cancelAnimationFrame(
          rafIdRef.current
        );

        rafIdRef.current = null;
      }
    };
  }, [videoRef]);

  // ==========================================================
  // PHASE 1 — RECEIVE MEDIAPIPE FINGERTIP
  // KEEP THIS SECTION FROZEN
  // ==========================================================

  useEffect(() => {
    const rawTip =
      indexFingerTips?.[0] || null;

    if (rawTip) {
      setLastKnownFingerTip(
        rawTip
      );

      fingerTipRawRef.current =
        rawTip;

      if (!hasDetectedFinger) {
        setHasDetectedFinger(
          true
        );
      }
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexFingerTips]);

  // ==========================================================
  // PHASE 1 — FINGERTIP RENDER LOOP
  // KEEP THIS SECTION FROZEN
  // ==========================================================

  useEffect(() => {
    const renderCursor = () => {
      const tip =
        fingerTipRawRef.current;

      const transform =
        lastTransformRef.current;

      const node =
        fingerNodeRef.current;

      if (
        tip &&
        transform &&
        transform.width &&
        transform.height &&
        node
      ) {
        const rawPx =
          normalizedToOverlayCoords(
            tip,
            transform
          );

        if (
          !smoothedFingerPxRef.current
        ) {
          smoothedFingerPxRef.current = {
            x: rawPx.x,
            y: rawPx.y,
          };
        } else {
          smoothedFingerPxRef.current = {
            x:
              smoothedFingerPxRef.current.x +
              (
                rawPx.x -
                smoothedFingerPxRef.current.x
              ) *
                CURSOR_SMOOTHING_FACTOR,

            y:
              smoothedFingerPxRef.current.y +
              (
                rawPx.y -
                smoothedFingerPxRef.current.y
              ) *
                CURSOR_SMOOTHING_FACTOR,
          };
        }

        const {
          x,
          y,
        } =
          smoothedFingerPxRef.current;

        node.style.transform =
          `translate(${x}px, ${y}px) ` +
          `translate(-50%, -50%)`;
      }

      cursorRafRef.current =
        requestAnimationFrame(
          renderCursor
        );
    };

    cursorRafRef.current =
      requestAnimationFrame(
        renderCursor
      );

    return () => {
      if (
        cursorRafRef.current !== null
      ) {
        cancelAnimationFrame(
          cursorRafRef.current
        );

        cursorRafRef.current = null;
      }
    };
  }, []);

  // ==========================================================
  // DIFFICULTY
  // ==========================================================

  useEffect(() => {
    setDifficultyLabel(
      getDifficultyLabel(score)
    );
  }, [score]);

  // ==========================================================
  // MOUNT STATE
  // ==========================================================

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ==========================================================
  // PHASE 3 — START MEMORIZATION
  // ==========================================================

  const startMemorization =
    useCallback(() => {
      if (!isMountedRef.current) {
        return;
      }

      // ------------------------------------------------------
      // Cancel any old preview timer.
      // ------------------------------------------------------

      if (
        previewTimeoutRef.current !==
        null
      ) {
        clearTimeout(
          previewTimeoutRef.current
        );

        previewTimeoutRef.current =
          null;
      }

      // ------------------------------------------------------
      // Every memorization start gets
      // a fresh generation.
      // ------------------------------------------------------

      const generation =
        ++sequenceGenerationRef.current;

      // ------------------------------------------------------
      // Explicit clean reset.
      // ------------------------------------------------------

      previewIndexRef.current = 0;

      previewVisibleRef.current =
        false;

      activeTargetIndexRef.current =
        0;

      sequenceCompleteRef.current =
        false;

      hitLockRef.current = false;

      currentRecallCountRef.current =
        0;

      targetPosRef.current =
        targetSequenceRef.current[0];

      gamePhaseRef.current =
        'memorizing';

      setIsMemorizing(true);

      setSequenceComplete(false);

      setSequencePosition(1);

      setCurrentRecallCount(0);

      // ------------------------------------------------------
      // Preview chain.
      // ------------------------------------------------------

      const runPreviewStep = (
        index
      ) => {
        if (
          !isMountedRef.current
        ) {
          return;
        }

        // Old sequence callback?
        if (
          generation !==
          sequenceGenerationRef.current
        ) {
          return;
        }

        // ----------------------------------------------------
        // Preview finished.
        // ----------------------------------------------------

        if (
          index >=
          MEMORY_SEQUENCE_LENGTH
        ) {
          previewIndexRef.current =
            0;

          previewVisibleRef.current =
            false;

          activeTargetIndexRef.current =
            0;

          targetPosRef.current =
            targetSequenceRef.current[0];

          sequenceCompleteRef.current =
            false;

          hitLockRef.current =
            false;

          gamePhaseRef.current =
            'recalling';

          setIsMemorizing(false);

          setSequencePosition(1);

          previewTimeoutRef.current =
            null;

          return;
        }

        // ----------------------------------------------------
        // Show current preview target.
        // ----------------------------------------------------

        previewIndexRef.current =
          index;

        previewVisibleRef.current =
          true;

        targetPosRef.current =
          targetSequenceRef.current[
            index
          ];

        // ----------------------------------------------------
        // Keep it visible for 1800ms.
        // ----------------------------------------------------

        previewTimeoutRef.current =
          setTimeout(() => {
            if (
              !isMountedRef.current
            ) {
              return;
            }

            if (
              generation !==
              sequenceGenerationRef.current
            ) {
              return;
            }

            // Hide current target.
            previewVisibleRef.current =
              false;

            // ------------------------------------------------
            // Wait 800ms before next target.
            // ------------------------------------------------

            previewTimeoutRef.current =
              setTimeout(() => {
                if (
                  !isMountedRef.current
                ) {
                  return;
                }

                if (
                  generation !==
                  sequenceGenerationRef.current
                ) {
                  return;
                }

                runPreviewStep(
                  index + 1
                );
              }, PREVIEW_GAP_MS);
          }, PREVIEW_DURATION_MS);
      };

      runPreviewStep(0);
    }, []);

  // ==========================================================
  // INITIAL MEMORIZATION
  // ==========================================================

  useEffect(() => {
    startMemorization();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==========================================================
  // START NEW SEQUENCE
  // ==========================================================

  const startNewSequence =
    useCallback(() => {
      if (!isMountedRef.current) {
        return;
      }

      // ------------------------------------------------------
      // Cancel old restart timer.
      // ------------------------------------------------------

      if (
        sequenceRestartTimeoutRef.current !==
        null
      ) {
        clearTimeout(
          sequenceRestartTimeoutRef.current
        );

        sequenceRestartTimeoutRef.current =
          null;
      }

      // ------------------------------------------------------
      // Generate completely new sequence.
      // ------------------------------------------------------

      targetSequenceRef.current =
        generateTargetSequence(
          MEMORY_SEQUENCE_LENGTH
        );

      // ------------------------------------------------------
      // Reset target state.
      // ------------------------------------------------------

      activeTargetIndexRef.current =
        0;

      targetPosRef.current =
        targetSequenceRef.current[0];

      sequenceCompleteRef.current =
        false;

      hitLockRef.current =
        false;

      // ------------------------------------------------------
      // Reset UI state.
      // ------------------------------------------------------

      setSequenceComplete(false);

      setSequencePosition(1);

      currentRecallCountRef.current =
        0;

      setCurrentRecallCount(0);

      // ------------------------------------------------------
      // Start fresh memorization.
      // ------------------------------------------------------

      startMemorization();
    }, [startMemorization]);

  // ==========================================================
  // TARGET HIT HANDLER
  // ==========================================================

  const handleTargetHit =
    useCallback(() => {
      if (!isMountedRef.current) {
        return;
      }

      // ------------------------------------------------------
      // Absolutely prevent hits outside recall mode.
      // ------------------------------------------------------

      if (
        gamePhaseRef.current !==
        'recalling'
      ) {
        return;
      }

      // ------------------------------------------------------
      // Prevent hits after completion.
      // ------------------------------------------------------

      if (
        sequenceCompleteRef.current
      ) {
        return;
      }

      // ------------------------------------------------------
      // Score.
      // ------------------------------------------------------

      const nextScore =
        scoreRef.current + 1;

      scoreRef.current =
        nextScore;

      setScore(nextScore);

      setTargetHit(true);

      setDifficultyLabel(
        getDifficultyLabel(
          nextScore
        )
      );

      if (
        targetHitTimeoutRef.current !==
        null
      ) {
        clearTimeout(
          targetHitTimeoutRef.current
        );
      }

      targetHitTimeoutRef.current =
        setTimeout(() => {
          if (
            !isMountedRef.current
          ) {
            return;
          }

          setTargetHit(false);

          targetHitTimeoutRef.current =
            null;
        }, 600);

      // ------------------------------------------------------
      // Current sequence recall count.
      // ------------------------------------------------------

      const nextRecallCount =
        currentRecallCountRef.current +
        1;

      currentRecallCountRef.current =
        nextRecallCount;

      setCurrentRecallCount(
        nextRecallCount
      );

      // ------------------------------------------------------
      // Move to next target.
      // ------------------------------------------------------

      const nextIndex =
        activeTargetIndexRef.current +
        1;

      // ======================================================
      // SEQUENCE COMPLETE
      // ======================================================

      if (
        nextIndex >=
        MEMORY_SEQUENCE_LENGTH
      ) {
        // ----------------------------------------------------
        // Immediately lock the game.
        // ----------------------------------------------------

        sequenceCompleteRef.current =
          true;

        gamePhaseRef.current =
          'complete';

        hitLockRef.current =
          true;

        previewVisibleRef.current =
          false;

        // ----------------------------------------------------
        // Keep last index only for bookkeeping.
        // ----------------------------------------------------

        activeTargetIndexRef.current =
          MEMORY_SEQUENCE_LENGTH - 1;

        // ----------------------------------------------------
        // Hide target through render loop.
        // ----------------------------------------------------

        setSequenceComplete(true);

        setSequencePosition(
          MEMORY_SEQUENCE_LENGTH
        );

        // ----------------------------------------------------
        // Performance statistics.
        // ----------------------------------------------------

        completedSequenceCountRef.current +=
          1;

        totalRecalledTargetsRef.current +=
          nextRecallCount;

        totalTargetsAttemptedRef.current +=
          MEMORY_SEQUENCE_LENGTH;

        const nextAccuracy =
          totalTargetsAttemptedRef.current >
          0
            ? Math.round(
                (
                  totalRecalledTargetsRef.current /
                  totalTargetsAttemptedRef.current
                ) *
                  100
              )
            : 0;

        setCompletedSequenceCount(
          completedSequenceCountRef.current
        );

        setTotalRecalledTargets(
          totalRecalledTargetsRef.current
        );

        setMemoryAccuracy(
          nextAccuracy
        );

        // ----------------------------------------------------
        // Cancel any previous restart timer.
        // ----------------------------------------------------

        if (
          sequenceRestartTimeoutRef.current !==
          null
        ) {
          clearTimeout(
            sequenceRestartTimeoutRef.current
          );
        }

        const generation =
          sequenceGenerationRef.current;

        // ----------------------------------------------------
        // Wait 2000ms before new sequence.
        // ----------------------------------------------------

        sequenceRestartTimeoutRef.current =
          setTimeout(() => {
            if (
              !isMountedRef.current
            ) {
              return;
            }

            if (
              generation !==
              sequenceGenerationRef.current
            ) {
              return;
            }

            sequenceRestartTimeoutRef.current =
              null;

            startNewSequence();
          }, SEQUENCE_RESTART_DELAY_MS);

        return;
      }

      // ======================================================
      // NEXT TARGET
      // ======================================================

      activeTargetIndexRef.current =
        nextIndex;

      targetPosRef.current =
        targetSequenceRef.current[
          nextIndex
        ];

      setSequencePosition(
        nextIndex + 1
      );

      // ------------------------------------------------------
      // Release hit lock.
      //
      // This prevents the same frame/touch from producing
      // multiple hits while allowing the next target to work.
      // ------------------------------------------------------

      hitLockRef.current = false;
    }, [startNewSequence]);

  // ==========================================================
  // PHASE 3 — TARGET RENDER + COLLISION LOOP
  //
  // IMPORTANT:
  // There is intentionally NO target velocity update here.
  // Phase 3 targets remain stationary.
  // ==========================================================

  useEffect(() => {
    const animateTarget = (
      timestamp
    ) => {
      if (
        !isMountedRef.current
      ) {
        return;
      }

      const transform =
        lastTransformRef.current;

      const node =
        targetNodeRef.current;

      let targetVisible = false;

      // ======================================================
      // DETERMINE CURRENT GAME PHASE
      // ======================================================

      if (
        gamePhaseRef.current ===
        'memorizing'
      ) {
        targetPosRef.current =
          targetSequenceRef.current[
            previewIndexRef.current
          ];

        targetVisible =
          previewVisibleRef.current;
      } else if (
        gamePhaseRef.current ===
          'recalling' &&
        !sequenceCompleteRef.current
      ) {
        targetPosRef.current =
          targetSequenceRef.current[
            activeTargetIndexRef.current
          ];

        targetVisible = true;
      } else {
        // Complete / inactive.
        targetVisible = false;
      }

      // ======================================================
      // RENDER TARGET
      // ======================================================

      if (
        transform &&
        transform.width &&
        transform.height &&
        node
      ) {
        if (targetVisible) {
          node.style.display = '';

          const targetPx =
            normalizedToOverlayCoords(
              targetPosRef.current,
              transform
            );

          node.style.left =
            `${targetPx.x}px`;

          node.style.top =
            `${targetPx.y}px`;
        } else {
          node.style.display =
            'none';
        }
      }

      // ======================================================
      // COLLISION
      //
      // Only active during RECALLING.
      // ======================================================

      if (
        gamePhaseRef.current ===
          'recalling' &&
        !sequenceCompleteRef.current
      ) {
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

          const hit =
            isCollision(
              fingerPx,
              targetPx,
              TARGET_RADIUS_PX,
              HIT_TOLERANCE_PX
            );

          if (
            hit &&
            !hitLockRef.current
          ) {
            hitLockRef.current =
              true;

            handleTargetHit();
          } else if (!hit) {
            hitLockRef.current =
              false;
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
        targetAnimRafRef.current !==
        null
      ) {
        cancelAnimationFrame(
          targetAnimRafRef.current
        );

        targetAnimRafRef.current =
          null;
      }

      targetLastFrameTimeRef.current =
        null;

      targetDirectionChangeRef.current =
        null;

      targetDirectionIntervalRef.current =
        null;

      targetDesiredVelRef.current =
        null;
    };
  }, [handleTargetHit]);

  // ==========================================================
  // CLEANUP
  // ==========================================================

  useEffect(() => {
    return () => {
      isMountedRef.current =
        false;

      // ------------------------------------------------------
      // Invalidate all existing preview callbacks.
      // ------------------------------------------------------

      sequenceGenerationRef.current +=
        1;

      // ------------------------------------------------------
      // Target hit timeout.
      // ------------------------------------------------------

      if (
        targetHitTimeoutRef.current !==
        null
      ) {
        clearTimeout(
          targetHitTimeoutRef.current
        );

        targetHitTimeoutRef.current =
          null;
      }

      // ------------------------------------------------------
      // Sequence restart timeout.
      // ------------------------------------------------------

      if (
        sequenceRestartTimeoutRef.current !==
        null
      ) {
        clearTimeout(
          sequenceRestartTimeoutRef.current
        );

        sequenceRestartTimeoutRef.current =
          null;
      }

      // ------------------------------------------------------
      // Preview timeout.
      // ------------------------------------------------------

      if (
        previewTimeoutRef.current !==
        null
      ) {
        clearTimeout(
          previewTimeoutRef.current
        );

        previewTimeoutRef.current =
          null;
      }
    };
  }, []);

  // ==========================================================
  // UI STATE
  // ==========================================================

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

  // ==========================================================
  // STATUS
  // ==========================================================

  const statusLabel =
    !hasVideoBox
      ? 'Waiting for camera video to render…'
      : !isTracking
      ? 'Waiting for hand tracking to start…'
      : !lastKnownFingerTip
      ? 'Hand tracking active — show your hand to the camera.'
      : sequenceComplete
      ? 'Sequence Complete!'
      : isMemorizing
      ? 'Memorize the sequence...'
      : targetHit
      ? 'Target hit! Find the next target.'
      : 'Recall the sequence.';

  const memoryAccuracyLabel =
    memoryAccuracy === null
      ? '--'
      : `${memoryAccuracy}%`;

  // ==========================================================
  // OVERLAY
  // ==========================================================

  const overlay =
    hasVideoBox
      ? createPortal(
          <div
            className="wellness-challenge__video-overlay"
            style={{
              position: 'fixed',

              top:
                `${displayTransform.top}px`,

              left:
                `${displayTransform.left}px`,

              width:
                `${displayTransform.width}px`,

              height:
                `${displayTransform.height}px`,

              pointerEvents:
                'none',
            }}
            aria-hidden="true"
          >
            {/* =================================================
                TARGET
                ================================================= */}

            <div
              ref={targetNodeRef}
              className="wellness-challenge__target"
              style={{
                position:
                  'absolute',

                left:
                  initialTargetPx
                    ? `${initialTargetPx.x}px`
                    : '0px',

                top:
                  initialTargetPx
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

            {/* =================================================
                FINGERTIP
                ================================================= */}

            {hasDetectedFinger && (
              <div
                ref={fingerNodeRef}
                className="wellness-challenge__finger"
                style={{
                  position:
                    'absolute',

                  left: 0,
                  top: 0,

                  width:
                    `${FINGER_RADIUS_PX * 2}px`,

                  height:
                    `${FINGER_RADIUS_PX * 2}px`,

                  willChange:
                    'transform',

                  transform:
                    initialFingerPx
                      ? `translate(${initialFingerPx.x}px, ${initialFingerPx.y}px) translate(-50%, -50%)`
                      : undefined,
                }}
              />
            )}
          </div>,
          document.body
        )
      : null;

  // ==========================================================
  // COMPONENT UI
  // ==========================================================

  return (
    <section
      className="wellness-challenge"
      aria-labelledby="wellness-challenge-heading"
    >
      <header
        className="wellness-challenge__header"
      >
        <h2
          id="wellness-challenge-heading"
        >
          AI Wellness Challenge
        </h2>

        <p
          className="wellness-challenge__disclaimer"
        >
          An interactive hand-eye coordination
          exercise designed for engagement and
          general wellness. It is not a medical
          treatment or rehabilitation program.
        </p>
      </header>

      {/* ======================================================
          SCORE
          ====================================================== */}

      <div
        className="wellness-challenge__score"
        aria-label="Current score"
      >
        Score:{' '}
        <span
          className="wellness-challenge__score-value"
        >
          {score}
        </span>
      </div>

      {/* ======================================================
          DIFFICULTY
          ====================================================== */}

      <div
        className="wellness-challenge__difficulty"
        aria-label="Current difficulty"
      >
        Difficulty:{' '}
        <span
          className="wellness-challenge__difficulty-value"
        >
          {difficultyLabel}
        </span>
      </div>

      {/* ======================================================
          SEQUENCE
          ====================================================== */}

      <div
        className="wellness-challenge__sequence"
        aria-label="Sequence progress"
      >
        {sequenceComplete
          ? 'Sequence Complete!'
          : isMemorizing
          ? `Memorize: ${MEMORY_SEQUENCE_LENGTH} targets`
          : `Sequence: ${sequencePosition} / ${MEMORY_SEQUENCE_LENGTH}`}
      </div>

      {/* ======================================================
          MEMORY ACCURACY
          ====================================================== */}

      <div
        className="wellness-challenge__memory-accuracy"
        aria-label="Memory accuracy"
      >
        Memory Accuracy:{' '}
        {memoryAccuracyLabel}
      </div>

      {/* ======================================================
          CURRENT RECALL
          ====================================================== */}

      <div
        className="wellness-challenge__memory-recall"
        aria-label="Current round memory recall"
      >
        Memory Recall:{' '}
        {currentRecallCount} /{' '}
        {MEMORY_SEQUENCE_LENGTH}
      </div>

      {/* ======================================================
          COMPLETED SEQUENCES
          ====================================================== */}

      <div
        className="wellness-challenge__sequences-completed"
        aria-label="Sequences completed"
      >
        Sequences Completed:{' '}
        {completedSequenceCount}
      </div>

      {/* ======================================================
          STATUS
          ====================================================== */}

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