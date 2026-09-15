const KEY = 'formlab.sessions.v1';
export function getSessions(storage = localStorage) {
  try {
    const data = JSON.parse(storage.getItem(KEY) || '[]');
    if (!Array.isArray(data)) return [];
    return data.filter(r => r && r.schemaVersion === 1 && ['squat', 'pushup', 'curl'].includes(r.exercise) && typeof r.id === 'string' && Number.isFinite(r.repCount) && Array.isArray(r.reps) && Array.isArray(r.frames) && Array.isArray(r.observations)).slice(0, 12);
  } catch { return []; }
}
export function saveSession(report, storage = localStorage) {
  if (report.demo) throw new Error('Sample reviews are not saved to your history.');
  const sessions = [report, ...getSessions(storage).filter(r => r.id !== report.id)].slice(0, 12);
  storage.setItem(KEY, JSON.stringify(sessions));
  return sessions;
}
export function deleteSession(id, storage = localStorage) {
  const previous = getSessions(storage), next = previous.filter(r => r.id !== id);
  storage.setItem(KEY, JSON.stringify(next));
  return previous.find(r => r.id === id);
}
