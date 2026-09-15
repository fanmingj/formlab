# FormLab

**Your movement, in focus.** A private exercise video review studio for squats, push-ups, and biceps curls. Upload a set, follow your movement with a pose overlay, and jump to the moments behind each review cue.

**[Open FormLab](https://fanmingj.github.io/formlab/)** · [Automated checks](https://github.com/fanmingj/formlab/actions/workflows/test.yml)

## Start locally

Requires Node.js 22 or newer. No package installation, API key, or account is needed.

```sh
node server.mjs
```

Open **http://127.0.0.1:4180**. Alternatively, run `npm start` in a standard Node installation. The server binds to localhost and only serves the `public` directory. It does not accept uploads.

The browser downloads a pinned MediaPipe runtime and pose model when analysis starts. An internet connection is needed for these assets unless they are already cached. Use a recent Chrome or Edge browser with WebAssembly, Web Workers, and OffscreenCanvas support.

## Review a set

1. Choose **Squat**, **Push-up**, or **Biceps curl**.
2. Upload an MP4, MOV, or WebM that your browser can decode. H.264 MP4 is a useful fallback for unsupported codecs. Limit: 250 MB.
3. Select a window of 2–90 seconds. Confirm that the video shows one person directly from the side. Start and finish in the extended position.
4. Analyze the set. The video is sampled at 6 frames per second; a dedicated worker runs pose inference.
5. Review the overlay, estimated rep count, median rep duration, projected movement range, and tracking coverage. Timestamped observations and rep rows seek to the relevant moment.
6. Save the report to this browser or export JSON. The most recent 12 saved reports are retained. Videos and raw pose landmarks are not included in saved reports.

**Explore a sample review** provides an animated illustration and clearly labeled synthetic measurements. It does not run inference or represent an analyzed workout. Samples cannot be saved to personal history.

## What the feedback means

The learned model estimates body landmarks. FormLab then applies inspectable measurement rules; it does not send videos to a language model or invent a form score.

| Exercise | Rep signal | Review observations |
| --- | --- | --- |
| Squat | Hip–knee–ankle projected angle | Between-rep range, timing, and torso-position variation at the bottom |
| Push-up | Shoulder–elbow–wrist projected angle | Between-rep range and timing; shoulder–hip–ankle line changes |
| Biceps curl | Shoulder–elbow–wrist projected angle | Between-rep range and timing; upper-arm movement relative to the torso |

Thresholds in `public/core.js` are transparent engineering heuristics, **not clinically validated technique standards**. A rep is an extended → bent → extended cycle, with hysteresis and a three-sample median filter. Incomplete movements do not count. Tracking gaps longer than 0.5 seconds reset a cycle. Reps must take at least 0.65 seconds and at most 30 seconds.

Angles use image coordinates corrected for aspect ratio. The same visible side is used throughout a review. Required joints must have at least 0.65 visibility and lie inside the frame. Samples with multiple detected people are excluded. Rep counts and coaching observations are withheld when fewer than 12 samples, or less than 65% of samples, are usable. Tracking coverage describes observable samples; it is not a calibrated model-confidence or safety score.

Rep duration is measured between movement thresholds and excludes some time near full extension; it is not a stopwatch measurement of an entire repetition. Movement range includes the preceding extended pose. Sampling at 6 FPS and temporal filtering limit timestamp precision.

Single-camera estimates are sensitive to viewpoint, occlusion, clothing, lighting, anatomy, and model error. The model does not verify that the chosen exercise matches the video, identify a person, understand equipment/load, assess pain, diagnose injuries, or guarantee safe/correct technique. Feedback is for reviewing visible movement and discussing uncertain technique with a qualified trainer. Stop if an exercise causes pain.

## Architecture

```text
Local video file → browser video decoder → sampled ImageBitmap frames
                                             ↓
                                  MediaPipe worker / WASM
                                             ↓
                    visibility filtering → aspect-corrected angles
                                             ↓
                        rep state machine → evidence-based rules
                                             ↓
                    annotated playback / charts / timestamped cues
                                             ↓
                          optional browser history / JSON export
```

- `public/core.js`: pure geometry, exercise definitions, quality filtering, rep detection, and report construction.
- `public/pose-worker.js`: pinned MediaPipe Pose Landmarker Lite inference, off the UI thread.
- `public/inference.js`: worker lifecycle, request timeouts, transferable frames, and video seeking.
- `public/app.js`: upload, cancellation, playback, overlays, charts, and accessible interactions.
- `public/storage.js`: bounded local report history with deduplication and recoverable removal.
- `server.mjs`: dependency-free local static server with traversal checks and no write/upload endpoints.

The static `public` folder also works on HTTPS hosting. All application asset references are relative, including the worker, so repository-subpath hosting is supported.

## Privacy and storage

Video files become temporary browser object URLs and are not posted to a server. Frame inference happens on device. Saved/exported reports contain the video filename, exercise, timestamps, movement measurements, and cues. Browser storage is not encrypted and is specific to a browser and origin. Clearing site data removes saved history. Nothing is saved automatically.

External requests are limited to the MediaPipe package/WASM from jsDelivr, the model from Google Cloud Storage, and fonts from Google Fonts. These providers receive ordinary asset requests (and associated connection metadata), not the video frames. There are no analytics scripts or account services. A production offline distribution could self-host these assets with their required third-party notices.

## Verification

```sh
node --test test/core.test.mjs test/server.test.mjs
```

The automated suite covers geometry, aspect ratio, visibility, side selection, each exercise's rep cycles, incomplete reps, noisy thresholds, tracking loss, low-coverage suppression, cue evidence, sample data, clip limits, history retention, and static-server boundaries. GitHub Actions runs on Node 22/24 and Windows/Linux.

For **real browser/model checks**:

```sh
node server.mjs --qa
```

Open **http://127.0.0.1:4180/__qa**. The smoke test initializes the actual model, checks 33 landmarks on Google's public pose test image, and confirms no pose on an empty frame. The integration check creates a short blank video, sends it through the actual upload/inference flow, verifies that unreliable feedback is withheld, and exercises save/open/remove history. The QA page is never served by the default server and is outside the deployable public folder.

These tests verify software behavior, not biomechanical accuracy on a representative exercise dataset. No clinical or injury-prevention claims are made.

## Further development

- Build a consented, labeled exercise dataset; measure per-exercise rep-count and angle error.
- Add per-user calibration and carefully evaluated support for additional exercises.
- Add a video annotation export and optional self-hosted model assets.
- Evaluate automatic camera-view checks before expanding beyond side-view recordings.

## Technical references

- [Google's Pose Landmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
- [MediaPipe web task documentation and on-device processing](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md)
- [Pose Landmarker JavaScript API](https://developers.google.com/edge/api/mediapipe/js/tasks-vision.poselandmarker)

MediaPipe is a third-party Google project. FormLab uses `@mediapipe/tasks-vision` version `0.10.14` and the version 1 Float16 Pose Landmarker Lite model, loaded at runtime. Third-party packages and model assets retain their own licenses.

