export type ActivityBucket = 'running' | 'recent' | 'parked' | 'stale';

export interface BucketThresholds {
  activeAfterHours: number;
  parkedAfterHours: number;
  staleAfterHours: number;
}

export interface SessionActivity {
  running: boolean;
  lastActivity: number;
}

export function classifySession(
  session: SessionActivity,
  now: number,
  thresholds: BucketThresholds,
): ActivityBucket {
  if (session.running) {
    return 'running';
  }

  const ageHours = Math.max(0, now - session.lastActivity) / 3_600_000;
  if (ageHours < thresholds.activeAfterHours) {
    return 'running';
  }
  if (ageHours < thresholds.parkedAfterHours) {
    return 'recent';
  }
  if (ageHours < thresholds.staleAfterHours) {
    return 'parked';
  }
  return 'stale';
}

export function formatAge(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
