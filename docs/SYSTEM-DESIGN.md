# System design

## 1. Shape of the system

There is no backend. FaceTracker is a static site; every byte of inference happens
inside the visitor's browser tab.

```
                         ┌──────────────────────────────────────────────┐
  GitHub Pages           │  The visitor's browser tab                   │
  (static origin)        │                                              │
                         │   ┌────────────┐      ┌──────────────────┐   │
  index.html    ─────────┼──▶│  UI layer  │      │  MediaStream     │   │
  app.css                │   │  app.js    │      │  (camera)        │   │
  face-api.js   ─────────┼──▶│  live.js   │◀─────┤        or        │   │
  models/*.bin  ─────────┼──▶│  clip.js   │      │  <video> from a  │   │
                         │   └─────┬──────┘      │  local File      │   │
  ▲                      │         │             └──────────────────┘   │
  │ one-time fetch       │         ▼                                    │
  │ of ~2.6 MB           │   ┌────────────┐     ┌───────────────────┐   │
  │                      │   │ detector.js│────▶│ TensorFlow.js     │   │
  └──────────────────────┼───│ pipeline   │     │ WebGL → your GPU  │   │
                         │   └─────┬──────┘     └───────────────────┘   │
   no further requests   │         ▼                                    │
   after load            │   ┌────────────┐                             │
                         │   │ overlay.js │──▶ <canvas>, cards, charts  │
                         │   └────────────┘                             │
                         │                                              │
                         │   frames are never buffered, stored or sent  │
                         └──────────────────────────────────────────────┘
```

The privacy property is structural, not procedural. There is no endpoint that
could receive a frame, so no configuration mistake, policy change, or breach can
cause one to be sent. You can confirm this from the browser's network panel:
after the model files load, the page issues no further requests.

## 2. Inference pipeline

Per sampled frame:

| # | Model | Weights | Role |
|---|-------|---------|------|
| 1 | TinyFaceDetector  | 190 KB | Bounding boxes + detection score |
| 2 | FaceLandmark68    | 350 KB | 68 points, used to align each crop |
| 3 | FaceExpressionNet | 320 KB | 7-way softmax over expression classes |
| 4 | AgeNet            | 420 KB | Apparent-age regression |

Models 2–4 run once per detected face, so cost scales with face count, not just
resolution. Output is normalised in `detector.js#toRecord()` into a flat record:
box, detection score, apparent age plus a ±5-year range, the full expression
distribution, and landmarks.

**Two capabilities are deliberately left out.**

- `face_recognition_model` — the 128-dimension identity embedding — is **not in
  this repository**. Without it there is no way to match a face to a watchlist,
  to link the same person across frames, or to build a face database. Face
  tracking between frames is therefore also absent: the clip report counts
  *detections*, never *people*.
- The age net also emits a binary gender classification. It is discarded in
  `toRecord()` and never displayed. A two-class output cannot represent the
  people it is wrong about, and the demo loses nothing without it.

Both omissions are load-bearing, not cosmetic. See
[SCOPE-AND-LIMITS.md](./SCOPE-AND-LIMITS.md).

## 3. Module map

| File | Responsibility |
|------|----------------|
| `assets/js/app.js`       | Tabs, toasts, bootstrap |
| `assets/js/detector.js`  | Model loading, inference, record normalisation |
| `assets/js/overlay.js`   | Canvas drawing, charts, face cards |
| `assets/js/live.js`      | Camera lifecycle and the render loop |
| `assets/js/clip.js`      | File intake, seek-and-sample analysis, export |
| `models/`                | Vendored weights (self-hosted, no CDN) |

## 4. Two execution modes

**Live** runs a `requestAnimationFrame` loop with a re-entrancy guard, so
inference never queues up behind a slow frame — it drops frames instead. The
frame rate is therefore honest about the device. Detector input size and
confidence threshold are exposed because the right values differ by an order of
magnitude between a laptop and a mid-range phone.

**Clip** does not sample during playback. It seeks to fixed timestamps and waits
for the `seeked` event before running inference. That makes the sample set a
function of the clip and the chosen interval only — a slow device produces the
same records as a fast one, just later. It also makes progress reportable and
the pass cancellable. A 3-second watchdog on each seek keeps a codec that never
fires `seeked` from stalling the run.

## 5. Camera lifecycle

The `MediaStream` is held only while the camera is on:

- acquired on explicit click, never on page load;
- every track is stopped on **Stop**, on tab hide (`visibilitychange`), and on
  `pagehide`;
- `getUserMedia` errors map to specific, actionable messages rather than a
  generic failure.

Releasing on tab-hide means the camera indicator light goes out when you switch
away — the page cannot capture in the background.

## 6. Camera acquisition, in detail

Three failure modes are handled explicitly, because each produces the same
unhelpful symptom — a dead preview or an empty overlay.

**Releasing the device.** Stopping a stream's tracks does not release the
camera while the `<video>` element still references that stream. Android Chrome
and iOS Safari keep the lens open until `srcObject` is detached, so re-acquiring
throws `NotReadableError` — which reads as "the camera is in use by another
app", when the other app is this page. `releaseCamera()` stops the tracks,
detaches `srcObject`, calls `load()`, and waits briefly for the OS to finish.

**Overlapping acquisition.** A double tap, or a camera switch while the previous
`getUserMedia` is still resolving, puts two requests against one device. A
`starting` latch collapses concurrent attempts into one.

**Constraints that a device cannot meet.** Phones throw `OverconstrainedError`
rather than degrading, and some Android builds report `NotReadableError` for a
`facingMode` they do not really have. `acquire()` retries through progressively
plainer constraints — ideal resolution, then facing only, then bare
`{ video: true }` — and stops immediately on a permission denial, which
relaxing constraints cannot fix.

**Retiring the previous run.** Restarting increments an epoch counter. This
matters because detaching the video mid-inference can leave that promise
permanently unsettled: its `finally` never runs, the `busy` latch stays set, and
the next loop spins at full frame rate without ever detecting anything. The
epoch both clears the latch and stops a superseded iteration from writing to the
canvas after a newer one has started.

## 7. Performance notes

Measured headless with software WebGL (SwiftShader), which is a worst case:
~1.7 fps at 416 px input. On real GPU hardware expect roughly 15–30 fps on a
desktop and 8–15 fps on a recent phone at the same input size. Levers, in order
of effect:

1. **Input size** — 224 instead of 416 is roughly 3× faster and the single
   biggest win on mobile. It costs you small and distant faces.
2. **Face count** — stages 2–4 are per-face.
3. **Backend** — if the header pill reads `cpu`, WebGL was unavailable and
   throughput will be roughly an order of magnitude lower.

Total transfer is ~2.6 MB (1.3 MB library, 1.3 MB weights), fetched once and
then served from cache.

## 8. Deployment

Static hosting, no build step. On GitHub Pages, set
**Settings → Pages → Source: Deploy from a branch → `main` / root**, or use the
included workflow at `.github/workflows/pages.yml`.

Two requirements:

- **HTTPS.** `getUserMedia` is gated on a secure context. `github.io` is HTTPS,
  so this is satisfied; locally, use `localhost`, which also counts.
- **`.nojekyll`** is present so Jekyll does not filter files out of the build.

`models/` must deploy as-is. `.bin` files are served as `application/octet-stream`,
which is what the loader expects.

## 9. Extending it

Reasonable additions that don't change the system's character:

- **More detail per face**: head pose from the 68 landmarks, eye-aspect-ratio
  blink detection, gaze direction. All derivable from what's already computed.
- **Better temporal readout**: smooth expression scores over a short window
  instead of showing per-frame argmax, which is jumpy by nature.
- **Batch images**: the same pipeline over a folder of stills.
- **A WebWorker + OffscreenCanvas** split, to keep the UI thread free during
  long clip passes.

Additions that *would* change its character — identity matching, cross-frame
tracking, watchlists, demographic inference, any "risk" or "suspicion" score —
are covered in [SCOPE-AND-LIMITS.md](./SCOPE-AND-LIMITS.md), which explains why
they are not here and what to build instead.
