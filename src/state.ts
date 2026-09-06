export interface PersistedActivity {
  identity: string;
  lastActivity: number;
}

export function readPersistedActivities(value: unknown, now: number): Map<string, PersistedActivity> {
  const entries = new Map<string, PersistedActivity>();
  if (!Array.isArray(value)) return entries;
  for (const entry of value) {
    if (entry && typeof entry.identity === 'string' && entry.identity.length > 0
      && typeof entry.lastActivity === 'number' && Number.isFinite(entry.lastActivity)
      && entry.lastActivity >= 0 && entry.lastActivity <= now) {
      entries.set(entry.identity, { identity: entry.identity, lastActivity: entry.lastActivity });
    }
  }
  return entries;
}

export function restoreActivity(current: number, observed: boolean, existing: boolean, persisted?: number): number {
  return existing && !observed && persisted !== undefined ? persisted : current;
}
