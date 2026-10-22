export interface PersistedActivity {
  identity: string;
  lastActivity: number;
  baseName?: string;
  markedNameHash?: string;
}

export function readPersistedActivities(value: unknown, now: number): Map<string, PersistedActivity> {
  const entries = new Map<string, PersistedActivity>();
  if (!Array.isArray(value)) return entries;
  for (const entry of value) {
    if (entry && typeof entry.identity === 'string' && entry.identity.length > 0
      && typeof entry.lastActivity === 'number' && Number.isFinite(entry.lastActivity)
      && entry.lastActivity >= 0 && entry.lastActivity <= now) {
      const restored: PersistedActivity = { identity: entry.identity, lastActivity: entry.lastActivity };
      if (typeof entry.baseName === 'string' && entry.baseName.length <= 4096
        && typeof entry.markedNameHash === 'string' && /^[a-f0-9]{64}$/u.test(entry.markedNameHash)) {
        restored.baseName = entry.baseName;
        restored.markedNameHash = entry.markedNameHash;
      }
      entries.set(entry.identity, restored);
    }
  }
  return entries;
}

export function restoreActivity(current: number, observed: boolean, existing: boolean, persisted?: number): number {
  return existing && !observed && persisted !== undefined ? persisted : current;
}
