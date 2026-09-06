export type ActivityBucket = 'active' | 'recent' | 'parked';

export interface BucketThresholds {
  activeAfterHours: number;
  parkedAfterHours: number;
}

export interface SessionActivity {
  lastActivity: number;
}

export interface ProcessSample {
  processId: number;
  parentProcessId: number;
  cpuSeconds: number;
}

export function parseProcessSamples(output: string, cpuValueIsTicks = false): ProcessSample[] {
  const samples: ProcessSample[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d:.-]+)$/u);
    if (!match) continue;
    const processId = Number(match[1]);
    const parentProcessId = Number(match[2]);
    const cpuSeconds = cpuValueIsTicks
      ? Number(match[3]) / 10_000_000
      : parseCpuDuration(match[3]);
    if (processId <= 0 || parentProcessId < 0 || !Number.isFinite(cpuSeconds)) continue;
    samples.push({ processId, parentProcessId, cpuSeconds });
  }
  return samples;
}

export function parseProcessTerminalDevices(output: string): Map<number, string> {
  const devices = new Map<number, string>();
  for (const line of output.split(/\r?\n/u)) {
    const match = line.trim().match(/^(\d+)\s+([a-zA-Z0-9/_-]+)$/u);
    if (!match || match[2] === '??' || match[2].includes('..')) continue;
    devices.set(Number(match[1]), match[2]);
  }
  return devices;
}

export function detectActiveProcessRoots(
  rootProcessIds: Iterable<number>,
  previousCpuByProcessId: ReadonlyMap<number, number>,
  samples: readonly ProcessSample[],
  minimumCpuDeltaSeconds: number,
): Set<number> {
  const roots = new Set(rootProcessIds);
  const parentByProcessId = new Map(samples.map((sample) => [sample.processId, sample.parentProcessId]));
  const activeRoots = new Set<number>();
  for (const sample of samples) {
    const root = findProcessRoot(sample.processId, roots, parentByProcessId);
    if (root === undefined) continue;
    const previousCpu = previousCpuByProcessId.get(sample.processId);
    const usedCpu = previousCpu !== undefined && sample.cpuSeconds - previousCpu >= minimumCpuDeltaSeconds;
    if (usedCpu) activeRoots.add(root);
  }

  return activeRoots;
}

function parseCpuDuration(value: string): number {
  const match = value.match(/^(?:(\d+)-)?(\d+(?::\d+){0,2}(?:\.\d+)?)$/u);
  if (!match) return Number.NaN;
  const parts = match[2].split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return Number.NaN;
  return Number(match[1] ?? 0) * 86400 + parts.reduce((total, part) => total * 60 + part, 0);
}

function findProcessRoot(
  processId: number,
  roots: ReadonlySet<number>,
  parentByProcessId: ReadonlyMap<number, number>,
): number | undefined {
  let current = processId;
  const visited = new Set<number>();
  while (current > 0 && !visited.has(current)) {
    if (roots.has(current)) return current;
    visited.add(current);
    current = parentByProcessId.get(current) ?? 0;
  }
  return undefined;
}

const LEGACY_ACTIVITY_LABEL = String.raw`\[[0-9] (?:RUN|WAIT|IDLE|PARK|STALE)\]`;
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
  const ageHours = Math.max(0, now - session.lastActivity) / 3_600_000;
  if (ageHours < thresholds.activeAfterHours) {
    return 'active';
  }
  if (ageHours < thresholds.parkedAfterHours) {
    return 'recent';
  }
  return 'parked';
}
