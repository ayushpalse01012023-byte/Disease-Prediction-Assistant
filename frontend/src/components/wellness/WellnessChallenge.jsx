import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

const TARGET_MARGIN = 0.12;
const TARGET_RADIUS_PX = 28;
const FINGER_RADIUS_PX = 10;
const HIT_TOLERANCE_PX = 14;

// Phase 1 — fingertip cursor smoothing.
// KEEP FROZEN.
const CURSOR_SMOOTHING_FACTOR = 0.55;

// Phase 2 — moving target speed.
// Normalized units per second.
const TARGET_SPEED = 0.05;

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

  const targetVelRef = useRef(
    generateRandomVelocity(TARGET_SPEED)
  );

  const targetNodeRef = useRef(null);

  const targetAnimRafRef = useRef(null);

  const targetLastFrameTimeRef = useRef(null);

  // ============================================================
  // SHARED REFS
  // ============================================================

  const hitLockRef = useRef(false);

  const rafIdRef = useRef(null);

  const lastTransformRef = useRef(null);

  const targetHitTimeoutRef = useRef(null);

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
  // TARGET HIT HANDLER
  // ============================================================

  const handleTargetHit = useCallback(() => {
    setScore((prev) => prev + 1);

    setTargetHit(true);

    // New random position after successful hit.
    targetPosRef.current =
      generateRandomTarget();

    // New random direction.
    targetVelRef.current =
      generateRandomVelocity(TARGET_SPEED);

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