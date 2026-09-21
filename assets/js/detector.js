/**
 * Model loading and the per-frame inference pipeline.
 *
 * Four nets are loaded: a face detector, 68-point landmarks, a 7-class
 * expression classifier and an apparent-age regressor. The face *recognition*
 * net is intentionally absent from /models, so no identity embedding can be
 * produced here — see docs/SCOPE-AND-LIMITS.md.
 */

const MODEL_URL = new URL('../../models/', import.meta.url).href;

export const EXPRESSIONS = [
  'neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised',
];

export const EXPRESSION_COLOR = {
  neutral:   '#7c8ba1',
  happy:     '#64e3b0',
  sad:       '#6aa8f0',
  angry:     '#f2777a',
  fearful:   '#b98df0',
  disgusted: '#cbbf5e',
  surprised: '#f0a05a',
};

let ready = null;

/**
 * Verifies the active backend actually computes correctly.
 *
 * Some mobile GPUs advertise WebGL but have broken float-texture precision, so
 * tf ops silently return garbage. The nets then run happily and produce zero
 * detections, which is indistinguishable from "no face in shot" unless we check.
 * A couple of exact arithmetic round-trips catch it before the user does.
 */
async function backendIsSane(tf) {
  const t = tf.tensor2d([[0.5, -0.25], [1.5, 2]]);
  try {
    const sq = await t.square().data();
    const sum = await t.sum().data();
    const expected = [0.25, 0.0625, 2.25, 4];
    const okSquare = expected.every((v, i) => Number.isFinite(sq[i]) && Math.abs(sq[i] - v) < 1e-2);
    const okSum = Number.isFinite(sum[0]) && Math.abs(sum[0] - 3.75) < 1e-2;
    return okSquare && okSum;
  } catch {
    return false;
  } finally {
    tf.dispose(t);
  }
}

/**
 * Loads the nets once; repeat calls share the same promise.
 *
 * @returns {Promise<{backend: string, note: string|null}>}
 */
export function loadModels() {
  if (ready) return ready;
  ready = (async () => {
    const { nets, tf } = faceapi;
    let note = null;

    try {
      await tf.setBackend('webgl');
      await tf.ready();
      if (!await backendIsSane(tf)) {
        note = 'This device\u2019s WebGL returned incorrect results, so detection fell back to the CPU.';
        await tf.setBackend('cpu');
        await tf.ready();
      }
    } catch {
      note = 'WebGL was unavailable, so detection fell back to the CPU.';
      await tf.setBackend('cpu');
      await tf.ready();
    }

    await Promise.all([
      nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      nets.faceExpressionNet.loadFromUri(MODEL_URL),
      nets.ageGenderNet.loadFromUri(MODEL_URL),
    ]);
    return { backend: tf.getBackend(), note };
  })();
  return ready;
}

/**
 * Runs the full pipeline over one frame.
 *
 * @param {HTMLVideoElement|HTMLCanvasElement|HTMLImageElement} input
 * @param {{inputSize?: number, scoreThreshold?: number}} [opts]
 * @returns {Promise<Array>} raw face-api results, in input-pixel coordinates
 */
export async function analyseFrame(input, opts = {}) {
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: opts.inputSize ?? 416,
    scoreThreshold: opts.scoreThreshold ?? 0.5,
  });
  return faceapi
    .detectAllFaces(input, options)
    .withFaceLandmarks()
    .withFaceExpressions()
    .withAgeAndGender();
}

/**
 * Flattens a face-api result into the plain shape the UI and exports use.
 *
 * `gender`/`genderProbability` come back from the age net but are dropped here
 * on purpose: a binary classifier that cannot represent the people it is wrong
 * about has no place in the output.
 */
export function toRecord(res) {
  const { x, y, width, height } = res.detection.box;
  const scores = EXPRESSIONS.map((name) => ({ name, score: res.expressions[name] ?? 0 }))
    .sort((a, b) => b.score - a.score);

  return {
    box: {
      x: Math.round(x), y: Math.round(y),
      width: Math.round(width), height: Math.round(height),
    },
    detectionScore: round3(res.detection.score),
    age: Math.round(res.age * 10) / 10,
    // A point estimate here would imply a precision the model does not have.
    ageRange: [Math.max(0, Math.round(res.age - 5)), Math.round(res.age + 5)],
    topExpression: scores[0].name,
    topExpressionScore: round3(scores[0].score),
    expressions: Object.fromEntries(scores.map((s) => [s.name, round3(s.score)])),
    landmarks: res.landmarks ? res.landmarks.positions.map((p) => [Math.round(p.x), Math.round(p.y)]) : null,
  };
}

const round3 = (n) => Math.round(n * 1000) / 1000;

/** Largest face by box area — the one the strip chart and HUD follow. */
export function primaryFace(records) {
  if (!records.length) return null;
  return records.reduce((a, b) =>
    (b.box.width * b.box.height > a.box.width * a.box.height ? b : a));
}
