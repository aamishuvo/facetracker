/**
 * Live camera tab.
 *
 * The MediaStream is held only for as long as the camera is on. Frames are read
 * straight from the <video> element into the detector and are never copied into
 * a buffer, uploaded, or persisted. Stopping the camera drops every track.
 */

import { loadModels, analyseFrame, toRecord, primaryFace } from './detector.js';
import { fitCanvas, drawFaces, clear, drawMoodStrip, renderFaceCards } from './overlay.js';

const MOOD_WINDOW_MS = 60000;

export function initLive({ toast, setBackend }) {
  const video   = document.getElementById('video');
  const overlay = document.getElementById('overlay');
  const stage   = document.getElementById('liveStage');
  const gate    = document.getElementById('gate');

  const startBtn = document.getElementById('startBtn');
  const stopBtn  = document.getElementById('stopBtn');
  const flipBtn  = document.getElementById('flipBtn');
  const snapBtn  = document.getElementById('snapBtn');
  const mirrorChk = document.getElementById('mirrorChk');
  const meshChk   = document.getElementById('meshChk');

  const fpsChip   = document.getElementById('fpsChip');
  const facesChip = document.getElementById('facesChip');
  const facesHost = document.getElementById('liveFaces');
  const moodStrip = document.getElementById('moodStrip');
  const diagHost  = document.getElementById('liveDiag');

  const inputSize = document.getElementById('inputSize');
  const scoreThr  = document.getElementById('scoreThr');
  const inputSizeVal = document.getElementById('inputSizeVal');
  const scoreVal     = document.getElementById('scoreVal');

  let stream = null;
  let running = false;
  let starting = false;
  let rafId = 0;
  let facing = 'user';
  let mood = [];
  let lastTick = 0;
  let fpsAvg = 0;
  let busy = false;
  let epoch = 0;
  let failStreak = 0;
  let lastError = null;
  let autoTuned = false;
  let userTunedSize = false;

  // Phones are an order of magnitude slower than laptops here, and a 416px
  // input at 1-2 fps reads to the user as "it isn't detecting anything". Start
  // them somewhere that actually runs.
  const isMobile = matchMedia('(pointer: coarse)').matches || innerWidth < 760;
  if (isMobile) {
    inputSize.value = '288';
    inputSizeVal.textContent = '288';
  }

  const applyMirror = () => stage.classList.toggle('is-mirrored', mirrorChk.checked);
  applyMirror();
  mirrorChk.addEventListener('change', applyMirror);

  inputSize.addEventListener('input', () => {
    inputSizeVal.textContent = inputSize.value;
    userTunedSize = true;
  });
  scoreThr.addEventListener('input', () => { scoreVal.textContent = Number(scoreThr.value).toFixed(2); });

  startBtn.addEventListener('click', () => start());
  stopBtn.addEventListener('click', () => stop());
  flipBtn.addEventListener('click', () => {
    if (starting) return;
    facing = facing === 'user' ? 'environment' : 'user';
    mirrorChk.checked = facing === 'user';
    applyMirror();
    start();
  });
  snapBtn.addEventListener('click', snapshot);

  // Release the camera when the tab is hidden — no background capture.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) {
      stop();
      toast('Camera released because the tab went to the background.');
    }
  });
  window.addEventListener('pagehide', () => stop());

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast('This browser has no camera API. Try Chrome, Edge, Safari or Firefox.', true);
      return;
    }
    if (!window.isSecureContext) {
      toast('Camera access needs https:// or localhost.', true);
      return;
    }

    // Two overlapping getUserMedia calls — a double tap, or flip while the
    // first is still resolving — make the device busy against itself, which
    // surfaces as NotReadableError.
    if (starting) return;
    starting = true;

    // A restart (camera switch) must retire the previous render loop, or each
    // switch leaves another rAF chain running against the same canvas and
    // shared fps/busy state.
    running = false;
    cancelAnimationFrame(rafId);

    // Detaching the video mid-inference can leave that promise permanently
    // unsettled, so its `finally` never clears `busy` and the next loop spins
    // without ever detecting. Retire the old run by epoch and clear the latch.
    epoch++;
    busy = false;

    flipBtn.disabled = true;
    startBtn.disabled = true;
    startBtn.textContent = 'Loading models…';

    try {
      const { backend, note } = await loadModels();
      setBackend(backend);
      if (note) toast(note, true);
    } catch (err) {
      console.error(err);
      toast('Could not load the models. Check that /models/ was deployed.', true);
      resetGate();
      return;
    }

    startBtn.textContent = 'Waiting for permission…';

    // Fully release any previous capture BEFORE asking for the next one.
    await releaseCamera();

    try {
      stream = await acquire(facing);
    } catch (err) {
      console.error(err);
      resetGate();
      toast(describeCameraError(err), true);
      return;
    }

    video.srcObject = stream;
    await video.play().catch(() => {});
    await onceReady(video);

    gate.hidden = true;
    stopBtn.disabled = false;
    snapBtn.disabled = false;
    flipBtn.disabled = !(await hasMultipleCameras());
    startBtn.disabled = false;
    startBtn.textContent = 'Allow camera access';
    starting = false;

    mood = [];
    failStreak = 0;
    running = true;
    lastTick = performance.now();
    updateDiag();
    loop(epoch);
  }

  function resetGate() {
    starting = false;
    startBtn.disabled = false;
    startBtn.textContent = 'Allow camera access';
  }

  /**
   * Asks for a camera, relaxing the constraints on each failure.
   *
   * A phone that cannot serve 1280x720 on the requested lens throws
   * OverconstrainedError rather than degrading, and some Android builds report
   * NotReadableError for a facingMode they do not actually have. Falling back
   * through plainer requests gets a working stream on far more devices than a
   * single strict call.
   */
  async function acquire(preferredFacing) {
    const attempts = [
      { video: { facingMode: { ideal: preferredFacing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: { ideal: preferredFacing } }, audio: false },
      { video: true, audio: false },
    ];

    let lastErr;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastErr = err;
        // A denied permission will not be fixed by relaxing constraints.
        if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') throw err;
        await settle(200);
      }
    }
    throw lastErr;
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
    epoch++;
    busy = false;
    releaseCamera();
    clear(overlay);
    gate.hidden = false;
    stopBtn.disabled = true;
    snapBtn.disabled = true;
    flipBtn.disabled = true;
    fpsChip.textContent = '— fps';
    facesChip.textContent = '0 faces';
    facesHost.innerHTML = '<p class="empty">No camera running.</p>';
    fpsAvg = 0;
    updateDiag();
    mood = [];
    drawMoodStrip(moodStrip, mood, MOOD_WINDOW_MS);
  }

  /**
   * Hands the camera back to the OS.
   *
   * Stopping the tracks is not sufficient on its own: while the <video> element
   * still holds the MediaStream in srcObject, Android Chrome and iOS Safari keep
   * the device open. Re-acquiring then fails with NotReadableError, which reads
   * to the user as "the camera is in use by another app" — when the other app is
   * in fact this page. Detaching the element is what actually frees the lens,
   * and the brief settle gives the OS time to finish doing so before we reopen.
   */
  async function releaseCamera() {
    const had = !!stream;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    try {
      video.pause();
      video.srcObject = null;
      video.removeAttribute('src');
      video.load();
    } catch { /* element already torn down */ }
    if (had) await settle(220);
  }

  async function loop(myEpoch) {
    if (!running || myEpoch !== epoch) return;
    rafId = requestAnimationFrame(() => loop(myEpoch));
    if (busy || video.readyState < 2) return;
    busy = true;

    try {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;
      fitCanvas(overlay, w, h);

      const raw = await analyseFrame(video, {
        inputSize: Number(inputSize.value),
        scoreThreshold: Number(scoreThr.value),
      });
      if (!running || myEpoch !== epoch) return;

      const records = faceapi.resizeResults(raw, { width: w, height: h }).map(toRecord);

      drawFaces(overlay, records, {
        showLandmarks: meshChk.checked,
        mirrored: mirrorChk.checked,
      });
      renderFaceCards(facesHost, records, 'No face in frame.');
      facesChip.textContent = `${records.length} face${records.length === 1 ? '' : 's'}`;

      const main = primaryFace(records);
      if (main) {
        mood.push({ t: performance.now(), name: main.topExpression });
        const cut = performance.now() - MOOD_WINDOW_MS;
        while (mood.length && mood[0].t < cut) mood.shift();
      }
      drawMoodStrip(moodStrip, mood, MOOD_WINDOW_MS);

      const now = performance.now();
      const dt = now - lastTick;
      lastTick = now;
      fpsAvg = fpsAvg ? fpsAvg * 0.85 + (1000 / dt) * 0.15 : 1000 / dt;
      fpsChip.textContent = `${fpsAvg.toFixed(1)} fps`;

      failStreak = 0;
      lastError = null;
      updateDiag(records.length);
      maybeAutoTune();
    } catch (err) {
      // Swallowing this into the console means a phone user sees "no faces"
      // forever with nothing to go on. Surface it instead.
      console.error(err);
      lastError = err?.message || String(err);
      updateDiag();
      if (++failStreak >= 10) {
        stop();
        toast(`Detection failed repeatedly and was stopped: ${lastError}`, true);
      }
    } finally {
      // A superseded run must not clear the latch for the live one.
      if (myEpoch === epoch) busy = false;
    }
  }

  /**
   * Drops the detector input size once if the device cannot keep up.
   *
   * A sustained 1-2 fps is the most common reason a phone "doesn't detect" —
   * faces are found, just far too late to feel live. Only fires when the user
   * has not set the slider themselves, and only once.
   */
  function maybeAutoTune() {
    if (autoTuned || userTunedSize || fpsAvg === 0) return;
    if (performance.now() - lastTick > 100) return;
    if (fpsAvg >= 4) return;

    const current = Number(inputSize.value);
    if (current <= 224) { autoTuned = true; return; }

    const next = Math.max(224, current - 96);
    inputSize.value = String(next);
    inputSizeVal.textContent = String(next);
    autoTuned = true;
    toast(`Running at ${fpsAvg.toFixed(1)} fps — dropped the detector input to ${next}px to keep up. `
        + 'Raise it in Detector settings if you want small faces back.');
  }

  /** Mirrors the live state into the diagnostics card. */
  function updateDiag(faceCount) {
    if (!diagHost) return;
    const track = stream?.getVideoTracks?.()[0];
    const settings = track?.getSettings?.() ?? {};
    const rows = [
      ['Capture', video.videoWidth ? `${video.videoWidth}\u00d7${video.videoHeight}` : '\u2014'],
      ['Camera', settings.facingMode || (facing === 'user' ? 'front (requested)' : 'rear (requested)')],
      ['Detector input', `${inputSize.value}px`],
      ['Min confidence', Number(scoreThr.value).toFixed(2)],
      ['Frame rate', fpsAvg ? `${fpsAvg.toFixed(1)} fps` : '\u2014'],
      ['Faces this frame', faceCount === undefined ? '\u2014' : String(faceCount)],
      ['Last error', lastError ? escapeHtml(lastError) : 'none'],
    ];
    diagHost.innerHTML = `<dl class="kv">${
      rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  }

  /** Composites the current frame plus overlay into a PNG download. */
  function snapshot() {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;

    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    if (mirrorChk.checked) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (mirrorChk.checked) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(overlay, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `facetracker-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Snapshot saved to your downloads.');
    }, 'image/png');
  }

  async function hasMultipleCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'videoinput').length > 1;
    } catch {
      return false;
    }
  }
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function onceReady(video) {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => video.addEventListener('loadeddata', resolve, { once: true }));
}

function describeCameraError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
      return 'Camera permission was denied. Re-enable it via the padlock icon in the address bar.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera matched the request. Try the other camera or plug one in.';
    case 'NotReadableError':
      return 'The camera is in use by another app. Close it and try again.';
    default:
      return `Could not start the camera: ${err?.message ?? err}`;
  }
}
