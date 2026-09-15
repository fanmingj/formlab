import test from 'node:test';
import assert from 'node:assert/strict';
import { angle, findReps, summarize, measureFrame, buildReport, demoReport, validateClip, chooseSide } from '../public/core.js';
import { getSessions, saveSession, deleteSession } from '../public/storage.js';

const cycle = (exercise = 'squat', offset = 0, low = 80) => {
  const frames = [];
  for (let i = 0; i <= 36; i++) { const t = i / 6; frames.push({ t: offset + t, angle: 172 - (172 - low) * Math.sin(Math.PI * t / 6) ** 2, secondary: exercise === 'pushup' ? 178 : 10, reliable: true }); }
  return frames;
};
const pose = () => Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: .99 }));
test('angle uses stable geometry and rejects coincident/invalid joints', () => {
  assert.equal(angle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }), 90);
  assert.equal(angle({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 180);
  assert.equal(angle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }), null);
  assert.equal(angle(null, {}, {}), null);
});
test('pixel aspect ratio is applied before joint angles', () => {
  const landmarks = pose(); landmarks[23] = { x: .25, y: .5, visibility: 1 }; landmarks[25] = { x: .5, y: .5, visibility: 1 }; landmarks[27] = { x: .75, y: .75, visibility: 1 };
  const f = measureFrame({ t: 0, people: 1, landmarks }, 'squat', 'left', 1920, 1080);
  assert.ok(Math.abs(f.angle - 150.642) < .01);
});
test('occluded joints, multiple people and offscreen joints are rejected', () => {
  const landmarks = pose(); landmarks[25].visibility = .3;
  assert.equal(measureFrame({ t: 0, people: 1, landmarks }, 'squat', 'left', 100, 100).reliable, false);
  landmarks[25].visibility = 1; landmarks[25].x = 2;
  assert.equal(measureFrame({ t: 0, people: 1, landmarks }, 'squat', 'left', 100, 100).reliable, false);
  assert.equal(measureFrame({ t: 0, people: 2, landmarks }, 'squat', 'left', 100, 100).reliable, false);
});
test('chooses one stable side for the entire clip', () => {
  const landmarks = pose(); for (const id of [23, 25, 27]) landmarks[id].visibility = .4;
  assert.equal(chooseSide([{ people: 1, landmarks }], 'squat'), 'right');
});
test('counts one complete cycle for each supported exercise', () => {
  for (const exercise of ['squat', 'pushup', 'curl']) { const { reps } = findReps(cycle(exercise, 0, 60), exercise); assert.equal(reps.length, 1, exercise); assert.ok(reps[0].duration > 3); assert.ok(reps[0].bottom > reps[0].start); }
});
test('a clip that starts bent cannot count a phantom first rep', () => {
  const frames = cycle().slice(18);
  assert.equal(findReps(frames, 'squat').reps.length, 0);
});
test('range includes the preceding extended position, not just the bend trigger', () => {
  const { reps } = findReps(cycle('squat', 0, 80), 'squat');
  assert.ok(reps[0].range > 90 && reps[0].range <= 92);
});
test('short-range and incomplete movements do not count as full reps', () => {
  assert.equal(findReps(cycle('squat', 0, 135), 'squat').reps.length, 0);
  assert.equal(findReps(cycle().slice(0, 23), 'squat').reps.length, 0);
});
test('tracking loss resets the cycle instead of connecting separated movements', () => {
  const frames = cycle().map(f => f.t > 2 && f.t < 4 ? { ...f, angle: null, reliable: false } : f);
  assert.equal(findReps(frames, 'squat').reps.length, 0);
});
test('stationary and noisy near-threshold data do not invent reps', () => {
  const frames = Array.from({ length: 120 }, (_, i) => ({ t: i / 6, angle: 151 + (i % 2 ? 4 : -4), reliable: true, secondary: null }));
  assert.equal(findReps(frames, 'squat').reps.length, 0);
});
test('insufficient visibility withholds rep counts and coaching claims', () => {
  const valid = cycle(); const missing = Array.from({ length: 100 }, (_, i) => ({ t: 6.2 + i / 6, angle: null, secondary: null, reliable: false }));
  const r = summarize({ measured: [...valid, ...missing], exercise: 'squat', start: 0, end: 23 });
  assert.equal(r.repCount, 0); assert.equal(r.sufficientTracking, false); assert.equal(r.observations[0].kind, 'recapture');
  assert.ok(r.frames.some(f => f.angle === null));
});
test('measured range changes produce a timestamped observation', () => {
  const r = summarize({ measured: [...cycle('squat', 0, 60), ...cycle('squat', 6.2, 65), ...cycle('squat', 12.4, 110)], exercise: 'squat', end: 19 });
  const cue = r.observations.find(o => o.title === 'Range changes between reps');
  assert.equal(r.repCount, 3); assert.ok(cue); assert.ok(cue.t >= 12);
});
test('curl drift feedback is based on upper-arm measurements', () => {
  const measured = cycle('curl', 0, 50).map(f => ({ ...f, secondary: (172 - f.angle) / 3 }));
  const r = summarize({ measured, exercise: 'curl', end: 6 });
  assert.ok(r.observations.some(o => o.title === 'Your upper arm moves with the curl'));
});
test('push-up body-line cue is withheld for stable alignment', () => {
  const r = summarize({ measured: cycle('pushup'), exercise: 'pushup', end: 6 });
  assert.ok(!r.observations.some(o => o.title.includes('shoulder-to-ankle')));
  const changed = summarize({ measured: cycle('pushup').map(f => ({ ...f, secondary: 140 })), exercise: 'pushup', end: 6 });
  assert.ok(changed.observations.some(o => o.title.includes('shoulder-to-ankle')));
});
test('empty input is a recording note, not a positive assessment', () => {
  const r = buildReport({ raw: [], exercise: 'squat', width: 640, height: 480, start: 0, end: 5 });
  assert.equal(r.repCount, 0); assert.equal(r.coverage, 0); assert.equal(r.observations[0].kind, 'recapture');
});
test('sample reviews are visibly marked and contain repeatable cycles', () => {
  for (const e of ['squat', 'pushup', 'curl']) { const r = demoReport(e); assert.equal(r.demo, true); assert.ok(r.repCount >= 3); assert.ok(r.name.includes('synthetic')); }
});
test('clip validation enforces nonempty, size, duration and window bounds', () => {
  const f = { size: 1000 }; assert.doesNotThrow(() => validateClip(f, 10, 0, 10));
  for (const args of [[{ size: 0 }, 10, 0, 10], [{ size: 300 * 1024 * 1024 }, 10, 0, 10], [f, Infinity, 0, 10], [f, 200, 0, 100], [f, 10, -1, 8], [f, 10, 0, 11], [f, 10, 5, 5], [f, 10, 0, 1]]) assert.throws(() => validateClip(...args));
});
const store = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
test('history deduplicates reports, limits retention, deletes and restores', () => {
  const storage = store(), r = { ...demoReport(), demo: false };
  saveSession(r, storage); saveSession(r, storage); assert.equal(getSessions(storage).length, 1);
  for (let i = 0; i < 20; i++) saveSession({ ...r, id: String(i) }, storage);
  assert.equal(getSessions(storage).length, 12);
  const removed = deleteSession('19', storage); assert.equal(getSessions(storage).length, 11);
  saveSession(removed, storage); assert.equal(getSessions(storage)[0].id, '19');
  assert.throws(() => saveSession(demoReport(), storage));
});
test('corrupt or unavailable browser storage fails safely', () => {
  assert.deepEqual(getSessions({ getItem: () => '{broken' }), []);
  assert.deepEqual(getSessions({ getItem: () => { throw new Error('blocked'); } }), []);
});
