import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

// ============================================================
// CORE CONSTANTS
// ============================================================

const TARGET_MARGIN = 0.12;
const TARGET_RADIUS_PX = 28;
const FINGER_RADIUS_PX = 10;
const HIT_TOLERANCE_PX = 14;

// Phase 1 — fingertip cursor smoothing. KEEP FROZEN.
const CURSOR_SMOOTHING_FACTOR = 0.55;

// ============================================================
// PHASE 4 — TIMED SPEED CHALLENGE (PRESERVED)
// ============================================================

const CHALLENGE_DURATION_MS = 30000;
const ROUND_RESTART_DELAY_MS = 3000;
const TARGET_LIFETIME_MS = 2200;
const BASE_TARGET_SPEED = 0.05;
const MAX_TARGET_SPEED = 0.22;
const SPEED_RAMP_SCORE = 25;
const STEERING_RATE = 6;
const MAX_DT_SECONDS = 0.1;

// ============================================================
// PHASE 5 — DUAL HAND
// ============================================================

const SIDES = ['left', 'right'];

// Minimum normalized-space separation between the two targets so
// they never spawn on top of each other.
const MIN_TARGET_SEPARATION = 0.3;

// MediaPipe's handedness label describes the physical hand as
// captured by the raw camera image, BEFORE any CSS mirroring is
// applied for a natural "selfie" display. Since the video feed in
// this project is displayed mirrored (see computeVideoDisplayTransform
// / normalizedToOverlayCoords's mirroring), the label the user
// visually perceives as "my left hand" is the opposite of what
// MediaPipe reports. This flag corrects for that so the on-screen
// "Left"/"Right" target matches the hand the user actually raises.
// If your camera setup is NOT mirrored, set this to false.
const INVERT_HANDEDNESS_FOR_DISPLAY = true;

function resolveDisplaySide(rawHandedness) {
  if (rawHandedness !== 'Left' && rawHandedness !== 'Right') return null;
  if (!INVERT_HANDEDNESS_FOR_DISPLAY) {
    return rawHandedness === 'Left' ? 'left' : 'right';
  }
  return rawHandedness === 'Left' ? 'right' : 'left';
}

function getTargetSpeed(score) {
  const safeScore = Number.isFinite(score) && score > 0 ? score : 0;
  const progress = Math.min(safeScore / SPEED_RAMP_SCORE, 1);
  return BASE_TARGET_SPEED + (MAX_TARGET_SPEED - BASE_TARGET_SPEED) * progress;
}

function getDifficultyLabel(score) {
  const safeScore = Number.isFinite(score) && score > 0 ? score : 0;
  if (safeScore >= 20) return 'Expert';
  if (safeScore >= 10) return 'Hard';
  if (safeScore >= 5) return 'Medium';
  return 'Easy';
}

// ============================================================
// VIDEO TRANSFORM (PRESERVED — FROZEN)
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
    scaleX = boxRect.width / naturalWidth;
    scaleY = boxRect.height / naturalHeight;
  }

  return { ...base, scaleX, scaleY, offsetX, offsetY, mirrored };
}

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

// ============================================================
// TARGET GENERATION
// ============================================================

function generateRandomTarget() {
  const range = 1 - TARGET_MARGIN * 2;
  return {
    x: TARGET_MARGIN + Math.random() * range,
    y: TARGET_MARGIN + Math.random() * range,
  };
}

function distanceBetween(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// PHASE 5 — generates two targets guaranteed to be at least
// MIN_TARGET_SEPARATION apart (normalized space), retrying a bounded
// number of times before accepting the last attempt as a fallback.
function generateTwoTargets() {
  let left = generateRandomTarget();
  let right = generateRandomTarget();
  let attempts = 0;
  while (distanceBetween(left, right) < MIN_TARGET_SEPARATION && attempts < 30) {
    right = generateRandomTarget();
    attempts += 1;
  }
  return { left, right };
}

function generateRandomVelocity(speed) {
  const angle = Math.random() * Math.PI * 2;
  return { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
}

// ============================================================
// COLLISION
// ============================================================

function isCollision(fingerPx, targetPx, radiusPx, tolerancePx) {
  const dx = fingerPx.x - targetPx.x;
  const dy = fingerPx.y - targetPx.y;
  return Math.sqrt(dx * dx + dy * dy) <= radiusPx + tolerancePx;
}

// ============================================================
// COMPONENT
// ============================================================

function WellnessChallenge({ videoRef, indexFingerTips = [], isTracking = false }) {
  // ==========================================================
  // VIDEO TRANSFORM STATE
  // ==========================================================
  const [displayTransform, setDisplayTransform] = useState(null);

  // ==========================================================
  // SCORE / STATS (per side + combined)
  // ==========================================================
  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);

  const [hits, setHits] = useState({ left: 0, right: 0 });
  const [misses, setMisses] = useState({ left: 0, right: 0 });
  const hitsRef = useRef({ left: 0, right: 0 });
  const missesRef = useRef({ left: 0, right: 0 });

  const [accuracy, setAccuracy] = useState(0);

  const [lastReactionTime, setLastReactionTime] = useState(null);
  const [averageReactionTime, setAverageReactionTime] = useState(null);
  const reactionTimesRef = useRef([]);

  const [targetHit, setTargetHit] = useState({ left: false, right: false });
  const targetHitTimeoutRefs = { left: useRef(null), right: useRef(null) };

  const [difficultyLabel, setDifficultyLabel] = useState(() => getDifficultyLabel(0));

  // ==========================================================
  // TIMER
  // ==========================================================
  const [timeRemaining, setTimeRemaining] = useState(CHALLENGE_DURATION_MS);
  const challengeEndTimeRef = useRef(null);
  const timerRafRef = useRef(null);

  // ==========================================================
  // GAME PHASE
  // 'waiting'  → waiting for both hands to be seen at least once
  // 'running'  → challenge active
  // 'complete' → round finished, restart pending
  // ==========================================================
  const gamePhaseRef = useRef('waiting');
  const [gamePhase, setGamePhase] = useState('waiting');

  // ==========================================================
  // PHASE 5 — FINGERTIP STATE (per side)
  // ==========================================================
  // Current-frame raw fingertip per side (normalized coords), or
  // null if that hand is not currently detected. Unlike the earlier
  // single-hand "sticky forever" cursor, Phase 5 REQUIRES a missing
  // hand's cursor to hide, so this is presence-based every frame.
  const fingerTipRawRef = { left: useRef(null), right: useRef(null) };
  const fingerNodeRef = { left: useRef(null), right: useRef(null) };
  const smoothedFingerPxRef = { left: useRef(null), right: useRef(null) };
  const cursorRafRef = useRef(null);

  // Whether each hand is CURRENTLY detected this frame — drives
  // conditional rendering of each cursor DOM node.
  const [handsDetected, setHandsDetected] = useState({ left: false, right: false });

  // Used only for the very first paint position before the RAF loop
  // takes over (mirrors Phase 1/4's initialFingerPx pattern).
  const [lastKnownFingerTip, setLastKnownFingerTip] = useState({ left: null, right: null });

  // Whether both hands have EVER been seen simultaneously — gates
  // the 'waiting' → 'running' transition.
  const bothHandsEverSeenRef = useRef(false);

  // ==========================================================
  // PHASE 5 — TARGET STATE (per side)
  // ==========================================================
  const initialTargets = generateTwoTargets();
  const targetPosRef = {
    left: useRef(initialTargets.left),
    right: useRef(initialTargets.right),
  };
  const targetVelRef = {
    left: useRef(generateRandomVelocity(BASE_TARGET_SPEED)),
    right: useRef(generateRandomVelocity(BASE_TARGET_SPEED)),
  };
  const targetNodeRef = { left: useRef(null), right: useRef(null) };
  const targetActiveRef = { left: useRef(false), right: useRef(false) };
  const targetSpawnTimeRef = { left: useRef(null), right: useRef(null) };
  const hitLockRef = { left: useRef(false), right: useRef(false) };

  const targetAnimRafRef = useRef(null);
  const targetLastFrameTimeRef = useRef(null);

  // ==========================================================
  // SHARED REFS
  // ==========================================================
  const rafIdRef = useRef(null);
  const lastTransformRef = useRef(null);
  const isMountedRef = useRef(true);
  const restartTimeoutRef = useRef(null);

  // ==========================================================
  // VIDEO TRANSFORM COMPARISON
  // ==========================================================
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

  // ==========================================================
  // VIDEO TRANSFORM RAF (PRESERVED)
  // ==========================================================
  useEffect(() => {
    const poll = () => {
      if (!isMountedRef.current) return;
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

  // ==========================================================
  // PHASE 5 — RECEIVE MEDIAPIPE FINGERTIPS (BOTH HANDS)
  // ==========================================================
  // Replaces Phase 1/4's single-tip-only intake. Reads the FULL
  // indexFingerTips array, resolves each entry's handedness to a
  // display side ('left'/'right'), and updates that side's raw
  // fingertip ref. A side with no matching entry this update is set
  // to null so its cursor hides (per Phase 5 spec).
  useEffect(() => {
    const nextLeft = indexFingerTips.find(
      (tip) => resolveDisplaySide(tip.handedness) === 'left'
    ) || null;
    const nextRight = indexFingerTips.find(
      (tip) => resolveDisplaySide(tip.handedness) === 'right'
    ) || null;

    fingerTipRawRef.left.current = nextLeft;
    fingerTipRawRef.right.current = nextRight;

    setHandsDetected((prev) => {
      const nextDetected = { left: !!nextLeft, right: !!nextRight };
      if (prev.left === nextDetected.left && prev.right === nextDetected.right) {
        return prev;
      }
      return nextDetected;
    });

    if (nextLeft || nextRight) {
      setLastKnownFingerTip((prev) => ({
        left: nextLeft || prev.left,
        right: nextRight || prev.right,
      }));
    }

    if (nextLeft && nextRight) {
      bothHandsEverSeenRef.current = true;
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexFingerTips]);

  // ==========================================================
  // PHASE 5 — FINGERTIP RENDER LOOP (BOTH CURSORS, ONE RAF)
  // ==========================================================
  useEffect(() => {
    const renderCursor = () => {
      const transform = lastTransformRef.current;

      SIDES.forEach((side) => {
        const tip = fingerTipRawRef[side].current;
        const node = fingerNodeRef[side].current;

        if (!node) return;

        if (!tip || !transform || !transform.width || !transform.height) {
          node.style.display = 'none';
          return;
        }

        node.style.display = '';

        const rawPx = normalizedToOverlayCoords(tip, transform);

        if (!smoothedFingerPxRef[side].current) {
          smoothedFingerPxRef[side].current = { x: rawPx.x, y: rawPx.y };
        } else {
          const prev = smoothedFingerPxRef[side].current;
          smoothedFingerPxRef[side].current = {
            x: prev.x + (rawPx.x - prev.x) * CURSOR_SMOOTHING_FACTOR,
            y: prev.y + (rawPx.y - prev.y) * CURSOR_SMOOTHING_FACTOR,
          };
        }

        const { x, y } = smoothedFingerPxRef[side].current;
        node.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      });

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
  // DIFFICULTY
  // ==========================================================
  useEffect(() => {
    setDifficultyLabel(getDifficultyLabel(score));
  }, [score]);

  // ==========================================================
  // UPDATE ACCURACY (combined across both sides)
  // ==========================================================
  const updateAccuracy = useCallback((nextHits, nextMisses) => {
    const totalHits = nextHits.left + nextHits.right;
    const totalMisses = nextMisses.left + nextMisses.right;
    const total = totalHits + totalMisses;
    const nextAccuracy = total > 0 ? Math.round((totalHits / total) * 100) : 0;
    setAccuracy(nextAccuracy);
  }, []);

  const recordReactionTime = useCallback((reactionMs) => {
    reactionTimesRef.current.push(reactionMs);
    const times = reactionTimesRef.current;
    const total = times.reduce((sum, v) => sum + v, 0);
    const average = total / times.length;
    setLastReactionTime(Math.round(reactionMs));
    setAverageReactionTime(Math.round(average));
  }, []);

  // ==========================================================
  // SPAWN BOTH TARGETS
  // ==========================================================
  const spawnTargets = useCallback((currentScore) => {
    if (!isMountedRef.current) return;
    const speed = getTargetSpeed(currentScore);
    const fresh = generateTwoTargets();

    SIDES.forEach((side) => {
      targetPosRef[side].current = fresh[side];
      targetVelRef[side].current = generateRandomVelocity(speed);
      targetSpawnTimeRef[side].current = performance.now();
      targetActiveRef[side].current = true;
      hitLockRef[side].current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==========================================================
  // COMPLETE CHALLENGE
  // ==========================================================
  const completeChallenge = useCallback(() => {
    if (!isMountedRef.current) return;
    if (gamePhaseRef.current !== 'running') return;

    gamePhaseRef.current = 'complete';
    setGamePhase('complete');

    SIDES.forEach((side) => {
      targetActiveRef[side].current = false;
      hitLockRef[side].current = true;
    });

    setTimeRemaining(0);

    if (timerRafRef.current !== null) {
      cancelAnimationFrame(timerRafRef.current);
      timerRafRef.current = null;
    }

    if (restartTimeoutRef.current !== null) {
      clearTimeout(restartTimeoutRef.current);
    }

    restartTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      restartTimeoutRef.current = null;
      // eslint-disable-next-line no-use-before-define
      startChallenge();
    }, ROUND_RESTART_DELAY_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==========================================================
  // TIMER LOOP
  // ==========================================================
  const runChallengeTimer = useCallback(() => {
    const updateTimer = () => {
      if (!isMountedRef.current) return;
      if (gamePhaseRef.current !== 'running') return;

      const now = performance.now();
      const remaining = Math.max(0, challengeEndTimeRef.current - now);
      setTimeRemaining(remaining);

      if (remaining <= 0) {
        completeChallenge();
        return;
      }

      timerRafRef.current = requestAnimationFrame(updateTimer);
    };
    timerRafRef.current = requestAnimationFrame(updateTimer);
  }, [completeChallenge]);

  // ==========================================================
  // START CHALLENGE
  // ==========================================================
  const startChallenge = useCallback(() => {
    if (!isMountedRef.current) return;

    if (restartTimeoutRef.current !== null) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    if (timerRafRef.current !== null) {
      cancelAnimationFrame(timerRafRef.current);
      timerRafRef.current = null;
    }

    scoreRef.current = 0;
    hitsRef.current = { left: 0, right: 0 };
    missesRef.current = { left: 0, right: 0 };
    reactionTimesRef.current = [];

    setScore(0);
    setHits({ left: 0, right: 0 });
    setMisses({ left: 0, right: 0 });
    setAccuracy(0);
    setLastReactionTime(null);
    setAverageReactionTime(null);
    setDifficultyLabel(getDifficultyLabel(0));
    setTargetHit({ left: false, right: false });

    const now = performance.now();
    challengeEndTimeRef.current = now + CHALLENGE_DURATION_MS;
    setTimeRemaining(CHALLENGE_DURATION_MS);

    gamePhaseRef.current = 'running';
    setGamePhase('running');

    SIDES.forEach((side) => {
      targetActiveRef[side].current = false;
      hitLockRef[side].current = false;
    });

    spawnTargets(0);
    runChallengeTimer();
  }, [runChallengeTimer, spawnTargets]);

  // ==========================================================
  // PHASE 5 — WAIT FOR BOTH HANDS, THEN START
  // ==========================================================
  // Instead of Phase 4's fixed 500ms auto-start, Phase 5 waits until
  // both hands have been detected simultaneously at least once.
  useEffect(() => {
    if (gamePhaseRef.current !== 'waiting') return;
    if (!handsDetected.left || !handsDetected.right) return;
    startChallenge();
  }, [handsDetected, startChallenge]);

  // ==========================================================
  // TARGET HIT (per side)
  // ==========================================================
  const handleTargetHit = useCallback(
    (side) => {
      if (!isMountedRef.current) return;
      if (gamePhaseRef.current !== 'running') return;
      if (!targetActiveRef[side].current) return;
      if (hitLockRef[side].current) return;

      hitLockRef[side].current = true;

      const now = performance.now();
      const spawnTime = targetSpawnTimeRef[side].current;
      if (Number.isFinite(spawnTime)) {
        recordReactionTime(Math.max(0, now - spawnTime));
      }

      const nextHits = { ...hitsRef.current, [side]: hitsRef.current[side] + 1 };
      hitsRef.current = nextHits;
      setHits(nextHits);

      const nextScore = scoreRef.current + 1;
      scoreRef.current = nextScore;
      setScore(nextScore);
      setDifficultyLabel(getDifficultyLabel(nextScore));

      setTargetHit((prev) => ({ ...prev, [side]: true }));
      if (targetHitTimeoutRefs[side].current !== null) {
        clearTimeout(targetHitTimeoutRefs[side].current);
      }
      targetHitTimeoutRefs[side].current = setTimeout(() => {
        if (!isMountedRef.current) return;
        setTargetHit((prev) => ({ ...prev, [side]: false }));
        targetHitTimeoutRefs[side].current = null;
      }, 300);

      updateAccuracy(nextHits, missesRef.current);

      // Respawn only this side's target, at the current combined
      // score's speed, keeping it separated from the other target.
      targetActiveRef[side].current = false;
      const speed = getTargetSpeed(nextScore);
      let fresh = generateRandomTarget();
      let attempts = 0;
      const other = targetPosRef[side === 'left' ? 'right' : 'left'].current;
      while (distanceBetween(fresh, other) < MIN_TARGET_SEPARATION && attempts < 30) {
        fresh = generateRandomTarget();
        attempts += 1;
      }
      targetPosRef[side].current = fresh;
      targetVelRef[side].current = generateRandomVelocity(speed);
      targetSpawnTimeRef[side].current = performance.now();
      targetActiveRef[side].current = true;
      hitLockRef[side].current = false;
    },
    [recordReactionTime, updateAccuracy]
  );

  // ==========================================================
  // TARGET MISS (per side)
  // ==========================================================
  const handleTargetMiss = useCallback(
    (side) => {
      if (!isMountedRef.current) return;
      if (gamePhaseRef.current !== 'running') return;
      if (!targetActiveRef[side].current) return;

      targetActiveRef[side].current = false;
      hitLockRef[side].current = true;

      const now = performance.now();
      const spawnTime = targetSpawnTimeRef[side].current;
      if (Number.isFinite(spawnTime)) {
        recordReactionTime(Math.max(0, now - spawnTime));
      }

      const nextMisses = { ...missesRef.current, [side]: missesRef.current[side] + 1 };
      missesRef.current = nextMisses;
      setMisses(nextMisses);

      updateAccuracy(hitsRef.current, nextMisses);

      const speed = getTargetSpeed(scoreRef.current);
      let fresh = generateRandomTarget();
      let attempts = 0;
      const other = targetPosRef[side === 'left' ? 'right' : 'left'].current;
      while (distanceBetween(fresh, other) < MIN_TARGET_SEPARATION && attempts < 30) {
        fresh = generateRandomTarget();
        attempts += 1;
      }
      targetPosRef[side].current = fresh;
      targetVelRef[side].current = generateRandomVelocity(speed);
      targetSpawnTimeRef[side].current = performance.now();
      targetActiveRef[side].current = true;
      hitLockRef[side].current = false;
    },
    [recordReactionTime, updateAccuracy]
  );

  // ==========================================================
  // TARGET MOVEMENT + COLLISION LOOP (BOTH TARGETS, ONE RAF)
  // ==========================================================
  useEffect(() => {
    const animateTargets = (timestamp) => {
      if (!isMountedRef.current) return;

      const transform = lastTransformRef.current;

      targetAnimRafRef.current = requestAnimationFrame(animateTargets);

      if (!transform || !transform.width || !transform.height) return;

      const previousTimestamp = targetLastFrameTimeRef.current;
      targetLastFrameTimeRef.current = timestamp;
      let dt = 0;
      if (Number.isFinite(previousTimestamp)) {
        dt = (timestamp - previousTimestamp) / 1000;
      }
      dt = Math.min(Math.max(dt, 0), MAX_DT_SECONDS);

      const speed = getTargetSpeed(scoreRef.current);

      SIDES.forEach((side) => {
        const node = targetNodeRef[side].current;
        if (!node) return;

        if (gamePhaseRef.current !== 'running' || !targetActiveRef[side].current) {
          node.style.display = 'none';
          return;
        }

        // Re-normalize velocity to current speed (progressive difficulty).
        const vel = targetVelRef[side].current;
        const mag = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
        if (mag === 0) {
          targetVelRef[side].current = generateRandomVelocity(speed);
        } else {
          targetVelRef[side].current = {
            x: (vel.x / mag) * speed,
            y: (vel.y / mag) * speed,
          };
        }

        targetPosRef[side].current = {
          x: targetPosRef[side].current.x + targetVelRef[side].current.x * dt,
          y: targetPosRef[side].current.y + targetVelRef[side].current.y * dt,
        };

        // Boundary bounce.
        if (targetPosRef[side].current.x <= TARGET_MARGIN) {
          targetPosRef[side].current.x = TARGET_MARGIN;
          targetVelRef[side].current.x = Math.abs(targetVelRef[side].current.x);
        } else if (targetPosRef[side].current.x >= 1 - TARGET_MARGIN) {
          targetPosRef[side].current.x = 1 - TARGET_MARGIN;
          targetVelRef[side].current.x = -Math.abs(targetVelRef[side].current.x);
        }
        if (targetPosRef[side].current.y <= TARGET_MARGIN) {
          targetPosRef[side].current.y = TARGET_MARGIN;
          targetVelRef[side].current.y = Math.abs(targetVelRef[side].current.y);
        } else if (targetPosRef[side].current.y >= 1 - TARGET_MARGIN) {
          targetPosRef[side].current.y = 1 - TARGET_MARGIN;
          targetVelRef[side].current.y = -Math.abs(targetVelRef[side].current.y);
        }

        const targetPx = normalizedToOverlayCoords(targetPosRef[side].current, transform);
        node.style.display = '';
        node.style.left = `${targetPx.x}px`;
        node.style.top = `${targetPx.y}px`;

        // Collision — ONLY this side's fingertip against this side's
        // target. A missing fingertip (null) simply skips collision,
        // so no false hits occur when a hand is absent.
        const fingerTip = fingerTipRawRef[side].current;
        if (fingerTip) {
          const fingerPx = normalizedToOverlayCoords(fingerTip, transform);
          const collision = isCollision(fingerPx, targetPx, TARGET_RADIUS_PX, HIT_TOLERANCE_PX);
          if (collision && !hitLockRef[side].current) {
            handleTargetHit(side);
            return;
          }
        }

        const spawnTime = targetSpawnTimeRef[side].current;
        if (Number.isFinite(spawnTime) && timestamp - spawnTime >= TARGET_LIFETIME_MS) {
          handleTargetMiss(side);
        }
      });
    };

    targetLastFrameTimeRef.current = null;
    targetAnimRafRef.current = requestAnimationFrame(animateTargets);

    return () => {
      if (targetAnimRafRef.current !== null) {
        cancelAnimationFrame(targetAnimRafRef.current);
        targetAnimRafRef.current = null;
      }
      targetLastFrameTimeRef.current = null;
    };
  }, [handleTargetHit, handleTargetMiss]);

  // ==========================================================
  // CLEANUP
  // ==========================================================
  useEffect(() => {
    return () => {
      isMountedRef.current = false;

      if (timerRafRef.current !== null) {
        cancelAnimationFrame(timerRafRef.current);
        timerRafRef.current = null;
      }
      if (targetAnimRafRef.current !== null) {
        cancelAnimationFrame(targetAnimRafRef.current);
        targetAnimRafRef.current = null;
      }
      if (restartTimeoutRef.current !== null) {
        clearTimeout(restartTimeoutRef.current);
        restartTimeoutRef.current = null;
      }
      SIDES.forEach((side) => {
        if (targetHitTimeoutRefs[side].current !== null) {
          clearTimeout(targetHitTimeoutRefs[side].current);
          targetHitTimeoutRefs[side].current = null;
        }
      });
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (cursorRafRef.current !== null) {
        cancelAnimationFrame(cursorRafRef.current);
        cursorRafRef.current = null;
      }
    };
  }, []);

  // ==========================================================
  // UI STATE
  // ==========================================================
  const hasVideoBox =
    !!displayTransform && displayTransform.width > 0 && displayTransform.height > 0;

  const initialFingerPx = {
    left:
      lastKnownFingerTip.left && hasVideoBox
        ? normalizedToOverlayCoords(lastKnownFingerTip.left, displayTransform)
        : null,
    right:
      lastKnownFingerTip.right && hasVideoBox
        ? normalizedToOverlayCoords(lastKnownFingerTip.right, displayTransform)
        : null,
  };

  const initialTargetPx = {
    left: hasVideoBox
      ? normalizedToOverlayCoords(targetPosRef.left.current, displayTransform)
      : null,
    right: hasVideoBox
      ? normalizedToOverlayCoords(targetPosRef.right.current, displayTransform)
      : null,
  };

  // ==========================================================
  // DISPLAY VALUES
  // ==========================================================
  const secondsRemaining = Math.ceil(timeRemaining / 1000);
  const formattedLastReaction = lastReactionTime === null ? '--' : `${lastReactionTime} ms`;
  const formattedAverageReaction =
    averageReactionTime === null ? '--' : `${averageReactionTime} ms`;

  // ==========================================================
  // STATUS
  // ==========================================================
  let statusLabel;
  if (!hasVideoBox) {
    statusLabel = 'Waiting for camera video to render…';
  } else if (!isTracking) {
    statusLabel = 'Waiting for hand tracking to start…';
  } else if (gamePhase === 'complete') {
    statusLabel = 'Both targets complete!';
  } else if (gamePhase === 'waiting') {
    if (!handsDetected.left && !handsDetected.right) {
      statusLabel = 'Waiting for both hands...';
    } else if (handsDetected.left && !handsDetected.right) {
      statusLabel = 'Left hand detected — show your right hand too.';
    } else if (!handsDetected.left && handsDetected.right) {
      statusLabel = 'Right hand detected — show your left hand too.';
    } else {
      statusLabel = 'Both hands detected — start!';
    }
  } else if (targetHit.left && targetHit.right) {
    statusLabel = 'Left target hit! Right target hit!';
  } else if (targetHit.left) {
    statusLabel = 'Left target hit!';
  } else if (targetHit.right) {
    statusLabel = 'Right target hit!';
  } else if (!handsDetected.left || !handsDetected.right) {
    statusLabel = !handsDetected.left && !handsDetected.right
      ? `Show both hands — ${secondsRemaining}s remaining.`
      : `${!handsDetected.left ? 'Left' : 'Right'} hand needed — ${secondsRemaining}s remaining.`;
  } else {
    statusLabel = `Hit both moving targets — ${secondsRemaining}s remaining.`;
  }

  // ==========================================================
  // OVERLAY
  // ==========================================================
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
          {/* LEFT TARGET */}
          <div
            ref={targetNodeRef.left}
            className="wellness-challenge__target wellness-challenge__target--left"
            style={{
              position: 'absolute',
              left: initialTargetPx.left ? `${initialTargetPx.left.x}px` : '0px',
              top: initialTargetPx.left ? `${initialTargetPx.left.y}px` : '0px',
              width: `${TARGET_RADIUS_PX * 2}px`,
              height: `${TARGET_RADIUS_PX * 2}px`,
              transform: 'translate(-50%, -50%)',
              willChange: 'left, top',
              display: 'none',
            }}
          />

          {/* RIGHT TARGET */}
          <div
            ref={targetNodeRef.right}
            className="wellness-challenge__target wellness-challenge__target--right"
            style={{
              position: 'absolute',
              left: initialTargetPx.right ? `${initialTargetPx.right.x}px` : '0px',
              top: initialTargetPx.right ? `${initialTargetPx.right.y}px` : '0px',
              width: `${TARGET_RADIUS_PX * 2}px`,
              height: `${TARGET_RADIUS_PX * 2}px`,
              transform: 'translate(-50%, -50%)',
              willChange: 'left, top',
              display: 'none',
            }}
          />

          {/* LEFT FINGER */}
          <div
            ref={fingerNodeRef.left}
            className="wellness-challenge__finger wellness-challenge__finger--left"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: `${FINGER_RADIUS_PX * 2}px`,
              height: `${FINGER_RADIUS_PX * 2}px`,
              willChange: 'transform',
              display: 'none',
              transform: initialFingerPx.left
                ? `translate(${initialFingerPx.left.x}px, ${initialFingerPx.left.y}px) translate(-50%, -50%)`
                : undefined,
            }}
          />

          {/* RIGHT FINGER */}
          <div
            ref={fingerNodeRef.right}
            className="wellness-challenge__finger wellness-challenge__finger--right"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: `${FINGER_RADIUS_PX * 2}px`,
              height: `${FINGER_RADIUS_PX * 2}px`,
              willChange: 'transform',
              display: 'none',
              transform: initialFingerPx.right
                ? `translate(${initialFingerPx.right.x}px, ${initialFingerPx.right.y}px) translate(-50%, -50%)`
                : undefined,
            }}
          />
        </div>,
        document.body
      )
    : null;

  // ==========================================================
  // COMPONENT UI
  // ==========================================================
  return (
    <section className="wellness-challenge" aria-labelledby="wellness-challenge-heading">
      <header className="wellness-challenge__header">
        <h2 id="wellness-challenge-heading">AI Wellness Challenge</h2>
        <p className="wellness-challenge__disclaimer">
          A timed two-hand coordination exercise designed for engagement and general
          wellness. It is not a medical treatment or rehabilitation program.
        </p>
      </header>

      <div className="wellness-challenge__timer" aria-label="Time remaining">
        Time: <span className="wellness-challenge__timer-value">{secondsRemaining}s</span>
      </div>

      <div className="wellness-challenge__score" aria-label="Current score">
        Score: <span className="wellness-challenge__score-value">{score}</span>
      </div>

      <div className="wellness-challenge__difficulty" aria-label="Current difficulty">
        Difficulty: <span className="wellness-challenge__difficulty-value">{difficultyLabel}</span>
      </div>

      <div className="wellness-challenge__hits" aria-label="Targets hit">
        Hits — Left: {hits.left} · Right: {hits.right}
      </div>

      <div className="wellness-challenge__misses" aria-label="Targets missed">
        Misses — Left: {misses.left} · Right: {misses.right}
      </div>

      <div className="wellness-challenge__accuracy" aria-label="Challenge accuracy">
        Accuracy: {accuracy}%
      </div>

      <div className="wellness-challenge__reaction-time" aria-label="Last reaction time">
        Reaction Time: {formattedLastReaction}
      </div>

      <div className="wellness-challenge__average-reaction-time" aria-label="Average reaction time">
        Average Reaction: {formattedAverageReaction}
      </div>

      <div className="wellness-challenge__hand-status" aria-label="Hand detection status">
        Left hand: {handsDetected.left ? 'Detected' : 'Not detected'} · Right hand:{' '}
        {handsDetected.right ? 'Detected' : 'Not detected'}
      </div>

      <p className="wellness-challenge__status" role="status" aria-live="polite">
        {statusLabel}
      </p>

      {overlay}
    </section>
  );
}

export default WellnessChallenge;