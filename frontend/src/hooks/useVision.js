import { useRef, useState, useCallback, useEffect } from 'react';
import {
  loadOpenCV,
  captureFrameToCanvas,
  canvasToMat,
  matToImageData,
  toGrayscale,
  detectEdges,
  preprocessFrame,
  safeDeleteMat,
  safeDeleteMats,
} from '../services/vision';

/**
 * useVision
 *
 * Owns the OpenCV.js readiness state and the frame-processing loop for
 * the camera/vision subsystem. Consumes a `videoRef` produced by
 * useCamera.js — it does not touch the camera stream itself.
 *
 * Responsibilities:
 *  - Lazily initialize OpenCV.js (once) and expose ready/loading/error state
 *  - Maintain a single reusable off-screen canvas for frame capture
 *  - Run a throttled requestAnimationFrame loop that captures a frame,
 *    runs it through vision.js preprocessing utilities, and exposes the
 *    result
 *  - Guarantee every OpenCV Mat created per-frame is deleted, and that
 *    the rAF loop is cancelled on stop/unmount
 *
 * Explicitly OUT of scope (by design, for future extensibility):
 *  - Disease/model prediction from camera frames
 *  - MediaPipe / face / gesture / skin analysis (can be layered on top
 *    of `processedFrame` / `lastMat` results later)
 */
export default function useVision(
  videoRef,
  {
    // How often to process a frame, in ms. e.g. 150ms ≈ ~6-7fps.
    processIntervalMs = 150,
    // Target dimensions for processing (smaller = faster). Null = use
    // the natural capture size from vision.js's captureFrameToCanvas.
    processWidth = 320,
    processHeight = 240,
    // Preprocessing behavior.
    grayscale = true,
    useEdgeDetection = false,
    blurKsize = 5,
    useClahe = true,
    // Emit the processed frame as a data URL for easy <img>/<canvas> use.
    emitDataUrl = true,
  } = {}
) {
  const [isOpenCVReady, setIsOpenCVReady] = useState(false);
  const [isOpenCVLoading, setIsOpenCVLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [processedFrame, setProcessedFrame] = useState(null); // { dataUrl, width, height, timestamp }

  // Internal refs — kept out of state to avoid re-renders per frame.
  const cvRef = useRef(null);
  const captureCanvasRef = useRef(null); // hidden canvas for video -> Mat capture
  const outputCanvasRef = useRef(null); // hidden canvas for Mat -> dataUrl output
  const rafIdRef = useRef(null);
  const lastProcessTimeRef = useRef(0);
  const isProcessingRef = useRef(false); // mirrors isProcessing, readable inside rAF loop
  const isMountedRef = useRef(true);
  const optionsRef = useRef({
    processIntervalMs,
    processWidth,
    processHeight,
    grayscale,
    useEdgeDetection,
    blurKsize,
    useClahe,
    emitDataUrl,
  });

  // Keep latest options available to the running loop without restarting it.
  useEffect(() => {
    optionsRef.current = {
      processIntervalMs,
      processWidth,
      processHeight,
      grayscale,
      useEdgeDetection,
      blurKsize,
      useClahe,
      emitDataUrl,
    };
  }, [
    processIntervalMs,
    processWidth,
    processHeight,
    grayscale,
    useEdgeDetection,
    blurKsize,
    useClahe,
    emitDataUrl,
  ]);

  // Create reusable off-screen canvases once.
  const getCaptureCanvas = useCallback(() => {
    if (!captureCanvasRef.current) {
      captureCanvasRef.current = document.createElement('canvas');
    }
    return captureCanvasRef.current;
  }, []);

  const getOutputCanvas = useCallback(() => {
    if (!outputCanvasRef.current) {
      outputCanvasRef.current = document.createElement('canvas');
    }
    return outputCanvasRef.current;
  }, []);

  /**
   * Lazily initializes OpenCV.js. Safe to call multiple times; only
   * loads once. Errors are captured into state rather than thrown.
   */
  const initOpenCV = useCallback(async () => {
    if (cvRef.current) return cvRef.current;

    setIsOpenCVLoading(true);
    setError(null);

    try {
      const cv = await loadOpenCV();
      if (!isMountedRef.current) return cv;
      cvRef.current = cv;
      setIsOpenCVReady(true);
      return cv;
    } catch (err) {
      if (isMountedRef.current) {
        setError({
          type: 'opencv-load-failed',
          message: 'Failed to load OpenCV. Vision processing is unavailable.',
          raw: err,
        });
      }
      return null;
    } finally {
      if (isMountedRef.current) setIsOpenCVLoading(false);
    }
  }, []);

  /**
   * Processes a single frame: capture -> Mat -> preprocess -> output.
   * Every Mat created here is deleted before the function returns,
   * regardless of success or failure.
   */
  const processSingleFrame = useCallback(() => {
    const cv = cvRef.current;
    const video = videoRef?.current;
    if (!cv || !video) return;

    const {
      processWidth: pw,
      processHeight: ph,
      grayscale: useGray,
      useEdgeDetection: useEdges,
      blurKsize: ksize,
      useClahe: clahe,
      emitDataUrl: wantsDataUrl,
    } = optionsRef.current;

    const captureCanvas = getCaptureCanvas();
    const drawn = captureFrameToCanvas(video, captureCanvas);
    if (!drawn) return; // video not ready yet this tick

    let srcMat = null;
    let processedMat = null;
    let edgeMat = null;

    try {
      srcMat = canvasToMat(cv, captureCanvas);

      if (useGray || useEdges) {
        processedMat = preprocessFrame(cv, srcMat, {
          width: pw || undefined,
          height: ph || undefined,
          blurKsize: ksize,
          useClahe: clahe,
        });

        if (useEdges) {
          edgeMat = detectEdges(cv, processedMat);
        }
      }

      const finalMat = edgeMat || processedMat || srcMat;

      if (wantsDataUrl) {
        const outputCanvas = getOutputCanvas();
        outputCanvas.width = finalMat.cols;
        outputCanvas.height = finalMat.rows;
        const ctx = outputCanvas.getContext('2d');
        const imageData = matToImageData(cv, finalMat);
        ctx.putImageData(imageData, 0, 0);

        if (isMountedRef.current) {
          setProcessedFrame({
            dataUrl: outputCanvas.toDataURL('image/jpeg', 0.85),
            width: finalMat.cols,
            height: finalMat.rows,
            timestamp: Date.now(),
          });
        }
      } else if (isMountedRef.current) {
        setProcessedFrame({
          width: finalMat.cols,
          height: finalMat.rows,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError({
          type: 'processing-failed',
          message: 'Frame processing failed.',
          raw: err,
        });
      }
    } finally {
      // Guarantee cleanup of every Mat allocated this frame.
      safeDeleteMats([srcMat, processedMat, edgeMat]);
    }
  }, [videoRef, getCaptureCanvas, getOutputCanvas]);

  /**
   * The requestAnimationFrame loop. Throttled to processIntervalMs so
   * we don't run OpenCV on every single browser frame (perf).
   */
  const loop = useCallback(
    (timestamp) => {
      if (!isProcessingRef.current) return;

      const interval = optionsRef.current.processIntervalMs;
      if (timestamp - lastProcessTimeRef.current >= interval) {
        lastProcessTimeRef.current = timestamp;
        processSingleFrame();
      }

      rafIdRef.current = requestAnimationFrame(loop);
    },
    [processSingleFrame]
  );

  /**
   * Starts continuous frame processing. Ensures OpenCV is loaded first.
   */
  const startProcessing = useCallback(async () => {
    if (isProcessingRef.current) return;

    const cv = cvRef.current || (await initOpenCV());
    if (!cv || !isMountedRef.current) return;

    isProcessingRef.current = true;
    setIsProcessing(true);
    lastProcessTimeRef.current = 0;
    rafIdRef.current = requestAnimationFrame(loop);
  }, [initOpenCV, loop]);

  /**
   * Stops the processing loop and cancels any pending animation frame.
   */
  const stopProcessing = useCallback(() => {
    isProcessingRef.current = false;
    setIsProcessing(false);
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  // Cleanup on unmount: stop the loop and release canvases. Guards
  // against React Strict Mode's mount -> unmount -> mount cycle by
  // resetting isMountedRef appropriately.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      isProcessingRef.current = false;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      captureCanvasRef.current = null;
      outputCanvasRef.current = null;
    };
  }, []);

  return {
    // OpenCV state
    isOpenCVReady,
    isOpenCVLoading,
    // Processing state
    isProcessing,
    processedFrame,
    error,
    // Controls
    initOpenCV,
    startProcessing,
    stopProcessing,
  };
}