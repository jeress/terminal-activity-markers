import assert from 'node:assert/strict';
import test from 'node:test';
import { readPersistedActivities, restoreActivity } from '../src/state';

test('only valid identity-based timestamps are restored', () => {
  const entries = readPersistedActivities([
    { processId: 123, lastActivity: 10 },
    { identity: 'host:123:start', lastActivity: 10 },
    { identity: 'future', lastActivity: 101 },
    { identity: 'nan', lastActivity: NaN },
    { identity: 'negative', lastActivity: -1 }, null,
  ], 100);
  assert.deepEqual([...entries.keys()], ['host:123:start']);
  assert.equal(entries.get('host:123:different-start'), undefined);
  assert.equal(entries.get('other-host:123:start'), undefined);
  assert.equal(readPersistedActivities({}, 100).size, 0);
});

test('late restoration cannot overwrite observed work or a newly created terminal', () => {
  assert.equal(restoreActivity(100, true, true, 10), 100);
  assert.equal(restoreActivity(100, false, false, 10), 100);
  assert.equal(restoreActivity(0, false, true, 10), 10);
  assert.equal(restoreActivity(0, false, true), 0);
});
