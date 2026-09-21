/** Canvas drawing: boxes, landmarks, labels, and the two small charts. */

import { EXPRESSIONS, EXPRESSION_COLOR } from './detector.js';

/** Sizes a canvas to its video's intrinsic frame, accounting for DPR. */
export function fitCanvas(canvas, width, height) {
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

export function clear(canvas) {
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * Draws detections onto `canvas`, whose pixel size must match the frame the
 * records were computed from.
 *
 * @param {boolean} mirrored  when the stage is mirrored via CSS the whole canvas
 *   is flipped too, so label text has to be un-flipped to stay readable.
 */
export function drawFaces(canvas, records, { showLandmarks = false, mirrored = false } = {}) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const scale = Math.max(1, canvas.width / 640);
  const lw = Math.max(1.5, 2 * scale);

  records.forEach((rec, i) => {
    const { x, y, width, height } = rec.box;
    const color = EXPRESSION_COLOR[rec.topExpression] ?? '#64e3b0';

    // corner-bracket box
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    const c = Math.min(width, height) * 0.22;
    ctx.beginPath();
    ctx.moveTo(x, y + c);            ctx.lineTo(x, y);             ctx.lineTo(x + c, y);
    ctx.moveTo(x + width - c, y);    ctx.lineTo(x + width, y);     ctx.lineTo(x + width, y + c);
    ctx.moveTo(x + width, y + height - c); ctx.lineTo(x + width, y + height); ctx.lineTo(x + width - c, y + height);
    ctx.moveTo(x + c, y + height);   ctx.lineTo(x, y + height);    ctx.lineTo(x, y + height - c);
    ctx.stroke();

    ctx.strokeStyle = color + '33';
    ctx.lineWidth = lw * 0.6;
    ctx.strokeRect(x, y, width, height);

    if (showLandmarks && rec.landmarks) {
      ctx.fillStyle = color + 'cc';
      const r = Math.max(1, 1.4 * scale);
      for (const [px, py] of rec.landmarks) {
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // label
    const label = `~${rec.ageRange[0]}–${rec.ageRange[1]}  ${rec.topExpression}`;
    const fs = Math.max(11, 13 * scale);
    ctx.font = `600 ${fs}px ui-monospace, Menlo, Consolas, monospace`;
    const tw = ctx.measureText(label).width;
    const pad = 6 * scale;
    const bh = fs + pad * 1.6;
    let bx = x;
    let by = y - bh - 4 * scale;
    if (by < 0) by = y + height + 4 * scale;

    ctx.save();
    if (mirrored) {
      // undo the CSS mirror for this label only
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      bx = canvas.width - x - tw - pad * 2;
    }
    ctx.fillStyle = 'rgba(6, 10, 16, 0.82)';
    roundRect(ctx, bx, by, tw + pad * 2, bh, 4 * scale);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(label, bx + pad, by + bh - pad * 0.9);
    ctx.restore();

    if (records.length > 1) {
      ctx.save();
      ctx.fillStyle = color;
      ctx.font = `500 ${Math.max(9, 10 * scale)}px ui-monospace, monospace`;
      if (mirrored) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
      const nx = mirrored ? canvas.width - x - width : x + width - 16 * scale;
      ctx.fillText(`#${i + 1}`, nx + 4 * scale, y + height - 5 * scale);
      ctx.restore();
    }
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Rolling strip of the dominant expression. `samples` = [{t, name}] oldest first. */
export function drawMoodStrip(canvas, samples, windowMs = 60000) {
  const ctx = prepare(canvas);
  const { width: w, height: h } = logicalSize(canvas);
  ctx.clearRect(0, 0, w, h);

  if (!samples.length) {
    ctx.fillStyle = '#64748b';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('waiting for a face…', 10, h / 2 + 4);
    return;
  }

  const now = samples[samples.length - 1].t;
  const t0 = now - windowMs;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.t < t0) continue;
    const next = samples[i + 1]?.t ?? now + 200;
    const x1 = ((s.t - t0) / windowMs) * w;
    const x2 = ((Math.min(next, now + 200) - t0) / windowMs) * w;
    ctx.fillStyle = EXPRESSION_COLOR[s.name] ?? '#7c8ba1';
    ctx.fillRect(x1, 8, Math.max(1, x2 - x1), h - 24);
  }

  ctx.fillStyle = '#64748b';
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText('-60s', 2, h - 3);
  ctx.textAlign = 'right';
  ctx.fillText('now', w - 2, h - 3);
  ctx.textAlign = 'left';
}

/** Clip timeline: bar height = face count, colour = dominant expression. */
export function drawTimeline(canvas, samples, duration, playhead = 0) {
  const ctx = prepare(canvas);
  const { width: w, height: h } = logicalSize(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!samples.length || !duration) return;

  const maxFaces = Math.max(1, ...samples.map((s) => s.faces.length));
  const bw = Math.max(1, w / samples.length);
  const base = h - 16;

  for (const s of samples) {
    const x = (s.t / duration) * w;
    const n = s.faces.length;
    if (!n) {
      ctx.fillStyle = '#172029';
      ctx.fillRect(x, base - 2, bw, 2);
      continue;
    }
    const top = s.faces.slice().sort((a, b) => b.topExpressionScore - a.topExpressionScore)[0];
    const bh = (n / maxFaces) * (base - 8);
    ctx.fillStyle = EXPRESSION_COLOR[top.topExpression] ?? '#7c8ba1';
    ctx.fillRect(x, base - bh, bw, bh);
  }

  const px = (playhead / duration) * w;
  ctx.strokeStyle = '#e6edf5';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px, 0);
  ctx.lineTo(px, base);
  ctx.stroke();

  ctx.fillStyle = '#64748b';
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText('0:00', 2, h - 3);
  ctx.textAlign = 'right';
  ctx.fillText(fmtTime(duration), w - 2, h - 3);
  ctx.textAlign = 'left';
}

export function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Sets up a DPR-correct 2D context for the small charts. */
function prepare(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 300;
  const cssH = parseInt(canvas.getAttribute('height'), 10) || 64;
  const needW = Math.round(cssW * dpr);
  const needH = Math.round(cssH * dpr);
  if (canvas.width !== needW || canvas.height !== needH) {
    canvas.width = needW;
    canvas.height = needH;
    canvas.style.height = cssH + 'px';
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function logicalSize(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return { width: canvas.width / dpr, height: canvas.height / dpr };
}

/** Renders the per-face detail cards in the sidebar. */
export function renderFaceCards(host, records, emptyText) {
  if (!records.length) {
    host.innerHTML = `<p class="empty">${emptyText}</p>`;
    return;
  }
  host.innerHTML = records.map((rec, i) => {
    const bars = EXPRESSIONS
      .map((name) => ({ name, v: rec.expressions[name] ?? 0 }))
      .sort((a, b) => b.v - a.v)
      .map(({ name, v }) => `
        <div class="bar-row">
          <span class="bar-name">${name}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${(v * 100).toFixed(1)}%;background:${EXPRESSION_COLOR[name]}"></span></span>
          <span class="bar-val">${(v * 100).toFixed(0)}%</span>
        </div>`).join('');

    return `
      <div class="face-card">
        <div class="face-head">
          <span class="face-id">face #${i + 1}</span>
          <span class="face-conf">det ${(rec.detectionScore * 100).toFixed(0)}%</span>
        </div>
        <div class="face-age">~${rec.ageRange[0]}–${rec.ageRange[1]}<small>apparent age</small></div>
        <p class="face-mood">looks <b>${rec.topExpression}</b> · ${(rec.topExpressionScore * 100).toFixed(0)}% confidence</p>
        <div class="bars">${bars}</div>
      </div>`;
  }).join('');
}
