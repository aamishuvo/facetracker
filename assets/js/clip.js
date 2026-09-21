/**
 * Video clip tab.
 *
 * The file is opened with URL.createObjectURL — the bytes stay on disk and are
 * decoded locally. Analysis is a deterministic seek-and-sample pass rather than
 * a play-and-grab one, so the same clip yields the same samples on a fast
 * laptop and a slow phone, and progress is reportable.
 */

import { loadModels, analyseFrame, toRecord, EXPRESSIONS } from './detector.js';
import { fitCanvas, drawFaces, clear, drawTimeline, renderFaceCards, fmtTime } from './overlay.js';

export function initClip({ toast, setBackend }) {
  const video   = document.getElementById('clipVideo');
  const overlay = document.getElementById('clipOverlay');
  const gate    = document.getElementById('clipGate');
  const drop    = document.getElementById('dropZone');

  const pickBtn     = document.getElementById('pickBtn');
  const fileInput   = document.getElementById('fileInput');
  const analyseBtn  = document.getElementById('analyseBtn');
  const cancelBtn   = document.getElementById('cancelBtn');
  const clearBtn    = document.getElementById('clearClipBtn');
  const stepSec     = document.getElementById('stepSec');
  const stepVal     = document.getElementById('stepVal');

  const progressWrap  = document.getElementById('progressWrap');
  const progressFill  = document.getElementById('progressFill');
  const progressLabel = document.getElementById('progressLabel');

  const timelineWrap = document.getElementById('timelineWrap');
  const timeline     = document.getElementById('timeline');
  const facesHost    = document.getElementById('clipFaces');
  const summaryHost  = document.getElementById('clipSummary');
  const exportJson   = document.getElementById('exportJson');
  const exportCsv    = document.getElementById('exportCsv');

  let objectUrl = null;
  let samples = [];
  let cancelled = false;
  let analysing = false;
  let meta = null;

  stepSec.addEventListener('input', () => {
    stepVal.textContent = Number(stepSec.value).toFixed(2);
  });

  pickBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) loadFile(fileInput.files[0]);
  });

  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  });

  analyseBtn.addEventListener('click', run);
  cancelBtn.addEventListener('click', () => { cancelled = true; });
  clearBtn.addEventListener('click', reset);

  video.addEventListener('timeupdate', syncPlayhead);
  video.addEventListener('seeked', syncPlayhead);

  timeline.addEventListener('click', (e) => {
    if (!meta?.duration) return;
    const rect = timeline.getBoundingClientRect();
    video.currentTime = ((e.clientX - rect.left) / rect.width) * meta.duration;
  });

  exportJson.addEventListener('click', () => download(
    JSON.stringify(buildExport(), null, 2), 'application/json', 'facetracker-analysis.json'));
  exportCsv.addEventListener('click', () => download(
    buildCsv(), 'text/csv', 'facetracker-analysis.csv'));

  function loadFile(file) {
    if (!file.type.startsWith('video/')) {
      toast('That is not a video file.', true);
      return;
    }
    reset();
    objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    meta = { name: file.name, sizeBytes: file.size, duration: 0 };

    video.addEventListener('loadedmetadata', () => {
      meta.duration = video.duration;
      meta.width = video.videoWidth;
      meta.height = video.videoHeight;
      gate.hidden = true;
      analyseBtn.disabled = false;
      clearBtn.disabled = false;
      fitCanvas(overlay, video.videoWidth, video.videoHeight);
      toast(`${file.name} · ${fmtTime(video.duration)} · ${video.videoWidth}×${video.videoHeight}`);
    }, { once: true });

    video.addEventListener('error', () => {
      toast('Your browser could not decode that video.', true);
      reset();
    }, { once: true });
  }

  async function run() {
    if (analysing || !meta?.duration) return;

    analyseBtn.disabled = true;
    analyseBtn.textContent = 'Loading models…';
    try {
      setBackend(await loadModels());
    } catch {
      toast('Could not load the models.', true);
      analyseBtn.disabled = false;
      analyseBtn.textContent = 'Analyse clip';
      return;
    }

    analysing = true;
    cancelled = false;
    samples = [];
    cancelBtn.disabled = false;
    progressWrap.hidden = false;
    timelineWrap.hidden = false;
    exportJson.disabled = true;
    exportCsv.disabled = true;
    analyseBtn.textContent = 'Analysing…';
    video.pause();

    const step = Number(stepSec.value);
    const total = Math.max(1, Math.floor(meta.duration / step));
    const started = performance.now();

    for (let i = 0; i < total; i++) {
      if (cancelled) break;
      const t = Math.min(i * step, Math.max(0, meta.duration - 0.05));
      try {
        await seekTo(video, t);
        const raw = await analyseFrame(video, { inputSize: 416, scoreThreshold: 0.5 });
        const faces = faceapi
          .resizeResults(raw, { width: video.videoWidth, height: video.videoHeight })
          .map(toRecord);
        samples.push({ t: Math.round(t * 1000) / 1000, faces });
      } catch (err) {
        console.error('sample failed at', t, err);
        samples.push({ t: Math.round(t * 1000) / 1000, faces: [] });
      }

      const done = i + 1;
      const pct = (done / total) * 100;
      progressFill.style.width = pct + '%';
      const eta = ((performance.now() - started) / done) * (total - done) / 1000;
      progressLabel.textContent = `${pct.toFixed(0)}% · ${eta < 1 ? 'almost' : `~${Math.ceil(eta)}s`}`;
      drawTimeline(timeline, samples, meta.duration, t);
    }

    analysing = false;
    cancelBtn.disabled = true;
    analyseBtn.disabled = false;
    analyseBtn.textContent = 'Analyse clip';
    progressLabel.textContent = cancelled
      ? `stopped · ${samples.length} samples`
      : `done · ${samples.length} samples`;

    if (samples.length) {
      exportJson.disabled = false;
      exportCsv.disabled = false;
      renderSummary();
      video.currentTime = 0;
      drawTimeline(timeline, samples, meta.duration, 0);
    }
  }

  /** Shows the sample nearest the playhead while scrubbing or playing. */
  function syncPlayhead() {
    if (!samples.length || !meta?.duration || analysing) return;
    const t = video.currentTime;
    let best = samples[0];
    for (const s of samples) {
      if (Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
    }
    fitCanvas(overlay, video.videoWidth, video.videoHeight);
    drawFaces(overlay, best.faces, { showLandmarks: false, mirrored: false });
    renderFaceCards(facesHost, best.faces, 'No face at this point in the clip.');
    drawTimeline(timeline, samples, meta.duration, t);
  }

  function renderSummary() {
    const frames = samples.length;
    const withFaces = samples.filter((s) => s.faces.length).length;
    const allFaces = samples.flatMap((s) => s.faces);
    const maxConcurrent = Math.max(0, ...samples.map((s) => s.faces.length));

    if (!allFaces.length) {
      summaryHost.innerHTML = '<p class="empty">No faces detected in this clip.</p>';
      return;
    }

    const ages = allFaces.map((f) => f.age).sort((a, b) => a - b);
    const median = ages[Math.floor(ages.length / 2)];

    const counts = Object.fromEntries(EXPRESSIONS.map((e) => [e, 0]));
    for (const f of allFaces) counts[f.topExpression]++;
    const dist = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .filter(([, n]) => n > 0);

    summaryHost.innerHTML = `
      <dl class="kv">
        <dt>Samples</dt><dd>${frames}</dd>
        <dt>Samples with a face</dt><dd>${withFaces} (${((withFaces / frames) * 100).toFixed(0)}%)</dd>
        <dt>Face detections</dt><dd>${allFaces.length}</dd>
        <dt>Most at once</dt><dd>${maxConcurrent}</dd>
        <dt>Median apparent age</dt><dd>~${Math.round(median)}</dd>
      </dl>
      <div class="dist">
        ${dist.map(([name, n]) => `
          <div class="bar-row">
            <span class="bar-name">${name}</span>
            <span class="bar-track"><span class="bar-fill" style="width:${(n / allFaces.length * 100).toFixed(1)}%;background:var(--ex-${name})"></span></span>
            <span class="bar-val">${((n / allFaces.length) * 100).toFixed(0)}%</span>
          </div>`).join('')}
      </div>
      <p class="hint">Counts are per detection, not per person — the same face appears in many samples,
      and this build cannot tell one person from another.</p>`;
  }

  function buildExport() {
    return {
      tool: 'facetracker',
      note: 'Apparent-age and facial-expression estimates. Not identity, not emotion, not intent. '
          + 'Faces are not tracked between samples.',
      generatedAt: new Date().toISOString(),
      source: { name: meta.name, durationSec: meta.duration, width: meta.width, height: meta.height },
      sampleIntervalSec: Number(stepSec.value),
      samples: samples.map((s) => ({
        t: s.t,
        faces: s.faces.map(({ landmarks, ...rest }) => rest),
      })),
    };
  }

  function buildCsv() {
    const head = ['time_sec', 'face_index', 'box_x', 'box_y', 'box_w', 'box_h',
      'detection_score', 'apparent_age', 'age_low', 'age_high', 'top_expression',
      ...EXPRESSIONS.map((e) => `expr_${e}`)].join(',');

    const rows = samples.flatMap((s) =>
      s.faces.map((f, i) => [
        s.t, i, f.box.x, f.box.y, f.box.width, f.box.height,
        f.detectionScore, f.age, f.ageRange[0], f.ageRange[1], f.topExpression,
        ...EXPRESSIONS.map((e) => f.expressions[e] ?? 0),
      ].join(',')));

    return [head, ...rows].join('\n');
  }

  function reset() {
    cancelled = true;
    analysing = false;
    samples = [];
    meta = null;
    video.removeAttribute('src');
    video.load();
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    clear(overlay);
    gate.hidden = false;
    analyseBtn.disabled = true;
    cancelBtn.disabled = true;
    clearBtn.disabled = true;
    exportJson.disabled = true;
    exportCsv.disabled = true;
    progressWrap.hidden = true;
    timelineWrap.hidden = true;
    progressFill.style.width = '0%';
    fileInput.value = '';
    facesHost.innerHTML = '<p class="empty">No clip loaded.</p>';
    summaryHost.innerHTML = '<p class="empty">Run an analysis to see aggregates.</p>';
  }
}

/** Resolves once the video has actually painted the requested time. */
function seekTo(video, t) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); resolve(); }, 3000);
    const onSeeked = () => { cleanup(); resolve(); };
    const onError  = () => { cleanup(); reject(new Error('seek failed')); };
    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    }
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = t;
  });
}

function download(text, mime, filename) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
