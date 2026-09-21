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

### Troubleshooting a blank or 404 site

**`Get Pages site failed ... Error: Not Found` in the deploy workflow.**
Pages has never been enabled on the repository, so there is nothing to publish
to. Merging the code does not enable it. Fix it either way:

- **In settings:** *Settings → Pages → Build and deployment → Source:*
  **GitHub Actions**. Then re-run the failed run from the *Actions* tab.
- **In the workflow:** `actions/configure-pages` is configured here with
  `enablement: true`, which provisions the site over the API on the next run.

**Site is up but the page is blank.** Check that `.nojekyll` is present at the
repository root. Without it, Jekyll filters files out of the published build.

**Camera button does nothing.** `getUserMedia` requires a secure context. This
works on `https://` and on `localhost`, but not on a plain `http://` host or a
`file://` path.

**"The camera is in use by another app."** This is the browser's
`NotReadableError`. Genuinely close other apps or tabs holding the camera
first — but if it appears when *switching* cameras, that is this page's own
previous stream still attached; fixed by detaching `srcObject` on release.
Reload if you are on an older cached copy.

**No faces detected on a phone.** Open the **Diagnostics** card under the video.
It reports capture resolution, the active backend, frame rate, faces found, and
the last error. Common causes:

| Diagnostics show | Cause | Fix |
|---|---|---|
| Frame rate under ~3 fps | Detector input too large for the device | The page drops it once automatically; lower it further in *Detector settings* |
| `backend: cpu` in the header | WebGL missing, or it failed the numeric self-check | Expected to be slow; try a different browser |
| A message under *Last error* | Inference is failing, not the camera | Report that message |
| Faces `0` with good frame rate | Face too small, too dark, or too far off-axis | Move closer, add light, face the camera; or raise input size and lower min confidence |

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
