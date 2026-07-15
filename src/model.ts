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

export function parseParentProcessIds(output: string): Set<number> {
  const parentProcessIds = new Set<number>();
  for (const line of output.split(/\r?\n/u)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/u);
    if (!match) continue;
    const processId = Number(match[1]);
    const parentProcessId = Number(match[2]);
    if (processId > 0 && parentProcessId > 0 && processId !== parentProcessId) {
      parentProcessIds.add(parentProcessId);
    }
  }
  return parentProcessIds;
}

const LEGACY_ACTIVITY_LABEL = String.raw`(?:\[[0-9] (?:RUN|WAIT|IDLE|PARK|STALE)\]|Active|Recent|Idle)`;
const NATIVE_NAME_MARKER = new RegExp(
  String.raw`^(?:(?:[🟢🟡⚪]\s*)(?:${LEGACY_ACTIVITY_LABEL}(?:\s+|$))?|${LEGACY_ACTIVITY_LABEL}(?:\s+|$))`,
  'u',
);

export function stripNativeMarker(value: string): string {
  let stripped = value;
  while (NATIVE_NAME_MARKER.test(stripped)) {
    stripped = stripped.replace(NATIVE_NAME_MARKER, '');
  }
  return stripped.trimStart() || 'Terminal';
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
