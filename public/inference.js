export class PoseEngine {
  constructor() { this.worker = null; this.pending = new Map(); this.nextId = 0; }
  async init() {
    this.close();
    if (!('Worker' in window) || !('OffscreenCanvas' in window)) throw new Error('This browser does not support on-device analysis. Try a recent version of Chrome or Edge.');
    this.worker = new Worker(new URL('./pose-worker.js', import.meta.url));
    this.worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(data.id);
      data.ok ? pending.resolve(data) : pending.reject(new Error(data.error));
    };
    this.worker.onerror = event => { event.preventDefault(); this.close(new Error('The pose model could not start. Check your connection and try again.')); };
    await this.call('init', {}, [], 120000);
  }
  call(type, values, transfer = [], timeout = 15000) {
    return new Promise((resolve, reject) => {
      if (!this.worker) { reject(new Error('Analysis cancelled.')); return; }
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The pose model timed out. Check your connection or try a shorter clip.')); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, type, ...values }, transfer);
    });
  }
  async frame(video, timestamp) {
    const bitmap = await createImageBitmap(video);
    return this.call('frame', { bitmap, timestamp }, [bitmap]);
  }
  close(reason = new Error('Analysis cancelled.')) {
    this.worker?.terminate(); this.worker = null;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(reason); }
    this.pending.clear();
  }
}

export function seek(video, time) {
  return new Promise((resolve, reject) => {
    if (Math.abs(video.currentTime - time) < .001 && video.readyState >= 2) { resolve(); return; }
    const timer = setTimeout(() => finish(new Error('This video frame could not be read. Try exporting the clip as H.264 MP4.')), 12000);
    const finish = error => { clearTimeout(timer); video.removeEventListener('seeked', done); video.removeEventListener('error', failed); error ? reject(error) : resolve(); };
    const done = () => finish();
    const failed = () => finish(new Error('Video decoding failed. Try another video format.'));
    video.addEventListener('seeked', done, { once: true }); video.addEventListener('error', failed, { once: true });
    video.currentTime = time;
  });
}
