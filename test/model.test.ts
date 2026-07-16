import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySession, detectActiveProcessRoots, formatAge, parseProcessSamples, stripNativeMarker } from '../src/model';

const hour = 3_600_000;
const thresholds = { activeAfterHours: 1, parkedAfterHours: 24, staleAfterHours: 168 };

test('running always wins regardless of age', () => {
  assert.equal(classifySession({ running: true, lastActivity: 0 }, 200 * hour, thresholds), 'running');
});

test('idle sessions move through active, recent, parked, and stale', () => {
  const now = 200 * hour;
  assert.equal(classifySession({ running: false, lastActivity: now - 30 * 60_000 }, now, thresholds), 'running');
  assert.equal(classifySession({ running: false, lastActivity: now - hour }, now, thresholds), 'recent');
  assert.equal(classifySession({ running: false, lastActivity: now - 24 * hour }, now, thresholds), 'parked');
  assert.equal(classifySession({ running: false, lastActivity: now - 168 * hour }, now, thresholds), 'stale');
});

test('age labels remain compact', () => {
  const now = 10 * 24 * hour;
  assert.equal(formatAge(now - 10_000, now), 'now');
  assert.equal(formatAge(now - 5 * 60_000, now), '5m');
  assert.equal(formatAge(now - 3 * hour, now), '3h');
  assert.equal(formatAge(now - 3 * 24 * hour, now), '3d');
});

test('native activity markers are completely removed', () => {
  assert.equal(stripNativeMarker('🟢 Active zsh'), 'zsh');
  assert.equal(stripNativeMarker('🟢 zsh'), 'zsh');
  assert.equal(stripNativeMarker('🟢 Active 🟡 Recent zsh'), 'zsh');
  assert.equal(stripNativeMarker('[1 RUN] project'), 'project');
  assert.equal(stripNativeMarker('🟢 Active'), 'Terminal');
  assert.equal(stripNativeMarker('zsh'), 'zsh');
});

test('process listings parse elapsed CPU time', () => {
  assert.deepEqual(
    parseProcessSamples('101 1 0:01.25\n202 101 1:02:03.50\ninvalid\n'),
    [
      { processId: 101, parentProcessId: 1, cpuSeconds: 1.25 },
      { processId: 202, parentProcessId: 101, cpuSeconds: 3723.5 },
    ],
  );
});

test('only new or CPU-active descendant processes activate a terminal root', () => {
  const previous = new Map([[10, 0.1], [20, 1], [30, 2]]);
  const samples = [
    { processId: 10, parentProcessId: 1, cpuSeconds: 0.1 },
    { processId: 20, parentProcessId: 10, cpuSeconds: 1.08 },
    { processId: 30, parentProcessId: 1, cpuSeconds: 2.01 },
    { processId: 40, parentProcessId: 30, cpuSeconds: 0 },
  ];
  assert.deepEqual([...detectActiveProcessRoots([10, 30], previous, samples, 0.05)].sort(), [10, 30]);
  assert.deepEqual([...detectActiveProcessRoots([10, 30], new Map(), samples, 0.05)], []);
});
