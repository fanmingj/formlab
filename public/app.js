import { EXERCISES, CONNECTIONS, buildReport, demoReport, validateClip } from './core.js';
import { PoseEngine, seek } from './inference.js';
import { getSessions, saveSession, deleteSession } from './storage.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  scan: '<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3M8 12h8M12 8v8"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2"/>',
  book: '<path d="M12 5v15M3 4c4-1 6-1 9 1 3-2 5-2 9-1v15c-4-1-6-1-9 1-3-2-5-2-9-1z"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  upload: '<path d="M12 16V3m-4 4 4-4 4 4M4 15v5h16v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 3v4m-2-2h4"/>',
  camera: '<path d="m8 5 1-2h6l1 2h4a1 1 0 0 1 1 1v13H3V6a1 1 0 0 1 1-1z"/><circle cx="12" cy="12" r="4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  download: '<path d="M12 3v13m-4-4 4 4 4-4M4 17v4h16v-4"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.info}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); el.removeAttribute('data-icon'); });
const video = $('video'), overlay = $('overlay'), ctx = overlay.getContext('2d');
let exercise = 'squat', file = null, videoUrl = null, report = null, raw = [], mode = 'empty', busy = false, runVersion = 0, animation = null, sampleTime = 0, samplePlaying = false, lastTick = 0;
const engine = new PoseEngine();
let toastTimer, undoAction;

function toast(message, undo) {
  clearTimeout(toastTimer); $('toast-message').textContent = message; $('toast').hidden = false;
  $('toast-undo').hidden = !undo; undoAction = undo;
  toastTimer = setTimeout(() => { $('toast').hidden = true; undoAction = null; }, 7000);
}
$('toast-undo').onclick = () => { undoAction?.(); $('toast').hidden = true; undoAction = null; };
function error(message) { $('error-box').textContent = message; $('error-box').hidden = !message; }
function time(seconds) { const s = Math.max(0, Number(seconds) || 0); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }
function updateCount() { $('history-count').textContent = getSessions().length; }
function openGuide() { $('guide-dialog').showModal(); }
['nav-guide', 'top-guide', 'filming-button'].forEach(id => { $(id).onclick = openGuide; });
$('privacy-button').onclick = () => $('privacy-dialog').showModal();
document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => $(button.dataset.close).close(); });
document.querySelectorAll('dialog').forEach(dialog => { dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }); });

function showView(view) {
  $('review-view').hidden = view !== 'review'; $('history-view').hidden = view !== 'history';
  $('nav-review').classList.toggle('active', view === 'review'); $('nav-history').classList.toggle('active', view === 'history');
  $('breadcrumb-current').textContent = view === 'review' ? 'Review a set' : 'Session history';
  if (view === 'history') { video.pause(); samplePlaying = false; updatePlayButton(); renderHistory(); }
}
$('nav-review').onclick = () => showView('review');
$('new-review').onclick = () => { resetReview(); showView('review'); };
$('nav-history').onclick = () => showView('history');
function updateAnalyze() {
  const canAnalyze = file && $('side-confirm').checked && !busy;
  $('analyze-button').disabled = !canAnalyze;
  $('analyze-hint').textContent = busy ? 'Analyzing on your device…' : !file ? 'Choose a video to get started' : !$('side-confirm').checked ? 'Confirm your camera angle above' : 'No API key needed · Runs on your device';
}
function setBusy(value) {
  busy = value;
  for (const element of document.querySelectorAll('#exercise-options button, #tracking-side, #side-confirm, #clip-start, #clip-end, #video-input, #replace-input, #sample-button, #playback-controls button, #playback-controls input, #playback-controls select')) element.disabled = value;
  $('progress-box').hidden = !value; updateAnalyze();
}
function stopAnalysis() {
  runVersion++; engine.close(); video.pause(); setBusy(false); video.currentTime = report?.start ?? (Number($('clip-start').value) || 0);
  $('overlay-label').textContent = report ? 'POSE OVERLAY' : 'READY TO REVIEW';
}
$('cancel-analysis').onclick = () => { stopAnalysis(); raw = []; toast('Analysis cancelled. Your video is still ready.'); draw(); };

function resetReview() {
  stopAnalysis(); report = null; raw = []; file = null; mode = 'empty'; samplePlaying = false; video.pause(); video.removeAttribute('src'); video.load();
  if (videoUrl) URL.revokeObjectURL(videoUrl); videoUrl = null;
  $('upload-zone').hidden = false; $('playback').hidden = true; $('playback-controls').hidden = true; $('results').hidden = true; $('coach-card').hidden = true; $('below-upload').hidden = false; $('replace-video').hidden = true; $('sample-button').hidden = false; $('trim-fields').hidden = true; $('saved-placeholder').hidden = true; $('sample-badge').hidden = true; $('overlay-label').hidden = false; $('video-label').textContent = ' YOUR REVIEW SPACE'; $('video-meta').textContent = 'MP4 · MOV · WEBM'; $('side-confirm').checked = false; $('video-input').value = ''; error(''); updateAnalyze();
  video.hidden = false;
  $('replace-input').value = '';
}
function setExercise(next) {
  if (busy) return;
  exercise = next;
  document.querySelectorAll('[data-exercise]').forEach(b => { const selected = b.dataset.exercise === next; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', selected); });
  $('framing-tip').textContent = EXERCISES[next].framing;
  if (mode === 'sample') { loadSample(); return; }
  if (report) { report = null; raw = []; $('results').hidden = true; $('coach-card').hidden = true; $('below-upload').hidden = false; draw(); }
  updateAnalyze();
}
document.querySelectorAll('[data-exercise]').forEach(b => { b.onclick = () => setExercise(b.dataset.exercise); });
$('side-confirm').onchange = updateAnalyze;
$('tracking-side').onchange = () => { if (report && mode === 'video') toast('Analyze again to review using the selected side.'); };
for (const id of ['video-input', 'replace-input']) {
  $(id).onchange = () => { const selected = $(id).files[0]; if (selected) loadFile(selected); };
}
const zone = $('video-panel');
for (const event of ['dragenter', 'dragover']) zone.addEventListener(event, e => { e.preventDefault(); if (!busy) $('upload-zone').classList.add('dragover'); });
for (const event of ['dragleave', 'drop']) zone.addEventListener(event, e => { e.preventDefault(); $('upload-zone').classList.remove('dragover'); });
zone.addEventListener('drop', e => { if (e.dataTransfer.files[0] && !busy) loadFile(e.dataTransfer.files[0]); });

async function loadFile(selected) {
  if (busy) return;
  if (selected.size > 250 * 1024 * 1024 || !selected.size) { error('Choose a non-empty video smaller than 250 MB.'); return; }
  if (!/^video\//.test(selected.type) && !/\.(mp4|webm|mov|m4v)$/i.test(selected.name)) { error('Choose an MP4, MOV, or WebM video.'); return; }
  resetReview(); const version = ++runVersion; mode = 'video'; file = selected;
  $('upload-zone').hidden = true; $('playback').hidden = false; $('playback-controls').hidden = false; $('replace-video').hidden = false; $('sample-button').hidden = true;
  $('video-label').textContent = ' ' + selected.name; $('video-meta').textContent = `${(selected.size / 1024 / 1024).toFixed(1)} MB`; $('overlay-label').textContent = 'READY TO REVIEW';
  videoUrl = URL.createObjectURL(selected);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('The video took too long to load. Try an H.264 MP4 or a shorter clip.')), 15000);
      const finish = err => { clearTimeout(timer); video.removeEventListener('loadeddata', ready); video.removeEventListener('error', failed); err ? reject(err) : resolve(); };
      const ready = () => finish(); const failed = () => finish(new Error('This video codec is not supported by your browser. Try an H.264 MP4 or WebM file.'));
      video.addEventListener('loadeddata', ready, { once: true }); video.addEventListener('error', failed, { once: true }); video.src = videoUrl; video.load();
    });
    if (version !== runVersion) return;
    if (!Number.isFinite(video.duration) || video.duration < 2) throw new Error('Choose a playable video of at least 2 seconds.');
    $('clip-start').value = 0; $('clip-end').value = Math.min(90, video.duration).toFixed(1); $('clip-start').max = video.duration; $('clip-end').max = video.duration;
    $('trim-fields').hidden = false; $('timeline').max = video.duration; $('timeline').value = 0; $('duration-display').textContent = time(video.duration); $('current-time').textContent = '0:00';
    if (video.duration > 90) toast('The first 90 seconds are selected. Adjust the start and end to choose your set.');
    resizeCanvas(); draw(); updateAnalyze();
  } catch (e) { if (version === runVersion) { file = null; error(e.message); updateAnalyze(); } }
}

$('analyze-button').onclick = async () => {
  if (!file || busy) return;
  const start = Number($('clip-start').value), end = Math.min(Number($('clip-end').value), video.duration);
  try { validateClip(file, video.duration, start, end); } catch (e) { error(e.message); return; }
  if (!$('side-confirm').checked) return;
  const version = ++runVersion; error(''); video.pause(); report = null; raw = []; samplePlaying = false;
  $('results').hidden = true; $('coach-card').hidden = true; $('below-upload').hidden = true; $('analysis-progress').value = 0; $('progress-title').textContent = 'Preparing pose model…'; $('progress-detail').textContent = 'Loading the model to your device. The first load takes a moment.'; setBusy(true);
  try {
    await engine.init(); if (version !== runVersion) return;
    const total = Math.ceil((end - start) * 6);
    for (let i = 0; i < total; i++) {
      if (version !== runVersion) return;
      const t = Math.min(end - .02, start + i / 6 + .01);
      await seek(video, t); if (version !== runVersion) return;
      const result = await engine.frame(video, Math.round(t * 1000)); if (version !== runVersion) return;
      raw.push({ t, people: result.people, landmarks: result.landmarks });
      $('analysis-progress').value = Math.round((i + 1) / total * 100); $('progress-title').textContent = `Reviewing your ${EXERCISES[exercise].name.toLowerCase()}…`;
      $('progress-detail').textContent = `${i + 1} of ${total} frames · ${time(t)} / ${time(end)} · Video stays on this device`;
      $('overlay-label').textContent = result.people === 1 ? 'TRACKING MOVEMENT' : result.people > 1 ? 'MULTIPLE PEOPLE · FRAME EXCLUDED' : 'LOOKING FOR A CLEAR POSE';
      draw();
    }
    report = buildReport({ raw, exercise, width: video.videoWidth, height: video.videoHeight, start, end, side: $('tracking-side').value, name: file.name });
    renderReport(); await seek(video, start); draw(); toast(report.sufficientTracking ? 'Your review is ready. Start with the notes beside your video.' : 'Review ready. Tracking was limited; see the recording suggestions.');
  } catch (e) {
    if (version === runVersion) { error(e.message.includes('cancelled') ? 'Analysis cancelled.' : `Could not complete analysis. ${e.message}`); $('below-upload').hidden = false; }
  } finally {
    if (version === runVersion) { engine.close(); setBusy(false); $('overlay-label').textContent = report ? 'POSE OVERLAY' : 'READY TO REVIEW'; }
  }
};

function loadSample() {
  if (busy) return;
  resetReview(); mode = 'sample'; video.hidden = true; report = demoReport(exercise); sampleTime = 0;
  $('upload-zone').hidden = true; $('playback').hidden = false; $('playback-controls').hidden = false; $('sample-badge').hidden = false; $('replace-video').hidden = false; $('sample-button').hidden = true;
  $('video-label').textContent = ' SAMPLE MOVEMENT REVIEW'; $('video-meta').textContent = 'ILLUSTRATION · 30 SECONDS'; $('overlay-label').textContent = 'ILLUSTRATIVE POSE'; $('timeline').max = 30; $('timeline').value = 0; $('duration-display').textContent = '0:30'; $('current-time').textContent = '0:00';
  renderReport(); resizeCanvas(); draw();
}
$('sample-button').onclick = loadSample;
function renderReport() {
  if (!report) return;
  const r = report, config = EXERCISES[r.exercise];
  $('results').hidden = false; $('coach-card').hidden = false; $('below-upload').hidden = true;
  $('report-type').textContent = r.demo ? 'SAMPLE REVIEW · SYNTHETIC DATA' : 'SET REVIEW';
  $('result-title').textContent = `${config.name}, broken down.`;
  $('metric-reps').textContent = r.sufficientTracking ? r.repCount : '—';
  $('metric-tempo').innerHTML = r.repCount ? `${r.medianRep.toFixed(1)}<b class="metric-unit">s</b>` : '—';
  $('metric-range').innerHTML = r.repCount ? `${Math.round(r.medianRange)}<b class="metric-unit">°</b>` : '—';
  $('metric-coverage').innerHTML = `${Math.round(r.coverage * 100)}<b class="metric-unit">%</b>`;
  $('chart-subtitle').textContent = `${config.joint} · ${r.side} side · projected 2D measurement`;
  $('chart-start').textContent = time(r.start); $('chart-end').textContent = time(r.end);
  const width = 600, height = 130, duration = Math.max(.1, r.end - r.start);
  const x = t => 30 + (t - r.start) / duration * (width - 34), y = a => 7 + (180 - a) / 180 * (height - 16);
  let d = '', pen = false;
  for (const f of r.frames) { if (f.angle === null) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${x(f.t).toFixed(2)},${y(f.angle).toFixed(2)} `; pen = true; }
  $('angle-chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escape(config.joint)} over the selected clip. Gaps indicate lost tracking. Exact rep measurements are in the table below.">${[0, 90, 180].map(a => `<line x1="30" y1="${y(a)}" x2="600" y2="${y(a)}" stroke="#e8edde" stroke-dasharray="3 5"/><text x="0" y="${y(a) + 3}" fill="#a0ae90" font-size="8">${a}°</text>`).join('')}<path d="${d}" fill="none" stroke="#7b9f51" stroke-width="2" vector-effect="non-scaling-stroke"/>${r.reps.map(rep => `<circle cx="${x(rep.bottom)}" cy="${y(rep.minAngle)}" r="3.5" fill="#5e7f37" stroke="#fff" stroke-width="2"/>`).join('')}</svg>`;
  $('rep-rows').innerHTML = r.reps.length ? r.reps.map(rep => `<tr><td>${String(rep.number).padStart(2, '0')}</td><td>${time(rep.start)} – ${time(rep.end)}</td><td>${rep.duration.toFixed(1)}s</td><td>${Math.round(rep.range)}°</td><td><button data-seek="${rep.bottom}" ${mode === 'saved' ? 'disabled' : ''} aria-label="Review rep ${rep.number}">${icon('play')} Replay</button></td></tr>`).join('') : '<tr><td colspan="5">No reliable complete reps to display. See your review notes.</td></tr>';
  $('coach-notes').innerHTML = r.observations.map(o => `<article class="observation"><div class="observation-header"><span class="observation-tag ${escape(o.kind)}">${o.kind === 'positive' ? 'KEEP BUILDING' : o.kind === 'review' ? 'TAKE A CLOSER LOOK' : o.kind === 'recapture' ? 'RECORDING NOTE' : 'YOUR NEXT SET'}</span>${o.t !== null ? `<button class="timestamp-button" data-seek="${o.t}" ${mode === 'saved' ? 'disabled' : ''}>${time(o.t)} ↗</button>` : ''}</div><h3>${escape(o.title)}</h3><p>${escape(o.body)}</p></article>`).join('');
  $('measurement-note').textContent = r.reliabilityNote;
  $('save-report').disabled = !!r.demo; $('save-report').title = r.demo ? 'Sample reviews are not saved to history' : 'Save this report on this device';
  document.querySelectorAll('[data-seek]').forEach(button => { button.onclick = () => seekTo(Number(button.dataset.seek)); });
}

async function seekTo(t) {
  if (busy || mode === 'saved') return;
  if (mode === 'sample') { sampleTime = t; samplePlaying = false; } else { video.pause(); await seek(video, t).catch(e => error(e.message)); }
  $('timeline').value = t; $('current-time').textContent = time(t); updatePlayButton(); draw();
}
$('timeline').oninput = () => seekTo(Number($('timeline').value));
$('playback-speed').onchange = () => { video.playbackRate = Number($('playback-speed').value); };
function updatePlayButton() { const playing = mode === 'sample' ? samplePlaying : !video.paused; $('play-button').innerHTML = icon(playing ? 'pause' : 'play'); $('play-button').setAttribute('aria-label', playing ? 'Pause video' : 'Play video'); }
$('play-button').onclick = async () => {
  if (busy || mode === 'saved') return;
  if (mode === 'sample') { if (sampleTime >= 30) sampleTime = 0; samplePlaying = !samplePlaying; lastTick = performance.now(); }
  else if (video.paused) { if (video.ended) video.currentTime = 0; await video.play().catch(e => error(e.message)); } else video.pause();
  updatePlayButton();
};
for (const event of ['play', 'pause', 'ended']) video.addEventListener(event, updatePlayButton);
video.addEventListener('timeupdate', () => { if (mode !== 'video') return; $('timeline').value = video.currentTime; $('current-time').textContent = time(video.currentTime); draw(); });
function resizeCanvas() { const rect = $('playback').getBoundingClientRect(); if (!rect.width || !rect.height) return; const ratio = Math.min(2, devicePixelRatio || 1); overlay.width = rect.width * ratio; overlay.height = rect.height * ratio; draw(); }
new ResizeObserver(resizeCanvas).observe($('playback'));
function closest(frames, t) { if (!frames.length) return null; let low = 0, high = frames.length - 1; while (low < high) { const mid = Math.floor((low + high) / 2); if (frames[mid].t < t) low = mid + 1; else high = mid; } const prev = frames[Math.max(0, low - 1)]; return Math.abs(prev.t - t) < Math.abs(frames[low].t - t) ? prev : frames[low]; }
function draw() {
  const w = overlay.width, h = overlay.height; if (!w || !h) return; ctx.clearRect(0, 0, w, h);
  if (mode === 'sample') { drawSample(w, h); return; }
  if (mode !== 'video' || !raw.length) return;
  const t = video.currentTime, frame = closest(raw, t); if (!frame || Math.abs(frame.t - t) > .25 || frame.people !== 1) return;
  const scale = Math.min(w / video.videoWidth, h / video.videoHeight), dw = video.videoWidth * scale, dh = video.videoHeight * scale, ox = (w - dw) / 2, oy = (h - dh) / 2;
  const points = frame.landmarks.map(p => ({ ...p, x: ox + p.x * dw, y: oy + p.y * dh }));
  skeleton(points, w);
  const metric = closest(report?.frames || [], t);
  if (metric?.angle !== null && metric?.angle !== undefined) {
    ctx.fillStyle = '#182e24d9'; ctx.fillRect(16, h - 52, 170, 36); ctx.fillStyle = '#dcf6ba'; ctx.font = '14px monospace'; ctx.fillText(`${Math.round(metric.angle)}° ${EXERCISES[exercise].joint.toLowerCase()}`, 25, h - 29);
  }
}
function skeleton(points, w) {
  ctx.strokeStyle = '#d5f58b'; ctx.lineWidth = Math.max(2, w / 320); ctx.lineCap = 'round';
  for (const [a, b] of CONNECTIONS) { if ((points[a]?.visibility || 0) < .65 || (points[b]?.visibility || 0) < .65) continue; ctx.beginPath(); ctx.moveTo(points[a].x, points[a].y); ctx.lineTo(points[b].x, points[b].y); ctx.stroke(); }
  for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]) { const p = points[i]; if (!p || p.visibility < .65) continue; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, w / 150), 0, Math.PI * 2); ctx.fillStyle = '#e8ffd1'; ctx.fill(); ctx.strokeStyle = '#304631'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.strokeStyle = '#d5f58b'; }
}
function drawSample(w, h) {
  ctx.fillStyle = '#1b3028'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#d5eabd08'; ctx.lineWidth = 1;
  for (let x = 0; x < w; x += w / 18) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += h / 10) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  const frame = closest(report.frames, sampleTime), a = frame?.angle ?? 172, bend = (172 - a) / 90;
  const cx = w * .54, floor = h * .87, unit = Math.min(w * .3, h * .65);
  let joints;
  if (exercise === 'squat') joints = { hip: [cx - bend * unit * .24, floor - unit * (.48 - bend * .14)], knee: [cx + bend * unit * .25, floor - unit * .26], ankle: [cx, floor], shoulder: [cx + bend * unit * .02, floor - unit * (.86 - bend * .18)] };
  else if (exercise === 'pushup') joints = { shoulder: [cx - unit * .4, floor - unit * (.48 - bend * .24)], hip: [cx + unit * .08, floor - unit * (.32 - bend * .14)], ankle: [cx + unit * .65, floor], elbow: [cx - unit * (.4 - bend * .2), floor - unit * .22], wrist: [cx - unit * .45, floor] };
  else joints = { shoulder: [cx, floor - unit * .85], hip: [cx, floor - unit * .42], ankle: [cx, floor], knee: [cx, floor - unit * .2], elbow: [cx + unit * .025, floor - unit * .61], wrist: [cx + unit * .25 * Math.sin(a * Math.PI / 180), floor - unit * .61 - unit * .25 * Math.cos(a * Math.PI / 180)] };
  joints.elbow ||= [joints.shoulder[0] + unit * .23, joints.shoulder[1] + unit * .08]; joints.wrist ||= [joints.elbow[0] + unit * .19, joints.elbow[1] - unit * .03]; joints.knee ||= [(joints.hip[0] + joints.ankle[0]) / 2, (joints.hip[1] + joints.ankle[1]) / 2];
  ctx.strokeStyle = '#68896355'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(w * .12, floor + 6); ctx.lineTo(w * .86, floor + 6); ctx.stroke();
  const pairs = [['shoulder', 'hip'], ['hip', 'knee'], ['knee', 'ankle'], ['shoulder', 'elbow'], ['elbow', 'wrist']];
  for (const [a, b] of pairs) { ctx.beginPath(); ctx.moveTo(...joints[a]); ctx.lineTo(...joints[b]); ctx.strokeStyle = '#6c8b6370'; ctx.lineWidth = unit * .11; ctx.lineCap = 'round'; ctx.stroke(); ctx.strokeStyle = '#d5f58b'; ctx.lineWidth = 3; ctx.stroke(); }
  ctx.beginPath(); ctx.arc(joints.shoulder[0] - unit * .02, joints.shoulder[1] - unit * .13, unit * .072, 0, Math.PI * 2); ctx.fillStyle = '#58704d'; ctx.fill(); ctx.strokeStyle = '#d5f58b'; ctx.lineWidth = 2; ctx.stroke();
  for (const p of Object.values(joints)) { ctx.beginPath(); ctx.arc(...p, 4, 0, Math.PI * 2); ctx.fillStyle = '#e8ffd1'; ctx.fill(); }
  ctx.font = `${Math.max(11, w / 45)}px monospace`; ctx.fillStyle = '#d5f58b'; ctx.fillText(`${Math.round(a)}°`, w * .16, h * .42); ctx.font = `${Math.max(8, w / 72)}px monospace`; ctx.fillStyle = '#8ba87c'; ctx.fillText(EXERCISES[exercise].joint.toUpperCase(), w * .16, h * .48);
}
function tick(now) {
  if (mode === 'sample' && samplePlaying && !$('review-view').hidden) { sampleTime = Math.min(30, sampleTime + (now - lastTick) / 1000 * Number($('playback-speed').value)); $('timeline').value = sampleTime; $('current-time').textContent = time(sampleTime); if (sampleTime >= 30) { samplePlaying = false; updatePlayButton(); } draw(); }
  else if (mode === 'video' && !video.paused) draw();
  lastTick = now; animation = requestAnimationFrame(tick);
}
animation = requestAnimationFrame(tick);

$('save-report').onclick = () => {
  if (!report || report.demo) return;
  try { saveSession(report); updateCount(); toast('Review saved on this device. Find it in Session history.'); }
  catch { toast('Browser storage is unavailable or full. Export the report to keep a copy.'); }
};
$('export-report').onclick = () => {
  if (!report) return;
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `formlab-${report.exercise}-${report.demo ? 'sample' : report.createdAt.slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Report exported. It contains measurements, not your video.');
};
function renderHistory() {
  const sessions = getSessions(); updateCount();
  $('history-list').innerHTML = !sessions.length ? `<div class="empty-history">${icon('history')}<h2>Your next set starts the story.</h2><p>Analyze a video and save the review.<br>Your observations will be waiting here next time.</p><button class="primary-button" id="history-first-review">Review my first set ↗</button></div>` : sessions.map(r => `<article class="history-card"><div class="history-symbol">${r.exercise === 'squat' ? '↧' : r.exercise === 'pushup' ? '↔' : '↶'}</div><div class="history-main"><h3>${escape(r.name)}</h3><p>${escape(EXERCISES[r.exercise].name)} · ${escape(new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))} · ${time(r.end - r.start)} clip</p></div><div class="history-stats">${r.repCount} reps<br>${Math.round(r.coverage * 100)}% tracking</div><div class="history-actions"><button class="quiet-button" data-open="${escape(r.id)}">Open review ↗</button><button class="icon-button" data-delete="${escape(r.id)}" aria-label="Delete saved review ${escape(r.name)}">${icon('trash')}</button></div></article>`).join('');
  $('history-first-review')?.addEventListener('click', () => { resetReview(); showView('review'); });
  document.querySelectorAll('[data-open]').forEach(b => { b.onclick = () => { const saved = getSessions().find(r => r.id === b.dataset.open); if (!saved) return; resetReview(); report = saved; exercise = saved.exercise; mode = 'saved'; $('upload-zone').hidden = true; $('playback').hidden = false; $('saved-placeholder').hidden = false; $('replace-video').hidden = false; $('sample-button').hidden = true; $('video-label').textContent = ' SAVED REVIEW'; $('video-meta').textContent = EXERCISES[exercise].name.toUpperCase(); $('overlay-label').hidden = true; document.querySelectorAll('[data-exercise]').forEach(el => { const active = el.dataset.exercise === exercise; el.classList.toggle('selected', active); el.setAttribute('aria-pressed', active); }); $('framing-tip').textContent = EXERCISES[exercise].framing; showView('review'); renderReport(); } });
  document.querySelectorAll('[data-delete]').forEach(b => { b.onclick = () => { try { const deleted = deleteSession(b.dataset.delete); renderHistory(); toast('Saved review removed.', () => { if (deleted) { try { saveSession(deleted); renderHistory(); updateCount(); } catch { toast('Could not restore review. Browser storage is unavailable.'); } } }); } catch { toast('Could not update browser storage.'); } } });
}
window.addEventListener('pagehide', () => { engine.close(); if (videoUrl) URL.revokeObjectURL(videoUrl); cancelAnimationFrame(animation); });
updateCount(); updateAnalyze();
