# FaceTracker

A browser demo that finds faces in your webcam feed or a video clip and estimates
**apparent age** and **facial expression** — entirely on your own device.

**Live:** https://aamishuvo.github.io/facetracker/

No server, no upload, no recording. Four small neural networks are fetched once
and then run against each frame using WebGL on your GPU. After the models load,
the page makes no further network requests — check the network panel.

---

## Features

**Live camera**
- Explicit permission gate; the stream is acquired on click, never on page load
- Real-time boxes, 68-point landmarks, apparent-age range and expression readout
- Per-face confidence bars across all seven expression classes
- Rolling 60-second strip chart of the dominant expression
- Front/rear camera switch, mirroring, annotated PNG snapshot
- Adjustable detector input size and confidence threshold
- Camera released automatically when the tab goes to the background

**Video clip**
- Drag-and-drop or file picker; the file is read from disk, never uploaded
- Deterministic seek-and-sample pass with progress, ETA and cancel
- Clickable timeline: bar height is face count, colour is dominant expression
- Aggregate summary and per-sample JSON / CSV export

## Running locally

Any static file server will do — but it must be `localhost` or HTTPS, because
browsers only grant camera access in a secure context.

```bash
git clone https://github.com/aamishuvo/facetracker.git
cd facetracker
python3 -m http.server 8777
# open http://localhost:8777
```

Opening `index.html` as a `file://` URL will not work: ES modules and
`getUserMedia` both require an origin.

## Deploying

The site is plain static files with no build step.

**Settings → Pages → Source: Deploy from a branch → `main` / `root`**, or let the
included workflow (`.github/workflows/pages.yml`) publish it on push to `main`.

`.nojekyll` is committed so that Jekyll does not filter files out of the build,
and `models/` must ship as-is.

## What the numbers mean — and don't

This matters more than the feature list.

- **Age is a guess about appearance.** Error for this class of model runs roughly
  ±4–8 years, and is worst on children, older adults, and darker skin tones.
  The UI shows a range rather than a single number for this reason.
- **"Expression" is not "emotion."** The model scores what a face is *doing*.
  The evidence that facial configuration reliably reveals inner emotional state
  is weak and heavily context-dependent — see
  [Barrett et al. 2019](docs/SCOPE-AND-LIMITS.md#references). "Happy" means the
  mouth corners are raised.
- **Nothing here infers intent.** No face model can tell you what a person plans
  to do. That is not a missing feature; it is a claim with no scientific basis.

### Deliberate omissions

The face-**recognition** model that ships with the underlying library is **not
included in this repository**. The app therefore cannot produce identity
embeddings, match faces against a watchlist, or link a person across frames or
sessions — the clip report counts *detections*, never *people*. The library's
binary gender classifier is computed but never displayed.

These are load-bearing design decisions. This demo is not a foundation for
surveillance, criminal-intent detection, or biometric identification, and
[docs/SCOPE-AND-LIMITS.md](docs/SCOPE-AND-LIMITS.md) sets out the scientific,
statistical and legal reasons why — along with what a lawful, evidence-based
public-safety analytics system looks like instead.

## Documentation

- [System design](docs/SYSTEM-DESIGN.md) — architecture, pipeline, performance, deployment
- [Scope and limits](docs/SCOPE-AND-LIMITS.md) — what this must not be used for, and why

## Tech

Vanilla JS (ES modules), no framework, no build.
[`@vladmandic/face-api`](https://github.com/vladmandic/face-api) 1.7.15 over
TensorFlow.js, vendored into `assets/js/vendor/` with weights in `models/` so
there is no runtime CDN dependency. MIT licensed; see
`assets/js/vendor/face-api.LICENSE`.

Total transfer: ~2.6 MB, fetched once and then cached.
