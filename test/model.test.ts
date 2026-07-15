import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySession, formatAge, stripNativeMarker } from '../src/model';

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
