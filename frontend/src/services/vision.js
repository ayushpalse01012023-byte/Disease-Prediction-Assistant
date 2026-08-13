/**
 * vision.js
 *
 * Reusable OpenCV.js processing utilities.
 *
 * Responsibilities:
 *  - Lazy-load and initialize OpenCV.js (@techstark/opencv-js)
 *  - Capture video frames into a canvas / ImageData
 *  - Convert frames into OpenCV Mats
 *  - Provide reusable preprocessing primitives (resize, grayscale,
 *    blur, contrast normalization, edge detection)
 *  - Provide safe Mat cleanup helpers
 *
 * This file contains NO React state and NO camera lifecycle logic.
 * It is consumed by hooks/useVision.js, which owns processing state
 * and the frame-processing loop.
 */

let cvInstance = null;
let cvReadyPromise = null;

/**
 * Loads and initializes OpenCV.js exactly once, caching the ready
 * instance for subsequent calls. Safe to call multiple times.
 *
 * @returns {Promise<Object>} resolves with the initialized cv namespace
 */
export function loadOpenCV() {
  if (cvInstance) {
    return Promise.resolve(cvInstance);
  }

  if (cvReadyPromise) {
    return cvReadyPromise;
  }

  cvReadyPromise = new Promise((resolve, reject) => {
    (async () => {
      try {
        const cvModule = await import('@techstark/opencv-js');
        const cv = cvModule.default || cvModule;

        // @techstark/opencv-js resolves either as a ready cv object,
        // or as a Promise/emscripten module exposing onRuntimeInitialized.
        if (cv && typeof cv.then === 'function') {
          const resolvedCv = await cv;
          cvInstance = resolvedCv;
          resolve(resolvedCv);
          return;
        }

        if (cv && typeof cv.Mat === 'function') {
          // Already initialized.
          cvInstance = cv;
          resolve(cv);
          return;
        }

        if (cv && typeof cv.onRuntimeInitialized !== 'undefined') {
          cv.onRuntimeInitialized = () => {
            cvInstance = cv;
            resolve(cv);
          };
          return;
        }

        reject(new Error('Unrecognized OpenCV.js module shape.'));
      } catch (err) {
        cvReadyPromise = null;
        reject(err);
      }
    })();
  });

  return cvReadyPromise;
}

/**
 * Returns true if OpenCV.js has already been loaded and initialized.
 */
export function isOpenCVReady() {
  return !!cvInstance;
}

/**
 * Draws the current frame of a <video> element onto a canvas.
 * Reuses the provided canvas rather than allocating a new one each call.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {HTMLCanvasElement} canvasEl
 * @param {{ width?: number, height?: number }} [options]
 * @returns {HTMLCanvasElement|null} the canvas with the frame drawn, or null if not ready
 */
export function captureFrameToCanvas(videoEl, canvasEl, options = {}) {
  if (!videoEl || !canvasEl) return null;
  if (videoEl.readyState < 2 /* HAVE_CURRENT_DATA */) return null;

  const width = options.width || videoEl.videoWidth;
  const height = options.height || videoEl.videoHeight;

  if (!width || !height) return null;

  if (canvasEl.width !== width) canvasEl.width = width;
  if (canvasEl.height !== height) canvasEl.height = height;

  const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(videoEl, 0, 0, width, height);
  return canvasEl;
}

/**
 * Reads ImageData from a canvas.
 *
 * @param {HTMLCanvasElement} canvasEl
 * @returns {ImageData|null}
 */
export function getImageDataFromCanvas(canvasEl) {
  if (!canvasEl) return null;
  const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  return ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
}

/**
 * Converts a canvas element directly into an OpenCV Mat (RGBA, CV_8UC4).
 * Caller owns the returned Mat and is responsible for calling .delete().
 *
 * @param {Object} cv - initialized OpenCV namespace
 * @param {HTMLCanvasElement} canvasEl
 * @returns {Object} cv.Mat
 */
export function canvasToMat(cv, canvasEl) {
  return cv.imread(canvasEl);
}

/**
 * Converts a Mat back into ImageData for drawing to a canvas.
 * Does not delete the source Mat.
 *
 * @param {Object} cv
 * @param {Object} mat
 * @returns {ImageData}
 */
export function matToImageData(cv, mat) {
  let rgbaMat = mat;
  let created = false;

  if (mat.type() !== cv.CV_8UC4) {
    rgbaMat = new cv.Mat();
    const channels = mat.channels();
    if (channels === 1) {
      cv.cvtColor(mat, rgbaMat, cv.COLOR_GRAY2RGBA);
    } else if (channels === 3) {
      cv.cvtColor(mat, rgbaMat, cv.COLOR_RGB2RGBA);
    } else {
      mat.copyTo(rgbaMat);
    }
    created = true;
  }

  const imageData = new ImageData(
    new Uint8ClampedArray(rgbaMat.data),
    rgbaMat.cols,
    rgbaMat.rows
  );

  if (created) {
    rgbaMat.delete();
  }

  return imageData;
}

/**
 * Renders a Mat directly onto a target canvas.
 * Does not delete the source Mat.
 *
 * @param {Object} cv
 * @param {Object} mat
 * @param {HTMLCanvasElement} canvasEl
 */
export function drawMatToCanvas(cv, mat, canvasEl) {
  cv.imshow(canvasEl, mat);
}

/* ------------------------------------------------------------------ */
/* Preprocessing primitives                                            */
/* ------------------------------------------------------------------ */

/**
 * Resizes a Mat to the given dimensions. Returns a new Mat;
 * caller must delete both source (if no longer needed) and result.
 *
 * @param {Object} cv
 * @param {Object} srcMat
 * @param {number} width
 * @param {number} height
 * @param {number} [interpolation]
 * @returns {Object} resized Mat
 */
export function resizeMat(cv, srcMat, width, height, interpolation) {
  const dst = new cv.Mat();
  const dsize = new cv.Size(width, height);
  cv.resize(
    srcMat,
    dst,
    dsize,
    0,
    0,
    interpolation !== undefined ? interpolation : cv.INTER_AREA
  );
  return dst;
}

/**
 * Converts a Mat to grayscale. Returns a new single-channel Mat.
 *
 * @param {Object} cv
 * @param {Object} srcMat
 * @returns {Object} grayscale Mat
 */
export function toGrayscale(cv, srcMat) {
  const dst = new cv.Mat();
  const channels = srcMat.channels();

  if (channels === 4) {
    cv.cvtColor(srcMat, dst, cv.COLOR_RGBA2GRAY);
  } else if (channels === 3) {
    cv.cvtColor(srcMat, dst, cv.COLOR_RGB2GRAY);
  } else {
    srcMat.copyTo(dst);
  }

  return dst;
}

/**
 * Applies Gaussian blur for noise reduction. Returns a new Mat.
 *
 * @param {Object} cv
 * @param {Object} srcMat
 * @param {number} [ksize] - odd kernel size, default 5
 * @param {number} [sigma] - default 0 (auto)
 * @returns {Object} blurred Mat
 */
export function gaussianBlur(cv, srcMat, ksize = 5, sigma = 0) {
  const dst = new cv.Mat();
  const size = new cv.Size(ksize, ksize);
  cv.GaussianBlur(srcMat, dst, size, sigma, sigma, cv.BORDER_DEFAULT);
  return dst;
}

/**
 * Normalizes contrast on a single-channel (grayscale) Mat using
 * histogram equalization. Returns a new Mat.
 *
 * @param {Object} cv
 * @param {Object} grayMat - single-channel Mat
 * @returns {Object} contrast-normalized Mat
 */
export function equalizeContrast(cv, grayMat) {
  const dst = new cv.Mat();
  cv.equalizeHist(grayMat, dst);
  return dst;
}

/**
 * Applies CLAHE (adaptive contrast normalization), generally better
 * for uneven lighting than global histogram equalization.
 *
 * @param {Object} cv
 * @param {Object} grayMat - single-channel Mat
 * @param {number} [clipLimit]
 * @param {number} [tileGridSize]
 * @returns {Object} contrast-normalized Mat
 */
export function adaptiveEqualizeContrast(cv, grayMat, clipLimit = 2.0, tileGridSize = 8) {
  const dst = new cv.Mat();
  const clahe = new cv.CLAHE(clipLimit, new cv.Size(tileGridSize, tileGridSize));
  clahe.apply(grayMat, dst);
  clahe.delete();
  return dst;
}

/**
 * Runs Canny edge detection on a single-channel Mat. Returns a new Mat.
 *
 * @param {Object} cv
 * @param {Object} grayMat - single-channel Mat
 * @param {number} [threshold1]
 * @param {number} [threshold2]
 * @returns {Object} edge map Mat
 */
export function detectEdges(cv, grayMat, threshold1 = 50, threshold2 = 150) {
  const dst = new cv.Mat();
  cv.Canny(grayMat, dst, threshold1, threshold2);
  return dst;
}

/**
 * Standard preprocessing pipeline: grayscale -> resize -> blur -> contrast
 * normalization. Intermediate Mats are cleaned up automatically; only the
 * final Mat is returned and owned by the caller.
 *
 * @param {Object} cv
 * @param {Object} srcMat - source RGBA/RGB Mat (not deleted by this function)
 * @param {{ width?: number, height?: number, blurKsize?: number, useClahe?: boolean }} [options]
 * @returns {Object} processed single-channel Mat
 */
export function preprocessFrame(cv, srcMat, options = {}) {
  const { width, height, blurKsize = 5, useClahe = true } = options;

  const stages = [];
  let current = toGrayscale(cv, srcMat);
  stages.push(current);

  if (width && height) {
    const resized = resizeMat(cv, current, width, height);
    stages.push(resized);
    current = resized;
  }

  const blurred = gaussianBlur(cv, current, blurKsize);
  stages.push(blurred);
  current = blurred;

  const normalized = useClahe
    ? adaptiveEqualizeContrast(cv, current)
    : equalizeContrast(cv, current);

  // Clean up every intermediate stage except the final result.
  stages.forEach((mat) => {
    if (mat !== normalized) {
      safeDeleteMat(mat);
    }
  });

  return normalized;
}

/* ------------------------------------------------------------------ */
/* Cleanup helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Deletes an OpenCV Mat if it exists and hasn't already been deleted.
 * Safe to call multiple times / with null.
 *
 * @param {Object} mat
 */
export function safeDeleteMat(mat) {
  if (mat && typeof mat.delete === 'function' && !mat.isDeleted?.()) {
    try {
      mat.delete();
    } catch {
      // Already deleted or invalid - ignore.
    }
  }
}

/**
 * Deletes multiple Mats in one call.
 *
 * @param {Object[]} mats
 */
export function safeDeleteMats(mats) {
  (mats || []).forEach(safeDeleteMat);
}