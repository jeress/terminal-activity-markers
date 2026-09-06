import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifySession,
  detectActiveProcessRoots,
  parseProcessSamples,
  parseProcessTerminalDevices,
  stripNativeMarker,
} from '../src/model';

const hour = 3_600_000;
const thresholds = { activeAfterHours: 1, parkedAfterHours: 24 };

test('idle sessions move through the three visible buckets', () => {
  const now = 200 * hour;
  assert.equal(classifySession({ lastActivity: now - 30 * 60_000 }, now, thresholds), 'active');
  assert.equal(classifySession({ lastActivity: now - hour }, now, thresholds), 'recent');
  assert.equal(classifySession({ lastActivity: now - 24 * hour }, now, thresholds), 'parked');
  assert.equal(classifySession({ lastActivity: now - 168 * hour }, now, thresholds), 'parked');
});

test('native activity markers are completely removed', () => {
  assert.equal(stripNativeMarker('🟢 Active zsh'), 'Active zsh');
  assert.equal(stripNativeMarker('🟢 zsh'), 'zsh');
  assert.equal(stripNativeMarker('🟢 🟡 zsh'), 'zsh');
  assert.equal(stripNativeMarker('[1 RUN] project'), 'project');
  assert.equal(stripNativeMarker('🟢 Active'), 'Active');
  assert.equal(stripNativeMarker('Active project'), 'Active project');
  assert.equal(stripNativeMarker('Recent work'), 'Recent work');
  assert.equal(stripNativeMarker('Idle worker'), 'Idle worker');
  assert.equal(stripNativeMarker('zsh'), 'zsh');
});

test('CPU listings support Linux day durations and Windows ticks', () => {
  assert.equal(parseProcessSamples('101 1 2-01:02:03')[0].cpuSeconds, 176523);
  assert.equal(parseProcessSamples('101 1 15000000', true)[0].cpuSeconds, 1.5);
  assert.deepEqual(parseProcessSamples('101 1 1--2'), []);
});

test('process ancestry cycles and reset CPU counters do not produce activity', () => {
  assert.deepEqual([...detectActiveProcessRoots([1], new Map([[2, 10]]), [
    { processId: 2, parentProcessId: 3, cpuSeconds: 1 },
    { processId: 3, parentProcessId: 2, cpuSeconds: 5 },
  ], 0.5)], []);
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

test('terminal device listings accept safe tty paths', () => {
  assert.deepEqual(
    [...parseProcessTerminalDevices('101 ttys005\n202 pts/3\n303 ??\n404 ../../tmp/bad\n')],
    [[101, 'ttys005'], [202, 'pts/3']],
  );
});

test('only CPU-active descendant processes activate a terminal root', () => {
  const previous = new Map([[10, 0.1], [20, 1], [30, 2]]);
  const samples = [
    { processId: 10, parentProcessId: 1, cpuSeconds: 0.1 },
    { processId: 20, parentProcessId: 10, cpuSeconds: 1.08 },
    { processId: 30, parentProcessId: 1, cpuSeconds: 2.01 },
    { processId: 40, parentProcessId: 30, cpuSeconds: 0 },
  ];
  assert.deepEqual([...detectActiveProcessRoots([10, 30], previous, samples, 0.05)].sort(), [10]);
  assert.deepEqual([...detectActiveProcessRoots([10, 30], new Map(), samples, 0.05)], []);
});
