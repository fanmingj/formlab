export const EXERCISES = {
  squat: { name: 'Squat', joint: 'Knee angle', start: 155, bend: 115, finish: 150, joints: ['hip', 'knee', 'ankle'], cue: 'Stand tall, then show a full squat and return to standing.', framing: 'Keep your shoulder, hip, knee, and ankle visible. Film directly from the side.', subtitle: 'Bodyweight or unobstructed squat' },
  pushup: { name: 'Push-up', joint: 'Elbow angle', start: 155, bend: 110, finish: 150, joints: ['shoulder', 'elbow', 'wrist', 'hip', 'ankle'], cue: 'Begin at the top, lower, and return to the top. Keep your full body in frame.', framing: 'Film at floor level from the side. Keep both your hands and feet in frame.', subtitle: 'Standard full-body push-up' },
  curl: { name: 'Biceps curl', joint: 'Elbow angle', start: 150, bend: 80, finish: 145, joints: ['shoulder', 'elbow', 'wrist', 'hip'], cue: 'Begin with the arm extended. Curl, then return to your starting position.', framing: 'Film the working arm from the side. Keep shoulder, elbow, wrist, and hip visible.', subtitle: 'One clearly visible working arm' }
};
const SIDES = { left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 }, right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 } };
export const CONNECTIONS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [28, 30], [30, 32]];
export const mean = a => a.length ? a.reduce((s, n) => s + n, 0) / a.length : 0;
export const median = a => { if (!a.length) return 0; const s = [...a].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const round = (n, places = 1) => Number(n.toFixed(places));
export function angle(a, b, c) {
  if (![a, b, c].every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const u = { x: a.x - b.x, y: a.y - b.y }, v = { x: c.x - b.x, y: c.y - b.y };
  const norm = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
  if (norm < 1e-8) return null;
  return Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / norm))) * 180 / Math.PI;
}
const visible = p => p && (p.visibility ?? 0) >= .65 && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

export function chooseSide(raw, exercise) {
  const score = side => mean(raw.map(f => {
    if (f.people !== 1 || !f.landmarks) return 0;
    return Math.min(...EXERCISES[exercise].joints.map(j => f.landmarks[SIDES[side][j]]?.visibility ?? 0));
  }));
  return score('left') >= score('right') ? 'left' : 'right';
}

export function measureFrame(frame, exercise, side, width, height) {
  const empty = { t: frame.t, angle: null, secondary: null, reliable: false };
  if (frame.people !== 1 || !frame.landmarks) return empty;
  const ids = SIDES[side], points = frame.landmarks;
  if (!EXERCISES[exercise].joints.every(j => visible(points[ids[j]]))) return empty;
  // Correct for aspect ratio before computing 2D angles.
  const p = j => ({ x: points[ids[j]].x * width, y: points[ids[j]].y * height });
  const primary = exercise === 'squat' ? angle(p('hip'), p('knee'), p('ankle')) : angle(p('shoulder'), p('elbow'), p('wrist'));
  let secondary = null;
  if (exercise === 'pushup') secondary = angle(p('shoulder'), p('hip'), p('ankle'));
  if (exercise === 'curl') secondary = angle(p('elbow'), p('shoulder'), p('hip'));
  if (exercise === 'squat' && visible(points[ids.shoulder])) {
    const s = p('shoulder'), h = p('hip');
    secondary = Math.atan2(Math.abs(s.x - h.x), Math.abs(s.y - h.y)) * 180 / Math.PI;
  }
  return { t: frame.t, angle: primary, secondary, reliable: primary !== null };
}

export function findReps(frames, exercise) {
  const config = EXERCISES[exercise];
  let armed = false, cycle = null, lastTime = null, recent = [], lastAngle = null, lastTop = null, topPeak = null;
  const reps = [], smooth = [];
  for (const f of frames) {
    if (!f.reliable || f.angle === null) {
      smooth.push({ ...f, angle: null });
      if (lastTime !== null && f.t - lastTime > .5) { armed = false; cycle = null; recent = []; lastAngle = null; lastTop = null; topPeak = null; }
      continue;
    }
    if (lastTime !== null && f.t - lastTime > .5) { armed = false; cycle = null; recent = []; lastAngle = null; lastTop = null; topPeak = null; }
    lastTime = f.t;
    recent.push(f.angle); if (recent.length > 3) recent.shift();
    const value = median(recent);
    const point = { ...f, angle: value }; smooth.push(point);
    if (value >= config.start && !cycle) { armed = true; lastTop = f.t; topPeak = Math.max(topPeak ?? value, value); }
    if (armed && !cycle && value < config.start - 8 && lastAngle !== null) {
      cycle = { start: lastTop ?? f.t, bottom: f.t, minAngle: value, maxAngle: topPeak ?? lastAngle, bent: false, samples: [], bottomSecondary: null };
    }
    if (cycle) {
      cycle.samples.push(point);
      cycle.maxAngle = Math.max(cycle.maxAngle, value);
      if (value < cycle.minAngle) { cycle.minAngle = value; cycle.bottom = f.t; cycle.bottomSecondary = f.secondary; }
      if (value <= config.bend) cycle.bent = true;
      if (f.t - cycle.start > 30) { cycle = null; armed = false; topPeak = null; }
      else if (value >= config.finish) {
        const duration = f.t - cycle.start;
        if (cycle.bent && duration >= .65) {
          reps.push({ number: reps.length + 1, start: round(cycle.start, 2), bottom: round(cycle.bottom, 2), end: round(f.t, 2), duration: round(duration, 2), minAngle: round(cycle.minAngle), range: round(cycle.maxAngle - cycle.minAngle), down: round(cycle.bottom - cycle.start, 2), up: round(f.t - cycle.bottom, 2), bottomSecondary: cycle.bottomSecondary,
            secondaryRange: cycle.samples.filter(s => s.secondary !== null).length ? Math.max(...cycle.samples.filter(s => s.secondary !== null).map(s => s.secondary)) - Math.min(...cycle.samples.filter(s => s.secondary !== null).map(s => s.secondary)) : null,
            bentBodyShare: mean(cycle.samples.filter(s => s.secondary !== null).map(s => Number(s.secondary < 162))) });
        }
        cycle = null; armed = value >= config.start; lastTop = f.t; topPeak = value;
      }
    }
    lastAngle = value;
  }
  return { reps, frames: smooth };
}

export function buildReport({ raw, exercise, width, height, start, end, side = 'auto', name = 'Workout set', note = '' }) {
  if (!EXERCISES[exercise]) throw new Error('Choose a supported exercise.');
  const trackedSide = side === 'auto' ? chooseSide(raw, exercise) : side;
  if (!SIDES[trackedSide]) throw new Error('Invalid tracking side.');
  const measured = raw.map(f => measureFrame(f, exercise, trackedSide, width, height));
  return summarize({ measured, exercise, side: trackedSide, start, end, name, note, multiplePeople: raw.filter(f => f.people > 1).length });
}

export function summarize({ measured, exercise, side = 'left', start = 0, end = 0, name = 'Workout set', note = '', multiplePeople = 0 }) {
  const coverage = measured.length ? measured.filter(f => f.reliable).length / measured.length : 0;
  const enough = coverage >= .65 && measured.filter(f => f.reliable).length >= 12;
  const detected = findReps(measured, exercise), reps = enough ? detected.reps : [];
  const observations = [];
  const add = (kind, title, body, t = null) => observations.push({ kind, title, body, t });
  if (!enough) add('recapture', 'A clearer view will help', `The required joints were trackable in ${Math.round(coverage * 100)}% of samples. Form cues and rep counts are withheld. Film one person from the side, in good light, with the working joints in frame.`);
  else if (!reps.length) add('recapture', 'No complete reps detected', `Try a clear starting position, a full movement, and a return to the start. ${EXERCISES[exercise].cue} Partial reps and movements outside the detector thresholds are not counted.`);
  else {
    if (reps.length >= 3) {
      const range = reps.map(r => r.range), spread = Math.max(...range) - Math.min(...range);
      if (spread > 18) {
        const short = reps.reduce((a, b) => a.range < b.range ? a : b);
        add('review', 'Range changes between reps', `Rep ${short.number} covers about ${Math.round(short.range)}° compared with ${Math.round(Math.max(...range))}° in your widest rep. Review the difference; if your goal is consistent reps, use a repeatable, comfortable range. Camera movement can also change this estimate.`, short.bottom);
      } else add('positive', 'A repeatable movement range', `The measured range varies by about ${Math.round(spread)}° across ${reps.length} reps. Use this set as a personal reference rather than a universal form target.`);
      const durations = reps.map(r => r.duration), avg = mean(durations), variation = Math.sqrt(mean(durations.map(n => (n - avg) ** 2))) / avg;
      if (variation > .25) {
        const fast = reps.reduce((a, b) => a.duration < b.duration ? a : b);
        add('review', 'Your rep timing changes', `The quickest rep takes ${Math.min(...durations).toFixed(1)}s and the slowest ${Math.max(...durations).toFixed(1)}s. If the change was not intentional, try keeping the next set at a repeatable pace.`, fast.start);
      }
    }
    if (exercise === 'pushup') {
      const changed = reps.find(r => r.bentBodyShare > .3);
      if (changed) add('review', 'Review your shoulder-to-ankle line', `In rep ${changed.number}, the projected shoulder–hip–ankle angle departs from a straight line in several samples. Review your trunk position and try moving the shoulders and hips together if you are doing a standard push-up.`, changed.bottom);
    }
    if (exercise === 'curl') {
      const drift = reps.find(r => r.secondaryRange !== null && r.secondaryRange > 20);
      if (drift) add('review', 'Your upper arm moves with the curl', `Rep ${drift.number} shows about ${Math.round(drift.secondaryRange)}° of upper-arm movement relative to your torso. If a strict curl is your goal, try keeping the upper arm steadier while bending the elbow.`, drift.bottom);
    }
    if (exercise === 'squat' && reps.length >= 3) {
      const measuredReps = reps.filter(r => r.bottomSecondary !== null);
      if (measuredReps.length >= 3) {
        const lean = measuredReps.map(r => r.bottomSecondary);
        if (Math.max(...lean) - Math.min(...lean) > 15) {
          const most = measuredReps.reduce((a, b) => a.bottomSecondary > b.bottomSecondary ? a : b);
          add('review', 'Torso position varies at the bottom', `The side-view torso angle differs by about ${Math.round(Math.max(...lean) - Math.min(...lean))}° between rep bottoms. Compare rep ${most.number} with the others. Forward lean is normal in a squat; look for unintentional changes rather than forcing an upright torso.`, most.bottom);
        }
      }
    }
    if (!observations.length) add('neutral', 'A starting point for your next set', `${reps.length} complete rep${reps.length === 1 ? '' : 's'} detected. Capture at least three clear reps to compare timing and movement range. A detected rep is not a form or safety assessment.`);
  }
  if (multiplePeople) add('recapture', 'Other people entered the frame', `${multiplePeople} samples contained more than one detected person and were excluded. Use a clear background for more consistent tracking.`);
  const reliabilityNote = 'Single-camera 2D estimates, not a safety score. Perspective, occlusion, and anatomy affect measurements. This tool cannot assess pain, diagnose injuries, or choose a safe load.';
  return { schemaVersion: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), name: String(name).slice(0, 160), note: String(note).slice(0, 500), exercise, side, start, end, coverage: round(coverage, 3), sufficientTracking: enough, repCount: reps.length, medianRep: round(median(reps.map(r => r.duration))), medianRange: round(median(reps.map(r => r.range))), sampleCount: measured.length,
    reps, frames: detected.frames.map(f => ({ t: round(f.t, 2), angle: f.angle === null ? null : round(f.angle), secondary: f.secondary === null ? null : round(f.secondary), reliable: f.reliable })), observations, reliabilityNote };
}

export function demoReport(exercise = 'squat') {
  const measured = [], lows = exercise === 'curl' ? [52, 55, 58, 75] : [85, 90, 88, 112];
  for (let i = 0; i <= 180; i++) {
    const t = i / 6, rep = Math.floor(Math.max(0, t - 1) / 6), phase = (t - 1) % 6;
    const wave = t < 1 || rep >= 4 ? 0 : Math.max(0, Math.sin(Math.PI * phase / 6)) ** 2;
    const low = lows[Math.min(3, rep)];
    measured.push({ t, angle: 172 - (172 - low) * wave, secondary: exercise === 'squat' ? 10 + 24 * wave : exercise === 'pushup' ? 176 - 8 * wave : 8 + 10 * wave, reliable: true });
  }
  return { ...summarize({ measured, exercise, start: 0, end: 30, name: 'Sample review · synthetic movement' }), demo: true };
}

export function validateClip(file, duration, start, end) {
  if (!file || !file.size) throw new Error('Choose a non-empty video first.');
  if (file.size > 250 * 1024 * 1024) throw new Error('Choose a video smaller than 250 MB.');
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('This video cannot be decoded. Try an MP4 with H.264 video or a WebM file.');
  if (![start, end].every(Number.isFinite) || start < 0 || end > duration + .05 || end <= start) throw new Error('Choose a valid start and end within your video.');
  if (end - start < 2) throw new Error('Choose at least 2 seconds of video.');
  if (end - start > 90.05) throw new Error('Select a clip of 90 seconds or less.');
}
