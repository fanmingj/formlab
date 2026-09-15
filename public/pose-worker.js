/* Classic worker: MediaPipe's WASM loader uses importScripts. */
let landmarker;
const VERSION = '0.10.14';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'init') {
      if (landmarker) landmarker.close();
      const { FilesetResolver, PoseLandmarker } = await import(`${CDN}/vision_bundle.mjs`);
      const files = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      landmarker = await PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numPoses: 2, minPoseDetectionConfidence: .6, minPosePresenceConfidence: .6, minTrackingConfidence: .6,
        outputSegmentationMasks: false
      });
      self.postMessage({ id, ok: true });
    } else if (type === 'frame') {
      if (!landmarker) throw new Error('Pose model has not loaded.');
      try {
        const result = landmarker.detectForVideo(data.bitmap, data.timestamp);
        self.postMessage({ id, ok: true, people: result.landmarks.length,
          landmarks: result.landmarks.length === 1 ? result.landmarks[0].map(p => ({ x: p.x, y: p.y, visibility: p.visibility })) : null });
      } finally { data.bitmap.close(); }
    }
  } catch (error) { self.postMessage({ id, ok: false, error: String(error.message || error) }); }
};
