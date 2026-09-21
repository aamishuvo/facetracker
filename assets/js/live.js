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

  const inputSize = document.getElementById('inputSize');
  const scoreThr  = document.getElementById('scoreThr');
  const inputSizeVal = document.getElementById('inputSizeVal');
  const scoreVal     = document.getElementById('scoreVal');

  let stream = null;
  let running = false;
  let rafId = 0;
  let facing = 'user';
  let mood = [];
  let lastTick = 0;
  let fpsAvg = 0;
  let busy = false;

  const applyMirror = () => stage.classList.toggle('is-mirrored', mirrorChk.checked);
  applyMirror();
  mirrorChk.addEventListener('change', applyMirror);

  inputSize.addEventListener('input', () => { inputSizeVal.textContent = inputSize.value; });
  scoreThr.addEventListener('input', () => { scoreVal.textContent = Number(scoreThr.value).toFixed(2); });

  startBtn.addEventListener('click', () => start());
  stopBtn.addEventListener('click', () => stop());
  flipBtn.addEventListener('click', () => {
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

    startBtn.disabled = true;
    startBtn.textContent = 'Loading models…';
    try {
      const backend = await loadModels();
      setBackend(backend);
    } catch (err) {
      console.error(err);
      toast('Could not load the models. Check that /models/ was deployed.', true);
      startBtn.disabled = false;
      startBtn.textContent = 'Allow camera access';
      return;
    }

    startBtn.textContent = 'Waiting for permission…';
    stopTracks();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (err) {
      startBtn.disabled = false;
      startBtn.textContent = 'Allow camera access';
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

    mood = [];
    running = true;
    lastTick = performance.now();
    loop();
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
    stopTracks();
    video.srcObject = null;
    clear(overlay);
    gate.hidden = false;
    stopBtn.disabled = true;
    snapBtn.disabled = true;
    flipBtn.disabled = true;
    fpsChip.textContent = '— fps';
    facesChip.textContent = '0 faces';
    facesHost.innerHTML = '<p class="empty">No camera running.</p>';
    mood = [];
    drawMoodStrip(moodStrip, mood, MOOD_WINDOW_MS);
  }

  function stopTracks() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  async function loop() {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
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
      if (!running) return;

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
    } catch (err) {
      console.error(err);
    } finally {
      busy = false;
    }
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
