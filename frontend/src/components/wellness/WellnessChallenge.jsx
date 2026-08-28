import {
  useState,
  useRef,
  useEffect,
  useCallback,
} from 'react';
import { createPortal } from 'react-dom';

// ============================================================
// CORE CONSTANTS
// ============================================================

const TARGET_MARGIN = 0.12;

const TARGET_RADIUS_PX = 28;

const FINGER_RADIUS_PX = 10;

const HIT_TOLERANCE_PX = 14;

// ============================================================
// PHASE 1 — FINGERTIP CURSOR SMOOTHING
// KEEP FROZEN.
// ============================================================

const CURSOR_SMOOTHING_FACTOR = 0.55;

// ============================================================
// PHASE 4 — TIMED SPEED CHALLENGE
// ============================================================

const CHALLENGE_DURATION_MS = 30000;

const ROUND_RESTART_DELAY_MS = 3000;

// Maximum amount of time a target remains active
// before it becomes a miss.
const TARGET_LIFETIME_MS = 2200;

// Initial movement speed.
const BASE_TARGET_SPEED = 0.05;

// Maximum movement speed.
const MAX_TARGET_SPEED = 0.22;

// Score at which maximum speed is reached.
const SPEED_RAMP_SCORE = 25;

// Movement steering responsiveness.
const STEERING_RATE = 6;

// Prevent unusually large frame jumps.
const MAX_DT_SECONDS = 0.1;

// ============================================================
// PHASE 4 — TARGET SPEED
// ============================================================

function getTargetSpeed(score) {
  const safeScore =
    Number.isFinite(score) && score > 0
      ? score
      : 0;

  const progress = Math.min(
    safeScore / SPEED_RAMP_SCORE,
    1
  );

  return (
    BASE_TARGET_SPEED +
    (MAX_TARGET_SPEED - BASE_TARGET_SPEED) *
      progress
  );
}

// ============================================================
// PHASE 4 — DIFFICULTY LABEL
// ============================================================

function getDifficultyLabel(score) {
  const safeScore =
    Number.isFinite(score) && score > 0
      ? score
      : 0;

  if (safeScore >= 20) {
    return 'Expert';
  }

  if (safeScore >= 10) {
    return 'Hard';
  }

  if (safeScore >= 5) {
    return 'Medium';
  }

  return 'Easy';
}

// ============================================================
// VIDEO TRANSFORM
// ============================================================

function computeVideoDisplayTransform(videoEl) {
  const boxRect =
    videoEl.getBoundingClientRect();

  const naturalWidth =
    videoEl.videoWidth;

  const naturalHeight =
    videoEl.videoHeight;

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
      window.getComputedStyle(
        videoEl
      ).transform;

    if (
      computedTransform &&
      computedTransform !== 'none'
    ) {
      const matrix =
        new DOMMatrixReadOnly(
          computedTransform
        );

      mirrored = matrix.a < 0;
    }
  } catch {
    mirrored = false;
  }

  let objectFit = 'fill';

  try {
    objectFit =
      window.getComputedStyle(
        videoEl
      ).objectFit || 'fill';
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
  } else if (
    objectFit === 'contain'
  ) {
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
  } else if (
    objectFit === 'none'
  ) {
    scaleX = 1;
    scaleY = 1;

    offsetX =
      (boxRect.width -
        naturalWidth) /
      2;

    offsetY =
      (boxRect.height -
        naturalHeight) /
      2;
  } else {
    scaleX =
      boxRect.width /
      naturalWidth;

    scaleY =
      boxRect.height /
      naturalHeight;
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

// ============================================================
// NORMALIZED → OVERLAY COORDINATES
// ============================================================

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

  const effectiveX =
    transform.mirrored
      ? 1 - clampedX
      : clampedX;

  const naturalX =
    effectiveX *
    transform.naturalWidth;

  const naturalY =
    clampedY *
    transform.naturalHeight;

  return {
    x:
      transform.offsetX +
      naturalX *
        transform.scaleX,

    y:
      transform.offsetY +
      naturalY *
        transform.scaleY,
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
// PHASE 4 — MOVING TARGET VELOCITY
// ============================================================

function generateRandomVelocity(
  speed
) {
  const angle =
    Math.random() *
    Math.PI *
    2;

  return {
    x:
      Math.cos(angle) *
      speed,

    y:
      Math.sin(angle) *
      speed,
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
    fingerPx.x -
    targetPx.x;

  const dy =
    fingerPx.y -
    targetPx.y;

  return (
    Math.sqrt(
      dx * dx +
        dy * dy
    ) <=
    radiusPx +
      tolerancePx
  );
}

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

  const [
    displayTransform,
    setDisplayTransform,
  ] = useState(null);

  // ==========================================================
  // SCORE
  // ==========================================================

  const [
    score,
    setScore,
  ] = useState(0);

  const scoreRef =
    useRef(0);

  // ==========================================================
  // HIT / MISS
  // ==========================================================

  const [
    hits,
    setHits,
  ] = useState(0);

  const [
    misses,
    setMisses,
  ] = useState(0);

  const hitsRef =
    useRef(0);

  const missesRef =
    useRef(0);

  // ==========================================================
  // ACCURACY
  // ==========================================================

  const [
    accuracy,
    setAccuracy,
  ] = useState(0);

  // ==========================================================
  // REACTION TIME
  // ==========================================================

  const [
    lastReactionTime,
    setLastReactionTime,
  ] = useState(null);

  const [
    averageReactionTime,
    setAverageReactionTime,
  ] = useState(null);

  const reactionTimesRef =
    useRef([]);

  // ==========================================================
  // TARGET HIT FEEDBACK
  // ==========================================================

  const [
    targetHit,
    setTargetHit,
  ] = useState(false);

  const targetHitTimeoutRef =
    useRef(null);

  // ==========================================================
  // DIFFICULTY
  // ==========================================================

  const [
    difficultyLabel,
    setDifficultyLabel,
  ] = useState(
    () => getDifficultyLabel(0)
  );

  // ==========================================================
  // TIMER
  // ==========================================================

  const [
    timeRemaining,
    setTimeRemaining,
  ] = useState(
    CHALLENGE_DURATION_MS
  );

  const challengeStartTimeRef =
    useRef(null);

  const challengeEndTimeRef =
    useRef(null);

  const timerRafRef =
    useRef(null);

  // ==========================================================
  // GAME PHASE
  // ==========================================================

  const gamePhaseRef =
    useRef('waiting');

  const [
    gamePhase,
    setGamePhase,
  ] = useState('waiting');

  // waiting
  // running
  // complete

  // ==========================================================
  // FINGERTIP STATE
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
  // PHASE 4 — MOVING TARGET
  // ==========================================================

  const targetPosRef =
    useRef(
      generateRandomTarget()
    );

  const targetVelRef =
    useRef(
      generateRandomVelocity(
        BASE_TARGET_SPEED
      )
    );

  const targetNodeRef =
    useRef(null);

  const targetAnimRafRef =
    useRef(null);

  // BUGFIX: this ref was used throughout the target animation
  // loop below (both reset on setup/cleanup and read/written
  // every frame to compute dt) but was never declared — this is
  // what caused "Uncaught ReferenceError: targetLastFrameTimeRef
  // is not defined".
  const targetLastFrameTimeRef =
    useRef(null);

  const targetSpawnTimeRef =
    useRef(null);

  const targetActiveRef =
    useRef(false);

  // ==========================================================
  // SHARED REFS
  // ==========================================================

  const rafIdRef =
    useRef(null);

  const lastTransformRef =
    useRef(null);

  const isMountedRef =
    useRef(true);

  const hitLockRef =
    useRef(false);

  const restartTimeoutRef =
    useRef(null);

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
      if (
        !isMountedRef.current
      ) {
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
        requestAnimationFrame(
          poll
        );
    };

    rafIdRef.current =
      requestAnimationFrame(
        poll
      );

    return () => {
      if (
        rafIdRef.current !==
        null
      ) {
        cancelAnimationFrame(
          rafIdRef.current
        );

        rafIdRef.current =
          null;
      }
    };
  }, [videoRef]);

  // ==========================================================
  // PHASE 1 — RECEIVE MEDIAPIPE FINGERTIP
  // KEEP THIS SECTION FROZEN
  // ==========================================================

  useEffect(() => {
    const rawTip =
      indexFingerTips?.[0] ||
      null;

    if (rawTip) {
      setLastKnownFingerTip(
        rawTip
      );

      fingerTipRawRef.current =
        rawTip;

      if (
        !hasDetectedFinger
      ) {
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
          smoothedFingerPxRef.current =
            {
              x: rawPx.x,
              y: rawPx.y,
            };
        } else {
          smoothedFingerPxRef.current =
            {
              x:
                smoothedFingerPxRef
                  .current
                  .x +
                (
                  rawPx.x -
                  smoothedFingerPxRef
                    .current
                    .x
                ) *
                  CURSOR_SMOOTHING_FACTOR,

              y:
                smoothedFingerPxRef
                  .current
                  .y +
                (
                  rawPx.y -
                  smoothedFingerPxRef
                    .current
                    .y
                ) *
                  CURSOR_SMOOTHING_FACTOR,
            };
        }

        const {
          x,
          y,
        } =
          smoothedFingerPxRef
            .current;

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
        cursorRafRef.current !==
        null
      ) {
        cancelAnimationFrame(
          cursorRafRef.current
        );

        cursorRafRef.current =
          null;
      }
    };
  }, []);

  // ==========================================================
  // MOUNT STATE
  // ==========================================================

  useEffect(() => {
    isMountedRef.current =
      true;

    return () => {
      isMountedRef.current =
        false;
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
  // UPDATE ACCURACY
  // ==========================================================

  const updateAccuracy =
    useCallback(
      (
        nextHits,
        nextMisses
      ) => {
        const total =
          nextHits +
          nextMisses;

        const nextAccuracy =
          total > 0
            ? Math.round(
                (nextHits /
                  total) *
                  100
              )
            : 0;

        setAccuracy(
          nextAccuracy
        );
      },
      []
    );

  // ==========================================================
  // UPDATE REACTION STATISTICS
  // ==========================================================

  const recordReactionTime =
    useCallback(
      (reactionMs) => {
        reactionTimesRef.current.push(
          reactionMs
        );

        const times =
          reactionTimesRef.current;

        const total =
          times.reduce(
            (
              sum,
              value
            ) =>
              sum + value,
            0
          );

        const average =
          total / times.length;

        setLastReactionTime(
          Math.round(
            reactionMs
          )
        );

        setAverageReactionTime(
          Math.round(
            average
          )
        );
      },
      []
    );

  // ==========================================================
  // START TARGET
  // ==========================================================

  const spawnTarget =
    useCallback(
      (currentScore) => {
        if (
          !isMountedRef.current
        ) {
          return;
        }

        const speed =
          getTargetSpeed(
            currentScore
          );

        targetPosRef.current =
          generateRandomTarget();

        targetVelRef.current =
          generateRandomVelocity(
            speed
          );

        targetSpawnTimeRef.current =
          performance.now();

        targetActiveRef.current =
          true;

        hitLockRef.current =
          false;
      },
      []
    );

  // ==========================================================
  // COMPLETE CHALLENGE
  // ==========================================================

  const completeChallenge =
    useCallback(() => {
      if (
        !isMountedRef.current
      ) {
        return;
      }

      if (
        gamePhaseRef.current !==
        'running'
      ) {
        return;
      }

      gamePhaseRef.current =
        'complete';

      setGamePhase(
        'complete'
      );

      targetActiveRef.current =
        false;

      hitLockRef.current =
        true;

      setTimeRemaining(0);

      // ------------------------------------------------------
      // Cancel timer loop.
      // ------------------------------------------------------

      if (
        timerRafRef.current !==
        null
      ) {
        cancelAnimationFrame(
          timerRafRef.current
        );

        timerRafRef.current =
          null;
      }

      // ------------------------------------------------------
      // Schedule next challenge.
      // ------------------------------------------------------

      if (
        restartTimeoutRef.current !==
        null
      ) {
        clearTimeout(
          restartTimeoutRef.current
        );
      }

      restartTimeoutRef.current =
        setTimeout(() => {
          if (
            !isMountedRef.current
          ) {
            return;
          }

          restartTimeoutRef.current =
            null;

          startChallenge();
        }, ROUND_RESTART_DELAY_MS);
    }, []);

  // ==========================================================
  // TIMER LOOP
  // ==========================================================

  const runChallengeTimer =
    useCallback(() => {
      const updateTimer =
        () => {
          if (
            !isMountedRef.current
          ) {
            return;
          }

          if (
            gamePhaseRef.current !==
            'running'
          ) {
            return;
          }

          const now =
            performance.now();

          const remaining =
            Math.max(
              0,
              challengeEndTimeRef
                .current - now
            );

          setTimeRemaining(
            remaining
          );

          if (
            remaining <= 0
          ) {
            completeChallenge();
            return;
          }

          timerRafRef.current =
            requestAnimationFrame(
              updateTimer
            );
        };

      timerRafRef.current =
        requestAnimationFrame(
          updateTimer
        );
    }, [completeChallenge]);

  // ==========================================================
  // START CHALLENGE
  // ==========================================================

  const startChallenge =
    useCallback(() => {
      if (
        !isMountedRef.current
      ) {
        return;
      }

      // ------------------------------------------------------
      // Cancel previous restart timer.
      // ------------------------------------------------------

      if (
        restartTimeoutRef.current !==
        null
      ) {
        clearTimeout(
          restartTimeoutRef.current
        );

        restartTimeoutRef.current =
          null;
      }

      // ------------------------------------------------------
      // Cancel previous timer RAF.
      // ------------------------------------------------------

      if (
        timerRafRef.current !==
        null
      ) {
        cancelAnimationFrame(
          timerRafRef.current
        );

        timerRafRef.current =
          null;
      }

      // ------------------------------------------------------
      // Reset metrics.
      // ------------------------------------------------------

      scoreRef.current = 0;

      hitsRef.current = 0;

      missesRef.current = 0;

      reactionTimesRef.current =
        [];

      setScore(0);

      setHits(0);

      setMisses(0);

      setAccuracy(0);

      setLastReactionTime(
        null
      );

      setAverageReactionTime(
        null
      );

      setDifficultyLabel(
        getDifficultyLabel(0)
      );

      setTargetHit(false);

      // ------------------------------------------------------
      // Reset timer.
      // ------------------------------------------------------

      const now =
        performance.now();

      challengeStartTimeRef.current =
        now;

      challengeEndTimeRef.current =
        now +
        CHALLENGE_DURATION_MS;

      setTimeRemaining(
        CHALLENGE_DURATION_MS
      );

      // ------------------------------------------------------
      // Reset game state.
      // ------------------------------------------------------

      gamePhaseRef.current =
        'running';

      setGamePhase(
        'running'
      );

      targetActiveRef.current =
        false;

      hitLockRef.current =
        false;

      // ------------------------------------------------------
      // Spawn first target.
      // ------------------------------------------------------

      spawnTarget(0);

      // ------------------------------------------------------
      // Start timer.
      // ------------------------------------------------------

      runChallengeTimer();
    }, [
      runChallengeTimer,
      spawnTarget,
    ]);

  // ==========================================================
  // INITIAL START
  // ==========================================================

  useEffect(() => {
    const timeout =
      setTimeout(() => {
        startChallenge();
      }, 500);

    return () => {
      clearTimeout(
        timeout
      );
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==========================================================
  // TARGET HIT
  // ==========================================================

  const handleTargetHit =
    useCallback(() => {
      if (
        !isMountedRef.current
      ) {
        return;
      }

      if (
        gamePhaseRef.current !==
        'running'
      ) {
        return;
      }

      if (
        !targetActiveRef.current
      ) {
        return;
      }

      if (
        hitLockRef.current
      ) {
        return;
      }

      hitLockRef.current =
        true;

      // ------------------------------------------------------
      // Reaction time.
      // ------------------------------------------------------

      const now =
        performance.now();

      const spawnTime =
        targetSpawnTimeRef.current;

      if (
        Number.isFinite(
          spawnTime
        )
      ) {
        const reaction =
          Math.max(
            0,
            now - spawnTime
          );

        recordReactionTime(
          reaction
        );
      }

      // ------------------------------------------------------
      // Hit.
      // ------------------------------------------------------

      const nextHits =
        hitsRef.current + 1;

      hitsRef.current =
        nextHits;

      setHits(
        nextHits
      );

      // ------------------------------------------------------
      // Score.
      // ------------------------------------------------------

      const nextScore =
        scoreRef.current + 1;

      scoreRef.current =
        nextScore;

      setScore(
        nextScore
      );

      setDifficultyLabel(
        getDifficultyLabel(
          nextScore
        )
      );

      // ------------------------------------------------------
      // Hit feedback.
      // ------------------------------------------------------

      setTargetHit(
        true
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

          setTargetHit(
            false
          );

          targetHitTimeoutRef.current =
            null;
        }, 300);

      // ------------------------------------------------------
      // Update accuracy.
      // ------------------------------------------------------

      updateAccuracy(
        nextHits,
        missesRef.current
      );

      // ------------------------------------------------------
      // Immediately create next target.
      // ------------------------------------------------------

      targetActiveRef.current =
        false;

      spawnTarget(
        nextScore
      );
    }, [
      recordReactionTime,
      spawnTarget,
      updateAccuracy,
    ]);

  // ==========================================================
  // TARGET MISS
  // ==========================================================

  const handleTargetMiss =
    useCallback(() => {
      if (
        !isMountedRef.current
      ) {
        return;
      }

      if (
        gamePhaseRef.current !==
        'running'
      ) {
        return;
      }

      if (
        !targetActiveRef.current
      ) {
        return;
      }

      // ------------------------------------------------------
      // Mark current target inactive first.
      // ------------------------------------------------------

      targetActiveRef.current =
        false;

      hitLockRef.current =
        true;

      // ------------------------------------------------------
      // Record reaction/lifetime.
      // ------------------------------------------------------

      const now =
        performance.now();

      const spawnTime =
        targetSpawnTimeRef.current;

      if (
        Number.isFinite(
          spawnTime
        )
      ) {
        const reaction =
          Math.max(
            0,
            now - spawnTime
          );

        recordReactionTime(
          reaction
        );
      }

      // ------------------------------------------------------
      // Miss count.
      // ------------------------------------------------------

      const nextMisses =
        missesRef.current + 1;

      missesRef.current =
        nextMisses;

      setMisses(
        nextMisses
      );

      // ------------------------------------------------------
      // Update accuracy.
      // ------------------------------------------------------

      updateAccuracy(
        hitsRef.current,
        nextMisses
      );

      // ------------------------------------------------------
      // Spawn replacement target.
      // ------------------------------------------------------

      spawnTarget(
        scoreRef.current
      );
    }, [
      recordReactionTime,
      spawnTarget,
      updateAccuracy,
    ]);

  // ==========================================================
  // TARGET MOVEMENT + COLLISION LOOP
  // ==========================================================

  useEffect(() => {
    const animateTarget =
      (timestamp) => {
        if (
          !isMountedRef.current
        ) {
          return;
        }

        const transform =
          lastTransformRef.current;

        const node =
          targetNodeRef.current;

        // ----------------------------------------------------
        // Continue RAF.
        // ----------------------------------------------------

        targetAnimRafRef.current =
          requestAnimationFrame(
            animateTarget
          );

        if (
          !transform ||
          !transform.width ||
          !transform.height ||
          !node
        ) {
          return;
        }

        if (
          gamePhaseRef.current !==
          'running'
        ) {
          node.style.display =
            'none';

          return;
        }

        if (
          !targetActiveRef.current
        ) {
          node.style.display =
            'none';

          return;
        }

        // ----------------------------------------------------
        // Calculate delta time.
        // ----------------------------------------------------

        const previousTimestamp =
          targetLastFrameTimeRef.current;

        targetLastFrameTimeRef.current =
          timestamp;

        let dt = 0;

        if (
          Number.isFinite(
            previousTimestamp
          )
        ) {
          dt =
            (timestamp -
              previousTimestamp) /
            1000;
        }

        dt = Math.min(
          Math.max(dt, 0),
          MAX_DT_SECONDS
        );

        // ----------------------------------------------------
        // Current speed.
        // ----------------------------------------------------

        const speed =
          getTargetSpeed(
            scoreRef.current
          );

        // ----------------------------------------------------
        // Desired velocity.
        // ----------------------------------------------------

        const currentVelocity =
          targetVelRef.current;

        const currentMagnitude =
          Math.sqrt(
            currentVelocity.x *
              currentVelocity.x +
              currentVelocity.y *
              currentVelocity.y
          );

        if (
          currentMagnitude === 0
        ) {
          targetVelRef.current =
            generateRandomVelocity(
              speed
            );
        } else {
          const normalizedX =
            currentVelocity.x /
            currentMagnitude;

          const normalizedY =
            currentVelocity.y /
            currentMagnitude;

          targetVelRef.current =
            {
              x:
                normalizedX *
                speed,

              y:
                normalizedY *
                speed,
            };
        }

        // ----------------------------------------------------
        // Move target.
        // ----------------------------------------------------

        targetPosRef.current = {
          x:
            targetPosRef.current.x +
            targetVelRef.current.x *
              dt,

          y:
            targetPosRef.current.y +
            targetVelRef.current.y *
              dt,
        };

        // ----------------------------------------------------
        // Bounce from horizontal boundaries.
        // ----------------------------------------------------

        if (
          targetPosRef.current.x <=
          TARGET_MARGIN
        ) {
          targetPosRef.current.x =
            TARGET_MARGIN;

          targetVelRef.current.x =
            Math.abs(
              targetVelRef.current.x
            );
        } else if (
          targetPosRef.current.x >=
          1 - TARGET_MARGIN
        ) {
          targetPosRef.current.x =
            1 - TARGET_MARGIN;

          targetVelRef.current.x =
            -Math.abs(
              targetVelRef.current.x
            );
        }

        // ----------------------------------------------------
        // Bounce from vertical boundaries.
        // ----------------------------------------------------

        if (
          targetPosRef.current.y <=
          TARGET_MARGIN
        ) {
          targetPosRef.current.y =
            TARGET_MARGIN;

          targetVelRef.current.y =
            Math.abs(
              targetVelRef.current.y
            );
        } else if (
          targetPosRef.current.y >=
          1 - TARGET_MARGIN
        ) {
          targetPosRef.current.y =
            1 - TARGET_MARGIN;

          targetVelRef.current.y =
            -Math.abs(
              targetVelRef.current.y
            );
        }

        // ----------------------------------------------------
        // Render target.
        // ----------------------------------------------------

        const targetPx =
          normalizedToOverlayCoords(
            targetPosRef.current,
            transform
          );

        node.style.display =
          '';

        node.style.left =
          `${targetPx.x}px`;

        node.style.top =
          `${targetPx.y}px`;

        // ----------------------------------------------------
        // Collision detection.
        // ----------------------------------------------------

        const fingerTip =
          fingerTipRawRef.current;

        if (
          fingerTip
        ) {
          const fingerPx =
            normalizedToOverlayCoords(
              fingerTip,
              transform
            );

          const collision =
            isCollision(
              fingerPx,
              targetPx,
              TARGET_RADIUS_PX,
              HIT_TOLERANCE_PX
            );

          if (
            collision &&
            !hitLockRef.current
          ) {
            handleTargetHit();

            return;
          }
        }

        // ----------------------------------------------------
        // Target lifetime → miss.
        // ----------------------------------------------------

        const spawnTime =
          targetSpawnTimeRef.current;

        if (
          Number.isFinite(
            spawnTime
          ) &&
          timestamp -
            spawnTime >=
            TARGET_LIFETIME_MS
        ) {
          handleTargetMiss();
        }
      };

    targetLastFrameTimeRef.current =
      null;

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
    };
  }, [
    handleTargetHit,
    handleTargetMiss,
  ]);

  // ==========================================================
  // CLEANUP
  // ==========================================================

  useEffect(() => {
    return () => {
      isMountedRef.current =
        false;

      // ------------------------------------------------------
      // Timer RAF.
      // ------------------------------------------------------

      if (
        timerRafRef.current !==
        null
      ) {
        cancelAnimationFrame(
          timerRafRef.current
        );

        timerRafRef.current =
          null;
      }

      // ------------------------------------------------------
      // Target RAF.
      // ------------------------------------------------------

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

      // ------------------------------------------------------
      // Restart timeout.
      // ------------------------------------------------------

      if (
        restartTimeoutRef.current !==
        null
      ) {
        clearTimeout(
          restartTimeoutRef.current
        );

        restartTimeoutRef.current =
          null;
      }

      // ------------------------------------------------------
      // Hit feedback timeout.
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
      // Video RAF.
      // ------------------------------------------------------

      if (
        rafIdRef.current !==
        null
      ) {
        cancelAnimationFrame(
          rafIdRef.current
        );

        rafIdRef.current =
          null;
      }

      // ------------------------------------------------------
      // Cursor RAF.
      // ------------------------------------------------------

      if (
        cursorRafRef.current !==
        null
      ) {
        cancelAnimationFrame(
          cursorRafRef.current
        );

        cursorRafRef.current =
          null;
      }
    };
  }, []);

  // ==========================================================
  // UI STATE
  // ==========================================================

  const hasVideoBox =
    !!displayTransform &&
    displayTransform.width >
      0 &&
    displayTransform.height >
      0;

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
  // DISPLAY VALUES
  // ==========================================================

  const secondsRemaining =
    Math.ceil(
      timeRemaining / 1000
    );

  const formattedLastReaction =
    lastReactionTime === null
      ? '--'
      : `${lastReactionTime} ms`;

  const formattedAverageReaction =
    averageReactionTime === null
      ? '--'
      : `${averageReactionTime} ms`;

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
      : gamePhase === 'complete'
      ? 'Challenge Complete!'
      : targetHit
      ? 'Target hit!'
      : `Hit the moving target — ${secondsRemaining}s remaining.`;

  // ==========================================================
  // OVERLAY
  // ==========================================================

  const overlay =
    hasVideoBox
      ? createPortal(
          <div
            className="wellness-challenge__video-overlay"
            style={{
              position:
                'fixed',

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
                MOVING TARGET
                ================================================= */}

            <div
              ref={
                targetNodeRef
              }
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

                display:
                  'none',
              }}
            />

            {/* =================================================
                FINGERTIP
                ================================================= */}

            {hasDetectedFinger && (
              <div
                ref={
                  fingerNodeRef
                }
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
          A timed hand-eye coordination
          exercise designed for engagement
          and general wellness. It is not a
          medical treatment or rehabilitation
          program.
        </p>
      </header>

      {/* ======================================================
          TIMER
          ====================================================== */}

      <div
        className="wellness-challenge__timer"
        aria-label="Time remaining"
      >
        Time:{' '}
        <span
          className="wellness-challenge__timer-value"
        >
          {secondsRemaining}s
        </span>
      </div>

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
          HITS
          ====================================================== */}

      <div
        className="wellness-challenge__hits"
        aria-label="Targets hit"
      >
        Hits:{' '}
        {hits}
      </div>

      {/* ======================================================
          MISSES
          ====================================================== */}

      <div
        className="wellness-challenge__misses"
        aria-label="Targets missed"
      >
        Misses:{' '}
        {misses}
      </div>

      {/* ======================================================
          ACCURACY
          ====================================================== */}

      <div
        className="wellness-challenge__accuracy"
        aria-label="Challenge accuracy"
      >
        Accuracy:{' '}
        {accuracy}%
      </div>

      {/* ======================================================
          LAST REACTION TIME
          ====================================================== */}

      <div
        className="wellness-challenge__reaction-time"
        aria-label="Last reaction time"
      >
        Reaction Time:{' '}
        {formattedLastReaction}
      </div>

      {/* ======================================================
          AVERAGE REACTION TIME
          ====================================================== */}

      <div
        className="wellness-challenge__average-reaction-time"
        aria-label="Average reaction time"
      >
        Average Reaction:{' '}
        {formattedAverageReaction}
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